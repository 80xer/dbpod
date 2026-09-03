//! Integration tests against a disposable PostgreSQL (testcontainers).
//! Covers the Milestone A gate: chunk ordering, exactly-one-terminal,
//! truncation, type decode, error mapping, cancel, backpressure, cleanup.

use std::collections::HashMap;
use std::sync::Arc;

use dbpod_lib::application::query_service;
use dbpod_lib::domain::db_value::{DbValue, JsonType, TemporalType};
use dbpod_lib::domain::events::*;
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
    let state = AppState::new(ProfileStore::load(dir).unwrap());
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

#[tokio::test]
async fn streams_chunks_in_order_with_exactly_one_terminal() {
    let (_node, state) = setup().await;
    let (sink, mut rx) = sink_channel();
    let accepted = query_service::execute(
        &state,
        req("t1", "SELECT generate_series(1, 250)", 10_000),
        sink,
    )
    .unwrap();
    let events = collect_events(&state, &accepted.execution_id, &mut rx).await;

    assert!(matches!(events[0], QueryStreamEvent::Started { .. }));
    assert!(matches!(events[1], QueryStreamEvent::Columns { .. }));
    let chunk_sizes: Vec<(u64, usize)> = events
        .iter()
        .filter_map(|e| match e {
            QueryStreamEvent::Rows { sequence, rows, .. } => Some((*sequence, rows.len())),
            _ => None,
        })
        .collect();
    assert_eq!(chunk_sizes, vec![(0, 50), (1, 100), (2, 100)]);
    let terminals = events.iter().filter(|e| is_terminal(e)).count();
    assert_eq!(terminals, 1);
    match events.last().unwrap() {
        QueryStreamEvent::Completed {
            row_count,
            truncated,
            ..
        } => {
            assert_eq!(*row_count, 250);
            assert!(!truncated);
        }
        other => panic!("expected completed, got {other:?}"),
    }
    // nothing after terminal
    assert!(
        timeout(Duration::from_millis(300), rx.recv())
            .await
            .is_err()
            || rx.try_recv().is_err()
    );
}

#[tokio::test]
async fn max_rows_truncates() {
    let (_node, state) = setup().await;
    let (sink, mut rx) = sink_channel();
    let accepted = query_service::execute(
        &state,
        req("t1", "SELECT generate_series(1, 10000)", 100),
        sink,
    )
    .unwrap();
    let events = collect_events(&state, &accepted.execution_id, &mut rx).await;
    match events.last().unwrap() {
        QueryStreamEvent::Completed {
            row_count,
            truncated,
            ..
        } => {
            assert_eq!(*row_count, 100);
            assert!(truncated);
        }
        other => panic!("expected completed, got {other:?}"),
    }
}

#[tokio::test]
async fn decodes_slice_types_and_falls_back() {
    let (_node, state) = setup().await;
    let (sink, mut rx) = sink_channel();
    let sql = "SELECT null, true, 42::int8, 1.5::float8, 12.34::numeric, 'x'::text, \
               '2024-01-02T03:04:05Z'::timestamptz, '0f8fad5b-d9cb-469f-a165-70867728950e'::uuid, \
               '{\"a\":1}'::jsonb, '1 day'::interval";
    let accepted = query_service::execute(&state, req("t1", sql, 10), sink).unwrap();
    let events = collect_events(&state, &accepted.execution_id, &mut rx).await;
    let row = events
        .iter()
        .find_map(|e| match e {
            QueryStreamEvent::Rows { rows, .. } => Some(rows[0].clone()),
            _ => None,
        })
        .expect("row event");
    assert!(matches!(row[0], DbValue::Null));
    assert!(matches!(row[1], DbValue::Boolean { value: true }));
    assert!(matches!(&row[2], DbValue::Integer { value } if value == "42"));
    assert!(matches!(&row[3], DbValue::Float { value } if value == "1.5"));
    assert!(matches!(&row[4], DbValue::Decimal { value } if value == "12.34"));
    assert!(matches!(&row[5], DbValue::Text { value } if value == "x"));
    assert!(
        matches!(&row[6], DbValue::Temporal { temporal_type: TemporalType::Timestamptz, value }
            if value.starts_with("2024-01-02"))
    );
    assert!(
        matches!(&row[7], DbValue::Uuid { value } if value == "0f8fad5b-d9cb-469f-a165-70867728950e")
    );
    assert!(
        matches!(&row[8], DbValue::Json { value, json_type: JsonType::Jsonb } if value == "{\"a\": 1}")
    );
    assert!(
        matches!(&row[9], DbValue::Temporal { temporal_type: TemporalType::Interval, value }
            if value == "1 day")
    );
}

async fn run_single_row(state: &AppState, sql: &str) -> Vec<DbValue> {
    let (sink, mut rx) = sink_channel();
    let accepted = query_service::execute(state, req("t-types", sql, 10), sink).unwrap();
    let events = collect_events(state, &accepted.execution_id, &mut rx).await;
    match events.last().unwrap() {
        QueryStreamEvent::Completed { .. } => {}
        other => panic!("expected completed, got {other:?}"),
    }
    events
        .iter()
        .find_map(|e| match e {
            QueryStreamEvent::Rows { rows, .. } => Some(rows[0].clone()),
            _ => None,
        })
        .expect("row event")
}

#[tokio::test]
async fn type_spec_acceptance() {
    let (_node, state) = setup().await;

    // int8 min/max round-trip without precision loss
    let row = run_single_row(&state, "SELECT (-9223372036854775808)::int8, 9223372036854775807::int8").await;
    assert!(matches!(&row[0], DbValue::Integer { value } if value == "-9223372036854775808"));
    assert!(matches!(&row[1], DbValue::Integer { value } if value == "9223372036854775807"));

    // 50-digit numeric with scale preserved
    let big = "12345678901234567890123456789012345678901234.567890";
    let row = run_single_row(&state, &format!("SELECT {big}::numeric")).await;
    assert!(matches!(&row[0], DbValue::Decimal { value } if value == big));

    // float special values
    let row = run_single_row(
        &state,
        "SELECT 'NaN'::float8, 'Infinity'::float8, '-Infinity'::float8",
    )
    .await;
    assert!(matches!(&row[0], DbValue::Float { value } if value == "NaN"));
    assert!(matches!(&row[1], DbValue::Float { value } if value == "Infinity"));
    assert!(matches!(&row[2], DbValue::Float { value } if value == "-Infinity"));

    // timestamp without tz keeps its wall-clock value; date and time canonical
    let row = run_single_row(
        &state,
        "SELECT '2024-06-15 12:34:56.5'::timestamp, '2024-06-15'::date, '23:59:59'::time",
    )
    .await;
    assert!(
        matches!(&row[0], DbValue::Temporal { temporal_type: TemporalType::Timestamp, value }
            if value == "2024-06-15T12:34:56.500")
    );
    assert!(matches!(&row[1], DbValue::Temporal { temporal_type: TemporalType::Date, value } if value == "2024-06-15"));
    assert!(matches!(&row[2], DbValue::Temporal { temporal_type: TemporalType::Time, value } if value == "23:59:59"));

    // jsonb big integer stays raw text (no JS number rounding)
    let row = run_single_row(&state, "SELECT '{\"n\": 9007199254740993}'::jsonb").await;
    assert!(matches!(&row[0], DbValue::Json { value, .. } if value.contains("9007199254740993")));

    // 1-D array with NULL element
    let row = run_single_row(&state, "SELECT ARRAY[1, NULL, 3]::int4[]").await;
    match &row[0] {
        DbValue::Array { dimensions, values, .. } => {
            assert_eq!(dimensions.len(), 1);
            assert_eq!(dimensions[0].length, 3);
            assert!(matches!(values[1], DbValue::Null));
            assert!(matches!(&values[2], DbValue::Integer { value } if value == "3"));
        }
        other => panic!("expected array, got {other:?}"),
    }

    // network, range, money
    let row = run_single_row(
        &state,
        "SELECT '192.168.0.0/24'::cidr, int4range(1, 10), 1234.56::money",
    )
    .await;
    assert!(matches!(&row[0], DbValue::Network { value, .. } if value == "192.168.0.0/24"));
    assert!(matches!(&row[1], DbValue::Range { value, .. } if value == "[1,10)"));
    assert!(matches!(&row[2], DbValue::Decimal { value } if value == "1234.56"));

    // enum label with type name
    run_single_row(&state, "SELECT 1").await; // keep session warm
    {
        let (sink, mut rx) = sink_channel();
        let accepted = query_service::execute(
            &state,
            req("t-types", "CREATE TYPE mood AS ENUM ('happy','sad')", 10),
            sink,
        )
        .unwrap();
        collect_events(&state, &accepted.execution_id, &mut rx).await;
    }
    let row = run_single_row(&state, "SELECT 'happy'::mood").await;
    assert!(
        matches!(&row[0], DbValue::Enum { value, type_name } if value == "happy" && type_name == "mood")
    );

    // unknown extension-ish type falls back without failing the query
    let row = run_single_row(&state, "SELECT point(1,2)").await;
    assert!(matches!(&row[0], DbValue::Unknown { .. }));
}

#[tokio::test]
async fn large_bytea_uses_value_handle_and_fetch() {
    let (_node, state) = setup().await;

    // 1 MiB bytea -> no inline value, handle present, grid not blocked
    let row = run_single_row(&state, "SELECT repeat('ab', 524288)::bytea").await;
    let handle = match &row[0] {
        DbValue::Binary {
            value,
            byte_length,
            truncated,
            value_handle,
            ..
        } => {
            assert!(value.is_none());
            assert_eq!(*byte_length, 1_048_576);
            assert!(truncated);
            value_handle.clone().expect("handle")
        }
        other => panic!("expected binary, got {other:?}"),
    };

    let fetched = query_service::result_value_fetch(
        &state,
        &ResultValueFetchRequest {
            result_tab_id: "t-types-result".into(),
            value_handle: handle.clone(),
            offset: 0,
            length: 4,
        },
    )
    .unwrap();
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(fetched.data)
        .unwrap();
    assert_eq!(bytes, b"abab");
    assert!(!fetched.eof);

    // release drops the handle
    query_service::result_release(
        &state,
        &ResultReleaseRequest {
            result_tab_id: "t-types-result".into(),
        },
    )
    .unwrap();
    assert!(query_service::result_value_fetch(
        &state,
        &ResultValueFetchRequest {
            result_tab_id: "t-types-result".into(),
            value_handle: handle,
            offset: 0,
            length: 4,
        },
    )
    .is_err());

    // small bytea stays inline
    let row = run_single_row(&state, "SELECT 'abc'::bytea").await;
    assert!(
        matches!(&row[0], DbValue::Binary { value: Some(v), truncated: false, .. } if v == "YWJj")
    );
}

#[tokio::test]
async fn syntax_error_maps_sqlstate_and_position_and_multistatement_rejected() {
    let (_node, state) = setup().await;

    let (sink, mut rx) = sink_channel();
    let accepted = query_service::execute(&state, req("t1", "select from from", 10), sink).unwrap();
    let events = collect_events(&state, &accepted.execution_id, &mut rx).await;
    match events.last().unwrap() {
        QueryStreamEvent::Failed { error, .. } => {
            assert_eq!(error.sql_state.as_deref(), Some("42601"));
            assert!(error.position.is_some());
        }
        other => panic!("expected failed, got {other:?}"),
    }

    // multi-statement rejected by the extended protocol
    let (sink2, mut rx2) = sink_channel();
    let accepted2 =
        query_service::execute(&state, req("t1", "select 1; select 2", 10), sink2).unwrap();
    let events2 = collect_events(&state, &accepted2.execution_id, &mut rx2).await;
    assert!(matches!(
        events2.last().unwrap(),
        QueryStreamEvent::Failed { .. }
    ));
}

#[tokio::test]
async fn cancel_long_query_then_session_reusable() {
    let (_node, state) = setup().await;
    let (sink, mut rx) = sink_channel();
    let accepted =
        query_service::execute(&state, req("t1", "SELECT pg_sleep(30)", 10), sink).unwrap();

    // wait for started
    loop {
        let e = timeout(Duration::from_secs(15), rx.recv())
            .await
            .unwrap()
            .unwrap();
        if matches!(e, QueryStreamEvent::Started { .. }) {
            break;
        }
    }
    let resp = query_service::cancel(
        &state,
        &QueryCancelRequest {
            execution_id: accepted.execution_id.clone(),
        },
    )
    .await
    .unwrap();
    assert_eq!(resp.state, "cancel-requested");

    let events = collect_events(&state, &accepted.execution_id, &mut rx).await;
    assert!(matches!(
        events.last().unwrap(),
        QueryStreamEvent::Cancelled { .. }
    ));

    // session still usable afterwards
    let (sink2, mut rx2) = sink_channel();
    let accepted2 = query_service::execute(&state, req("t1", "select 1", 10), sink2).unwrap();
    let events2 = collect_events(&state, &accepted2.execution_id, &mut rx2).await;
    assert!(matches!(
        events2.last().unwrap(),
        QueryStreamEvent::Completed { .. }
    ));
}

#[tokio::test]
async fn second_execution_on_same_tab_rejected_while_running() {
    let (_node, state) = setup().await;
    let (sink, mut rx) = sink_channel();
    let accepted =
        query_service::execute(&state, req("t1", "SELECT pg_sleep(10)", 10), sink).unwrap();
    loop {
        let e = timeout(Duration::from_secs(15), rx.recv())
            .await
            .unwrap()
            .unwrap();
        if matches!(e, QueryStreamEvent::Started { .. }) {
            break;
        }
    }
    let (sink2, _rx2) = sink_channel();
    let err = query_service::execute(&state, req("t1", "select 1", 10), sink2).unwrap_err();
    assert_eq!(err.code, "QUERY_ALREADY_RUNNING");

    let _ = query_service::cancel(
        &state,
        &QueryCancelRequest {
            execution_id: accepted.execution_id.clone(),
        },
    )
    .await;
    let _ = collect_events(&state, &accepted.execution_id, &mut rx).await;
}

#[tokio::test]
async fn backpressure_blocks_third_chunk_until_ack() {
    let (_node, state) = setup().await;
    let (sink, mut rx) = sink_channel();
    let accepted = query_service::execute(
        &state,
        req("t1", "SELECT generate_series(1, 500)", 10_000),
        sink,
    )
    .unwrap();

    // no acks: expect started, columns, rows(0), rows(1), then silence
    let mut rows_seen = 0u64;
    loop {
        match timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(QueryStreamEvent::Rows { sequence, .. })) => {
                rows_seen += 1;
                assert!(sequence <= 1, "chunk {sequence} sent without ack window");
                if rows_seen == 2 {
                    break;
                }
            }
            Ok(Some(_)) => {}
            other => panic!("unexpected: {other:?}"),
        }
    }
    // third chunk must NOT arrive without an ack
    assert!(
        timeout(Duration::from_millis(500), rx.recv())
            .await
            .is_err(),
        "third chunk arrived while 2 chunks were unacked"
    );

    // ack chunk 0 -> exactly one more chunk may flow
    query_service::ack_chunk(
        &state,
        &QueryAckChunkRequest {
            execution_id: accepted.execution_id.clone(),
            sequence: 0,
        },
    )
    .unwrap();
    match timeout(Duration::from_secs(5), rx.recv()).await {
        Ok(Some(QueryStreamEvent::Rows { sequence, .. })) => assert_eq!(sequence, 2),
        other => panic!("expected rows seq 2, got {other:?}"),
    }

    // duplicate ack is idempotent; ack of unsent sequence is an error
    query_service::ack_chunk(
        &state,
        &QueryAckChunkRequest {
            execution_id: accepted.execution_id.clone(),
            sequence: 0,
        },
    )
    .unwrap();
    let err = query_service::ack_chunk(
        &state,
        &QueryAckChunkRequest {
            execution_id: accepted.execution_id.clone(),
            sequence: 99,
        },
    )
    .unwrap_err();
    assert_eq!(err.code, "INVALID_REQUEST");

    // open the window fully, then drain to terminal (collect_events acks the rest)
    query_service::ack_chunk(
        &state,
        &QueryAckChunkRequest {
            execution_id: accepted.execution_id.clone(),
            sequence: 2,
        },
    )
    .unwrap();
    let _ = collect_events(&state, &accepted.execution_id, &mut rx).await;
}

#[tokio::test]
async fn session_close_rolls_back_and_kills_backend() {
    let (_node, state) = setup().await;
    let (sink, mut rx) = sink_channel();
    let accepted = query_service::execute(&state, req("t1", "BEGIN", 10), sink).unwrap();
    let events = collect_events(&state, &accepted.execution_id, &mut rx).await;
    let backend_pid = events
        .iter()
        .find_map(|e| match e {
            QueryStreamEvent::Started { backend_pid, .. } => Some(*backend_pid),
            _ => None,
        })
        .unwrap();
    match events.last().unwrap() {
        QueryStreamEvent::Completed {
            transaction_state, ..
        } => {
            assert_eq!(*transaction_state, TransactionState::InTransaction);
        }
        other => panic!("expected completed, got {other:?}"),
    }

    query_service::session_close(
        &state,
        &QuerySessionCloseRequest {
            session_id: accepted.session_id.clone(),
            rollback_open_transaction: true,
        },
    )
    .await
    .unwrap();

    // backend must disappear from pg_stat_activity
    let opts = {
        let ws = state.workspaces.lock().unwrap();
        ws.get(CONN_ID).unwrap().connect_opts.clone()
    };
    let mut probe = sqlx::PgConnection::connect_with(&opts).await.unwrap();
    for attempt in 0..30 {
        let alive: i64 = sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE pid = $1")
            .bind(backend_pid)
            .fetch_one(&mut probe)
            .await
            .unwrap();
        if alive == 0 {
            return;
        }
        assert!(attempt < 29, "session backend still alive after close");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

use sqlx::Connection;

#[tokio::test]
async fn metadata_and_table_data() {
    use dbpod_lib::application::metadata_service;
    use dbpod_lib::domain::metadata::*;

    let (_node, state) = setup().await;

    // fixtures via the query path
    for sql in [
        "CREATE TABLE public.items (id serial PRIMARY KEY, name text NOT NULL, note text)",
        "INSERT INTO public.items (name) SELECT 'n' || g FROM generate_series(1, 25) g",
        "CREATE TABLE public.\"we\"\"ird\" (\"select\" int PRIMARY KEY, \"order by\" text)",
        "INSERT INTO public.\"we\"\"ird\" VALUES (1, 'x'), (2, 'y')",
    ] {
        let (sink, mut rx) = sink_channel();
        let accepted = query_service::execute(&state, req("t-meta", sql, 10), sink).unwrap();
        let events = collect_events(&state, &accepted.execution_id, &mut rx).await;
        assert!(
            matches!(events.last().unwrap(), QueryStreamEvent::Completed { .. }),
            "fixture failed: {sql}"
        );
    }

    let schemas = metadata_service::list_schemas(
        &state,
        &MetadataListSchemasRequest {
            connection_id: CONN_ID.into(),
            include_system: false,
        },
    )
    .await
    .unwrap();
    assert!(schemas.iter().any(|s| s.name == "public"));
    assert!(!schemas.iter().any(|s| s.name == "pg_catalog"));
    let public_oid = schemas.iter().find(|s| s.name == "public").unwrap().oid;

    let objects = metadata_service::list_objects(
        &state,
        &MetadataListObjectsRequest {
            connection_id: CONN_ID.into(),
            schema_oids: vec![public_oid],
            kinds: vec![ObjectKind::Table],
        },
    )
    .await
    .unwrap();
    let items = objects.iter().find(|o| o.name == "items").expect("items table");
    assert_eq!(items.can_select, Some(true));
    assert!(objects.iter().any(|o| o.name == "we\"ird"));

    let meta = metadata_service::get_table(
        &state,
        &MetadataGetTableRequest {
            connection_id: CONN_ID.into(),
            relation_oid: items.oid,
        },
    )
    .await
    .unwrap();
    assert_eq!(meta.schema, "public");
    assert_eq!(meta.kind, "table");
    assert_eq!(meta.primary_key, vec![1]);
    assert_eq!(meta.columns.len(), 3);
    assert!(meta.columns[0].is_primary_key);
    assert!(!meta.columns[1].nullable);
    assert!(meta.columns[0].default_expr.as_deref().unwrap_or("").contains("nextval"));

    // table data: sorted desc by id, limit 2 offset 1 -> ids 24, 23; xmin rides along
    let (sink, mut rx) = sink_channel();
    let accepted = query_service::table_data_execute(
        &state,
        TableDataExecuteRequest {
            connection_id: CONN_ID.into(),
            query_tab_id: "t-meta".into(),
            result_tab_id: "t-meta-data".into(),
            relation_oid: items.oid,
            sort_attribute: Some(1),
            sort_descending: true,
            limit: 2,
            offset: 1,
        },
        sink,
    )
    .await
    .unwrap();
    let events = collect_events(&state, &accepted.execution_id, &mut rx).await;
    let columns = events
        .iter()
        .find_map(|e| match e {
            QueryStreamEvent::Columns { columns, .. } => Some(columns.clone()),
            _ => None,
        })
        .unwrap();
    assert_eq!(columns[0].name, "__dbpod_xmin");
    assert_eq!(columns[1].name, "id");
    let rows: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            QueryStreamEvent::Rows { rows, .. } => Some(rows.clone()),
            _ => None,
        })
        .flatten()
        .collect();
    assert_eq!(rows.len(), 2);
    assert!(matches!(&rows[0][1], DbValue::Integer { value } if value == "24"));
    assert!(matches!(&rows[1][1], DbValue::Integer { value } if value == "23"));

    // special-character identifiers stay safe
    let weird = objects.iter().find(|o| o.name == "we\"ird").unwrap();
    let (sink, mut rx) = sink_channel();
    let accepted = query_service::table_data_execute(
        &state,
        TableDataExecuteRequest {
            connection_id: CONN_ID.into(),
            query_tab_id: "t-meta".into(),
            result_tab_id: "t-meta-data2".into(),
            relation_oid: weird.oid,
            sort_attribute: Some(2),
            sort_descending: false,
            limit: 10,
            offset: 0,
        },
        sink,
    )
    .await
    .unwrap();
    let events = collect_events(&state, &accepted.execution_id, &mut rx).await;
    assert!(matches!(events.last().unwrap(), QueryStreamEvent::Completed { row_count: 2, .. }));
}
