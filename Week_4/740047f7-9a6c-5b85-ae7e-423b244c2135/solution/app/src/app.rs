//! Shared application state, the per-request context and the reply shapes.

use crate::config::Config;
use crate::error::{ApiError, ApiResult};
use crate::model::LockInfo;
use crate::s3::S3;
use crate::valkey::{Resp, Valkey};
use axum::body::Body;
use axum::http::HeaderMap;
use bytes::Bytes;
use futures_util::StreamExt;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::broadcast;

pub const JSON_LIMIT: usize = 64_000;
pub const STILL_LIMIT: usize = 8_000_000;
pub const SONAR_LIMIT: usize = 20_000_000;
pub const IMPORT_LIMIT: usize = 2_000_000;
const LOCK_SECONDS: &str = "30";
const HEARTBEAT_SECONDS: &str = "15";

#[derive(Clone)]
pub struct Device {
    pub id: String,
    pub name: String,
}

pub struct App {
    pub cfg: Config,
    pub pool: deadpool_postgres::Pool,
    pub s3: S3,
    pub valkey: Valkey,
    pub http: reqwest::Client,
    pub events: broadcast::Sender<String>,
    pub devices: Vec<Device>,
}

pub type Shared = Arc<App>;

fn lock_key(defect_id: &str) -> String {
    format!("pensight:lock:defect:{defect_id}")
}

fn valkey_error(error: String) -> ApiError {
    ApiError::internal(format!("valkey: {error}"))
}

impl App {
    pub async fn db(&self) -> ApiResult<deadpool_postgres::Client> {
        Ok(self.pool.get().await?)
    }

    pub fn device(&self, id: &str) -> Option<&Device> {
        self.devices.iter().find(|d| d.id == id)
    }

    pub async fn emit(&self, kind: &str, device: Option<&Device>, extra: Value) {
        let mut event = Map::new();
        event.insert("type".into(), json!(kind));
        if let Some(device) = device {
            event.insert("device_id".into(), json!(device.id));
            event.insert("device_name".into(), json!(device.name));
        }
        if let Value::Object(more) = extra {
            event.extend(more);
        }
        self.valkey.publish(&Value::Object(event).to_string()).await;
    }

    pub async fn heartbeat(&self, device_id: &str) -> ApiResult<()> {
        let key = format!("pensight:heartbeat:{device_id}");
        self.valkey.cmd(&["SET", &key, "1", "EX", HEARTBEAT_SECONDS]).await.map_err(valkey_error)?;
        Ok(())
    }

    pub async fn online(&self, device_id: &str) -> ApiResult<bool> {
        let key = format!("pensight:heartbeat:{device_id}");
        let reply = self.valkey.cmd(&["EXISTS", &key]).await.map_err(valkey_error)?;
        Ok(reply.int() == Some(1))
    }

    fn lock_info(&self, holder: &str, pttl_ms: i64) -> Option<LockInfo> {
        let device = self.device(holder)?;
        Some(LockInfo { device_id: device.id.clone(), device_name: device.name.clone(), expires_in_s: (pttl_ms.max(0) + 999) / 1000 })
    }

    pub async fn locks_for(&self, ids: &[String]) -> ApiResult<HashMap<String, LockInfo>> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        let mut commands = vec![];
        for id in ids {
            let key = lock_key(id).into_bytes();
            commands.push(vec![b"GET".to_vec(), key.clone()]);
            commands.push(vec![b"PTTL".to_vec(), key]);
        }
        let replies = self.valkey.pipeline(commands).await.map_err(valkey_error)?;
        let mut found = HashMap::new();
        for (i, id) in ids.iter().enumerate() {
            if let (Some(holder), Some(ttl)) = (replies[2 * i].string(), replies[2 * i + 1].int()) {
                if let Some(info) = self.lock_info(&holder, ttl) {
                    found.insert(id.clone(), info);
                }
            }
        }
        Ok(found)
    }

    pub async fn lock_of(&self, defect_id: &str) -> ApiResult<Option<LockInfo>> {
        Ok(self.locks_for(&[defect_id.to_string()]).await?.remove(defect_id))
    }

    /// 423 when another device holds the defect's edit lock.
    pub async fn require_unlocked(&self, defect_id: &str, device: &Device) -> ApiResult<()> {
        match self.lock_of(defect_id).await? {
            Some(lock) if lock.device_id != device.id => Err(ApiError::locked(&lock.device_id, &lock.device_name, lock.expires_in_s)),
            _ => Ok(()),
        }
    }

    /// Takes or refreshes the lock; the Lua script makes the take atomic, so exactly one of two devices wins.
    pub async fn take_lock(&self, defect_id: &str, device: &Device) -> ApiResult<LockInfo> {
        let script = "local v = redis.call('GET', KEYS[1]) \
            if not v then redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2]) return {1, ARGV[1]} end \
            if v == ARGV[1] then redis.call('EXPIRE', KEYS[1], ARGV[2]) return {1, v} end \
            return {0, v}";
        let reply = self.valkey.cmd(&["EVAL", script, "1", &lock_key(defect_id), &device.id, LOCK_SECONDS]).await.map_err(valkey_error)?;
        let Resp::Array(items) = reply else { return Err(ApiError::internal("lock script reply")) };
        if items.first().and_then(Resp::int) == Some(1) {
            return Ok(LockInfo { device_id: device.id.clone(), device_name: device.name.clone(), expires_in_s: 30 });
        }
        let holder = items.get(1).and_then(Resp::string).unwrap_or_default();
        let other = self.lock_of(defect_id).await?;
        match other {
            Some(lock) => Err(ApiError::locked(&lock.device_id, &lock.device_name, lock.expires_in_s)),
            None => Err(ApiError::locked(&holder, &holder, 1)),
        }
    }

    pub async fn release_lock(&self, defect_id: &str, device: &Device) -> ApiResult<bool> {
        let script = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
        let reply = self.valkey.cmd(&["EVAL", script, "1", &lock_key(defect_id), &device.id]).await.map_err(valkey_error)?;
        Ok(reply.int() == Some(1))
    }

    pub async fn drop_locks(&self, defect_ids: &[String]) -> ApiResult<()> {
        for id in defect_ids {
            self.valkey.cmd(&["DEL", &lock_key(id)]).await.map_err(valkey_error)?;
        }
        Ok(())
    }
}

pub enum Reply {
    Json(u16, Value),
    Raw { content_type: String, sha256: Option<String>, body: Vec<u8>, download: Option<String> },
    NoContent,
}

pub fn ok(value: Value) -> ApiResult<Reply> {
    Ok(Reply::Json(200, value))
}

pub fn created(value: Value) -> ApiResult<Reply> {
    Ok(Reply::Json(201, value))
}

pub struct Ctx {
    pub app: Shared,
    pub method: String,
    pub path: String,
    pub query: String,
    pub headers: HeaderMap,
    pub body: Option<Body>,
}

/// A JSON request body: parsed late so that 413, 404, 410, 423 and 409 are decided first.
pub struct JsonBody(Bytes);

impl JsonBody {
    /// The body as an object when it is one, without turning anything else into an error.
    pub fn lenient(&self) -> Option<Map<String, Value>> {
        match serde_json::from_slice::<Value>(&self.0) {
            Ok(Value::Object(map)) => Some(map),
            _ => None,
        }
    }

    pub fn object(&self) -> ApiResult<Map<String, Value>> {
        match serde_json::from_slice::<Value>(&self.0) {
            Ok(Value::Object(map)) => Ok(map),
            _ => Err(ApiError::field("body", "Request body must be a JSON object")),
        }
    }
}

impl Ctx {
    pub fn header(&self, name: &str) -> Option<String> {
        self.headers.get(name).and_then(|v| v.to_str().ok()).map(String::from)
    }

    /// Reads the whole body; one byte over the limit is 413. The surplus is drained so the client sees the reply.
    pub async fn read(&mut self, limit: usize) -> ApiResult<Bytes> {
        let Some(body) = self.body.take() else { return Ok(Bytes::new()) };
        let mut stream = body.into_data_stream();
        let mut buffer = Vec::new();
        let mut total = 0usize;
        while let Some(chunk) = stream.next().await {
            let Ok(chunk) = chunk else { break };
            total += chunk.len();
            if total <= limit {
                buffer.extend_from_slice(&chunk);
            } else if total > limit + 200_000_000 {
                break;
            }
        }
        if total > limit {
            return Err(ApiError::too_large());
        }
        Ok(Bytes::from(buffer))
    }

    pub async fn read_json(&mut self) -> ApiResult<JsonBody> {
        Ok(JsonBody(self.read(JSON_LIMIT).await?))
    }

    pub fn device(&self) -> ApiResult<Device> {
        self.header("x-pensight-device")
            .and_then(|id| self.app.device(id.trim()).cloned())
            .ok_or_else(ApiError::unknown_device)
    }

    pub fn file_name(&self) -> String {
        self.header("x-filename").filter(|n| !n.trim().is_empty()).unwrap_or_else(|| "upload".into())
    }

    pub fn query_param(&self, name: &str) -> Option<String> {
        self.query.split('&').filter_map(|pair| pair.split_once('=')).find(|(k, _)| *k == name).map(|(_, v)| percent_decode_plus(v))
    }
}

/// Decodes a URL query value: `+` is a space and `%XX` is a byte.
pub fn percent_decode_plus(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = if bytes[i] == b'%' && i + 2 < bytes.len() { text.get(i + 1..i + 3) } else { None };
        match (bytes[i], hex.and_then(|h| u8::from_str_radix(h, 16).ok())) {
            (_, Some(value)) => {
                out.push(value);
                i += 3;
            }
            (b'+', None) => {
                out.push(b' ');
                i += 1;
            }
            (byte, None) => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}
