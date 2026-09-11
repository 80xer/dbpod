use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::domain::{events::ResultRowsFetchResponse, DbValue};
use crate::error::AppError;

pub const RESULT_PAGE_ROWS: usize = 200;
pub const INLINE_BINARY_LIMIT: usize = 256 * 1024;
pub const MAX_FETCH_BYTES: usize = 1024 * 1024;
// Desktop defaults tuned for 24 GiB RAM; these bound estimated retained data, not RSS.
pub const RESULT_BUDGET: usize = 512 * 1024 * 1024;
pub const CONNECTION_BUDGET: usize = 1024 * 1024 * 1024;
pub const APP_BUDGET: usize = 2 * 1024 * 1024 * 1024;
pub type RetainedUsage = Arc<Mutex<HashMap<String, usize>>>;

/// Result-owned rows and large values. Dropped on result_release / tab dispose.
/// ponytail: rows share the result memory budget; use disk spooling
/// if results must outgrow that budget.
#[derive(Default)]
pub struct LargeValueStore {
    map: Mutex<HashMap<String, Vec<u8>>>,
    rows: Mutex<Vec<Vec<DbValue>>>,
    pub execution_id: String,
    pub paged: bool,
    pub connection_id: String,
    pub query_tab_id: String,
    usage: Option<RetainedUsage>,
    retained: Mutex<usize>,
}

impl LargeValueStore {
    pub fn owned(connection_id: String, query_tab_id: String, usage: RetainedUsage) -> Self {
        Self {
            connection_id,
            query_tab_id,
            usage: Some(usage),
            map: Mutex::new(HashMap::new()),
            rows: Mutex::new(Vec::new()),
            execution_id: uuid::Uuid::new_v4().to_string(),
            paged: false,
            retained: Mutex::new(0),
        }
    }

    /// Conservatively accounts for retained Rust + renderer rows before decoding.
    pub fn reserve_row(&self, raw_bytes: usize, columns: usize) -> bool {
        // Allow for the retained Rust value, renderer strings and serialization copies.
        self.reserve(
            raw_bytes
                .saturating_mul(4)
                .saturating_add(columns.saturating_mul(256)),
        )
    }

    /// Never evict pinned/dirty results: the caller truncates the new result instead.
    pub fn reserve(&self, bytes: usize) -> bool {
        let mut retained = self.retained.lock().unwrap();
        if retained.saturating_add(bytes) > RESULT_BUDGET {
            return false;
        }
        if let Some(usage) = &self.usage {
            let mut usage = usage.lock().unwrap();
            let connection = usage.get(&self.connection_id).copied().unwrap_or(0);
            if connection.saturating_add(bytes) > CONNECTION_BUDGET
                || usage.values().sum::<usize>().saturating_add(bytes) > APP_BUDGET
            {
                return false;
            }
            usage.insert(self.connection_id.clone(), connection + bytes);
        }
        *retained += bytes;
        true
    }

    pub fn insert(&self, bytes: Vec<u8>) -> String {
        let handle = uuid::Uuid::new_v4().to_string();
        self.map.lock().unwrap().insert(handle.clone(), bytes);
        handle
    }

    pub fn retain_row(&self, row: Vec<DbValue>) {
        self.rows.lock().unwrap().push(row);
    }

    pub fn read_rows(
        &self,
        execution_id: &str,
        offset: u32,
    ) -> Result<ResultRowsFetchResponse, AppError> {
        if !self.paged || self.execution_id != execution_id {
            return Err(AppError::invalid_request(
                "result execution is no longer available",
            ));
        }
        let rows = self.rows.lock().unwrap();
        let start = offset as usize;
        if start > rows.len() {
            return Err(AppError::invalid_request("result offset out of range"));
        }
        let mut end = start;
        let mut bytes = 0;
        // Retain the existing 1 MiB IPC ceiling even for wide rows.
        while end < rows.len() && end - start < RESULT_PAGE_ROWS {
            let row_bytes = serde_json::to_vec(&rows[end])
                .map_err(|e| AppError::internal(e.to_string()))?
                .len();
            if end > start && bytes + row_bytes > MAX_FETCH_BYTES {
                break;
            }
            bytes += row_bytes;
            end += 1;
        }
        Ok(ResultRowsFetchResponse {
            rows: rows[start..end].to_vec(),
            next_offset: end as u32,
            has_more: end < rows.len(),
        })
    }

    /// Returns (chunk, eof).
    pub fn read(
        &self,
        handle: &str,
        offset: u64,
        length: u32,
    ) -> Result<(Vec<u8>, bool), AppError> {
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

impl Drop for LargeValueStore {
    fn drop(&mut self) {
        if let Some(usage) = &self.usage {
            let mut usage = usage.lock().unwrap();
            if let Some(total) = usage.get_mut(&self.connection_id) {
                *total = total.saturating_sub(*self.retained.lock().unwrap());
                if *total == 0 {
                    usage.remove(&self.connection_id);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn budgets_apply_across_results_and_release_on_drop() {
        let usage = RetainedUsage::default();
        let make = |conn: &str| LargeValueStore::owned(conn.into(), "tab".into(), usage.clone());
        let a = make("c");
        let b = make("c");
        let c = make("c");
        assert!(a.reserve(RESULT_BUDGET));
        assert!(!a.reserve(1));
        assert!(b.reserve(RESULT_BUDGET));
        assert!(!c.reserve(1));
        drop(a);
        assert!(c.reserve(RESULT_BUDGET));
        let d = make("d");
        let e = make("d");
        let f = make("f");
        assert!(d.reserve(RESULT_BUDGET));
        assert!(e.reserve(RESULT_BUDGET));
        assert!(!f.reserve(1));
        drop((b, c, d, e, f));
        assert!(usage.lock().unwrap().is_empty());
    }
}
