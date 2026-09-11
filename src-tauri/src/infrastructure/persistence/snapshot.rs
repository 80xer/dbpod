use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};

use crate::domain::snapshot::WorkspaceSnapshot;
use crate::error::AppError;
use crate::infrastructure::platform::keychain;

const MAX_SNAPSHOT_BYTES: usize = 5 * 1024 * 1024;
const MAX_FILE_BYTES: usize = (MAX_SNAPSHOT_BYTES + 18) / 3 * 4 + 512;
const KEY_ACCOUNT: &str = "__dbpod_workspace_key_v1__";
const FORMAT: &str = "dbpod-workspace-aes-256-gcm";
const AAD: &[u8] = b"dbpod-workspace-aes-256-gcm/version=1";
// The shared keychain layer reuses authorized keys across loads and autosaves.
// ponytail: one lock serializes snapshot I/O and key creation in this process;
// use an OS file lock if multiple application instances share the data directory.
static SNAPSHOT_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    format: String,
    version: u32,
    nonce: String,
    ciphertext: String,
}

enum StoredSnapshot {
    Encrypted(Envelope),
    Legacy(WorkspaceSnapshot),
}

pub fn snapshot_path(dir: &Path) -> PathBuf {
    dir.join("workspace.json")
}

pub fn load(dir: &Path) -> Result<Option<WorkspaceSnapshot>, AppError> {
    let _guard = SNAPSHOT_LOCK
        .lock()
        .map_err(|_| AppError::internal("workspace storage lock unavailable"))?;
    load_with_key(dir, workspace_key)
}

pub fn save(dir: &Path, snapshot: &WorkspaceSnapshot) -> Result<(), AppError> {
    let _guard = SNAPSHOT_LOCK
        .lock()
        .map_err(|_| AppError::internal("workspace storage lock unavailable"))?;
    save_with_key(dir, snapshot, workspace_key)
}

fn recovery_error(reason: &str) -> AppError {
    AppError::new(
        "WORKSPACE_RECOVERY_REQUIRED",
        format!("{reason}. Existing workspace.json was preserved; unlock the OS keychain or restore the workspace file and its key from backup before retrying"),
    )
}

fn workspace_key(create: bool) -> Result<[u8; 32], AppError> {
    match keychain::get_password(KEY_ACCOUNT)? {
        Some(encoded) => STANDARD
            .decode(encoded)
            .ok()
            .and_then(|bytes| bytes.try_into().ok())
            .ok_or_else(|| recovery_error("Workspace encryption key is invalid")),
        None if create => {
            let mut key = [0; 32];
            SystemRandom::new()
                .fill(&mut key)
                .map_err(|_| AppError::internal("cannot generate workspace encryption key"))?;
            keychain::set_password(KEY_ACCOUNT, &STANDARD.encode(key))?;
            Ok(key)
        }
        None => Err(recovery_error("Workspace encryption key is missing")),
    }
}

fn serialize_snapshot(snapshot: &WorkspaceSnapshot) -> Result<Vec<u8>, AppError> {
    if snapshot.version != 1 {
        return Err(recovery_error("Unsupported workspace snapshot version"));
    }
    let json = serde_json::to_vec(snapshot)
        .map_err(|_| AppError::internal("cannot serialize workspace snapshot"))?;
    if json.len() > MAX_SNAPSHOT_BYTES {
        return Err(AppError::invalid_request(
            "workspace snapshot exceeds 5 MiB",
        ));
    }
    Ok(json)
}

fn read_stored(dir: &Path) -> Result<Option<StoredSnapshot>, AppError> {
    let file = match std::fs::File::open(snapshot_path(dir)) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(AppError::internal(format!(
                "workspace.json unreadable: {e}"
            )));
        }
    };
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| AppError::internal(format!("workspace.json unreadable: {e}")))?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(recovery_error("Workspace file exceeds the storage limit"));
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| recovery_error("Workspace file is corrupted"))?;
    if value.get("format").is_some() {
        let envelope: Envelope = serde_json::from_value(value)
            .map_err(|_| recovery_error("Workspace encryption envelope is corrupted"))?;
        if envelope.format != FORMAT || envelope.version != 1 {
            return Err(recovery_error("Unsupported workspace encryption format"));
        }
        Ok(Some(StoredSnapshot::Encrypted(envelope)))
    } else {
        let snapshot: WorkspaceSnapshot = serde_json::from_value(value)
            .map_err(|_| recovery_error("Workspace file is corrupted"))?;
        serialize_snapshot(&snapshot)?;
        Ok(Some(StoredSnapshot::Legacy(snapshot)))
    }
}

fn encryption_key(key: &[u8; 32]) -> Result<LessSafeKey, AppError> {
    UnboundKey::new(&AES_256_GCM, key)
        .map(LessSafeKey::new)
        .map_err(|_| AppError::internal("invalid workspace encryption key"))
}

fn decrypt(envelope: Envelope, key: &[u8; 32]) -> Result<WorkspaceSnapshot, AppError> {
    let nonce: [u8; 12] = STANDARD
        .decode(envelope.nonce)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(|| recovery_error("Workspace encryption nonce is corrupted"))?;
    let mut ciphertext = STANDARD
        .decode(envelope.ciphertext)
        .map_err(|_| recovery_error("Workspace ciphertext is corrupted"))?;
    let key = encryption_key(key)?;
    let plaintext = key
        .open_in_place(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(AAD),
            &mut ciphertext,
        )
        .map_err(|_| {
            recovery_error("Workspace authentication failed (wrong key or damaged file)")
        })?;
    let snapshot: WorkspaceSnapshot = serde_json::from_slice(plaintext)
        .map_err(|_| recovery_error("Decrypted workspace is corrupted"))?;
    serialize_snapshot(&snapshot)?;
    Ok(snapshot)
}

fn load_with_key(
    dir: &Path,
    key_provider: impl FnOnce(bool) -> Result<[u8; 32], AppError>,
) -> Result<Option<WorkspaceSnapshot>, AppError> {
    match read_stored(dir)? {
        None => Ok(None),
        Some(StoredSnapshot::Encrypted(envelope)) => {
            decrypt(envelope, &key_provider(false)?).map(Some)
        }
        Some(StoredSnapshot::Legacy(snapshot)) => {
            // Migration succeeds only after encrypted replacement reaches disk.
            write_encrypted(dir, serialize_snapshot(&snapshot)?, &key_provider(true)?)?;
            Ok(Some(snapshot))
        }
    }
}

fn save_with_key(
    dir: &Path,
    snapshot: &WorkspaceSnapshot,
    key_provider: impl FnOnce(bool) -> Result<[u8; 32], AppError>,
) -> Result<(), AppError> {
    let plaintext = serialize_snapshot(snapshot)?;
    let stored = read_stored(dir)?;
    let key = key_provider(!matches!(stored, Some(StoredSnapshot::Encrypted(_))))?;
    if let Some(StoredSnapshot::Encrypted(envelope)) = stored {
        // A failed restore must never turn the next autosave into data loss.
        decrypt(envelope, &key)?;
    }
    write_encrypted(dir, plaintext, &key)
}

fn write_encrypted(dir: &Path, mut plaintext: Vec<u8>, key: &[u8; 32]) -> Result<(), AppError> {
    let mut nonce = [0; 12];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| AppError::internal("cannot generate workspace encryption nonce"))?;
    encryption_key(key)?
        .seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(AAD),
            &mut plaintext,
        )
        .map_err(|_| AppError::internal("workspace encryption failed"))?;
    let bytes = serde_json::to_vec(&Envelope {
        format: FORMAT.into(),
        version: 1,
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(plaintext),
    })
    .map_err(|_| AppError::internal("cannot serialize encrypted workspace"))?;
    atomic_write(dir, &bytes)
        .map_err(|e| AppError::internal(format!("workspace.json write failed: {e}")))
}

fn atomic_write(dir: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        builder.mode(0o700);
        builder.create(dir)?;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    #[cfg(not(unix))]
    builder.create(dir)?;
    let tmp = dir.join(format!(".workspace-{}.tmp", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&tmp)?;
    let result = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&tmp, snapshot_path(dir))?;
        #[cfg(unix)]
        std::fs::File::open(dir)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::snapshot::{ConnectionSnapshot, TabSnapshot};

    const TEST_KEY: [u8; 32] = [42; 32];
    const SQL: &str = "SELECT 'private draft 한글'";

    fn fixture() -> (PathBuf, WorkspaceSnapshot) {
        let dir = std::env::temp_dir().join(format!("dbpod-snapshot-{}", uuid::Uuid::new_v4()));
        let snapshot = WorkspaceSnapshot {
            version: 1,
            connections: vec![ConnectionSnapshot {
                profile_id: "profile-one".into(),
                database: None,
                active_tab_index: Some(0),
                tab_groups: vec![],
                tabs: vec![TabSnapshot {
                    title: "Draft".into(),
                    sql: SQL.into(),
                    id: None,
                }],
            }],
        };
        (dir, snapshot)
    }

    #[test]
    fn encrypted_snapshot_round_trips_with_random_nonce_and_private_permissions() {
        let (dir, snapshot) = fixture();
        save_with_key(&dir, &snapshot, |_| Ok(TEST_KEY)).unwrap();
        let first = std::fs::read(snapshot_path(&dir)).unwrap();
        let json = std::str::from_utf8(&first).unwrap();
        assert!(!json.contains("private draft"));
        assert!(!json.contains("profile-one"));
        let restored = load_with_key(&dir, |create| {
            assert!(!create);
            Ok(TEST_KEY)
        })
        .unwrap()
        .unwrap();
        assert_eq!(
            serde_json::to_value(&restored).unwrap(),
            serde_json::to_value(&snapshot).unwrap()
        );
        save_with_key(&dir, &snapshot, |_| Ok(TEST_KEY)).unwrap();
        let second = std::fs::read(snapshot_path(&dir)).unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                std::fs::metadata(snapshot_path(&dir))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn legacy_migration_preserves_drafts_and_failure_preserves_original() {
        let (dir, snapshot) = fixture();
        std::fs::create_dir_all(&dir).unwrap();
        let original = serde_json::to_vec(&snapshot).unwrap();
        std::fs::write(snapshot_path(&dir), &original).unwrap();
        let unavailable = |_| Err(AppError::internal("keychain locked"));
        assert!(load_with_key(&dir, unavailable).is_err());
        assert!(save_with_key(&dir, &snapshot, unavailable).is_err());
        assert_eq!(std::fs::read(snapshot_path(&dir)).unwrap(), original);
        let restored = load_with_key(&dir, |create| {
            assert!(create);
            Ok(TEST_KEY)
        })
        .unwrap()
        .unwrap();
        assert_eq!(restored.connections[0].tabs[0].sql, SQL);
        assert!(!std::fs::read_to_string(snapshot_path(&dir))
            .unwrap()
            .contains("private draft"));
        assert!(matches!(
            read_stored(&dir).unwrap(),
            Some(StoredSnapshot::Encrypted(_))
        ));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn damaged_or_unknown_files_and_wrong_keys_block_autosave_without_data_loss() {
        let (dir, snapshot) = fixture();
        save_with_key(&dir, &snapshot, |_| Ok(TEST_KEY)).unwrap();
        let original = std::fs::read(snapshot_path(&dir)).unwrap();
        assert!(load_with_key(&dir, |_| Ok([7; 32])).is_err());
        assert!(save_with_key(&dir, &snapshot, |_| Ok([7; 32])).is_err());
        assert!(save_with_key(&dir, &snapshot, |create| {
            assert!(!create);
            Err(recovery_error("key missing"))
        })
        .is_err());
        assert_eq!(std::fs::read(snapshot_path(&dir)).unwrap(), original);

        let mut envelope: Envelope = serde_json::from_slice(&original).unwrap();
        let mut ciphertext = STANDARD.decode(&envelope.ciphertext).unwrap();
        ciphertext[0] ^= 1;
        envelope.ciphertext = STANDARD.encode(ciphertext);
        let mut changed_nonce: Envelope = serde_json::from_slice(&original).unwrap();
        changed_nonce.nonce = STANDARD.encode([0; 12]);
        let mut future: Envelope = serde_json::from_slice(&original).unwrap();
        future.version = 2;
        let mut legacy = snapshot.clone();
        legacy.version = 2;
        for damaged in [
            serde_json::to_vec(&envelope).unwrap(),
            serde_json::to_vec(&changed_nonce).unwrap(),
            serde_json::to_vec(&future).unwrap(),
            serde_json::to_vec(&legacy).unwrap(),
            b"broken json".to_vec(),
        ] {
            std::fs::write(snapshot_path(&dir), &damaged).unwrap();
            assert!(load_with_key(&dir, |_| Ok(TEST_KEY)).is_err());
            assert!(save_with_key(&dir, &snapshot, |_| Ok(TEST_KEY)).is_err());
            assert_eq!(std::fs::read(snapshot_path(&dir)).unwrap(), damaged);
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejected_save_keeps_the_last_complete_snapshot() {
        let (dir, mut snapshot) = fixture();
        save_with_key(&dir, &snapshot, |_| Ok(TEST_KEY)).unwrap();
        let original = std::fs::read(snapshot_path(&dir)).unwrap();
        snapshot.connections[0].tabs[0].sql = "x".repeat(MAX_SNAPSHOT_BYTES);
        assert!(save_with_key(&dir, &snapshot, |_| Ok(TEST_KEY)).is_err());
        assert_eq!(std::fs::read(snapshot_path(&dir)).unwrap(), original);
        // A failed atomic replacement cleans up its encrypted temporary file.
        std::fs::remove_file(snapshot_path(&dir)).unwrap();
        std::fs::create_dir(snapshot_path(&dir)).unwrap();
        assert!(atomic_write(&dir, b"encrypted bytes").is_err());
        assert!(snapshot_path(&dir).is_dir());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
