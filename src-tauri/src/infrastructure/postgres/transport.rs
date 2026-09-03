use sqlx::postgres::{PgConnectOptions, PgSslMode};

use crate::domain::{ConnectionProfile, ProfileDraft, TlsMode};

/// The only place a PostgreSQL connection is assembled. The password comes in
/// as a parameter (fetched from the OS keychain by the caller) and never
/// leaves the Rust side.
pub fn build_connect_options(
    host: &str,
    port: u16,
    database: &str,
    username: &str,
    tls_mode: TlsMode,
    password: Option<&str>,
) -> PgConnectOptions {
    let ssl = match tls_mode {
        TlsMode::VerifyFull => PgSslMode::VerifyFull,
        TlsMode::VerifyCa => PgSslMode::VerifyCa,
        TlsMode::Insecure => PgSslMode::Prefer,
    };
    let mut opts = PgConnectOptions::new_without_pgpass()
        .host(host)
        .port(port)
        .database(database)
        .username(username)
        .ssl_mode(ssl)
        .application_name("dbpod");
    if let Some(pw) = password {
        opts = opts.password(pw);
    }
    opts
}

pub fn options_for_profile(p: &ConnectionProfile, password: Option<&str>) -> PgConnectOptions {
    build_connect_options(
        &p.host,
        p.port,
        &p.database,
        &p.username,
        p.tls_mode,
        password,
    )
}

pub fn options_for_draft(d: &ProfileDraft, password: Option<&str>) -> PgConnectOptions {
    build_connect_options(
        &d.host,
        d.port,
        &d.database,
        &d.username,
        d.tls_mode,
        password,
    )
}
