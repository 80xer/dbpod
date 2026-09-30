use sqlx::postgres::types::Oid;
use sqlx::{AssertSqlSafe, PgConnection, Row};

use crate::domain::metadata::*;
use crate::error::AppError;
use crate::state::AppState;

/// Quotes a PostgreSQL identifier (doubles embedded quotes).
pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Server-side `statement_timeout` on the control connection, plus room for one
/// round trip: past this a catalog read is not slow, it is unanswered.
pub(crate) const CATALOG_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(35);

/// Runs `f` on the workspace's control connection, connecting lazily.
pub(crate) async fn with_control<T, F>(
    state: &AppState,
    connection_id: &str,
    f: F,
) -> Result<T, AppError>
where
    F: for<'c> FnOnce(
        &'c mut PgConnection,
    ) -> futures_util::future::BoxFuture<'c, Result<T, AppError>>,
{
    with_control_until(
        state,
        connection_id,
        CATALOG_TIMEOUT,
        AppError::new(
            "CONNECTION_TIMEOUT",
            "the database stopped answering; the metadata request was abandoned",
        ),
        f,
    )
    .await
}

/// `with_control` with the caller's own deadline and timeout error.
///
/// A catalog read and a 500-statement commit do not deserve the same deadline, and
/// the caller is the only one that knows whether an abandoned operation may still be
/// in flight on the server. `timed_out` is returned verbatim when the deadline passes.
pub(crate) async fn with_control_until<T, F>(
    state: &AppState,
    connection_id: &str,
    timeout: std::time::Duration,
    timed_out: AppError,
    f: F,
) -> Result<T, AppError>
where
    F: for<'c> FnOnce(
        &'c mut PgConnection,
    ) -> futures_util::future::BoxFuture<'c, Result<T, AppError>>,
{
    let (control, opts) = {
        let workspaces = state.workspaces.lock().unwrap();
        let ws = workspaces
            .get(connection_id)
            .ok_or_else(|| AppError::invalid_request("unknown connection"))?;
        (ws.control.clone(), ws.connect_opts.clone())
    };
    let mut guard = tokio::time::timeout(std::time::Duration::from_secs(5), control.lock())
        .await
        .map_err(|_| {
            AppError::new(
                "CONNECTION_BUSY",
                "metadata or edit operation is still in progress",
            )
        })?;
    {
        let workspaces = state.workspaces.lock().unwrap();
        let ws = workspaces
            .get(connection_id)
            .ok_or_else(|| AppError::invalid_request("connection was closed"))?;
        if ws.connect_opts.get_database() != opts.get_database() {
            return Err(AppError::invalid_request(
                "database changed while waiting for metadata",
            ));
        }
    }
    if guard.is_none() {
        let mut conn = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            <PgConnection as sqlx::Connection>::connect_with(&opts),
        )
        .await
        .map_err(|_| AppError::new("CONNECTION_TIMEOUT", "control connection timed out"))?
        .map_err(|e| AppError::from_sqlx(&e))?;
        sqlx::raw_sql("SET statement_timeout = '30s'")
            .execute(&mut conn)
            .await
            .map_err(|e| AppError::from_sqlx(&e))?;
        *guard = Some(conn);
    }
    let conn = guard.as_mut().unwrap();
    // The server's statement_timeout cannot end a wait for a reply that is never
    // coming, so the client keeps its own deadline. Without it a black-holed socket
    // holds this lock until the TCP stack gives up, and reconnecting is the one thing
    // that would fix it: it needs the same lock and fails with CONNECTION_BUSY.
    let result = match tokio::time::timeout(timeout, f(conn)).await {
        Ok(result) => result,
        Err(_) => Err(timed_out),
    };
    if result.is_err() {
        // Drop a possibly-stale control connection so the next call reconnects.
        if let Some(c) = guard.take() {
            discard(c).await;
        }
    }
    result
}

/// Closes a connection that may be unusable, without waiting on it.
///
/// Both closes talk to the server: the graceful one sends Terminate and the hard one
/// still flushes the socket, so either can hang on the connection this is called for.
/// Dropping the future drops the connection, which closes the socket regardless.
async fn discard(conn: PgConnection) {
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        sqlx::Connection::close(conn),
    )
    .await;
}

pub async fn list_databases(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<DatabaseInfo>, AppError> {
    with_control(state, connection_id, |conn| {
        Box::pin(async move {
            let rows = sqlx::query(
                "SELECT datname, datallowconn AND datconnlimit <> -2 \
                        AND has_database_privilege(oid, 'CONNECT') AS can_connect \
                 FROM pg_database ORDER BY datname",
            )
            .fetch_all(conn)
            .await
            .map_err(|e| AppError::from_sqlx(&e))?;
            Ok(rows
                .into_iter()
                .map(|r| DatabaseInfo {
                    name: r.get(0),
                    can_connect: r.get(1),
                })
                .collect())
        })
    })
    .await
}

pub async fn list_schemas(
    state: &AppState,
    req: &MetadataListSchemasRequest,
) -> Result<Vec<SchemaInfo>, AppError> {
    let include_system = req.include_system;
    with_control(state, &req.connection_id, move |conn| {
        Box::pin(async move {
            let rows = sqlx::query(
                "SELECT n.oid, n.nspname, \
                        (n.nspname LIKE 'pg\\_%' OR n.nspname = 'information_schema') AS is_system \
                 FROM pg_namespace n \
                 WHERE $1 OR NOT (n.nspname LIKE 'pg\\_%' OR n.nspname = 'information_schema') \
                 ORDER BY n.nspname",
            )
            .bind(include_system)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| AppError::from_sqlx(&e))?;
            Ok(rows
                .into_iter()
                .map(|r| SchemaInfo {
                    oid: r.get::<Oid, _>(0).0,
                    name: r.get(1),
                    is_system: r.get(2),
                })
                .collect())
        })
    })
    .await
}

pub async fn list_objects(
    state: &AppState,
    req: &MetadataListObjectsRequest,
) -> Result<Vec<DatabaseObjectSummary>, AppError> {
    let schema_oids: Vec<i64> = req.schema_oids.iter().map(|o| *o as i64).collect();
    let mut relkinds: Vec<String> = Vec::new();
    for k in &req.kinds {
        match k {
            ObjectKind::Table => relkinds.extend(["r".into(), "p".into()]),
            ObjectKind::View => relkinds.push("v".into()),
            ObjectKind::MaterializedView => relkinds.push("m".into()),
            ObjectKind::Sequence => relkinds.push("S".into()),
            ObjectKind::Function => {}
        }
    }
    let want_functions = req.kinds.contains(&ObjectKind::Function);

    with_control(state, &req.connection_id, move |conn| {
        Box::pin(async move {
            let mut out: Vec<DatabaseObjectSummary> = Vec::new();
            if !relkinds.is_empty() {
                let rows = sqlx::query(
                    // ponytail: load descendants together for complete search; use lazy
                    // branch queries if catalog size makes metadata loading too expensive.
                    // No cap: completion asks for every schema at once, and a cap sorted
                    // by schema name silently dropped the schemas that sort last.
                    "WITH RECURSIVE relations AS ( \
                       SELECT c.oid, NULL::oid AS partition_parent_oid \
                       FROM pg_class c \
                       WHERE c.relnamespace::int8 = ANY($1) AND c.relkind::text = ANY($2) \
                         AND NOT c.relispartition \
                       UNION ALL \
                       SELECT child.oid, i.inhparent \
                       FROM relations parent JOIN pg_inherits i ON i.inhparent = parent.oid \
                       JOIN pg_class child ON child.oid = i.inhrelid \
                       WHERE child.relispartition \
                     ) \
                     SELECT c.oid, n.nspname, c.relname, c.relkind::text, \
                            has_table_privilege(c.oid, 'SELECT'), \
                            has_table_privilege(c.oid, 'INSERT'), \
                            has_table_privilege(c.oid, 'UPDATE'), \
                            has_table_privilege(c.oid, 'DELETE'), r.partition_parent_oid \
                     FROM relations r JOIN pg_class c ON c.oid = r.oid \
                     JOIN pg_namespace n ON n.oid = c.relnamespace \
                     ORDER BY n.nspname, c.relname",
                )
                .bind(&schema_oids)
                .bind(&relkinds)
                .fetch_all(&mut *conn)
                .await
                .map_err(|e| AppError::from_sqlx(&e))?;
                for r in rows {
                    let relkind: String = r.get(3);
                    out.push(DatabaseObjectSummary {
                        oid: r.get::<Oid, _>(0).0,
                        schema: r.get(1),
                        name: r.get(2),
                        kind: match relkind.as_str() {
                            "v" => ObjectKind::View,
                            "m" => ObjectKind::MaterializedView,
                            "S" => ObjectKind::Sequence,
                            _ => ObjectKind::Table,
                        },
                        function_arguments: None,
                        can_select: r.try_get(4).ok(),
                        can_insert: r.try_get(5).ok(),
                        can_update: r.try_get(6).ok(),
                        can_delete: r.try_get(7).ok(),
                        partition_parent_oid: r.get::<Option<Oid>, _>(8).map(|oid| oid.0),
                    });
                }
            }
            if want_functions {
                let rows = sqlx::query(
                    "SELECT p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) \
                     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace \
                     WHERE p.pronamespace::int8 = ANY($1) AND p.prokind IN ('f', 'w', 'p') \
                     ORDER BY n.nspname, p.proname, p.oid",
                )
                .bind(&schema_oids)
                .fetch_all(&mut *conn)
                .await
                .map_err(|e| AppError::from_sqlx(&e))?;
                for r in rows {
                    out.push(DatabaseObjectSummary {
                        oid: r.get::<Oid, _>(0).0,
                        schema: r.get(1),
                        name: r.get(2),
                        kind: ObjectKind::Function,
                        function_arguments: Some(r.get(3)),
                        partition_parent_oid: None,
                        can_select: None,
                        can_insert: None,
                        can_update: None,
                        can_delete: None,
                    });
                }
            }
            Ok(out)
        })
    })
    .await
}

pub async fn drop_object(
    state: &AppState,
    req: &MetadataDropObjectRequest,
) -> Result<(), AppError> {
    {
        let workspaces = state.workspaces.lock().unwrap();
        let workspace = workspaces
            .get(&req.connection_id)
            .ok_or_else(|| AppError::invalid_request("unknown connection"))?;
        if workspace.profile.read_only {
            return Err(AppError::new("PERMISSION_DENIED", "read-only connection"));
        }
    }

    let oid = i64::from(req.object_oid);
    let kind = req.kind;
    with_control(state, &req.connection_id, move |conn| {
        Box::pin(async move {
            let sql = if kind == ObjectKind::Function {
                let row = sqlx::query(
                    "SELECT n.nspname, p.proname, p.prokind::text, \
                            pg_get_function_identity_arguments(p.oid) \
                     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace \
                     WHERE p.oid::int8 = $1 AND p.prokind IN ('f', 'w', 'p')",
                )
                .bind(oid)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| AppError::from_sqlx(&e))?
                .ok_or_else(|| {
                    AppError::invalid_request("function or procedure no longer exists")
                })?;
                let object = if row.get::<String, _>(2) == "p" {
                    "PROCEDURE"
                } else {
                    "FUNCTION"
                };
                format!(
                    "DROP {object} {}.{}({}) RESTRICT",
                    quote_ident(row.get(0)),
                    quote_ident(row.get(1)),
                    row.get::<String, _>(3),
                )
            } else {
                let row = sqlx::query(
                    "SELECT n.nspname, c.relname, c.relkind::text \
                     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
                     WHERE c.oid::int8 = $1",
                )
                .bind(oid)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| AppError::from_sqlx(&e))?
                .ok_or_else(|| AppError::invalid_request("database object no longer exists"))?;
                let relkind: String = row.get(2);
                let expected = match kind {
                    ObjectKind::Table => matches!(relkind.as_str(), "r" | "p"),
                    ObjectKind::View => relkind == "v",
                    ObjectKind::MaterializedView => relkind == "m",
                    ObjectKind::Sequence => relkind == "S",
                    ObjectKind::Function => false,
                };
                if !expected {
                    return Err(AppError::invalid_request("database object kind changed"));
                }
                let object = match kind {
                    ObjectKind::Table => "TABLE",
                    ObjectKind::View => "VIEW",
                    ObjectKind::MaterializedView => "MATERIALIZED VIEW",
                    ObjectKind::Sequence => "SEQUENCE",
                    ObjectKind::Function => unreachable!(),
                };
                format!(
                    "DROP {object} {}.{} RESTRICT",
                    quote_ident(row.get(0)),
                    quote_ident(row.get(1)),
                )
            };
            sqlx::raw_sql(AssertSqlSafe(sql))
                .execute(conn)
                .await
                .map_err(|e| AppError::from_sqlx(&e))?;
            Ok(())
        })
    })
    .await
}

pub async fn get_routine_definition(
    state: &AppState,
    connection_id: &str,
    routine_oid: u32,
) -> Result<String, AppError> {
    with_control(state, connection_id, move |conn| {
        Box::pin(async move {
            sqlx::query_scalar(
                "SELECT pg_get_functiondef(p.oid) FROM pg_proc p \
                 WHERE p.oid::int8 = $1 AND p.prokind IN ('f', 'w', 'p')",
            )
            .bind(i64::from(routine_oid))
            .fetch_optional(conn)
            .await
            .map_err(|e| AppError::from_sqlx(&e))?
            .ok_or_else(|| AppError::invalid_request("function or procedure no longer exists"))
        })
    })
    .await
}

/// Options that change a view's permission or row-filtering semantics. Only these
/// are replayed; values are catalog-normalized words, checked before splicing.
const VIEW_OPTIONS: [&str; 3] = ["check_option", "security_barrier", "security_invoker"];

/// Rebuilds a view's creation script from the catalog. Names go through
/// `quote_ident` server-side because the script is meant to be copied and run.
pub async fn get_view_definition(
    state: &AppState,
    connection_id: &str,
    relation_oid: u32,
) -> Result<String, AppError> {
    with_control(state, connection_id, move |conn| {
        Box::pin(async move {
            let row = sqlx::query(
                "SELECT c.relkind::text, quote_ident(n.nspname) || '.' || quote_ident(c.relname), \
                        pg_get_viewdef(c.oid, true), c.relispopulated, c.reloptions \
                 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
                 WHERE c.oid::int8 = $1 AND c.relkind IN ('v', 'm')",
            )
            .bind(i64::from(relation_oid))
            .fetch_optional(conn)
            .await
            .map_err(|e| AppError::from_sqlx(&e))?
            .ok_or_else(|| AppError::invalid_request("view no longer exists"))?;
            let name: String = row.get(1);
            let definition: String = row.get(2);
            let definition = definition.trim_end().trim_end_matches(';');
            Ok(if row.get::<String, _>(0) == "m" {
                let data = if row.get(3) {
                    "WITH DATA"
                } else {
                    "WITH NO DATA"
                };
                format!("CREATE MATERIALIZED VIEW {name} AS\n{definition}\n{data};")
            } else {
                let options: Vec<String> = row.get::<Option<Vec<String>>, _>(4).unwrap_or_default();
                let options: Vec<&str> = options
                    .iter()
                    .map(String::as_str)
                    .filter(|option| {
                        option.split_once('=').is_some_and(|(key, value)| {
                            VIEW_OPTIONS.contains(&key)
                                && !value.is_empty()
                                && value.bytes().all(|b| b.is_ascii_alphanumeric())
                        })
                    })
                    .collect();
                let with = if options.is_empty() {
                    String::new()
                } else {
                    format!(" WITH ({})", options.join(", "))
                };
                format!("CREATE OR REPLACE VIEW {name}{with} AS\n{definition};")
            })
        })
    })
    .await
}

pub async fn get_table(
    state: &AppState,
    req: &MetadataGetTableRequest,
) -> Result<TableMetadata, AppError> {
    let oid = req.relation_oid as i64;
    let relation_oid = req.relation_oid;
    with_control(state, &req.connection_id, move |conn| {
        Box::pin(async move {
            let info = sqlx::query(
                "SELECT n.nspname, c.relname, c.relkind::text, c.relrowsecurity \
                 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
                 WHERE c.oid::int8 = $1",
            )
            .bind(oid)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| AppError::from_sqlx(&e))?
            .ok_or_else(|| AppError::invalid_request("unknown relation"))?;

            let keys = sqlx::query(
                "SELECT i.indisprimary, ARRAY(SELECT x FROM unnest(i.indkey) x)::int2[] \
                 FROM pg_index i \
                 WHERE i.indrelid::int8 = $1 AND (i.indisprimary OR i.indisunique) \
                   AND i.indpred IS NULL AND i.indexprs IS NULL",
            )
            .bind(oid)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| AppError::from_sqlx(&e))?;
            let mut primary_key: Vec<i16> = Vec::new();
            let mut unique_keys: Vec<Vec<i16>> = Vec::new();
            for k in keys {
                let is_pk: bool = k.get(0);
                let cols: Vec<i16> = k.get(1);
                if is_pk {
                    primary_key = cols;
                } else {
                    unique_keys.push(cols);
                }
            }

            let cols = sqlx::query(
                "SELECT a.attnum, a.attname, a.atttypid, \
                        format_type(a.atttypid, a.atttypmod), \
                        NOT a.attnotnull, \
                        pg_get_expr(d.adbin, d.adrelid), \
                        (a.attidentity <> '' OR a.attgenerated <> ''), \
                        col_description(a.attrelid, a.attnum) \
                 FROM pg_attribute a \
                 LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
                 WHERE a.attrelid::int8 = $1 AND a.attnum > 0 AND NOT a.attisdropped \
                 ORDER BY a.attnum",
            )
            .bind(oid)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| AppError::from_sqlx(&e))?;

            let kind: String = info.get(2);
            Ok(TableMetadata {
                relation_oid,
                schema: info.get(0),
                name: info.get(1),
                kind: match kind.as_str() {
                    "p" => "partitioned-table".into(),
                    "v" => "view".into(),
                    "m" => "materialized-view".into(),
                    _ => "table".into(),
                },
                columns: cols
                    .into_iter()
                    .map(|r| {
                        let attnum: i16 = r.get(0);
                        TableColumnMetadata {
                            attribute_number: attnum,
                            name: r.get(1),
                            pg_type_oid: r.get::<Oid, _>(2).0,
                            pg_type_name: r.get(3),
                            nullable: r.get(4),
                            default_expr: r.try_get(5).ok(),
                            comment: r.try_get(7).ok(),
                            is_generated: r.get(6),
                            is_primary_key: primary_key.contains(&attnum),
                        }
                    })
                    .collect(),
                primary_key,
                unique_keys,
                row_level_security: info.get(3),
            })
        })
    })
    .await
}
