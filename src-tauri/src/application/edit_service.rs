use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine;
use sqlx::postgres::PgRow;
use sqlx::{Column, Connection, Row, SqlSafeStr};
use uuid::Uuid;

use crate::application::metadata_service::{self, quote_ident};
use crate::domain::db_value::DbValue;
use crate::domain::editing::*;
use crate::domain::metadata::{MetadataGetTableRequest, TableColumnMetadata, TableMetadata};
use crate::error::AppError;
use crate::infrastructure::postgres::decoder;
use crate::infrastructure::postgres::large_values::LargeValueStore;
use crate::state::AppState;

pub type CommitSink = Arc<dyn Fn(ChangesCommitEvent) -> bool + Send + Sync>;

const MAX_BATCH_ROWS: usize = 500;

#[derive(Debug, Clone)]
pub enum BindParam {
    Text(Option<String>),
    Bytea(Vec<u8>),
}

#[derive(Debug, Clone)]
pub struct RowPlan {
    pub row_id: String,
    /// "insert" | "update" | "delete"
    pub operation: String,
    pub sql: String,
    pub params: Vec<BindParam>,
    /// PK conditions alone, for the conflict re-read (sql, params).
    pub pk_lookup: Option<(String, Vec<BindParam>)>,
}

pub struct ChangeSet {
    pub connection_id: String,
    pub database: String,
    pub result_tab_id: String,
    pub metadata: TableMetadata,
    pub expires: Instant,
    pub target: ChangeTarget,
    pub plans: Vec<RowPlan>,
}

fn to_bind(v: &DbValue) -> Result<BindParam, AppError> {
    Ok(match v {
        DbValue::Null => BindParam::Text(None),
        DbValue::Boolean { value } => {
            BindParam::Text(Some(if *value { "true" } else { "false" }.into()))
        }
        DbValue::Binary {
            value: Some(b64), ..
        } => BindParam::Bytea(
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|_| AppError::invalid_request("invalid base64 binary value"))?,
        ),
        DbValue::Binary { value: None, .. } => {
            return Err(AppError::invalid_request(
                "large binary values cannot be edited",
            ))
        }
        DbValue::Array { .. } => {
            return Err(AppError::invalid_request(
                "array editing is not supported in MVP",
            ))
        }
        DbValue::Integer { value }
        | DbValue::Decimal { value }
        | DbValue::Float { value }
        | DbValue::Text { value }
        | DbValue::Uuid { value }
        | DbValue::Temporal { value, .. }
        | DbValue::Json { value, .. }
        | DbValue::Enum { value, .. }
        | DbValue::Network { value, .. }
        | DbValue::Range { value, .. }
        | DbValue::Composite { value, .. }
        | DbValue::Unknown { value, .. } => BindParam::Text(Some(value.clone())),
    })
}

struct Planner<'a> {
    meta: &'a TableMetadata,
}

impl<'a> Planner<'a> {
    fn col(&self, name: &str) -> Result<&'a TableColumnMetadata, AppError> {
        self.meta
            .columns
            .iter()
            .find(|c| c.name == name)
            .ok_or_else(|| AppError::invalid_request(format!("unknown column: {name}")))
    }

    /// `$n::type` — the cast type text comes from the catalog (format_type),
    /// never from user input; values themselves always travel as binds.
    fn param(&self, n: usize, col: &TableColumnMetadata) -> String {
        format!("${}::{}", n, col.pg_type_name)
    }

    fn returning(&self) -> String {
        "RETURNING xmin::text AS __dbpod_xmin, *".to_string()
    }

    fn table(&self) -> String {
        format!(
            "{}.{}",
            quote_ident(&self.meta.schema),
            quote_ident(&self.meta.name)
        )
    }

    fn validate_identity(&self, identity: &RowIdentity) -> Result<(), AppError> {
        if identity.relation_oid != self.meta.relation_oid {
            return Err(AppError::invalid_request("row identity relation mismatch"));
        }
        let mut expected: Vec<i16> = self.meta.primary_key.clone();
        expected.sort_unstable();
        let mut got: Vec<i16> = identity
            .primary_key
            .iter()
            .map(|p| p.attribute_number)
            .collect();
        got.sort_unstable();
        if expected.is_empty() || expected != got {
            return Err(AppError::invalid_request(
                "row identity does not cover the primary key",
            ));
        }
        Ok(())
    }

    /// PK equality conditions; returns (condition fragments, params consumed).
    fn pk_conditions(
        &self,
        identity: &RowIdentity,
        params: &mut Vec<BindParam>,
        next: &mut usize,
    ) -> Result<Vec<String>, AppError> {
        let mut conds = Vec::new();
        for pk in &identity.primary_key {
            let col = self.col(&pk.column_name)?;
            if col.attribute_number != pk.attribute_number {
                return Err(AppError::invalid_request("primary key column mismatch"));
            }
            params.push(to_bind(&pk.value)?);
            conds.push(format!(
                "{} = {}",
                quote_ident(&col.name),
                self.param(*next, col)
            ));
            *next += 1;
        }
        Ok(conds)
    }

    fn where_clause(
        &self,
        identity: &RowIdentity,
        original_values: Option<&HashMap<String, DbValue>>,
        params: &mut Vec<BindParam>,
        next: &mut usize,
        warnings: &mut Vec<String>,
    ) -> Result<String, AppError> {
        let mut conds = self.pk_conditions(identity, params, next)?;
        if identity.xmin.is_none() && original_values.is_none_or(HashMap::is_empty) {
            return Err(AppError::invalid_request(
                "row version or displayed original values required",
            ));
        }
        if let Some(xmin) = &identity.xmin {
            params.push(BindParam::Text(Some(xmin.clone())));
            conds.push(format!("xmin::text = ${}", *next));
            *next += 1;
        } else if let Some(originals) = original_values {
            // Query Result fallback: displayed original values as the lock.
            let pk_names: Vec<&str> = identity
                .primary_key
                .iter()
                .map(|p| p.column_name.as_str())
                .collect();
            let mut names: Vec<&String> = originals.keys().collect();
            names.sort();
            for name in names {
                if pk_names.contains(&name.as_str()) {
                    continue;
                }
                let col = self.col(name)?;
                params.push(to_bind(&originals[name])?);
                conds.push(format!(
                    "{} IS NOT DISTINCT FROM {}",
                    quote_ident(&col.name),
                    self.param(*next, col)
                ));
                *next += 1;
            }
            if !warnings.iter().any(|w| w.contains("displayed columns")) {
                warnings.push(
                    "no xmin available: using displayed columns conflict check (weaker than row version)"
                        .into(),
                );
            }
        }
        Ok(conds.join(" AND "))
    }

    fn plan_update(
        &self,
        row_id: &str,
        identity: &RowIdentity,
        original_values: &HashMap<String, DbValue>,
        changes: &HashMap<String, DbValue>,
        warnings: &mut Vec<String>,
    ) -> Result<RowPlan, AppError> {
        if changes.is_empty() {
            return Err(AppError::invalid_request("empty update change"));
        }
        self.validate_identity(identity)?;
        let mut params: Vec<BindParam> = Vec::new();
        let mut next = 1usize;
        let mut sets = Vec::new();
        let mut names: Vec<&String> = changes.keys().collect();
        names.sort();
        for name in names {
            let col = self.col(name)?;
            if col.is_generated {
                return Err(AppError::invalid_request(format!(
                    "generated column cannot be updated: {name}"
                )));
            }
            params.push(to_bind(&changes[name])?);
            sets.push(format!(
                "{} = {}",
                quote_ident(&col.name),
                self.param(next, col)
            ));
            next += 1;
        }
        let where_sql = self.where_clause(
            identity,
            Some(original_values),
            &mut params,
            &mut next,
            warnings,
        )?;
        let sql = format!(
            "UPDATE {} SET {} WHERE {} {}",
            self.table(),
            sets.join(", "),
            where_sql,
            self.returning()
        );
        Ok(RowPlan {
            row_id: row_id.into(),
            operation: "update".into(),
            sql,
            params,
            pk_lookup: Some(self.pk_lookup(identity)?),
        })
    }

    fn plan_delete(
        &self,
        row_id: &str,
        identity: &RowIdentity,
        originals: &HashMap<String, DbValue>,
        warnings: &mut Vec<String>,
    ) -> Result<RowPlan, AppError> {
        self.validate_identity(identity)?;
        let mut params: Vec<BindParam> = Vec::new();
        let mut next = 1usize;
        let where_sql =
            self.where_clause(identity, Some(originals), &mut params, &mut next, warnings)?;
        let sql = format!("DELETE FROM {} WHERE {}", self.table(), where_sql);
        Ok(RowPlan {
            row_id: row_id.into(),
            operation: "delete".into(),
            sql,
            params,
            pk_lookup: Some(self.pk_lookup(identity)?),
        })
    }

    fn plan_insert(
        &self,
        row_id: &str,
        values: &HashMap<String, InsertCellDraft>,
    ) -> Result<RowPlan, AppError> {
        let mut params: Vec<BindParam> = Vec::new();
        let mut next = 1usize;
        let mut cols = Vec::new();
        let mut placeholders = Vec::new();
        let mut names: Vec<&String> = values.keys().collect();
        names.sort();
        for name in names {
            let col = self.col(name)?;
            match &values[name] {
                InsertCellDraft::Default => continue,
                InsertCellDraft::Null => {
                    params.push(BindParam::Text(None));
                }
                InsertCellDraft::Value { value } => {
                    params.push(to_bind(value)?);
                }
            }
            if col.is_generated {
                return Err(AppError::invalid_request(format!(
                    "generated column cannot be inserted: {name}"
                )));
            }
            cols.push(quote_ident(&col.name));
            placeholders.push(self.param(next, col));
            next += 1;
        }
        let sql = if cols.is_empty() {
            format!(
                "INSERT INTO {} DEFAULT VALUES {}",
                self.table(),
                self.returning()
            )
        } else {
            format!(
                "INSERT INTO {} ({}) VALUES ({}) {}",
                self.table(),
                cols.join(", "),
                placeholders.join(", "),
                self.returning()
            )
        };
        Ok(RowPlan {
            row_id: row_id.into(),
            operation: "insert".into(),
            sql,
            params,
            pk_lookup: None,
        })
    }

    fn pk_lookup(&self, identity: &RowIdentity) -> Result<(String, Vec<BindParam>), AppError> {
        let mut params: Vec<BindParam> = Vec::new();
        let mut next = 1usize;
        let conds = self.pk_conditions(identity, &mut params, &mut next)?;
        Ok((
            format!(
                "SELECT xmin::text AS __dbpod_xmin, * FROM {} WHERE {}",
                self.table(),
                conds.join(" AND ")
            ),
            params,
        ))
    }
}

pub async fn preview(
    state: &AppState,
    req: &ChangesPreviewRequest,
) -> Result<ChangesPreviewResponse, AppError> {
    if req.changes.is_empty() {
        return Err(AppError::invalid_request("no changes to preview"));
    }
    if req.changes.len() > MAX_BATCH_ROWS {
        return Err(AppError::invalid_request(
            "more than 500 rows in one change set",
        ));
    }
    // duplicate row change guard
    {
        let mut ids: Vec<&str> = req
            .changes
            .iter()
            .map(|c| match c {
                RowChange::Update { row_id, .. }
                | RowChange::Insert { row_id, .. }
                | RowChange::Delete { row_id, .. } => row_id.as_str(),
            })
            .collect();
        ids.sort_unstable();
        if ids.windows(2).any(|w| w[0] == w[1]) {
            return Err(AppError::invalid_request("duplicate row change"));
        }
    }

    let database = {
        let workspaces = state.workspaces.lock().unwrap();
        let ws = workspaces
            .get(&req.connection_id)
            .ok_or_else(|| AppError::invalid_request("unknown connection"))?;
        if ws.profile.read_only {
            return Err(AppError::new("PERMISSION_DENIED", "read-only connection"));
        }
        ws.profile.database.clone()
    };
    let meta = metadata_service::get_table(
        state,
        &MetadataGetTableRequest {
            connection_id: req.connection_id.clone(),
            relation_oid: req.relation_oid,
        },
    )
    .await?;
    if meta.kind != "table" && meta.kind != "partitioned-table" {
        return Err(AppError::invalid_request("only base tables are editable"));
    }
    if meta.primary_key.is_empty() {
        return Err(AppError::invalid_request("table has no primary key"));
    }

    if meta.columns.iter().any(|c| c.name == "__dbpod_xmin") {
        return Err(AppError::invalid_request(
            "reserved row-version column name collision",
        ));
    }
    let result_store = state
        .large_values
        .lock()
        .unwrap()
        .get(&req.result_tab_id)
        .cloned()
        .ok_or_else(|| {
            AppError::invalid_request("result was released; query again before editing")
        })?;
    if result_store.connection_id != req.connection_id {
        return Err(AppError::invalid_request(
            "result belongs to another connection",
        ));
    }
    if state
        .executions
        .lock()
        .unwrap()
        .values()
        .any(|e| !e.is_terminal() && Arc::ptr_eq(&e.large, &result_store))
    {
        return Err(AppError::invalid_request(
            "wait for query completion before editing",
        ));
    }
    let planner = Planner { meta: &meta };
    let mut warnings = Vec::new();
    let mut plans = Vec::new();
    let mut counts = ChangeCounts {
        insert: 0,
        update: 0,
        delete: 0,
    };
    // Save order: DELETE -> UPDATE -> INSERT (FK/unique friendliness).
    for change in &req.changes {
        if let RowChange::Delete {
            row_id,
            identity,
            original_values,
        } = change
        {
            counts.delete += 1;
            plans.push(planner.plan_delete(row_id, identity, original_values, &mut warnings)?);
        }
    }
    for change in &req.changes {
        if let RowChange::Update {
            row_id,
            identity,
            original_values,
            changes,
        } = change
        {
            counts.update += 1;
            plans.push(planner.plan_update(
                row_id,
                identity,
                original_values,
                changes,
                &mut warnings,
            )?);
        }
    }
    for change in &req.changes {
        if let RowChange::Insert { row_id, values } = change {
            counts.insert += 1;
            plans.push(planner.plan_insert(row_id, values)?);
        }
    }

    // Group identical templates for the preview.
    let mut statements: Vec<StatementPreview> = Vec::new();
    for plan in &plans {
        if let Some(existing) = statements.iter_mut().find(|s| s.sql_template == plan.sql) {
            existing.row_count += 1;
        } else {
            statements.push(StatementPreview {
                operation: plan.operation.clone(),
                sql_template: plan.sql.clone(),
                parameter_types: plan
                    .params
                    .iter()
                    .map(|p| match p {
                        BindParam::Text(_) => "text".into(),
                        BindParam::Bytea(_) => "bytea".into(),
                    })
                    .collect(),
                row_count: 1,
            });
        }
    }

    let change_set_id = Uuid::new_v4().to_string();
    let target = ChangeTarget {
        schema: meta.schema.clone(),
        table: meta.name.clone(),
    };
    let mut sets = state.change_sets.lock().unwrap();
    sets.retain(|_, set| set.expires > Instant::now());
    let bytes = |plans: &[RowPlan]| {
        plans
            .iter()
            .map(|p| {
                p.sql.len()
                    + p.params
                        .iter()
                        .map(|v| match v {
                            BindParam::Text(v) => v.as_ref().map_or(0, String::len),
                            BindParam::Bytea(v) => v.len(),
                        })
                        .sum::<usize>()
            })
            .sum::<usize>()
    };
    let new_bytes = bytes(&plans);
    if sets.len() >= 32
        || new_bytes > 5 * 1024 * 1024
        || sets.values().map(|s| bytes(&s.plans)).sum::<usize>() + new_bytes > 50 * 1024 * 1024
    {
        return Err(AppError::invalid_request(
            "pending change previews exceed the memory limit",
        ));
    }
    sets.insert(
        change_set_id.clone(),
        ChangeSet {
            connection_id: req.connection_id.clone(),
            database,
            result_tab_id: req.result_tab_id.clone(),
            metadata: meta,
            expires: Instant::now() + Duration::from_secs(600),
            target: target.clone(),
            plans,
        },
    );
    Ok(ChangesPreviewResponse {
        change_set_id,
        expires_at: (chrono::Utc::now() + chrono::Duration::minutes(10)).to_rfc3339(),
        target,
        counts,
        statements,
        warnings,
    })
}

fn bind_all<'q>(
    mut q: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    params: &'q [BindParam],
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
    for p in params {
        q = match p {
            BindParam::Text(v) => q.bind(v.as_deref()),
            BindParam::Bytea(b) => q.bind(b.as_slice()),
        };
    }
    q
}

fn row_to_updated(
    row: &PgRow,
    row_id: &str,
    operation: &str,
    store: &LargeValueStore,
) -> Result<UpdatedRow, AppError> {
    let raw_bytes: usize = (0..row.len())
        .map(|i| {
            row.try_get_raw(i)
                .ok()
                .and_then(|v| v.as_bytes().ok().map(|b| b.len()))
                .unwrap_or(0)
        })
        .sum();
    if !store.reserve_row(raw_bytes, row.len()) {
        return Err(AppError::invalid_request(
            "updated rows exceed the result memory budget; release other results and retry",
        ));
    }
    let decoded = decoder::decode_row(row, store);
    let mut values = HashMap::new();
    let mut xmin = None;
    for (i, col) in row.columns().iter().enumerate() {
        if col.name() == "__dbpod_xmin" {
            if let DbValue::Text { value } | DbValue::Unknown { value, .. } = &decoded[i] {
                xmin = Some(value.clone());
            }
            continue;
        }
        values.insert(col.name().to_string(), decoded[i].clone());
    }
    Ok(UpdatedRow {
        row_id: row_id.into(),
        operation: operation.into(),
        values,
        xmin,
    })
}

pub fn discard(state: &AppState, req: &ChangesDiscardRequest) -> Result<(), AppError> {
    state.change_sets.lock().unwrap().remove(&req.change_set_id);
    Ok(())
}

/// Applies one change set atomically on the workspace control connection.
/// Emits exactly one terminal event (completed | conflict | failed).
pub async fn commit(
    state: &AppState,
    req: &ChangesCommitRequest,
    sink: CommitSink,
) -> Result<(), AppError> {
    let set = state
        .change_sets
        .lock()
        .unwrap()
        .remove(&req.change_set_id)
        .ok_or_else(|| AppError::invalid_request("unknown or already committed change set"))?;

    if set.expires <= Instant::now() {
        return Err(AppError::invalid_request(
            "change preview expired; preview again",
        ));
    }
    let store = state
        .large_values
        .lock()
        .unwrap()
        .get(&set.result_tab_id)
        .cloned()
        .ok_or_else(|| AppError::invalid_request("result was released; preview again"))?;
    if store.connection_id != set.connection_id {
        return Err(AppError::invalid_request("result connection mismatch"));
    }
    let total = set.plans.len() as u32;
    sink(ChangesCommitEvent::Started { total_rows: total });

    let progress_sink = sink.clone();
    let result = metadata_service::with_control(state, &set.connection_id, move |conn| {
        Box::pin(async move {
            let database: String = sqlx::query_scalar("SELECT current_database()")
                .fetch_one(&mut *conn).await.map_err(|e| AppError::from_sqlx(&e))?;
            if database != set.database {
                return Err(AppError::new("DATABASE_CHANGED", "database changed; query and preview again"));
            }
            let mut updated: Vec<UpdatedRow> = Vec::new();
            let mut transaction = conn.begin().await.map_err(|e| AppError::from_sqlx(&e))?;
            let conn = &mut *transaction;
            sqlx::raw_sql("SET LOCAL statement_timeout = '30s'; SET LOCAL lock_timeout = '3s'")
                .execute(&mut *conn).await.map_err(|e| AppError::from_sqlx(&e))?;

            // Hold the relation against concurrent rename/drop/column DDL until COMMIT.
            // Re-resolve the name only after locking it: the name may now refer to a replacement.
            let table = format!("{}.{}", quote_ident(&set.target.schema), quote_ident(&set.target.table));
            sqlx::raw_sql(sqlx::AssertSqlSafe(format!("LOCK TABLE {table} IN ROW EXCLUSIVE MODE")))
                .execute(&mut *conn).await.map_err(|e| AppError::from_sqlx(&e))?;
            let oid: i64 = sqlx::query_scalar("SELECT to_regclass($1)::oid::int8").bind(&table)
                .fetch_one(&mut *conn).await.map_err(|e| AppError::from_sqlx(&e))?;
            if oid != i64::from(set.metadata.relation_oid) {
                return Err(AppError::new("SCHEMA_CHANGED", "Preview target was replaced; query and preview again"));
            }
            let columns: serde_json::Value = sqlx::query_scalar(
                "SELECT json_agg(json_build_array(a.attnum, a.attname, a.atttypid::int8, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull, pg_get_expr(d.adbin, d.adrelid), (a.attidentity <> '' OR a.attgenerated <> '')) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid::int8 = $1 AND a.attnum > 0 AND NOT a.attisdropped"
            ).bind(oid).fetch_one(&mut *conn).await.map_err(|e| AppError::from_sqlx(&e))?;
            let expected = serde_json::Value::Array(set.metadata.columns.iter().map(|c| serde_json::json!([c.attribute_number, c.name, c.pg_type_oid, c.pg_type_name, c.nullable, c.default_expr, c.is_generated])).collect());
            if columns != expected {
                return Err(AppError::new("SCHEMA_CHANGED", "Preview columns changed; query and preview again"));
            }

            let mut outcome: Result<Vec<UpdatedRow>, ChangesCommitEvent> = Ok(Vec::new());
            'rows: for (i, plan) in set.plans.iter().enumerate() {
                let is_delete = plan.operation == "delete";
                let exec = if is_delete {
                    bind_all(
                        sqlx::query(sqlx::AssertSqlSafe(plan.sql.clone()).into_sql_str()),
                        &plan.params,
                    )
                    .execute(&mut *conn)
                    .await
                    .map(|r| (r.rows_affected(), None))
                } else {
                    bind_all(
                        sqlx::query(sqlx::AssertSqlSafe(plan.sql.clone()).into_sql_str()),
                        &plan.params,
                    )
                    .fetch_all(&mut *conn)
                    .await
                    .map(|rows| (rows.len() as u64, rows.into_iter().next()))
                };
                match exec {
                    Ok((1, maybe_row)) => {
                        if let Some(row) = maybe_row {
                            updated.push(row_to_updated(&row, &plan.row_id, &plan.operation, &store)?);
                        } else {
                            updated.push(UpdatedRow {
                                row_id: plan.row_id.clone(),
                                operation: plan.operation.clone(),
                                values: HashMap::new(),
                                xmin: None,
                            });
                        }
                    }
                    Ok((0, _)) => {
                        // conflict: fetch the latest committed row before rolling back
                        let current = if let Some((sql, params)) = &plan.pk_lookup {
                            bind_all(
                                sqlx::query(sqlx::AssertSqlSafe(sql.clone()).into_sql_str()),
                                params,
                            )
                            .fetch_optional(&mut *conn)
                            .await
                            .map_err(|e| AppError::from_sqlx(&e))?
                            .map(|row| {
                                let u = row_to_updated(&row, &plan.row_id, "current", &store)?;
                                let mut values = u.values;
                                // carry the fresh row version so the client can retry
                                if let Some(x) = u.xmin {
                                    values
                                        .insert("__dbpod_xmin".into(), DbValue::Text { value: x });
                                }
                                Ok::<_, AppError>(values)
                            }).transpose()?
                        } else {
                            None
                        };
                        outcome = Err(ChangesCommitEvent::Conflict {
                            conflicts: vec![RowConflict {
                                row_id: plan.row_id.clone(),
                                reason: "row was changed or deleted by another session".into(),
                                current,
                            }],
                        });
                        break 'rows;
                    }
                    Ok((n, _)) => {
                        outcome = Err(ChangesCommitEvent::Failed {
                            error: AppError::internal(format!(
                                "safety violation: {n} rows affected by a single-row change"
                            )),
                        });
                        break 'rows;
                    }
                    Err(e) => {
                        outcome = Err(ChangesCommitEvent::Failed {
                            error: AppError::from_sqlx(&e),
                        });
                        break 'rows;
                    }
                }
                if (i + 1) % 50 == 0 {
                    progress_sink(ChangesCommitEvent::Progress { completed_rows: (i + 1) as u32 });
                }
            }

            match outcome {
                Ok(_) => {
                    transaction.commit().await.map_err(|e| match e {
                        sqlx::Error::Database(_) => AppError::from_sqlx(&e),
                        _ => AppError::new("COMMIT_OUTCOME_UNKNOWN", "Commit acknowledgement was lost. Check the database before retrying; changes may have been saved."),
                    })?;
                    Ok(Ok(updated))
                }
                Err(event) => {
                    transaction.rollback().await.map_err(|e| AppError::from_sqlx(&e))?;
                    Ok(Err(event))
                }
            }
        })
    })
    .await;

    match result {
        Ok(Ok(rows)) => {
            sink(ChangesCommitEvent::Completed { rows });
        }
        Ok(Err(event)) => {
            sink(event);
        }
        Err(e) => {
            sink(ChangesCommitEvent::Failed { error: e });
        }
    }
    Ok(())
}
