use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum TlsMode {
    VerifyFull,
    VerifyCa,
    Insecure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    Local,
    Dev,
    Stage,
    Prod,
}

/// Persisted connection profile. Never contains a secret — the password
/// lives in the OS keychain under the profile id.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub environment: Environment,
    #[serde(default)]
    pub color: Option<String>,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub tls_mode: TlsMode,
    pub read_only: bool,
    pub query_timeout_ms: u32,
    pub max_rows: u32,
    pub has_stored_credential: bool,
}

/// Profile fields as submitted from the UI (no id on create, no credential flag).
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDraft {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub environment: Environment,
    #[serde(default)]
    pub color: Option<String>,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub tls_mode: TlsMode,
    pub read_only: bool,
    pub query_timeout_ms: u32,
    pub max_rows: u32,
}

#[derive(Clone, Deserialize, TS)]
#[serde(tag = "mode", rename_all = "kebab-case")]
pub enum SecretInput {
    KeepExisting,
    Replace { password: String },
    PromptEachTime,
}

impl std::fmt::Debug for SecretInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretInput(<redacted>)")
    }
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfileSaveRequest {
    pub profile: ProfileDraft,
    pub secret: SecretInput,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfileSaveResponse {
    pub profile_id: String,
}

/// Test either a saved profile (by id) or an unsaved draft with a one-time password.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestRequest {
    #[serde(default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub draft: Option<ProfileDraft>,
    #[serde(default)]
    pub password: Option<String>,
}

impl std::fmt::Debug for ConnectionTestRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ConnectionTestRequest(<redacted>)")
    }
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TlsStatus {
    pub enabled: bool,
    pub mode: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub server_version: String,
    pub latency_ms: u32,
    pub tls: TlsStatus,
    pub current_user: String,
    pub database: String,
    pub is_superuser: bool,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionOpenRequest {
    pub profile_id: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionOpenResponse {
    pub connection_id: String,
    pub profile_id: String,
    pub server_version: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionCloseRequest {
    pub connection_id: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub state: String,
    pub secure_storage_available: bool,
}
