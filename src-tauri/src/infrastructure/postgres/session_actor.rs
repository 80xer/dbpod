use std::sync::atomic::{AtomicBool, AtomicI32, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use futures_util::TryStreamExt;
use sqlx::postgres::PgConnectOptions;
use sqlx::{AssertSqlSafe, Connection, Executor, PgConnection, SqlSafeStr, Statement};
use tokio::sync::{mpsc, oneshot, Semaphore};
use tokio_util::sync::CancellationToken;

use crate::domain::events::{ColumnMeta, QueryExecuteRequest, QueryStreamEvent, TransactionState};
use crate::domain::DbValue;
use crate::error::AppError;

use super::decoder;

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
    ) -> Self {
        Self {
            id,
            session_id,
            connection_id,
            cancel: CancellationToken::new(),
            terminal: AtomicBool::new(false),
            backend_pid,
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
    let handle = SessionHandle {
        session_id,
        query_tab_id,
        tx,
        busy: busy.clone(),
        backend_pid: backend_pid.clone(),
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
                    run_execution(
                        &mut conn,
                        &opts,
                        read_only,
                        &backend_pid,
                        &mut txn,
                        &request,
                        &execution,
                        &sink,
                    )
                    .await;
                    execution.terminal.store(true, Ordering::Release);
                    // wake any pending backpressure waiters so nothing leaks
                    execution.cancel.cancel();
                    busy.store(false, Ordering::Release);
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
pub fn first_keyword(sql: &str) -> String {
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
    rest.split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .next()
        .unwrap_or("")
        .to_ascii_uppercase()
}

fn txn_after_success(txn: TransactionState, sql: &str) -> TransactionState {
    match first_keyword(sql).as_str() {
        "BEGIN" | "START" => TransactionState::InTransaction,
        "COMMIT" | "END" | "ROLLBACK" | "ABORT" => TransactionState::Idle,
        _ => txn,
    }
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
) {
    let start = Instant::now();
    let eid = exec.id.clone();
    let duration = |s: &Instant| s.elapsed().as_millis() as u64;

    macro_rules! fail {
        ($err:expr) => {{
            *txn = txn_after_error(*txn);
            sink(QueryStreamEvent::Failed {
                execution_id: eid.clone(),
                error: $err,
                duration_ms: duration(&start),
                transaction_state: *txn,
            });
            return;
        }};
    }

    // 1. lazy dedicated connection
    if conn_slot.is_none() {
        let mut c = match PgConnection::connect_with(opts).await {
            Ok(c) => c,
            Err(e) => fail!(AppError::from_sqlx(&e)),
        };
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut c)
            .await
            .unwrap_or(0);
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

    // 2. per-execution server-side timeout (validated integer, safe to inline)
    if let Err(e) = sqlx::raw_sql(AssertSqlSafe(format!(
        "SET statement_timeout = {}",
        req.timeout_ms
    )))
    .execute(&mut *conn)
    .await
    {
        fail!(AppError::from_sqlx(&e));
    }

    sink(QueryStreamEvent::Started {
        execution_id: eid.clone(),
        backend_pid: backend_pid.load(Ordering::Acquire),
        started_at: chrono::Utc::now().to_rfc3339(),
    });

    // 3. prepare: extended protocol rejects multi-statement SQL and
    //    reports syntax error position. User-authored SQL is the product;
    //    AssertSqlSafe is the deliberate audit point for it.
    let stmt = match (&mut *conn)
        .prepare(AssertSqlSafe(req.sql.clone()).into_sql_str())
        .await
    {
        Ok(s) => s,
        Err(e) => fail!(AppError::from_sqlx(&e)),
    };
    let columns: Vec<ColumnMeta> = decoder::column_meta(stmt.columns());
    let has_result_set = !columns.is_empty();
    if has_result_set {
        sink(QueryStreamEvent::Columns {
            execution_id: eid.clone(),
            columns,
        });
    }

    // 4. stream rows with chunking, backpressure and cancellation
    let mut buf: Vec<Vec<DbValue>> = Vec::new();
    let mut seq: u64 = 0;
    let mut total: u64 = 0;
    let mut truncated = false;
    let mut affected: Option<u64> = None;
    let mut cancelled = exec.cancel.is_cancelled();
    let mut sql_err: Option<sqlx::Error> = None;

    if has_result_set {
        let mut stream = stmt.query().fetch(&mut *conn);
        while !cancelled {
            let item = tokio::select! {
                biased;
                _ = exec.cancel.cancelled() => {
                    cancelled = true;
                    break;
                }
                item = stream.try_next() => item,
            };
            match item {
                Ok(Some(row)) => {
                    buf.push(decoder::decode_row(&row));
                    total += 1;
                    let limit = if seq == 0 {
                        FIRST_CHUNK_ROWS
                    } else {
                        CHUNK_ROWS
                    };
                    if buf.len() >= limit && !flush_chunk(&mut buf, &mut seq, exec, sink).await {
                        cancelled = true;
                        break;
                    }
                    if total >= req.max_rows as u64 {
                        truncated = true;
                        break;
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    sql_err = Some(e);
                    break;
                }
            }
        }
        drop(stream);
    } else if !cancelled {
        let done = tokio::select! {
            biased;
            _ = exec.cancel.cancelled() => {
                cancelled = true;
                None
            }
            r = stmt.query().execute(&mut *conn) => Some(r),
        };
        match done {
            Some(Ok(res)) => affected = Some(res.rows_affected()),
            Some(Err(e)) => sql_err = Some(e),
            None => {}
        }
    }

    if !cancelled && sql_err.is_none() && !buf.is_empty() {
        cancelled = !flush_chunk(&mut buf, &mut seq, exec, sink).await;
    }

    // 5. exactly one terminal event, emitted only here
    let duration_ms = duration(&start);
    let user_cancelled = exec.cancel.is_cancelled();
    let err_is_cancel = sql_err
        .as_ref()
        .map(|e| AppError::from_sqlx(e).sql_state.as_deref() == Some("57014"))
        .unwrap_or(false);

    if cancelled || (err_is_cancel && user_cancelled) {
        *txn = txn_after_error(*txn);
        sink(QueryStreamEvent::Cancelled {
            execution_id: eid,
            received_row_count: total,
            duration_ms,
            transaction_state: *txn,
        });
    } else if let Some(e) = sql_err {
        let mut err = AppError::from_sqlx(&e);
        if err_is_cancel {
            // statement_timeout fired without a user cancel
            err.code = "QUERY_TIMEOUT".into();
        }
        *txn = txn_after_error(*txn);
        sink(QueryStreamEvent::Failed {
            execution_id: eid,
            error: err,
            duration_ms,
            transaction_state: *txn,
        });
    } else {
        if !has_result_set {
            sink(QueryStreamEvent::Command {
                execution_id: eid.clone(),
                command_tag: first_keyword(&req.sql),
                affected_rows: affected,
            });
        }
        *txn = txn_after_success(*txn, &req.sql);
        sink(QueryStreamEvent::Completed {
            execution_id: eid,
            row_count: total,
            truncated,
            duration_ms,
            transaction_state: *txn,
        });
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
    }

    #[test]
    fn ack_window_is_idempotent_and_rejects_unsent() {
        let exec = ExecutionState::new(
            "e".into(),
            "s".into(),
            "c".into(),
            Arc::new(AtomicI32::new(0)),
        );
        assert_eq!(exec.ack(0).unwrap_err().code, "INVALID_REQUEST");
        exec.sent.store(1, Ordering::Release);
        exec.ack(0).unwrap();
        exec.ack(0).unwrap(); // duplicate ok
        exec.ack(1).unwrap();
        assert_eq!(exec.ack(5).unwrap_err().code, "INVALID_REQUEST");
    }
}
