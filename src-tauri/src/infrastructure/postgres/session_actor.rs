use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::{FutureExt, TryStreamExt};
use sqlx::postgres::PgConnectOptions;
use sqlx::{AssertSqlSafe, Connection, Either, Executor, PgConnection, Row, SqlSafeStr, Statement};
use tokio::sync::{mpsc, oneshot, Semaphore};
use tokio_util::sync::CancellationToken;

use crate::domain::events::{ColumnMeta, QueryExecuteRequest, QueryStreamEvent, TransactionState};
use crate::domain::DbValue;
use crate::error::AppError;

use super::decoder;
use super::large_values::{LargeValueStore, MAX_FETCH_BYTES, RESULT_PAGE_ROWS};

/// Delivers one stream event; returns false when the consumer is gone
/// (disposed webview) so the execution stops instead of buffering forever.
pub type EventSink = Arc<dyn Fn(QueryStreamEvent) -> bool + Send + Sync>;

const MAX_UNACKED_CHUNKS: usize = 2;
const FIRST_CHUNK_ROWS: usize = 50;
const CHUNK_ROWS: usize = 100;

pub struct ExecutionState {
    pub id: String,
    pub session_id: String,
    pub connection_id: String,
    pub cancel: CancellationToken,
    pub terminal: AtomicBool,
    pub backend_pid: Arc<AtomicI32>,
    /// Out-of-band store for values beyond the inline limit (keyed per Result Tab).
    pub large: Arc<LargeValueStore>,
    ack_sem: Arc<Semaphore>,
    sent: AtomicI64,
    acked: Mutex<i64>,
}

impl ExecutionState {
    pub fn new(
        id: String,
        session_id: String,
        connection_id: String,
        backend_pid: Arc<AtomicI32>,
        large: Arc<LargeValueStore>,
    ) -> Self {
        Self {
            id,
            session_id,
            connection_id,
            cancel: CancellationToken::new(),
            terminal: AtomicBool::new(false),
            backend_pid,
            large,
            ack_sem: Arc::new(Semaphore::new(MAX_UNACKED_CHUNKS)),
            sent: AtomicI64::new(-1),
            acked: Mutex::new(-1),
        }
    }

    /// Idempotent for repeated acks; acking a never-sent sequence is a protocol error.
    pub fn ack(&self, sequence: u64) -> Result<(), AppError> {
        let seq = sequence as i64;
        if seq > self.sent.load(Ordering::Acquire) {
            return Err(AppError::invalid_request(
                "ack for a chunk that was never sent",
            ));
        }
        let mut acked = self.acked.lock().unwrap();
        if seq <= *acked {
            return Ok(());
        }
        let release = (seq - *acked) as usize;
        *acked = seq;
        self.ack_sem.add_permits(release);
        Ok(())
    }

    pub fn is_terminal(&self) -> bool {
        self.terminal.load(Ordering::Acquire)
    }
}

pub enum SessionMsg {
    Execute {
        request: QueryExecuteRequest,
        execution: Arc<ExecutionState>,
        sink: EventSink,
    },
    Close {
        rollback: bool,
        reply: oneshot::Sender<()>,
    },
}

#[derive(Clone)]
pub struct SessionHandle {
    pub session_id: String,
    pub query_tab_id: String,
    pub tx: mpsc::Sender<SessionMsg>,
    pub busy: Arc<AtomicBool>,
    pub backend_pid: Arc<AtomicI32>,
    pub transaction: Arc<Mutex<TransactionState>>,
}

/// One actor per Query Tab: owns a lazy dedicated PgConnection, processes one
/// execution at a time (structurally — the loop finishes an Execute before
/// receiving the next message), tracks transaction state, cleans up on Close.
pub fn spawn_session(
    session_id: String,
    query_tab_id: String,
    opts: PgConnectOptions,
    read_only: bool,
) -> SessionHandle {
    let (tx, mut rx) = mpsc::channel::<SessionMsg>(4);
    let busy = Arc::new(AtomicBool::new(false));
    let backend_pid = Arc::new(AtomicI32::new(0));
    let transaction = Arc::new(Mutex::new(TransactionState::Idle));
    let handle = SessionHandle {
        session_id,
        query_tab_id,
        tx,
        busy: busy.clone(),
        backend_pid: backend_pid.clone(),
        transaction: transaction.clone(),
    };

    tauri::async_runtime::spawn(async move {
        let mut conn: Option<PgConnection> = None;
        let mut txn = TransactionState::Idle;
        while let Some(msg) = rx.recv().await {
            match msg {
                SessionMsg::Execute {
                    request,
                    execution,
                    sink,
                } => {
                    let started = Instant::now();
                    let outcome = {
                        let running = AssertUnwindSafe(run_execution(
                            &mut conn,
                            &opts,
                            read_only,
                            &backend_pid,
                            &mut txn,
                            &request,
                            &execution,
                            &sink,
                        ))
                        .catch_unwind();
                        tokio::pin!(running);
                        let first = tokio::select! {
                            result = &mut running => Some(result),
                            _ = execution.cancel.cancelled() => None,
                            _ = tokio::time::sleep(Duration::from_millis(u64::from(request.timeout_ms) + 2_000)) => None,
                        };
                        match first {
                            Some(result) => Some(result),
                            None => {
                                // A fresh connection keeps cancellation independent of metadata/edit locks.
                                let cancelled = tokio::time::timeout(
                                    Duration::from_secs(2),
                                    cancel_backend(&opts, backend_pid.load(Ordering::Acquire)),
                                )
                                .await;
                                match cancelled {
                                    Ok(Ok(())) => {
                                        tokio::time::timeout(Duration::from_secs(2), &mut running)
                                            .await
                                            .ok()
                                    }
                                    _ => None,
                                }
                            }
                        }
                    };
                    let terminal = match outcome {
                        Some(Ok(event)) => event,
                        _ => {
                            if let Some(c) = conn.take() {
                                let _ = c.close_hard().await;
                            }
                            backend_pid.store(0, Ordering::Release);
                            txn = TransactionState::Idle;
                            QueryStreamEvent::Failed {
                                execution_id: execution.id.clone(),
                                error: AppError::new("QUERY_OUTCOME_UNKNOWN", "Session closed before the server outcome could be confirmed. Check the database before retrying writes."),
                                duration_ms: started.elapsed().as_millis() as u64,
                                transaction_state: txn,
                            }
                        }
                    };
                    *transaction.lock().unwrap() = txn;
                    execution.terminal.store(true, Ordering::Release);
                    busy.store(false, Ordering::Release);
                    sink(terminal);
                }
                SessionMsg::Close { rollback, reply } => {
                    if let Some(mut c) = conn.take() {
                        if rollback && txn != TransactionState::Idle {
                            let _ = sqlx::raw_sql("ROLLBACK").execute(&mut c).await;
                        }
                        let _ = c.close().await;
                    }
                    let _ = reply.send(());
                    break;
                }
            }
        }
    });

    handle
}

/// First keyword of the SQL, skipping leading whitespace and comments.
/// Used for the command tag approximation and transaction-state tracking.
/// ponytail: replace with server ReadyForQuery status if sqlx ever exposes it.
fn skip_comments(sql: &str) -> &str {
    let mut rest = sql;
    loop {
        rest = rest.trim_start();
        if let Some(after) = rest.strip_prefix("--") {
            rest = after.split_once('\n').map(|(_, r)| r).unwrap_or("");
        } else if let Some(after) = rest.strip_prefix("/*") {
            // block comments nest in PostgreSQL
            let mut depth = 1;
            let mut r = after;
            while depth > 0 {
                match (r.find("/*"), r.find("*/")) {
                    (Some(open), Some(close)) if open < close => {
                        depth += 1;
                        r = &r[open + 2..];
                    }
                    (_, Some(close)) => {
                        depth -= 1;
                        r = &r[close + 2..];
                    }
                    _ => {
                        r = "";
                        break;
                    }
                }
            }
            rest = r;
        } else {
            break;
        }
    }
    rest
}

pub fn first_keyword(sql: &str) -> String {
    skip_comments(sql)
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .next()
        .unwrap_or("")
        .to_ascii_uppercase()
}

fn command_words(sql: &str) -> Vec<String> {
    let mut rest = sql;
    let mut tokens = Vec::new();
    for _ in 0..5 {
        rest = skip_comments(rest);
        let word = first_keyword(rest);
        if word.is_empty() {
            break;
        }
        rest = &rest[word.len()..];
        tokens.push(word);
    }
    tokens
}

fn txn_after_success(txn: TransactionState, sql: &str) -> TransactionState {
    let tokens = command_words(sql);
    match first_keyword(sql).as_str() {
        "BEGIN" | "START" => TransactionState::InTransaction,
        "ROLLBACK" if tokens.iter().any(|s| s == "TO") => TransactionState::InTransaction,
        "COMMIT" | "END" | "ROLLBACK" | "ABORT" => {
            if tokens.windows(2).any(|w| w == ["AND", "CHAIN"]) {
                TransactionState::InTransaction
            } else {
                TransactionState::Idle
            }
        }
        "PREPARE" if tokens.get(1).map(String::as_str) == Some("TRANSACTION") => {
            TransactionState::Idle
        }
        _ => txn,
    }
}

async fn cancel_backend(opts: &PgConnectOptions, pid: i32) -> Result<(), sqlx::Error> {
    if pid == 0 {
        return Ok(());
    }
    let mut control = PgConnection::connect_with(opts).await?;
    let _: bool = sqlx::query_scalar("SELECT pg_cancel_backend($1)")
        .bind(pid)
        .fetch_one(&mut control)
        .await?;
    control.close().await
}

fn txn_after_error(txn: TransactionState) -> TransactionState {
    match txn {
        TransactionState::InTransaction | TransactionState::FailedTransaction => {
            TransactionState::FailedTransaction
        }
        TransactionState::Idle => TransactionState::Idle,
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_execution(
    conn_slot: &mut Option<PgConnection>,
    opts: &PgConnectOptions,
    read_only: bool,
    backend_pid: &AtomicI32,
    txn: &mut TransactionState,
    req: &QueryExecuteRequest,
    exec: &Arc<ExecutionState>,
    sink: &EventSink,
) -> QueryStreamEvent {
    let start = Instant::now();
    let eid = exec.id.clone();
    let mut started_sent = false;
    macro_rules! fail {
        ($err:expr) => {{
            if !started_sent {
                sink(QueryStreamEvent::Started {
                    execution_id: eid.clone(),
                    backend_pid: backend_pid.load(Ordering::Acquire),
                    started_at: chrono::Utc::now().to_rfc3339(),
                });
            }
            *txn = txn_after_error(*txn);
            return QueryStreamEvent::Failed {
                execution_id: eid.clone(),
                error: $err,
                duration_ms: start.elapsed().as_millis() as u64,
                transaction_state: *txn,
            };
        }};
    }
    if conn_slot.is_none() {
        let mut c = match PgConnection::connect_with(opts).await {
            Ok(c) => c,
            Err(e) => fail!(AppError::from_sqlx(&e)),
        };
        let pid = match sqlx::query_scalar::<_, i32>("SELECT pg_backend_pid()")
            .fetch_one(&mut c)
            .await
        {
            Ok(pid) => pid,
            Err(e) => fail!(AppError::from_sqlx(&e)),
        };
        backend_pid.store(pid, Ordering::Release);
        if read_only {
            if let Err(e) = sqlx::raw_sql("SET default_transaction_read_only = on")
                .execute(&mut c)
                .await
            {
                fail!(AppError::from_sqlx(&e));
            }
        }
        *conn_slot = Some(c);
    }
    let conn = conn_slot.as_mut().unwrap();
    sink(QueryStreamEvent::Started {
        execution_id: eid.clone(),
        backend_pid: backend_pid.load(Ordering::Acquire),
        started_at: chrono::Utc::now().to_rfc3339(),
    });
    started_sent = true;
    // SET cannot run inside an aborted transaction. Let recovery statements reach PostgreSQL.
    if *txn != TransactionState::FailedTransaction {
        if let Err(e) = sqlx::raw_sql(AssertSqlSafe(format!(
            "SET statement_timeout = {}",
            req.timeout_ms
        )))
        .execute(&mut *conn)
        .await
        {
            fail!(AppError::from_sqlx(&e));
        }
    }
    if exec.cancel.is_cancelled() {
        return QueryStreamEvent::Cancelled {
            execution_id: eid,
            received_row_count: 0,
            duration_ms: start.elapsed().as_millis() as u64,
            transaction_state: *txn,
        };
    }
    let stmt = match (&mut *conn)
        .prepare(AssertSqlSafe(req.sql.clone()).into_sql_str())
        .await
    {
        Ok(s) => s,
        Err(e) => {
            let _ = conn.ping().await;
            fail!(AppError::from_sqlx(&e));
        }
    };
    let columns: Vec<ColumnMeta> = decoder::column_meta(stmt.columns());
    let has_result_set = !columns.is_empty();
    if has_result_set {
        sink(QueryStreamEvent::Columns {
            execution_id: eid.clone(),
            columns,
        });
    }
    if exec.cancel.is_cancelled() {
        return QueryStreamEvent::Cancelled {
            execution_id: eid,
            received_row_count: 0,
            duration_ms: start.elapsed().as_millis() as u64,
            transaction_state: *txn,
        };
    }

    let mut buf = Vec::new();
    let mut seq = 0;
    let mut total = 0;
    let mut chunk_bytes = 0usize;
    let mut truncated = false;
    let mut affected = None;
    let mut sql_err = None;
    let mut receiving = true;
    {
        // Always drain through ReadyForQuery: rows and CommandComplete do not prove commit succeeded.
        let mut stream = (&mut *conn).fetch_many(stmt.query());
        loop {
            match stream.try_next().await {
                Ok(Some(Either::Right(row))) => {
                    if !receiving || (!exec.large.paged && total >= u64::from(req.max_rows)) {
                        truncated = true;
                        continue;
                    }
                    let raw_bytes: usize = (0..row.len())
                        .map(|i| {
                            row.try_get_raw(i)
                                .ok()
                                .and_then(|v| v.as_bytes().ok().map(|b| b.len()))
                                .unwrap_or(0)
                        })
                        .sum();
                    if !exec.large.reserve_row(raw_bytes, row.len()) {
                        receiving = false;
                        truncated = true;
                        continue;
                    }
                    let decoded = decoder::decode_row(&row, &exec.large);
                    let payload_bytes = serde_json::to_vec(&decoded)
                        .map(|b| b.len())
                        .unwrap_or(usize::MAX);
                    if payload_bytes > MAX_FETCH_BYTES {
                        // Keep a complete prefix. Never cut or replace a value to make it fit IPC.
                        receiving = false;
                        truncated = true;
                        continue;
                    }
                    // IPC size is independent of the retained-memory estimate, including JSON escaping.
                    if !buf.is_empty()
                        && chunk_bytes.saturating_add(payload_bytes) > MAX_FETCH_BYTES
                    {
                        if !flush_chunk(&mut buf, &mut seq, exec, sink).await {
                            receiving = false;
                            truncated = true;
                        }
                        chunk_bytes = 0;
                    }
                    if !receiving {
                        continue;
                    }
                    if exec.large.paged {
                        if total >= RESULT_PAGE_ROWS as u64 {
                            exec.large.retain_row(decoded);
                            total += 1;
                            continue;
                        }
                        exec.large.retain_row(decoded.clone());
                    }
                    chunk_bytes += payload_bytes;
                    buf.push(decoded);
                    total += 1;
                    let limit = if exec.large.paged {
                        RESULT_PAGE_ROWS
                    } else if seq == 0 {
                        FIRST_CHUNK_ROWS
                    } else {
                        CHUNK_ROWS
                    };
                    if buf.len() >= limit || (exec.large.paged && total == RESULT_PAGE_ROWS as u64)
                    {
                        if !flush_chunk(&mut buf, &mut seq, exec, sink).await {
                            receiving = false;
                            truncated = true;
                        }
                        chunk_bytes = 0;
                    }
                }
                Ok(Some(Either::Left(done))) => affected = Some(done.rows_affected()),
                Ok(None) => break,
                Err(e) => {
                    sql_err = Some(e);
                    break;
                }
            }
        }
    }
    // Consume the pending ReadyForQuery after errors, without issuing SQL in an aborted transaction.
    if sql_err.is_some() && conn.ping().await.is_err() {
        if let Some(c) = conn_slot.take() {
            let _ = c.close_hard().await;
        }
        backend_pid.store(0, Ordering::Release);
        *txn = TransactionState::Idle;
    }
    if sql_err.is_none() && !buf.is_empty() && !flush_chunk(&mut buf, &mut seq, exec, sink).await {
        truncated = true;
    }
    total = total.saturating_sub(buf.len() as u64);
    let duration_ms = start.elapsed().as_millis() as u64;
    if let Some(e) = sql_err {
        let mut error = match &e {
            sqlx::Error::Database(_) => AppError::from_sqlx(&e),
            _ => AppError::new("QUERY_OUTCOME_UNKNOWN", "Connection lost before the server outcome could be confirmed. Check the database before retrying writes."),
        };
        let words = command_words(&req.sql);
        // COMMIT errors abort and finish the transaction, even with AND CHAIN.
        // COMMIT PREPARED operates on a different transaction and is excluded.
        *txn = if matches!(words.first().map(String::as_str), Some("COMMIT" | "END"))
            && words.get(1).map(String::as_str) != Some("PREPARED")
        {
            TransactionState::Idle
        } else {
            txn_after_error(*txn)
        };
        if error.sql_state.as_deref() == Some("57014") {
            if exec.cancel.is_cancelled() {
                return QueryStreamEvent::Cancelled {
                    execution_id: eid,
                    received_row_count: total,
                    duration_ms,
                    transaction_state: *txn,
                };
            }
            error.code = "QUERY_TIMEOUT".into();
        }
        QueryStreamEvent::Failed {
            execution_id: eid,
            error,
            duration_ms,
            transaction_state: *txn,
        }
    } else {
        if !has_result_set
            || !matches!(
                first_keyword(&req.sql).as_str(),
                "SELECT" | "SHOW" | "EXPLAIN" | "VALUES" | "TABLE"
            )
        {
            sink(QueryStreamEvent::Command {
                execution_id: eid.clone(),
                command_tag: if *txn == TransactionState::FailedTransaction
                    && matches!(first_keyword(&req.sql).as_str(), "COMMIT" | "END")
                {
                    "ROLLBACK".into()
                } else {
                    first_keyword(&req.sql)
                },
                affected_rows: affected,
            });
        }
        *txn = txn_after_success(*txn, &req.sql);
        QueryStreamEvent::Completed {
            execution_id: eid,
            row_count: total,
            truncated,
            duration_ms,
            transaction_state: *txn,
        }
    }
}

/// Sends one rows chunk, honoring the max-2-unacked-chunks window.
/// Returns false when the execution was cancelled or the consumer is gone.
async fn flush_chunk(
    buf: &mut Vec<Vec<DbValue>>,
    seq: &mut u64,
    exec: &Arc<ExecutionState>,
    sink: &EventSink,
) -> bool {
    let permit = tokio::select! {
        biased;
        _ = exec.cancel.cancelled() => return false,
        _ = tokio::time::sleep(Duration::from_secs(5)) => { exec.cancel.cancel(); return false; },
        p = exec.ack_sem.clone().acquire_owned() => match p {
            Ok(p) => p,
            Err(_) => return false,
        },
    };
    permit.forget(); // released by query_ack_chunk
    exec.sent.store(*seq as i64, Ordering::Release);
    let delivered = sink(QueryStreamEvent::Rows {
        execution_id: exec.id.clone(),
        sequence: *seq,
        rows: std::mem::take(buf),
    });
    *seq += 1;
    if !delivered {
        exec.cancel.cancel();
    }
    delivered
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_keyword_skips_comments_and_whitespace() {
        assert_eq!(first_keyword("select 1"), "SELECT");
        assert_eq!(first_keyword("  -- note\n  BEGIN;"), "BEGIN");
        assert_eq!(first_keyword("/* x /* y */ */ commit"), "COMMIT");
        assert_eq!(first_keyword(""), "");
    }

    #[test]
    fn txn_state_machine() {
        use TransactionState::*;
        assert_eq!(txn_after_success(Idle, "begin"), InTransaction);
        assert_eq!(txn_after_success(InTransaction, "select 1"), InTransaction);
        assert_eq!(txn_after_success(InTransaction, "commit"), Idle);
        assert_eq!(txn_after_success(FailedTransaction, "rollback"), Idle);
        assert_eq!(txn_after_error(InTransaction), FailedTransaction);
        assert_eq!(txn_after_error(Idle), Idle);
        assert_eq!(
            txn_after_success(FailedTransaction, "ROLLBACK TO SAVEPOINT x"),
            InTransaction
        );
        assert_eq!(
            txn_after_success(InTransaction, "COMMIT /* AND CHAIN */"),
            Idle
        );
        assert_eq!(
            txn_after_success(InTransaction, "COMMIT AND /* note */ CHAIN"),
            InTransaction
        );
        assert_eq!(txn_after_success(InTransaction, "ROLLBACK -- TO x\n"), Idle);
    }

    #[test]
    fn ack_window_is_idempotent_and_rejects_unsent() {
        let exec = ExecutionState::new(
            "e".into(),
            "s".into(),
            "c".into(),
            Arc::new(AtomicI32::new(0)),
            Arc::new(LargeValueStore::default()),
        );
        assert_eq!(exec.ack(0).unwrap_err().code, "INVALID_REQUEST");
        exec.sent.store(1, Ordering::Release);
        exec.ack(0).unwrap();
        exec.ack(0).unwrap(); // duplicate ok
        exec.ack(1).unwrap();
        assert_eq!(exec.ack(5).unwrap_err().code, "INVALID_REQUEST");
    }
}
