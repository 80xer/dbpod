//! Headless credential-path smoke: saving a profile puts the password in the
//! OS keychain and never in profiles.json; deleting removes both.

use dbpod_lib::application::connection_service;
use dbpod_lib::domain::profile::*;
use dbpod_lib::infrastructure::persistence::profiles::ProfileStore;
use dbpod_lib::infrastructure::platform::keychain;
use dbpod_lib::state::AppState;

fn draft(name: &str) -> ProfileDraft {
    ProfileDraft {
        id: None,
        name: name.into(),
        environment: Environment::Local,
        color: None,
        host: "127.0.0.1".into(),
        port: 5432,
        database: "postgres".into(),
        username: "postgres".into(),
        tls_mode: TlsMode::VerifyFull,
        read_only: false,
        query_timeout_ms: 60_000,
        max_rows: 500,
    }
}

#[test]
fn profile_save_keeps_secret_out_of_disk() {
    let dir = std::env::temp_dir().join(format!("dbpod-vault-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let state = AppState::new(dir.clone(), ProfileStore::load(dir.clone()).unwrap());

    let secret = "s3cr3t-smoke-password";
    let saved = connection_service::profile_save(
        &state,
        ConnectionProfileSaveRequest {
            profile: draft("vault-smoke"),
            secret: SecretInput::Replace {
                password: secret.into(),
            },
        },
    )
    .unwrap();

    // password reachable via keychain only
    assert_eq!(
        keychain::get_password(&saved.profile_id)
            .unwrap()
            .as_deref(),
        Some(secret)
    );

    // profiles.json exists and contains no secret material
    let json = std::fs::read_to_string(dir.join("profiles.json")).unwrap();
    assert!(json.contains("vault-smoke"));
    assert!(!json.contains(secret));
    assert!(!json.to_lowercase().contains("password"));
    assert!(json.contains("\"hasStoredCredential\": true"));

    // debug formatting of the secret input is redacted
    let dbg = format!(
        "{:?}",
        SecretInput::Replace {
            password: secret.into()
        }
    );
    assert!(!dbg.contains(secret));
    assert!(dbg.contains("redacted"));

    // delete removes profile and credential
    connection_service::profile_delete(&state, &saved.profile_id).unwrap();
    assert!(keychain::get_password(&saved.profile_id).unwrap().is_none());
    let json = std::fs::read_to_string(dir.join("profiles.json")).unwrap();
    assert!(!json.contains("vault-smoke"));
}
