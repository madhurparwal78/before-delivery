use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{json, Map, Value};

/// One error type for every refusal, mapped to the single published error
/// shape and the exact status code for its cause.
#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
    pub fields: Option<Map<String, Value>>,
    pub details: Option<Value>,
}

pub type ApiResult<T> = Result<T, ApiError>;

impl ApiError {
    fn plain(status: StatusCode, code: &'static str, message: impl Into<String>) -> ApiError {
        ApiError {
            status,
            code,
            message: message.into(),
            fields: None,
            details: None,
        }
    }

    pub fn cross_origin() -> ApiError {
        ApiError::plain(
            StatusCode::FORBIDDEN,
            "cross_origin",
            "Cross-site request refused",
        )
    }

    pub fn not_found() -> ApiError {
        ApiError::plain(StatusCode::NOT_FOUND, "not_found", "Not found")
    }

    pub fn read_only() -> ApiError {
        ApiError::plain(
            StatusCode::METHOD_NOT_ALLOWED,
            "read_only",
            "Report links are read-only",
        )
    }

    pub fn too_large(message: impl Into<String>) -> ApiError {
        ApiError::plain(StatusCode::PAYLOAD_TOO_LARGE, "too_large", message)
    }

    pub fn link_inactive() -> ApiError {
        ApiError::plain(
            StatusCode::GONE,
            "link_inactive",
            "This link is no longer active",
        )
    }

    pub fn conflict(code: &'static str, message: impl Into<String>) -> ApiError {
        ApiError::plain(StatusCode::CONFLICT, code, message)
    }

    pub fn locked(device_id: &str, device_name: &str, expires_in_s: i64) -> ApiError {
        ApiError {
            status: StatusCode::LOCKED,
            code: "locked",
            message: format!("Being edited on {device_name}"),
            fields: None,
            details: Some(json!({
                "device_id": device_id,
                "device_name": device_name,
                "expires_in_s": expires_in_s,
            })),
        }
    }

    pub fn validation(field: &str, message: impl Into<String>) -> ApiError {
        let message: String = message.into();
        let mut fields = Map::new();
        fields.insert(field.to_string(), Value::String(message.clone()));
        ApiError {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            code: "validation",
            message,
            fields: Some(fields),
            details: None,
        }
    }

    pub fn validation_many(message: impl Into<String>, fields: Map<String, Value>) -> ApiError {
        ApiError {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            code: "validation",
            message: message.into(),
            fields: Some(fields),
            details: None,
        }
    }

    pub fn unknown_device() -> ApiError {
        ApiError::validation("device", "Unknown device")
    }

    pub fn body_not_object() -> ApiError {
        ApiError::validation("body", "Body must be a JSON object")
    }

    pub fn provider(code: &'static str, timed_out: bool, message: impl Into<String>) -> ApiError {
        let status = if timed_out {
            StatusCode::GATEWAY_TIMEOUT
        } else {
            StatusCode::BAD_GATEWAY
        };
        ApiError::plain(status, code, message)
    }

    pub fn starting() -> ApiError {
        ApiError::plain(
            StatusCode::SERVICE_UNAVAILABLE,
            "starting",
            "Pensight is starting",
        )
    }

    pub fn internal(message: impl Into<String>) -> ApiError {
        ApiError::plain(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            message.into(),
        )
    }

    pub fn body(&self) -> Value {
        let mut error = Map::new();
        error.insert("code".into(), Value::String(self.code.to_string()));
        error.insert("message".into(), Value::String(self.message.clone()));
        if let Some(fields) = &self.fields {
            error.insert("fields".into(), Value::Object(fields.clone()));
        }
        if let Some(details) = &self.details {
            error.insert("details".into(), details.clone());
        }
        json!({ "error": Value::Object(error) })
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for ApiError {}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = serde_json::to_vec(&self.body()).unwrap_or_else(|_| b"{}".to_vec());
        (
            self.status,
            [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
            body,
        )
            .into_response()
    }
}

impl From<tokio_postgres::Error> for ApiError {
    fn from(err: tokio_postgres::Error) -> ApiError {
        ApiError::internal(format!("database error: {err}"))
    }
}

impl From<deadpool_postgres::PoolError> for ApiError {
    fn from(err: deadpool_postgres::PoolError) -> ApiError {
        ApiError::internal(format!("database pool error: {err}"))
    }
}

impl From<redis::RedisError> for ApiError {
    fn from(err: redis::RedisError) -> ApiError {
        ApiError::internal(format!("valkey error: {err}"))
    }
}

impl From<serde_json::Error> for ApiError {
    fn from(err: serde_json::Error) -> ApiError {
        ApiError::internal(format!("json error: {err}"))
    }
}
