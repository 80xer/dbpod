use crate::error::AppError;

const SERVICE: &str = "com.niceinvesting.dbpod";

fn entry(profile_id: &str) -> Result<keyring::Entry, AppError> {
    keyring::Entry::new(SERVICE, profile_id)
        .map_err(|e| AppError::internal(format!("keychain unavailable: {e}")))
}

pub fn set_password(profile_id: &str, password: &str) -> Result<(), AppError> {
    entry(profile_id)?
        .set_password(password)
        .map_err(|e| AppError::internal(format!("keychain write failed: {e}")))
}

pub fn get_password(profile_id: &str) -> Result<Option<String>, AppError> {
    match entry(profile_id)?.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::internal(format!("keychain read failed: {e}"))),
    }
}

pub fn delete_password(profile_id: &str) -> Result<(), AppError> {
    match entry(profile_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::internal(format!("keychain delete failed: {e}"))),
    }
}

pub fn available() -> bool {
    keyring::Entry::new(SERVICE, "__probe__").is_ok()
}
