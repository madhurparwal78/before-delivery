use crate::error::{ApiError, ApiResult};
use chrono::{DateTime, Utc};

pub const MIN_EXPIRES_IN_SECONDS: i64 = 10;
pub const MAX_EXPIRES_IN_SECONDS: i64 = 2_592_000;

pub const INACTIVE_MESSAGE: &str = "This link is no longer active";
pub const CHANGED_ELSEWHERE_MESSAGE: &str =
    "Link changed on another device — the list has been refreshed";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LinkStatus {
    Active,
    Revoked,
    Expired,
}

impl LinkStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            LinkStatus::Active => "active",
            LinkStatus::Revoked => "revoked",
            LinkStatus::Expired => "expired",
        }
    }
}

/// A link is active until it is revoked or expires. Exactly `expires_at`
/// counts as expired.
pub fn status(revoked: bool, expires_at: DateTime<Utc>, now: DateTime<Utc>) -> LinkStatus {
    if revoked {
        LinkStatus::Revoked
    } else if now >= expires_at {
        LinkStatus::Expired
    } else {
        LinkStatus::Active
    }
}

/// Whole seconds from now until `expires_at`, rounded down, and 0 unless active.
pub fn expires_in_s(status: LinkStatus, expires_at: DateTime<Utc>, now: DateTime<Utc>) -> i64 {
    if status != LinkStatus::Active {
        return 0;
    }
    (expires_at - now).num_seconds().max(0)
}

pub fn parse_expires_in_seconds(raw: Option<&serde_json::Value>) -> ApiResult<i64> {
    let field = "expires_in_seconds";
    let value = raw
        .and_then(|v| v.as_i64())
        .ok_or_else(|| ApiError::validation(field, "A whole number of seconds is required"))?;
    if value < MIN_EXPIRES_IN_SECONDS || value > MAX_EXPIRES_IN_SECONDS {
        return Err(ApiError::validation(
            field,
            "Must be between 10 and 2592000 seconds",
        ));
    }
    Ok(value)
}

pub fn new_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}
