// Integration tests against a disposable PostgreSQL (testcontainers).
// Covers the Milestone A gate: chunk ordering, exactly-one-terminal,
// truncation, type decode, error mapping, cancel, backpressure, cleanup.

use std::collections::HashMap;
use std::sync::Arc;

use dbpod_lib::application::query_service;
use dbpod_lib::domain::db_value::DbValue;
use dbpod_lib::domain::events::*;
use dbpod_lib::domain::metadata::*;
use dbpod_lib::domain::profile::*;
use dbpod_lib::infrastructure::persistence::profiles::ProfileStore;
use dbpod_lib::infrastructure::postgres::session_actor::EventSink;
use dbpod_lib::infrastructure::postgres::transport::build_connect_options;
use dbpod_lib::state::{AppState, Workspace};
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, ImageExt};
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::time::{timeout, Duration};

const CONN_ID: &str = "test-conn";

fn test_profile() -> ConnectionProfile {
    ConnectionProfile {
        id: "test-profile".into(),
        name: "test".into(),
        environment: Environment::Local,
        color: None,
        host: "127.0.0.1".into(),
        port: 0,
        database: "postgres".into(),
        username: "postgres".into(),
        tls_mode: TlsMode::Insecure,
        read_only: false,
        query_timeout_ms: 60_000,
        max_rows: 10_000,
        has_stored_credential: false,
    }
}

async fn setup() -> (ContainerAsync<Postgres>, AppState) {
    let node = Postgres::default()
        .with_tag("17-alpine")
        .start()
        .await
        .expect("start postgres");
    let port = node.get_host_port_ipv4(5432).await.expect("mapped port");
    let opts = build_connect_options(
        "127.0.0.1",
        port,
        "postgres",
        "postgres",
        TlsMode::Insecure,
        Some("postgres"),
    );
    let dir = std::env::temp_dir().join(format!("dbpod-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let state = AppState::new(dir.clone(), ProfileStore::load(dir).unwrap());
    state.workspaces.lock().unwrap().insert(
        CONN_ID.into(),
        Workspace {
            connection_id: CONN_ID.into(),
            profile: test_profile(),
            connect_opts: opts,
            control: Arc::new(tokio::sync::Mutex::new(None)),
            sessions: HashMap::new(),
        },
    );
    (node, state)
}

#[tokio::test]
async fn drops_the_catalog_selected_relation_or_routine_and_blocks_read_only_connections() {
    use dbpod_lib::application::metadata_service;
    use sqlx::Connection;

    let (_node, state) = setup().await;
    let opts = state.workspaces.lock().unwrap()[CONN_ID]
        .connect_opts
        .clone();
    let mut admin = sqlx::PgConnection::connect_with(&opts).await.unwrap();
    sqlx::raw_sql(
        "CREATE TABLE \"drop target\"(id int); \
         CREATE FUNCTION drop_target(v integer) RETURNS integer LANGUAGE SQL AS 'SELECT v'; \
         CREATE FUNCTION drop_target(v text) RETURNS text LANGUAGE SQL AS 'SELECT v'",
    )
    .execute(&mut admin)
    .await
    .unwrap();
    let table_oid: i64 = sqlx::query_scalar("SELECT 'public.\"drop target\"'::regclass::oid::int8")
        .fetch_one(&mut admin)
        .await
        .unwrap();
    let integer_oid: i64 =
        sqlx::query_scalar("SELECT 'public.drop_target(integer)'::regprocedure::oid::int8")
            .fetch_one(&mut admin)
            .await
            .unwrap();

    state
        .workspaces
        .lock()
        .unwrap()
        .get_mut(CONN_ID)
        .unwrap()
        .profile
        .read_only = true;
    let request = MetadataDropObjectRequest {
        connection_id: CONN_ID.into(),
        object_oid: table_oid as u32,
        kind: ObjectKind::Table,
    };
    assert_eq!(
        metadata_service::drop_object(&state, &request)
            .await
            .unwrap_err()
            .code,
        "PERMISSION_DENIED"
    );
    state
        .workspaces
        .lock()
        .unwrap()
        .get_mut(CONN_ID)
        .unwrap()
        .profile
        .read_only = false;
    metadata_service::drop_object(&state, &request)
        .await
        .unwrap();
    assert!(sqlx::query_scalar::<_, Option<i64>>(
        "SELECT to_regclass('public.\"drop target\"')::oid::int8"
    )
    .fetch_one(&mut admin)
    .await
    .unwrap()
    .is_none());

    metadata_service::drop_object(
        &state,
        &MetadataDropObjectRequest {
            connection_id: CONN_ID.into(),
            object_oid: integer_oid as u32,
            kind: ObjectKind::Function,
        },
    )
    .await
    .unwrap();
    assert!(sqlx::query_scalar::<_, Option<i64>>(
        "SELECT to_regprocedure('public.drop_target(integer)')::oid::int8"
    )
    .fetch_one(&mut admin)
    .await
    .unwrap()
    .is_none());
    assert!(sqlx::query_scalar::<_, Option<i64>>(
        "SELECT to_regprocedure('public.drop_target(text)')::oid::int8"
    )
    .fetch_one(&mut admin)
    .await
    .unwrap()
    .is_some());
}

fn sink_channel() -> (EventSink, UnboundedReceiver<QueryStreamEvent>) {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    let sink: EventSink = Arc::new(move |e| tx.send(e).is_ok());
    (sink, rx)
}

fn req(tab: &str, sql: &str, max_rows: u32) -> QueryExecuteRequest {
    QueryExecuteRequest {
        connection_id: CONN_ID.into(),
        query_tab_id: tab.into(),
        result_tab_id: format!("{tab}-result"),
        sql: sql.into(),
        max_rows,
        timeout_ms: 60_000,
    }
}

#[tokio::test]
async fn database_navigation_reuses_connection_and_replaces_idle_sessions() {
    use dbpod_lib::application::{connection_service, metadata_service};
    use dbpod_lib::domain::metadata::*;
    use sqlx::Connection;

    let (_node, state) = setup().await;
    let opts = state.workspaces.lock().unwrap()[CONN_ID]
        .connect_opts
        .clone();
    let mut admin = sqlx::PgConnection::connect_with(&opts).await.unwrap();
    let database = "other \"database";
    sqlx::raw_sql("CREATE DATABASE \"other \"\"database\"")
        .execute(&mut admin)
        .await
        .unwrap();
    sqlx::raw_sql("CREATE DATABASE blocked WITH ALLOW_CONNECTIONS false")
        .execute(&mut admin)
        .await
        .unwrap();
    // A normal role can browse the catalog but cannot open a database without CONNECT.
    sqlx::raw_sql("CREATE ROLE explorer LOGIN PASSWORD 'explorer'; REVOKE CONNECT ON DATABASE postgres FROM PUBLIC")
        .execute(&mut admin).await.unwrap();
    let databases = metadata_service::list_databases(&state, CONN_ID)
        .await
        .unwrap();
    assert!(databases
        .iter()
        .any(|d| d.name == database && d.can_connect));
    assert!(databases
        .iter()
        .any(|d| d.name == "postgres" && d.can_connect));
    assert!(databases
        .iter()
        .any(|d| d.name == "template0" && !d.can_connect));
    assert!(databases
        .iter()
        .any(|d| d.name == "blocked" && !d.can_connect));

    let profile = state.workspaces.lock().unwrap()[CONN_ID].profile.clone();
    state.profiles.lock().unwrap().upsert(profile).unwrap();
    let (sink, mut rx) = sink_channel();
    let accepted = query_service::execute(&state, req("original", "BEGIN", 10), sink).unwrap();
    let events = collect_events(&state, &accepted.execution_id, &mut rx).await;
    assert!(matches!(
        events.last(),
        Some(QueryStreamEvent::Completed {
            transaction_state: TransactionState::InTransaction,
            ..
        })
    ));

    let original_session = state.workspaces.lock().unwrap()[CONN_ID].sessions["original"]
        .session_id
        .clone();
    assert_eq!(
        connection_service::connection_switch_database(&state, CONN_ID, database)
            .await
            .unwrap_err()
            .code,
        "CONNECTION_BUSY"
    );
    assert_eq!(
        state.workspaces.lock().unwrap()[CONN_ID].profile.database,
        "postgres"
    );
    let (sink, mut rx) = sink_channel();
    let accepted = query_service::execute(&state, req("original", "ROLLBACK", 10), sink).unwrap();
    collect_events(&state, &accepted.execution_id, &mut rx).await;
    let (first, second) = tokio::join!(
        connection_service::connection_switch_database(&state, CONN_ID, database),
        connection_service::connection_switch_database(&state, CONN_ID, database),
    );
    let opened = first.unwrap();
    assert_eq!(opened.connection_id, second.unwrap().connection_id);
    assert_eq!(opened.connection_id, CONN_ID);
    assert_eq!(opened.database, database);
    assert_eq!(state.workspaces.lock().unwrap().len(), 1);
    assert!(state.workspaces.lock().unwrap()[CONN_ID]
        .sessions
        .is_empty());
    assert!(state.large_values.lock().unwrap().is_empty());
    let reused = connection_service::connection_open(
        &state,
        ConnectionOpenRequest {
            profile_id: "test-profile".into(),
            password: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(reused.connection_id, CONN_ID);
    assert_eq!(reused.database, database);
    assert_eq!(
        state.profiles.lock().unwrap().list()[0].database,
        "postgres"
    );

    let mut other = sqlx::PgConnection::connect_with(&opts.database(database))
        .await
        .unwrap();
    sqlx::raw_sql("CREATE TABLE only_here(id int); CREATE FUNCTION lookup(integer) RETURNS integer LANGUAGE SQL AS 'SELECT $1'; CREATE FUNCTION lookup(text) RETURNS text LANGUAGE SQL AS 'SELECT $1'; CREATE PROCEDURE hidden_procedure() LANGUAGE SQL AS 'SELECT 1'")
        .execute(&mut other).await.unwrap();
    let schemas = metadata_service::list_schemas(
        &state,
        &MetadataListSchemasRequest {
            connection_id: opened.connection_id.clone(),
            include_system: false,
        },
    )
    .await
    .unwrap();
    let public_oid = schemas.iter().find(|s| s.name == "public").unwrap().oid;
    let objects = metadata_service::list_objects(
        &state,
        &MetadataListObjectsRequest {
            connection_id: opened.connection_id.clone(),
            schema_oids: vec![public_oid],
            kinds: vec![ObjectKind::Function],
        },
    )
    .await
    .unwrap();
    assert_eq!(objects.len(), 3);
    assert!(objects.iter().all(|o| o.kind == ObjectKind::Function));
    assert!(objects
        .iter()
        .any(|o| o.name == "hidden_procedure" && o.function_arguments.as_deref() == Some("")));
    assert!(objects
        .iter()
        .any(|o| o.function_arguments.as_deref() == Some("integer")));
    assert!(objects
        .iter()
        .any(|o| o.function_arguments.as_deref() == Some("text")));
    for routine in &objects {
        let definition = metadata_service::get_routine_definition(&state, CONN_ID, routine.oid)
            .await
            .unwrap();
        if routine.name == "hidden_procedure" {
            assert!(definition.contains("CREATE OR REPLACE PROCEDURE public.hidden_procedure()"));
            assert!(definition.contains("SELECT 1"));
        } else {
            assert!(definition.contains(&format!(
                "CREATE OR REPLACE FUNCTION public.lookup({})",
                routine.function_arguments.as_deref().unwrap()
            )));
            assert!(definition.contains("SELECT $1"));
        }
    }
    assert!(metadata_service::get_routine_definition(&state, CONN_ID, 0)
        .await
        .is_err());
    assert!(
        metadata_service::get_routine_definition(&state, "unknown", objects[0].oid)
            .await
            .is_err()
    );
    // A routine removed after the list was loaded must fail explicitly.
    let dropped = objects
        .iter()
        .find(|o| o.name == "lookup" && o.function_arguments.as_deref() == Some("text"))
        .unwrap()
        .oid;
    sqlx::raw_sql("DROP FUNCTION public.lookup(text)")
        .execute(&mut other)
        .await
        .unwrap();
    assert!(
        metadata_service::get_routine_definition(&state, CONN_ID, dropped)
            .await
            .is_err()
    );
    let (sink, mut rx) = sink_channel();
    let accepted = query_service::execute(
        &state,
        QueryExecuteRequest {
            connection_id: opened.connection_id.clone(),
            ..req(
                "other",
                "SELECT current_database(), count(*) FROM only_here",
                10,
            )
        },
        sink,
    )
    .unwrap();
    let events = collect_events(&state, &accepted.execution_id, &mut rx).await;
    assert!(events.iter().any(|e| matches!(e, QueryStreamEvent::Rows { rows, .. } if matches!(&rows[0][0], DbValue::Text { value } if value == database))));

    let back =
        connection_service::connection_switch_database(&state, &opened.connection_id, "postgres")
            .await
            .unwrap();
    assert_eq!(back.connection_id, CONN_ID);
    let from_profile = connection_service::connection_open(
        &state,
        ConnectionOpenRequest {
            profile_id: "test-profile".into(),
            password: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(from_profile.connection_id, CONN_ID);
    let (sink, mut rx) = sink_channel();
    let accepted = query_service::execute(
        &state,
        req("original", "SELECT current_database()", 10),
        sink,
    )
    .unwrap();
    let events = collect_events(&state, &accepted.execution_id, &mut rx).await;
    assert!(events.iter().any(|e| matches!(e, QueryStreamEvent::Rows { rows, .. } if matches!(&rows[0][0], DbValue::Text { value } if value == "postgres"))));
    assert!(matches!(
        events.last(),
        Some(QueryStreamEvent::Completed {
            transaction_state: TransactionState::Idle,
            ..
        })
    ));
    assert_ne!(
        state.workspaces.lock().unwrap()[CONN_ID].sessions["original"].session_id,
        original_session
    );
    assert!(
        connection_service::connection_switch_database(&state, CONN_ID, "missing")
            .await
            .is_err()
    );
    assert!(
        connection_service::connection_switch_database(&state, CONN_ID, "blocked")
            .await
            .is_err()
    );
    assert!(
        connection_service::connection_switch_database(&state, "unknown", database)
            .await
            .is_err()
    );
    assert_eq!(state.workspaces.lock().unwrap().len(), 1);
    connection_service::connection_switch_database(&state, CONN_ID, database)
        .await
        .unwrap();
    // Reconnect the workspace as a restricted role to exercise the permission flag.
    {
        let mut workspaces = state.workspaces.lock().unwrap();
        let ws = workspaces.get_mut(&opened.connection_id).unwrap();
        ws.connect_opts = ws
            .connect_opts
            .clone()
            .username("explorer")
            .password("explorer");
        ws.profile.id = "restricted-profile".into();
        ws.profile.username = "explorer".into();
        ws.control = Arc::new(tokio::sync::Mutex::new(None));
    }
    let databases = metadata_service::list_databases(&state, &opened.connection_id)
        .await
        .unwrap();
    assert!(databases
        .iter()
        .any(|d| d.name == "postgres" && !d.can_connect));
    assert!(connection_service::connection_switch_database(
        &state,
        &opened.connection_id,
        "postgres"
    )
    .await
    .is_err());
    assert_eq!(state.workspaces.lock().unwrap().len(), 1);
    assert_eq!(
        state.workspaces.lock().unwrap()[CONN_ID].profile.database,
        database
    );
    connection_service::connection_close(&state, CONN_ID)
        .await
        .unwrap();
}

fn is_terminal(e: &QueryStreamEvent) -> bool {
    matches!(
        e,
        QueryStreamEvent::Completed { .. }
            | QueryStreamEvent::Failed { .. }
            | QueryStreamEvent::Cancelled { .. }
    )
}

/// Collects events until the terminal one, auto-acking rows chunks.
async fn collect_events(
    state: &AppState,
    execution_id: &str,
    rx: &mut UnboundedReceiver<QueryStreamEvent>,
) -> Vec<QueryStreamEvent> {
    let mut events = Vec::new();
    loop {
        let e = timeout(Duration::from_secs(30), rx.recv())
            .await
            .expect("event timeout")
            .expect("channel closed before terminal");
        if let QueryStreamEvent::Rows { sequence, .. } = &e {
            let _ = query_service::ack_chunk(
                state,
                &QueryAckChunkRequest {
                    execution_id: execution_id.into(),
                    sequence: *sequence,
                },
            );
        }
        let done = is_terminal(&e);
        events.push(e);
        if done {
            break;
        }
    }
    events
}

async fn review_execute(state: &AppState, sql: &str, limit: u32) -> Vec<QueryStreamEvent> {
    let (sink, mut rx) = sink_channel();
    let accepted = query_service::execute(state, req("review", sql, limit), sink).unwrap();
    let events = collect_events(state, &accepted.execution_id, &mut rx).await;
    for _ in 0..100 {
        let busy = state
            .workspaces
            .lock()
            .unwrap()
            .get(CONN_ID)
            .unwrap()
            .sessions["review"]
            .busy
            .load(std::sync::atomic::Ordering::Acquire);
        if !busy {
            break;
        }
        tokio::task::yield_now().await;
    }
    events
}

#[tokio::test]
async fn wide_results_keep_all_90_rows_with_bounded_ipc_chunks() {
    let (_node, state) = setup().await;
    for (sql, expected_count, expected_text) in [
        (
            "SELECT n, repeat('x', 410000) FROM generate_series(1, 90) n ORDER BY n",
            90,
            "x".repeat(410_000),
        ),
        (
            "SELECT n, repeat(chr(1), 100000) FROM generate_series(1, 4) n ORDER BY n",
            4,
            "\u{1}".repeat(100_000),
        ),
    ] {
        let (sink, mut rx) = sink_channel();
        let accepted =
            query_service::execute_with_paging(&state, req("wide", sql, 0), sink, true).unwrap();
        let events = collect_events(&state, &accepted.execution_id, &mut rx).await;
        let mut count = 0;
        for event in &events {
            if let QueryStreamEvent::Rows { rows, .. } = event {
                assert!(serde_json::to_vec(event).unwrap().len() <= 1024 * 1024);
                for row in rows {
                    count += 1;
                    assert!(
                        matches!(&row[0], DbValue::Integer { value } if value == &count.to_string())
                    );
                    assert!(matches!(&row[1], DbValue::Text { value } if value == &expected_text));
                }
            }
        }
        assert_eq!(count, expected_count);
        assert!(matches!(events.last(), Some(QueryStreamEvent::Completed {
            row_count, truncated: false, ..
        }) if *row_count == expected_count));
    }
}

#[tokio::test]
async fn paged_results_deliver_200_rows_and_fetch_the_same_execution_without_repeating_sql() {
    let (_node, state) = setup().await;
    review_execute(&state, "CREATE SEQUENCE paging_counter", 10).await;
    let (sink, mut rx) = sink_channel();
    let accepted = query_service::execute_with_paging(
        &state,
        req(
            "paged",
            "SELECT nextval('paging_counter') FROM generate_series(1, 450)",
            0,
        ),
        sink,
        true,
    )
    .unwrap();
    let events = collect_events(&state, &accepted.execution_id, &mut rx).await;
    let initial: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            QueryStreamEvent::Rows { rows, .. } => Some(rows),
            _ => None,
        })
        .flatten()
        .collect();
    assert_eq!(initial.len(), 200);
    assert!(matches!(
        events.last(),
        Some(QueryStreamEvent::Completed {
            row_count: 450,
            truncated: false,
            ..
        })
    ));
    let fetch = |execution_id: &str, offset| {
        query_service::result_rows_fetch(
            &state,
            &ResultRowsFetchRequest {
                result_tab_id: "paged-result".into(),
                execution_id: execution_id.into(),
                offset,
            },
        )
        .map_err(Box::new)
    };
    let second = fetch(&accepted.execution_id, 200).unwrap();
    assert_eq!(second.rows.len(), 200);
    assert_eq!(second.next_offset, 400);
    assert!(second.has_more);
    assert!(matches!(&second.rows[0][0], DbValue::Integer { value } if value == "201"));
    let last = fetch(&accepted.execution_id, 400).unwrap();
    assert_eq!(last.rows.len(), 50);
    assert!(!last.has_more);
    assert!(matches!(&last.rows[49][0], DbValue::Integer { value } if value == "450"));
    assert!(fetch(&accepted.execution_id, 451).is_err());
    assert!(fetch("stale-execution", 200).is_err());
    let repeated = fetch(&accepted.execution_id, 200).unwrap();
    assert!(matches!(&repeated.rows[0][0], DbValue::Integer { value } if value == "201"));
    let sequence = review_execute(&state, "SELECT last_value FROM paging_counter", 10).await;
    assert!(sequence.iter().any(|e| matches!(e, QueryStreamEvent::Rows { rows, .. } if matches!(&rows[0][0], DbValue::Integer { value } if value == "450"))));

    // Legacy profile limits must not truncate paged queries, including beyond 10,000 rows.
    let (sink, mut rx) = sink_channel();
    let replacement = query_service::execute_with_paging(
        &state,
        req("paged", "SELECT generate_series(1, 12050)", 500),
        sink,
        true,
    )
    .unwrap();
    let events = collect_events(&state, &replacement.execution_id, &mut rx).await;
    assert!(matches!(
        events.last(),
        Some(QueryStreamEvent::Completed {
            row_count: 12050,
            truncated: false,
            ..
        })
    ));
    assert!(fetch(&accepted.execution_id, 200).is_err());
    let mut offset = 200;
    while offset < 12050 {
        let page = fetch(&replacement.execution_id, offset).unwrap();
        assert_eq!(page.rows.len(), (12050 - offset).min(200) as usize);
        for (i, row) in page.rows.iter().enumerate() {
            assert!(
                matches!(&row[0], DbValue::Integer { value } if value == &(offset as usize + i + 1).to_string())
            );
        }
        offset = page.next_offset;
        assert_eq!(page.has_more, offset < 12050);
    }
    assert!(fetch(&replacement.execution_id, 12050)
        .unwrap()
        .rows
        .is_empty());
    query_service::result_release(
        &state,
        &ResultReleaseRequest {
            result_tab_id: "paged-result".into(),
        },
    )
    .unwrap();
    assert!(fetch(&replacement.execution_id, 200).is_err());
}

#[tokio::test]
async fn review_rollback_after_error_must_recover() {
    let (_node, state) = setup().await;
    review_execute(&state, "BEGIN", 10).await;
    let failed = review_execute(&state, "SELECT 1/0", 10).await;
    assert!(matches!(
        failed.last(),
        Some(QueryStreamEvent::Failed { .. })
    ));
    let rollback = review_execute(&state, "ROLLBACK", 10).await;
    assert!(
        matches!(
            rollback.last(),
            Some(QueryStreamEvent::Completed {
                transaction_state: TransactionState::Idle,
                ..
            })
        ),
        "ROLLBACK must reach server: {:?}",
        rollback.last()
    );
}

#[tokio::test]
async fn review_truncated_returning_must_observe_commit_error() {
    use sqlx::Connection;
    let (_node, state) = setup().await;
    let opts = state
        .workspaces
        .lock()
        .unwrap()
        .get(CONN_ID)
        .unwrap()
        .connect_opts
        .clone();
    let mut observer = sqlx::PgConnection::connect_with(&opts).await.unwrap();
    sqlx::raw_sql("CREATE TABLE parent(id int PRIMARY KEY); CREATE TABLE child(id int REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)").execute(&mut observer).await.unwrap();
    let result = review_execute(
        &state,
        "INSERT INTO child SELECT generate_series(1, 100) RETURNING id",
        1,
    )
    .await;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM child")
        .fetch_one(&mut observer)
        .await
        .unwrap();
    assert!(
        matches!(result.last(), Some(QueryStreamEvent::Failed { .. })),
        "rolled-back INSERT must not report success, committed rows={count}, terminal={:?}",
        result.last()
    );
}

#[tokio::test]
async fn review_query_delete_requires_conflict_protection() {
    use dbpod_lib::application::edit_service;
    use dbpod_lib::domain::editing::*;
    use sqlx::{Connection, Row};
    let (_node, state) = setup().await;
    let opts = state
        .workspaces
        .lock()
        .unwrap()
        .get(CONN_ID)
        .unwrap()
        .connect_opts
        .clone();
    let mut observer = sqlx::PgConnection::connect_with(&opts).await.unwrap();
    sqlx::raw_sql(
        "CREATE TABLE target(id int PRIMARY KEY, name text); INSERT INTO target VALUES(1, 'old')",
    )
    .execute(&mut observer)
    .await
    .unwrap();
    let oid: i64 = sqlx::query_scalar("SELECT 'target'::regclass::oid::int8")
        .fetch_one(&mut observer)
        .await
        .unwrap();
    let original = sqlx::query("SELECT id, name FROM target")
        .fetch_one(&mut observer)
        .await
        .unwrap();
    let id: i32 = original.get(0);
    sqlx::raw_sql("UPDATE target SET name = 'concurrent edit' WHERE id = 1")
        .execute(&mut observer)
        .await
        .unwrap();
    review_execute(&state, "SELECT id, name FROM target", 10).await;
    let plan = edit_service::preview(
        &state,
        &ChangesPreviewRequest {
            connection_id: CONN_ID.into(),
            result_tab_id: "review-result".into(),
            relation_oid: oid as u32,
            changes: vec![RowChange::Delete {
                row_id: "d:0".into(),
                identity: RowIdentity {
                    relation_oid: oid as u32,
                    primary_key: vec![PrimaryKeyValue {
                        attribute_number: 1,
                        column_name: "id".into(),
                        value: DbValue::Integer {
                            value: id.to_string(),
                        },
                    }],
                    xmin: None,
                },
                original_values: HashMap::from([(
                    "name".into(),
                    DbValue::Text {
                        value: "old".into(),
                    },
                )]),
            }],
        },
    )
    .await;
    let plan = plan.unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    edit_service::commit(
        &state,
        &ChangesCommitRequest {
            change_set_id: plan.change_set_id,
        },
        Arc::new(move |e| tx.send(e).is_ok()),
    )
    .await
    .unwrap();
    let mut terminal = None;
    while let Some(event) = rx.recv().await {
        if !matches!(
            event,
            ChangesCommitEvent::Started { .. } | ChangesCommitEvent::Progress { .. }
        ) {
            terminal = Some(event);
            break;
        }
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM target")
        .fetch_one(&mut observer)
        .await
        .unwrap();
    assert_eq!(
        count, 1,
        "concurrently modified row deleted without conflict: {terminal:?}"
    );
}

#[tokio::test]
async fn review_cancel_terminal_must_wait_for_server() {
    use sqlx::Connection;
    let (_node, state) = setup().await;
    let (opts, control) = {
        let w = state.workspaces.lock().unwrap();
        let w = w.get(CONN_ID).unwrap();
        (w.connect_opts.clone(), w.control.clone())
    };
    let mut observer = sqlx::PgConnection::connect_with(&opts).await.unwrap();
    // Model a control connection occupied by a metadata query or blocked edit.
    let _control_busy = control.lock().await;
    let (sink, mut rx) = sink_channel();
    let accepted = query_service::execute(
        &state,
        req("cancel-review", "SELECT pg_sleep(10)", 10),
        sink,
    )
    .unwrap();
    let pid = loop {
        if let QueryStreamEvent::Started { backend_pid, .. } = rx.recv().await.unwrap() {
            break backend_pid;
        }
    };
    for _ in 0..100 {
        let active: bool = sqlx::query_scalar(
            "SELECT state = 'active' AND wait_event = 'PgSleep' FROM pg_stat_activity WHERE pid=$1",
        )
        .bind(pid)
        .fetch_one(&mut observer)
        .await
        .unwrap();
        if active {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let cancel_req = QueryCancelRequest {
        execution_id: accepted.execution_id.clone(),
    };
    timeout(
        Duration::from_secs(2),
        query_service::cancel(&state, &cancel_req),
    )
    .await
    .unwrap()
    .unwrap();
    let terminal = collect_events(&state, &accepted.execution_id, &mut rx).await;
    assert!(
        matches!(terminal.last(), Some(QueryStreamEvent::Cancelled { .. })),
        "{terminal:?}"
    );
    let active: bool = sqlx::query_scalar(
        "SELECT state = 'active' AND wait_event = 'PgSleep' FROM pg_stat_activity WHERE pid=$1",
    )
    .bind(pid)
    .fetch_one(&mut observer)
    .await
    .unwrap();
    // Cleanup via independent observer before asserting.
    let _: bool = sqlx::query_scalar("SELECT pg_cancel_backend($1)")
        .bind(pid)
        .fetch_one(&mut observer)
        .await
        .unwrap();
    assert!(
        !active,
        "terminal={:?}, but server still running pg_sleep",
        terminal.last()
    );
}

#[tokio::test]
async fn savepoint_recovery_and_chained_transactions_keep_session_state() {
    let (_node, state) = setup().await;
    review_execute(&state, "BEGIN", 10).await;
    review_execute(&state, "SAVEPOINT s", 10).await;
    review_execute(&state, "SELECT 1/0", 10).await;
    let recovered = review_execute(&state, "ROLLBACK TO SAVEPOINT s", 10).await;
    assert!(matches!(
        recovered.last(),
        Some(QueryStreamEvent::Completed {
            transaction_state: TransactionState::InTransaction,
            ..
        })
    ));
    let chained = review_execute(&state, "COMMIT AND CHAIN", 10).await;
    assert!(matches!(
        chained.last(),
        Some(QueryStreamEvent::Completed {
            transaction_state: TransactionState::InTransaction,
            ..
        })
    ));
    let closed = review_execute(&state, "ROLLBACK /* TO savepoint */", 10).await;
    assert!(matches!(
        closed.last(),
        Some(QueryStreamEvent::Completed {
            transaction_state: TransactionState::Idle,
            ..
        })
    ));
}

#[tokio::test]
async fn preview_expiry_and_result_release_prevent_stale_commits() {
    use dbpod_lib::application::edit_service;
    use dbpod_lib::domain::editing::*;
    use dbpod_lib::domain::metadata::*;
    let (_node, state) = setup().await;
    review_execute(
        &state,
        "CREATE TABLE expiry_target(id int PRIMARY KEY, name text)",
        10,
    )
    .await;
    let schemas = dbpod_lib::application::metadata_service::list_schemas(
        &state,
        &MetadataListSchemasRequest {
            connection_id: CONN_ID.into(),
            include_system: false,
        },
    )
    .await
    .unwrap();
    let objects = dbpod_lib::application::metadata_service::list_objects(
        &state,
        &MetadataListObjectsRequest {
            connection_id: CONN_ID.into(),
            schema_oids: schemas.iter().map(|s| s.oid).collect(),
            kinds: vec![ObjectKind::Table],
        },
    )
    .await
    .unwrap();
    let oid = objects
        .iter()
        .find(|o| o.name == "expiry_target")
        .unwrap()
        .oid;
    let request = ChangesPreviewRequest {
        connection_id: CONN_ID.into(),
        result_tab_id: "review-result".into(),
        relation_oid: oid,
        changes: vec![RowChange::Insert {
            row_id: "i:1".into(),
            values: HashMap::from([(
                "id".into(),
                InsertCellDraft::Value {
                    value: DbValue::Integer { value: "1".into() },
                },
            )]),
        }],
    };
    let preview = edit_service::preview(&state, &request).await.unwrap();
    state
        .change_sets
        .lock()
        .unwrap()
        .get_mut(&preview.change_set_id)
        .unwrap()
        .expires = std::time::Instant::now() - Duration::from_secs(1);
    let sink: edit_service::CommitSink = Arc::new(|_| true);
    assert!(edit_service::commit(
        &state,
        &ChangesCommitRequest {
            change_set_id: preview.change_set_id
        },
        sink.clone()
    )
    .await
    .unwrap_err()
    .message
    .contains("expired"));
    let preview = edit_service::preview(&state, &request).await.unwrap();
    // A previously accepted plan must not write if its database no longer matches.
    state
        .change_sets
        .lock()
        .unwrap()
        .get_mut(&preview.change_set_id)
        .unwrap()
        .database = "previous_database".into();
    let events = Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured = events.clone();
    edit_service::commit(
        &state,
        &ChangesCommitRequest {
            change_set_id: preview.change_set_id,
        },
        Arc::new(move |event| {
            captured.lock().unwrap().push(event);
            true
        }),
    )
    .await
    .unwrap();
    assert!(
        matches!(events.lock().unwrap().last(), Some(ChangesCommitEvent::Failed { error }) if error.code == "DATABASE_CHANGED")
    );
    let rows = review_execute(&state, "SELECT count(*) FROM expiry_target", 10).await;
    assert!(rows.iter().any(|e| matches!(e, QueryStreamEvent::Rows { rows, .. } if matches!(&rows[0][0], DbValue::Integer { value } if value == "0"))));
    let preview = edit_service::preview(&state, &request).await.unwrap();
    query_service::result_release(
        &state,
        &ResultReleaseRequest {
            result_tab_id: "review-result".into(),
        },
    )
    .unwrap();
    assert!(state.change_sets.lock().unwrap().is_empty());
    assert!(edit_service::commit(
        &state,
        &ChangesCommitRequest {
            change_set_id: preview.change_set_id
        },
        sink
    )
    .await
    .is_err());
}

#[tokio::test]
async fn closing_connection_releases_owned_results_and_budget() {
    use dbpod_lib::application::connection_service;
    let (_node, state) = setup().await;
    review_execute(&state, "SELECT repeat('x', 20000)", 10).await;
    assert!(!state.large_values.lock().unwrap().is_empty());
    assert!(
        state
            .retained_usage
            .lock()
            .unwrap()
            .get(CONN_ID)
            .copied()
            .unwrap_or(0)
            > 0
    );
    connection_service::connection_close(&state, CONN_ID)
        .await
        .unwrap();
    assert!(state.large_values.lock().unwrap().is_empty());
    assert!(state.executions.lock().unwrap().is_empty());
    assert!(state.retained_usage.lock().unwrap().is_empty());
    connection_service::connection_close(&state, CONN_ID)
        .await
        .unwrap();
}

#[tokio::test]
async fn one_time_password_connects_without_storing_a_secret() {
    use dbpod_lib::application::connection_service;
    let (_node, state) = setup().await;
    let mut profile = test_profile();
    profile.port = state
        .workspaces
        .lock()
        .unwrap()
        .get(CONN_ID)
        .unwrap()
        .connect_opts
        .get_port();
    profile.id = "one-time-profile".into();
    state
        .profiles
        .lock()
        .unwrap()
        .upsert(profile.clone())
        .unwrap();
    let opened = connection_service::connection_open(
        &state,
        ConnectionOpenRequest {
            profile_id: profile.id.clone(),
            password: Some("postgres".into()),
        },
    )
    .await
    .unwrap();
    assert!(
        !state
            .profiles
            .lock()
            .unwrap()
            .get(&profile.id)
            .unwrap()
            .has_stored_credential
    );
    let serialized =
        serde_json::to_string(state.profiles.lock().unwrap().get(&profile.id).unwrap()).unwrap();
    assert!(!serialized.contains("password"));
    let draft: ProfileDraft =
        serde_json::from_value(serde_json::to_value(&profile).unwrap()).unwrap();
    let error = connection_service::profile_save(
        &state,
        ConnectionProfileSaveRequest {
            profile: draft,
            secret: SecretInput::KeepExisting,
        },
    )
    .unwrap_err();
    assert!(error.message.contains("close the open connection"));
    assert_eq!(
        format!(
            "{:?}",
            ConnectionOpenRequest {
                profile_id: profile.id,
                password: Some("secret-sentinel".into())
            }
        ),
        "ConnectionOpenRequest(<redacted>)"
    );
    connection_service::connection_close(&state, &opened.connection_id)
        .await
        .unwrap();
}

#[tokio::test]
async fn deferred_commit_failure_reports_the_server_transaction_state() {
    use sqlx::Connection;
    let (_node, state) = setup().await;
    let opts = state
        .workspaces
        .lock()
        .unwrap()
        .get(CONN_ID)
        .unwrap()
        .connect_opts
        .clone();
    let mut observer = sqlx::PgConnection::connect_with(&opts).await.unwrap();
    review_execute(
        &state,
        "CREATE TABLE deferred_unique(id int UNIQUE DEFERRABLE INITIALLY DEFERRED)",
        10,
    )
    .await;
    let mut observed = Vec::new();
    for commit in ["COMMIT", "COMMIT AND CHAIN", "END"] {
        review_execute(&state, "BEGIN", 10).await;
        review_execute(&state, "INSERT INTO deferred_unique VALUES(1),(1)", 10).await;
        let events = review_execute(&state, commit, 10).await;
        let pid = state
            .workspaces
            .lock()
            .unwrap()
            .get(CONN_ID)
            .unwrap()
            .sessions["review"]
            .backend_pid
            .load(std::sync::atomic::Ordering::Acquire);
        let server_state: String =
            sqlx::query_scalar("SELECT state FROM pg_stat_activity WHERE pid=$1")
                .bind(pid)
                .fetch_one(&mut observer)
                .await
                .unwrap();
        observed.push((commit, server_state, events.last().unwrap().clone()));
        let next = review_execute(&state, "SELECT 1", 10).await;
        assert!(
            matches!(
                next.last(),
                Some(QueryStreamEvent::Completed {
                    transaction_state: TransactionState::Idle,
                    ..
                })
            ),
            "{next:?}"
        );
        review_execute(&state, "ROLLBACK", 10).await;
    }
    for (commit, server_state, terminal) in &observed {
        assert_eq!(server_state, "idle", "{observed:?}");
        assert!(
            matches!(
                terminal,
                QueryStreamEvent::Failed {
                    transaction_state: TransactionState::Idle,
                    ..
                }
            ),
            "{commit}: {observed:?}"
        );
    }
}

#[tokio::test]
async fn cancelled_delivery_after_server_completion_marks_a_partial_result() {
    let (_node, state) = setup().await;
    let (sink, mut rx) = sink_channel();
    let accepted = query_service::execute(
        &state,
        req("delivery", "SELECT generate_series(1,200)", 1000),
        sink,
    )
    .unwrap();
    let mut received = 0;
    while received < 150 {
        let event = timeout(Duration::from_secs(5), rx.recv())
            .await
            .unwrap()
            .unwrap();
        if let QueryStreamEvent::Rows { rows, .. } = event {
            received += rows.len();
        }
    }
    // The final 50 rows cannot pass the two-chunk ACK window. Do not ACK here.
    query_service::cancel(
        &state,
        &QueryCancelRequest {
            execution_id: accepted.execution_id.clone(),
        },
    )
    .await
    .unwrap();
    let events = collect_events(&state, &accepted.execution_id, &mut rx).await;
    assert!(
        matches!(
            events.last(),
            Some(QueryStreamEvent::Completed {
                row_count: 150,
                truncated: true,
                ..
            })
        ),
        "{events:?}"
    );
}

#[tokio::test]
async fn ddl_cannot_retarget_a_validated_change_preview() {
    use dbpod_lib::application::edit_service;
    use dbpod_lib::domain::editing::*;
    use sqlx::Connection;
    let (_node, state) = setup().await;
    let opts = state
        .workspaces
        .lock()
        .unwrap()
        .get(CONN_ID)
        .unwrap()
        .connect_opts
        .clone();
    let mut observer = sqlx::PgConnection::connect_with(&opts).await.unwrap();
    sqlx::raw_sql("CREATE TABLE ddl_target(id int PRIMARY KEY, name text)")
        .execute(&mut observer)
        .await
        .unwrap();
    let oid: i64 = sqlx::query_scalar("SELECT 'ddl_target'::regclass::oid::int8")
        .fetch_one(&mut observer)
        .await
        .unwrap();
    review_execute(&state, "SELECT * FROM ddl_target", 10).await;
    let request = ChangesPreviewRequest {
        connection_id: CONN_ID.into(),
        result_tab_id: "review-result".into(),
        relation_oid: oid as u32,
        changes: vec![RowChange::Insert {
            row_id: "i:1".into(),
            values: HashMap::from([(
                "id".into(),
                InsertCellDraft::Value {
                    value: DbValue::Integer { value: "1".into() },
                },
            )]),
        }],
    };
    for ddl in ["ALTER TABLE ddl_target RENAME COLUMN name TO previous_name; ALTER TABLE ddl_target ADD COLUMN name text", "ALTER TABLE ddl_target RENAME TO original_target; CREATE TABLE ddl_target(id int PRIMARY KEY, name text)"] {
        let plan = edit_service::preview(&state, &request).await.unwrap();
        sqlx::raw_sql(sqlx::AssertSqlSafe(ddl)).execute(&mut observer).await.unwrap();
        let events = Arc::new(std::sync::Mutex::new(Vec::new())); let captured = events.clone();
        edit_service::commit(&state, &ChangesCommitRequest { change_set_id: plan.change_set_id }, Arc::new(move |e| { captured.lock().unwrap().push(e); true })).await.unwrap();
        assert!(matches!(events.lock().unwrap().last(), Some(ChangesCommitEvent::Failed { error }) if error.code == "SCHEMA_CHANGED"));
        let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM ddl_target").fetch_one(&mut observer).await.unwrap();
        assert_eq!(rows, 0);
    }
}
