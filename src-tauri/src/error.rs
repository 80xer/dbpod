use serde::Serialize;
use ts_rs::TS;

/// IPC error shape shared by every command. Never contains SQL text,
/// bind values, passwords or connection strings.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub sql_state: Option<String>,
    pub position: Option<u32>,
    pub detail: Option<String>,
    pub hint: Option<String>,
}

impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable: false,
            sql_state: None,
            position: None,
            detail: None,
            hint: None,
        }
    }

    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self::new("INVALID_REQUEST", message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("INTERNAL_ERROR", message)
    }

    /// Map a sqlx error into an AppError without leaking SQL text or secrets.
    /// Postgres server errors keep SQLSTATE, position, detail and hint —
    /// the server-provided fields the spec allows through.
    pub fn from_sqlx(err: &sqlx::Error) -> Self {
        match err {
            sqlx::Error::Database(db) => {
                let sql_state = db.code().map(|c| c.to_string());
                let code = match sql_state.as_deref() {
                    Some("57014") => "QUERY_CANCELLED",
                    Some(s) if s.starts_with("28") => "AUTH_ERROR",
                    Some("42501") => "PERMISSION_DENIED",
                    _ => "POSTGRES_ERROR",
                };
                let pg = db.try_downcast_ref::<sqlx::postgres::PgDatabaseError>();
                Self {
                    code: code.into(),
                    message: db.message().to_string(),
                    retryable: false,
                    sql_state,
                    position: pg.and_then(|e| match e.position() {
                        Some(sqlx::postgres::PgErrorPosition::Original(p)) => Some(p as u32),
                        _ => None,
                    }),
                    detail: pg.and_then(|e| e.detail().map(String::from)),
                    hint: pg.and_then(|e| e.hint().map(String::from)),
                }
            }
            sqlx::Error::Io(_) | sqlx::Error::PoolTimedOut => {
                let mut e = Self::new("CONNECTION_LOST", "database connection lost");
                e.retryable = true;
                e
            }
            sqlx::Error::Tls(_) => Self::new("TLS_ERROR", "TLS negotiation or verification failed"),
            // ponytail: other sqlx variants collapsed; message is sqlx's own text
            // which never embeds user SQL or credentials for these variants.
            other => Self::new("INTERNAL_ERROR", other.to_string()),
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}
