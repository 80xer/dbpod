use std::{collections::HashMap, path::PathBuf};

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

    pub fn reorder(&mut self, ids: &[String]) -> Result<(), AppError> {
        let positions: HashMap<_, _> = ids.iter().enumerate().map(|(i, id)| (id, i)).collect();
        if ids.len() != self.profiles.len()
            || positions.len() != ids.len()
            || self.profiles.iter().any(|p| !positions.contains_key(&p.id))
        {
            return Err(AppError::invalid_request(
                "profile order must contain every current profile exactly once",
            ));
        }
        let previous = self.profiles.clone();
        self.profiles.sort_by_key(|p| positions[&p.id]);
        if let Err(error) = self.persist() {
            self.profiles = previous;
            return Err(error);
        }
        Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Environment, TlsMode};

    #[test]
    fn reorder_preserves_profiles_across_reload_and_rejects_invalid_or_failed_writes() {
        let dir =
            std::env::temp_dir().join(format!("dbpod-profile-order-{}", uuid::Uuid::new_v4()));
        let mut store = ProfileStore::load(dir.clone()).unwrap();
        for id in ["a", "b", "c"] {
            store
                .upsert(ConnectionProfile {
                    id: id.into(),
                    name: format!("Profile {id}"),
                    environment: Environment::Local,
                    color: None,
                    host: "localhost".into(),
                    port: 5432,
                    database: "postgres".into(),
                    username: "postgres".into(),
                    tls_mode: TlsMode::VerifyFull,
                    read_only: true,
                    query_timeout_ms: 60_000,
                    max_rows: 500,
                    has_stored_credential: true,
                })
                .unwrap();
        }
        let original = store.list().to_vec();
        store
            .reorder(&["c".into(), "a".into(), "b".into()])
            .unwrap();
        let expected = serde_json::to_value([&original[2], &original[0], &original[1]]).unwrap();
        let reloaded = ProfileStore::load(dir.clone()).unwrap();
        assert_eq!(serde_json::to_value(reloaded.list()).unwrap(), expected);

        // Stale or malformed requests must never drop, duplicate or replace profiles.
        for invalid in [
            vec![],
            vec!["a", "b"],
            vec!["a", "a", "c"],
            vec!["a", "b", "unknown"],
            vec!["a", "b", "c", "extra"],
        ] {
            let ids: Vec<String> = invalid.into_iter().map(String::from).collect();
            assert_eq!(store.reorder(&ids).unwrap_err().code, "INVALID_REQUEST");
        }
        assert_eq!(serde_json::to_value(store.list()).unwrap(), expected);
        // Block the temporary write and verify both memory and the saved file stay intact.
        std::fs::create_dir(dir.join("profiles.json.tmp")).unwrap();
        assert!(store
            .reorder(&["a".into(), "b".into(), "c".into()])
            .is_err());
        assert_eq!(serde_json::to_value(store.list()).unwrap(), expected);
        let reloaded = ProfileStore::load(dir.clone()).unwrap();
        assert_eq!(serde_json::to_value(reloaded.list()).unwrap(), expected);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
