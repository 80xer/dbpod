use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub name: String,
    pub can_connect: bool,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MetadataListSchemasRequest {
    pub connection_id: String,
    pub include_system: bool,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SchemaInfo {
    pub oid: u32,
    pub name: String,
    pub is_system: bool,
}

/// A keyword of the connected server's SQL grammar, as `pg_get_keywords()` lists it.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SqlKeyword {
    pub word: String,
    /// `catdesc`: reserved, unreserved, and the two partially reserved kinds.
    pub category: String,
}

/// Words the SQL editor completes without a qualifier, all from the connected server.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SqlWords {
    pub keywords: Vec<SqlKeyword>,
    /// Distinct names of callable functions and procedures on the search path.
    pub functions: Vec<String>,
    /// Names of data types on the search path, arrays excluded.
    pub types: Vec<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MetadataListObjectsRequest {
    pub connection_id: String,
    pub schema_oids: Vec<u32>,
    pub kinds: Vec<ObjectKind>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MetadataDropObjectRequest {
    pub connection_id: String,
    pub object_oid: u32,
    pub kind: ObjectKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum ObjectKind {
    Table,
    View,
    MaterializedView,
    Function,
    Sequence,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseObjectSummary {
    pub oid: u32,
    pub schema: String,
    pub name: String,
    pub kind: ObjectKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub function_arguments: Option<String>,
    // Direct partition parent; descendants may belong to another schema.
    pub partition_parent_oid: Option<u32>,
    pub can_select: Option<bool>,
    pub can_insert: Option<bool>,
    pub can_update: Option<bool>,
    pub can_delete: Option<bool>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MetadataGetTableRequest {
    pub connection_id: String,
    pub relation_oid: u32,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TableColumnMetadata {
    pub attribute_number: i16,
    pub name: String,
    pub pg_type_oid: u32,
    pub pg_type_name: String,
    pub nullable: bool,
    pub default_expr: Option<String>,
    pub comment: Option<String>,
    pub is_generated: bool,
    pub is_primary_key: bool,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TableMetadata {
    pub relation_oid: u32,
    pub schema: String,
    pub name: String,
    /// 'table' | 'partitioned-table' | 'view' | 'materialized-view'
    pub kind: String,
    pub columns: Vec<TableColumnMetadata>,
    /// attribute numbers of the primary key, in key order
    pub primary_key: Vec<i16>,
    pub unique_keys: Vec<Vec<i16>>,
    pub row_level_security: bool,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TableDataExecuteRequest {
    pub connection_id: String,
    pub query_tab_id: String,
    pub result_tab_id: String,
    pub relation_oid: u32,
    /// attribute number to sort by (validated against the catalog)
    pub sort_attribute: Option<i16>,
    pub sort_descending: bool,
    pub limit: u32,
    #[ts(type = "number")]
    pub offset: u64,
}

/// Next Table Data page. Relation, sort and offset are the backend's own record of
/// the first page; the WebView only names which result to continue.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TableDataFetchPageRequest {
    pub connection_id: String,
    pub query_tab_id: String,
    pub result_tab_id: String,
    pub execution_id: String,
}
