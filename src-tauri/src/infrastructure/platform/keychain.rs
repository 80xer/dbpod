use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use crate::error::AppError;

const SERVICE: &str = "com.niceinvesting.dbpod";
// Authorized secrets stay in Rust memory until exit. A future app lock must
// clear this cache along with open connections and result data.
// ponytail: serialize access so concurrent requests cannot duplicate OS prompts;
// use per-account locks if independent credential access needs concurrency.
static PASSWORDS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn entry(profile_id: &str) -> Result<keyring::Entry, AppError> {
    keyring::Entry::new(SERVICE, profile_id)
        .map_err(|e| AppError::internal(format!("keychain unavailable: {e}")))
}

pub fn set_password(profile_id: &str, password: &str) -> Result<(), AppError> {
    let mut passwords = PASSWORDS
        .lock()
        .map_err(|_| AppError::internal("keychain cache unavailable"))?;
    passwords.remove(profile_id);
    entry(profile_id)?
        .set_password(password)
        .map_err(|e| AppError::internal(format!("keychain write failed: {e}")))?;
    passwords.insert(profile_id.to_owned(), password.to_owned());
    Ok(())
}

pub fn get_password(profile_id: &str) -> Result<Option<String>, AppError> {
    let mut passwords = PASSWORDS
        .lock()
        .map_err(|_| AppError::internal("keychain cache unavailable"))?;
    cached_password(&mut passwords, profile_id, || {
        match entry(profile_id)?.get_password() {
            Ok(p) => Ok(Some(p)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::internal(format!("keychain read failed: {e}"))),
        }
    })
}

fn cached_password(
    cache: &mut HashMap<String, String>,
    account: &str,
    read: impl FnOnce() -> Result<Option<String>, AppError>,
) -> Result<Option<String>, AppError> {
    if let Some(password) = cache.get(account) {
        return Ok(Some(password.clone()));
    }
    let password = read()?;
    if let Some(password) = &password {
        cache.insert(account.to_owned(), password.clone());
    }
    Ok(password)
}

pub fn delete_password(profile_id: &str) -> Result<(), AppError> {
    let mut passwords = PASSWORDS
        .lock()
        .map_err(|_| AppError::internal("keychain cache unavailable"))?;
    passwords.remove(profile_id);
    match entry(profile_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::internal(format!("keychain delete failed: {e}"))),
    }
}

pub fn available() -> bool {
    keyring::Entry::new(SERVICE, "__probe__").is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorized_secrets_are_reused_per_account_until_exit() {
        let mut cache = HashMap::new();
        let mut reads = 0;
        for account in ["workspace", "database", "workspace", "database"] {
            let password = cached_password(&mut cache, account, || {
                reads += 1;
                Ok(Some(format!("secret-for-{account}")))
            })
            .unwrap();
            assert_eq!(password, Some(format!("secret-for-{account}")));
        }
        assert_eq!(reads, 2);
        // Cache removal after a password change/deletion must force a fresh read.
        cache.remove("database");
        assert_eq!(
            cached_password(&mut cache, "database", || Ok(Some("updated".into())))
                .unwrap()
                .as_deref(),
            Some("updated")
        );
        let mut next_process = HashMap::new();
        cached_password(&mut next_process, "workspace", || {
            reads += 1;
            Ok(Some("new-authorization".into()))
        })
        .unwrap();
        assert_eq!(reads, 3);
    }

    #[test]
    fn denied_or_missing_passwords_are_not_cached() {
        let mut cache = HashMap::new();
        assert!(
            cached_password(&mut cache, "database", || Err(AppError::internal("denied"))).is_err()
        );
        assert!(!cache.contains_key("database"));
        assert_eq!(
            cached_password(&mut cache, "database", || Ok(None)).unwrap(),
            None
        );
        assert!(!cache.contains_key("database"));
        assert_eq!(
            cached_password(&mut cache, "database", || Ok(Some("authorized".into())))
                .unwrap()
                .as_deref(),
            Some("authorized")
        );
    }
}
