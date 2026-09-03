use std::path::PathBuf;

use crate::domain::ConnectionProfile;
use crate::error::AppError;

/// profiles.json in the app data dir. Holds non-secret profile fields only;
/// a test asserts no password ever lands here.
pub struct ProfileStore {
    path: PathBuf,
    profiles: Vec<ConnectionProfile>,
}

impl ProfileStore {
    pub fn load(dir: PathBuf) -> Result<Self, AppError> {
        let path = dir.join("profiles.json");
        let profiles = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| AppError::internal(format!("profiles.json corrupted: {e}")))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(AppError::internal(format!("profiles.json unreadable: {e}"))),
        };
        Ok(Self { path, profiles })
    }

    pub fn list(&self) -> &[ConnectionProfile] {
        &self.profiles
    }

    pub fn get(&self, id: &str) -> Option<&ConnectionProfile> {
        self.profiles.iter().find(|p| p.id == id)
    }

    pub fn upsert(&mut self, profile: ConnectionProfile) -> Result<(), AppError> {
        match self.profiles.iter_mut().find(|p| p.id == profile.id) {
            Some(slot) => *slot = profile,
            None => self.profiles.push(profile),
        }
        self.persist()
    }

    pub fn remove(&mut self, id: &str) -> Result<(), AppError> {
        self.profiles.retain(|p| p.id != id);
        self.persist()
    }

    fn persist(&self) -> Result<(), AppError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::internal(format!("cannot create data dir: {e}")))?;
        }
        let json = serde_json::to_vec_pretty(&self.profiles)
            .map_err(|e| AppError::internal(e.to_string()))?;
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, json)
            .and_then(|_| std::fs::rename(&tmp, &self.path))
            .map_err(|e| AppError::internal(format!("profiles.json write failed: {e}")))
    }
}
