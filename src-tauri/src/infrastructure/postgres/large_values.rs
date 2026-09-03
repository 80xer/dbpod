use std::collections::HashMap;
use std::sync::Mutex;

use crate::error::AppError;

pub const INLINE_BINARY_LIMIT: usize = 256 * 1024;
pub const MAX_FETCH_BYTES: usize = 1024 * 1024;

/// Values too large to inline in a rows chunk, kept per Result Tab and read
/// back with result_value_fetch. Dropped on result_release / tab dispose.
#[derive(Default)]
pub struct LargeValueStore {
    map: Mutex<HashMap<String, Vec<u8>>>,
}

impl LargeValueStore {
    pub fn insert(&self, bytes: Vec<u8>) -> String {
        let handle = uuid::Uuid::new_v4().to_string();
        self.map.lock().unwrap().insert(handle.clone(), bytes);
        handle
    }

    /// Returns (chunk, eof).
    pub fn read(&self, handle: &str, offset: u64, length: u32) -> Result<(Vec<u8>, bool), AppError> {
        if length as usize > MAX_FETCH_BYTES {
            return Err(AppError::invalid_request("length exceeds 1 MiB"));
        }
        let map = self.map.lock().unwrap();
        let bytes = map
            .get(handle)
            .ok_or_else(|| AppError::invalid_request("unknown value handle"))?;
        let start = (offset as usize).min(bytes.len());
        let end = (start + length as usize).min(bytes.len());
        Ok((bytes[start..end].to_vec(), end == bytes.len()))
    }

    pub fn total_bytes(&self) -> usize {
        self.map.lock().unwrap().values().map(Vec::len).sum()
    }
}
