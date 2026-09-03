use std::path::PathBuf;

use crate::domain::snapshot::WorkspaceSnapshot;
use crate::error::AppError;

const MAX_SNAPSHOT_BYTES: usize = 5 * 1024 * 1024;

pub fn snapshot_path(dir: &std::path::Path) -> PathBuf {
    dir.join("workspace.json")
}

pub fn load(dir: &std::path::Path) -> Result<Option<WorkspaceSnapshot>, AppError> {
    match std::fs::read(snapshot_path(dir)) {
        Ok(bytes) => match serde_json::from_slice::<WorkspaceSnapshot>(&bytes) {
            Ok(s) if s.version == 1 => Ok(Some(s)),
            // Corrupted or future-version snapshot: fall back to empty, don't crash.
            _ => Ok(None),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::internal(format!("workspace.json unreadable: {e}"))),
    }
}

pub fn save(dir: &std::path::Path, snapshot: &WorkspaceSnapshot) -> Result<(), AppError> {
    let json = serde_json::to_vec(snapshot).map_err(|e| AppError::internal(e.to_string()))?;
    if json.len() > MAX_SNAPSHOT_BYTES {
        return Err(AppError::invalid_request("workspace snapshot exceeds 5 MiB"));
    }
    std::fs::create_dir_all(dir)
        .map_err(|e| AppError::internal(format!("cannot create data dir: {e}")))?;
    let path = snapshot_path(dir);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)
        .and_then(|_| std::fs::rename(&tmp, &path))
        .map_err(|e| AppError::internal(format!("workspace.json write failed: {e}")))
}
