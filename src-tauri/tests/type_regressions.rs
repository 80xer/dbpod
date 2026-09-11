//! Decoder regressions using PostgreSQL's actual binary and text wire formats.
use dbpod_lib::domain::db_value::{DbValue, TemporalType};
use dbpod_lib::domain::profile::TlsMode;
use dbpod_lib::infrastructure::postgres::decoder::decode_row;
use dbpod_lib::infrastructure::postgres::large_values::LargeValueStore;
use dbpod_lib::infrastructure::postgres::transport::build_connect_options;
use sqlx::{AssertSqlSafe, Connection, Executor, PgConnection, Row};
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::ImageExt;

#[tokio::test]
async fn temporal_extremes_ranges_and_unknown_binary_are_safe_and_faithful() {
    let node = Postgres::default()
        .with_tag("17-alpine")
        .start()
        .await
        .unwrap();
    let opts = build_connect_options(
        "127.0.0.1",
        node.get_host_port_ipv4(5432).await.unwrap(),
        "postgres",
        "postgres",
        TlsMode::Insecure,
        Some("postgres"),
    );
    let mut conn = PgConnection::connect_with(&opts).await.unwrap();
    let large = LargeValueStore::default();

    for (pg_type, temporal_type, finite_values) in [
        (
            "date",
            TemporalType::Date,
            vec![
                "2024-06-15",
                "4713-01-01 BC",
                "0001-01-01 BC",
                "10000-01-01",
                "5874897-12-31",
            ],
        ),
        (
            "timestamp",
            TemporalType::Timestamp,
            vec![
                "2024-06-15 12:34:56.5",
                "4713-01-01 BC",
                "294276-12-31 23:59:59.999999",
            ],
        ),
        (
            "timestamptz",
            TemporalType::Timestamptz,
            vec![
                "2024-06-15 12:34:56.5+09",
                "4713-01-01 BC",
                "294276-12-31 23:59:59.999999+00",
            ],
        ),
    ] {
        for literal in ["infinity", "-infinity"].into_iter().chain(finite_values) {
            let sql = format!("SELECT '{literal}'::{pg_type}");
            // Dynamic fragments here are fixed test cases; decoded values are bound.
            let row = sqlx::query(AssertSqlSafe(sql.clone()))
                .fetch_one(&mut conn)
                .await
                .unwrap();
            let values = decode_row(&row, &large);
            let DbValue::Temporal {
                temporal_type: actual_type,
                value,
            } = &values[0]
            else {
                panic!("expected temporal for {sql}: {:?}", values[0]);
            };
            assert_eq!(*actual_type, temporal_type);
            if literal.ends_with("infinity") {
                assert_eq!(value, literal);
            }
            let equal: bool = sqlx::query_scalar(AssertSqlSafe(format!(
                "SELECT $1::text::{pg_type} = '{literal}'::{pg_type}"
            )))
            .bind(value)
            .fetch_one(&mut conn)
            .await
            .unwrap();
            assert!(equal, "{sql} decoded as {value}");
        }
    }

    let row = sqlx::query(
        "SELECT '24:00:00'::time, '24:00:00+15:59'::timetz, '-2147483648 days'::interval",
    )
    .fetch_one(&mut conn)
    .await
    .unwrap();
    for (cell, expected) in
        decode_row(&row, &large)
            .iter()
            .zip(["24:00:00", "24:00:00+15:59", "-2147483648 days"])
    {
        assert!(
            matches!(cell, DbValue::Temporal { value, .. } if value == expected),
            "{cell:?}"
        );
    }

    for pg_type in [
        "int4range",
        "int8range",
        "numrange",
        "daterange",
        "tsrange",
        "tstzrange",
    ] {
        for literal in ["empty", "(,)"] {
            let row = sqlx::query(AssertSqlSafe(format!("SELECT '{literal}'::{pg_type}")))
                .fetch_one(&mut conn)
                .await
                .unwrap();
            assert!(
                matches!(&decode_row(&row, &large)[0], DbValue::Range { value, .. } if value == literal)
            );
        }
    }
    for expression in [
        "int4range(-10, 10, '(]')",
        "int8range(-9223372036854775808, 9223372036854775807)",
        "numrange(1.2300, 2.3400)",
        "numrange('-Infinity', 'Infinity')",
        "daterange('-infinity', 'infinity', '[]')",
        "daterange('5000000-01-01', '5000000-02-01')",
        "daterange('0002-01-01 BC', '0001-01-01 BC')",
        "tsrange('-infinity', 'infinity', '[]')",
        "tsrange('280000-01-01', '280000-02-01')",
        "tsrange('0002-01-01 BC', '0001-01-01 BC')",
        "tstzrange('-infinity', 'infinity', '[]')",
        "tstzrange('280000-01-01', '280000-02-01')",
    ] {
        let row = sqlx::query(AssertSqlSafe(format!("SELECT {expression}")))
            .fetch_one(&mut conn)
            .await
            .unwrap();
        let values = decode_row(&row, &large);
        let DbValue::Range { value, range_type } = &values[0] else {
            panic!("expected range for {expression}: {:?}", values[0]);
        };
        let equal: bool = sqlx::query_scalar(AssertSqlSafe(format!(
            "SELECT $1::text::{range_type} = {expression}"
        )))
        .bind(value)
        .fetch_one(&mut conn)
        .await
        .unwrap();
        assert!(equal, "{expression} decoded as {value}");
    }

    let row = sqlx::query("SELECT point(0, 0)")
        .fetch_one(&mut conn)
        .await
        .unwrap();
    assert_eq!(
        row.try_get_raw(0).unwrap().format(),
        sqlx::postgres::PgValueFormat::Binary
    );
    assert!(
        matches!(&decode_row(&row, &large)[0], DbValue::Unknown { value, .. } if value == "<point>")
    );

    let row = conn.fetch_one("SELECT point(0, 0)").await.unwrap();
    assert_eq!(
        row.try_get_raw(0).unwrap().format(),
        sqlx::postgres::PgValueFormat::Text
    );
    assert!(
        matches!(&decode_row(&row, &large)[0], DbValue::Unknown { value, .. } if value == "(0,0)")
    );
}
