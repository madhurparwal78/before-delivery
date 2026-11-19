//! The one error type: every refusal maps to the published error JSON shape and status code.

use serde_json::{json, Map, Value};

#[derive(Debug)]
pub struct ApiError {
    pub status: u16,
    pub code: &'static str,
    pub message: String,
    pub fields: Option<Vec<(String, String)>>,
    pub details: Option<Value>,
}

pub type ApiResult<T> = Result<T, ApiError>;

impl ApiError {
    fn plain(status: u16, code: &'static str, message: &str) -> ApiError {
        ApiError { status, code, message: message.to_string(), fields: None, details: None }
    }
    pub fn not_found() -> ApiError {
        ApiError::plain(404, "not_found", "Not found")
    }
    pub fn read_only() -> ApiError {
        ApiError::plain(405, "read_only", "Report links are read-only")
    }
    pub fn cross_origin() -> ApiError {
        ApiError::plain(403, "cross_origin", "Cross-site request refused")
    }
    pub fn too_large() -> ApiError {
        ApiError::plain(413, "too_large", "Request body is too large")
    }
    pub fn starting() -> ApiError {
        ApiError::plain(503, "starting", "Pensight is starting")
    }
    pub fn internal(what: impl std::fmt::Display) -> ApiError {
        eprintln!("internal error: {what}");
        ApiError::plain(500, "internal", "Something went wrong on the server")
    }
    pub fn gone() -> ApiError {
        ApiError::plain(410, "link_inactive", "This report link is no longer active")
    }
    pub fn conflict(code: &'static str, message: &str) -> ApiError {
        ApiError::plain(409, code, message)
    }
    pub fn removed(defect_id: &str) -> ApiError {
        ApiError::conflict("defect_removed", &format!("{defect_id} was removed"))
    }
    pub fn already_repaired(defect_id: &str) -> ApiError {
        ApiError::conflict("already_repaired", &format!("{defect_id} is already repaired"))
    }
    pub fn locked(device_id: &str, device_name: &str, expires_in_s: i64) -> ApiError {
        ApiError {
            status: 423,
            code: "locked",
            message: format!("Being edited on {device_name}"),
            fields: None,
            details: Some(json!({"device_id": device_id, "device_name": device_name, "expires_in_s": expires_in_s})),
        }
    }
    pub fn provider(code: &'static str, message: &str, timed_out: bool) -> ApiError {
        ApiError::plain(if timed_out { 504 } else { 502 }, code, message)
    }
    pub fn validation(fields: Vec<(String, String)>) -> ApiError {
        let message = fields.first().map(|(_, m)| m.clone()).unwrap_or_else(|| "Invalid request".into());
        ApiError { status: 422, code: "validation", message, fields: Some(fields), details: None }
    }
    pub fn field(name: &str, message: &str) -> ApiError {
        ApiError::validation(vec![(name.to_string(), message.to_string())])
    }
    pub fn unknown_device() -> ApiError {
        ApiError::field("device", "Unknown device")
    }

    pub fn body(&self) -> Value {
        let mut error = Map::new();
        error.insert("code".into(), json!(self.code));
        error.insert("message".into(), json!(self.message));
        if let Some(fields) = &self.fields {
            let map: Map<String, Value> = fields.iter().map(|(k, v)| (k.clone(), json!(v))).collect();
            error.insert("fields".into(), Value::Object(map));
        }
        if let Some(details) = &self.details {
            error.insert("details".into(), details.clone());
        }
        json!({"error": error})
    }
}

impl From<tokio_postgres::Error> for ApiError {
    fn from(error: tokio_postgres::Error) -> ApiError {
        ApiError::internal(error)
    }
}

impl From<deadpool_postgres::PoolError> for ApiError {
    fn from(error: deadpool_postgres::PoolError) -> ApiError {
        ApiError::internal(error)
    }
}
