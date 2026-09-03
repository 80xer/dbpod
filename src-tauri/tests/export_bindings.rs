//! Regenerates src/generated/ipc-types.ts from the Rust serde types.
//! Run: `cargo test --test export_bindings`
//! CI treats an uncommitted diff of the generated file as a failure.

use dbpod_lib::domain::db_value::*;
use dbpod_lib::domain::events::*;
use dbpod_lib::domain::profile::*;
use dbpod_lib::error::AppError;
use ts_rs::TS;

#[test]
fn export_ipc_types() {
    let mut out = String::from(
        "// AUTO-GENERATED from src-tauri Rust types by `cargo test --test export_bindings`.\n// Do not edit by hand.\n\n",
    );
    let cfg = ts_rs::Config::default();
    macro_rules! decl {
        ($t:ty) => {
            out.push_str("export ");
            out.push_str(&<$t as TS>::decl(&cfg));
            out.push_str("\n\n");
        };
    }
    decl!(AppError);
    decl!(TlsMode);
    decl!(Environment);
    decl!(ConnectionProfile);
    decl!(ProfileDraft);
    decl!(SecretInput);
    decl!(ConnectionProfileSaveRequest);
    decl!(ConnectionProfileSaveResponse);
    decl!(ConnectionTestRequest);
    decl!(TlsStatus);
    decl!(ConnectionTestResult);
    decl!(ConnectionOpenRequest);
    decl!(ConnectionOpenResponse);
    decl!(ConnectionCloseRequest);
    decl!(VaultStatus);
    decl!(TemporalType);
    decl!(JsonType);
    decl!(ArrayDimension);
    decl!(DbValue);
    decl!(ColumnCategory);
    decl!(ColumnSource);
    decl!(ColumnMeta);
    decl!(TransactionState);
    decl!(QueryStreamEvent);
    decl!(QuerySessionOpenRequest);
    decl!(QuerySessionOpenResponse);
    decl!(QuerySessionCloseRequest);
    decl!(QueryExecuteRequest);
    decl!(ExecutionAccepted);
    decl!(QueryAckChunkRequest);
    decl!(QueryCancelRequest);
    decl!(QueryCancelResponse);
    decl!(ResultValueFetchRequest);
    decl!(ResultValueFetchResponse);
    decl!(ResultReleaseRequest);

    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/generated/ipc-types.ts");
    std::fs::create_dir_all(std::path::Path::new(path).parent().unwrap()).unwrap();
    std::fs::write(path, out).unwrap();
}
