//! The API: every endpoint under /api, plus the report link page.
//! One error shape for every refusal; the precedence rule lives in `guard`.

use crate::config::Config;

use crate::http_client::Http;
use crate::infra::{ApiError, ApiResult, ValkeyHandle};
use crate::pg::Param;


use crate::store::Store;
use axum::body::Body;

use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{SecondsFormat, Utc};

use serde_json::{json, Value};
use std::sync::Arc;


pub struct App {
    pub locks: Locks,
    pub store: Arc<Store>,
    pub valkey: ValkeyHandle,
    pub http: Http,
    pub wiremock_url: String,
    pub cfg: Config,
}

pub type Shared = Arc<App>;

// ---------- helpers ----------

pub fn ts_of(at: &str) -> chrono::DateTime<chrono::Utc> {
    crate::dives::parse_now(at).unwrap_or_else(chrono::Utc::now)
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

pub fn err(status: u16, code: &'static str, message: impl Into<String>) -> ApiError {
    ApiError::new(status, code, message)
}

pub fn into_response(result: ApiResult<Response>) -> Response {
    match result {
        Ok(r) => r,
        Err(e) => {
            let status = StatusCode::from_u16(e.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            let mut resp = (status, Json(e.body())).into_response();
            resp.headers_mut().insert("content-type", HeaderValue::from_static("application/json; charset=utf-8"));
            resp
        }
    }
}

// ---------- one-at-a-time serialisation ----------

use std::collections::HashMap;
use std::sync::Mutex;

pub struct Locks {
    per_defect: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    per_import: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    per_link: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    per_dive: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl Locks {
    pub fn new() -> Self {
        Locks {
            per_defect: Mutex::new(HashMap::new()),
            per_import: Mutex::new(HashMap::new()),
            per_link: Mutex::new(HashMap::new()),
            per_dive: Mutex::new(HashMap::new()),
        }
    }
    pub fn defect(&self, id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut m = self.per_defect.lock().unwrap_or_else(|e| e.into_inner());
        m.entry(id.to_string()).or_default().clone()
    }
    pub fn import(&self, id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut m = self.per_import.lock().unwrap_or_else(|e| e.into_inner());
        m.entry(id.to_string()).or_default().clone()
    }
    pub fn link(&self, id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut m = self.per_link.lock().unwrap_or_else(|e| e.into_inner());
        m.entry(id.to_string()).or_default().clone()
    }
    pub fn dive(&self, id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut m = self.per_dive.lock().unwrap_or_else(|e| e.into_inner());
        m.entry(id.to_string()).or_default().clone()
    }
}

// ---------- the API handlers ----------

impl App {
    /// This pen's current locks, from Valkey.
    async fn pen_locks(&self, pen_id: &str) -> std::collections::HashMap<String, (String, i64)> {
        let mut map = std::collections::HashMap::new();
        let rows = match self.store.pg.exec(
            "SELECT id FROM defects WHERE pen_id = $1 AND removed = false",
            vec![Param::Text(pen_id.into())]) {
            Ok(r) => r,
            Err(_) => return map,
        };
        for i in 0..rows.len() {
            let id = rows.str_of(i, "id");
            if let Ok(Some(holder)) = self.valkey.lock_holder(&id).await {
                let ttl = self.valkey.lock_ttl(&id).await.unwrap_or(30);
                map.insert(id, (holder, ttl));
            }
        }
        map
    }

    /// The pen with its locks filled in, for every surface that shows the pen.
    pub async fn pen_with_locks(&self, pen_id: &str) -> Result<serde_json::Value, ApiError> {
        if !self.store.pen_exists(pen_id).map_err(internal)? {
            return Err(err(404, "not_found", "Not found"));
        }
        let locks = self.pen_locks(pen_id).await;
        self.store.pen_json_with_locks(pen_id, true, &locks).map_err(internal)
    }

    /// One defect by id, inspector shape or placeholder.
    pub async fn defect_by_id(&self, defect_id: &str) -> ApiResult<Response> {
        let exists = self.store.pg.exec("SELECT removed FROM defects WHERE id = $1", vec![Param::Text(defect_id.into())]).map_err(internal)?;
        if exists.is_empty() { return Err(err(404, "not_found", "Not found")); }
        let json = if exists.get(0, "removed").as_bool() == Some(true) {
            self.store.placeholder_json(defect_id).map_err(internal)?
        } else {
            self.store.defect_json(defect_id, true, None).map_err(internal)?
        };
        Ok(json_response(200, &json!({"defect": json})))
    }

    // ----- devices -----

    pub async fn devices(&self) -> ApiResult<Response> {
        let devices = self.store.devices().map_err(internal)?;
        let mut out = Vec::new();
        for (id, name) in devices {
            let online = self.valkey.online(&id).await.unwrap_or(false);
            out.push(json!({"id": id, "name": name, "online": online}));
        }
        Ok(json_response(200, &json!({"devices": out})))
    }

    pub async fn heartbeat(&self, device_id: &str) -> ApiResult<Response> {
        let name = self.store.device_name(device_id).map_err(internal)?
            .ok_or_else(|| err(404, "not_found", "Unknown device"))?;
        self.valkey.set_heartbeat(device_id).await.map_err(internal)?;
        Ok(json_response(200, &json!({"device": {"id": device_id, "name": name, "online": true}})))
    }

    // ----- farms -----

    pub async fn farms(&self) -> ApiResult<Response> {
        let rows = self.store.pg.exec(
            "SELECT f.id, f.name, f.day_rate_amount, f.day_rate_currency FROM farms f ORDER BY f.id", vec![]).map_err(internal)?;
        let mut farms = Vec::new();
        for i in 0..rows.len() {
            let farm_id = rows.str_of(i, "id");
            let sites = self.store.pg.exec(
                "SELECT code, name, latitude, longitude FROM sites WHERE farm_id = $1 ORDER BY code",
                vec![Param::Text(farm_id.clone())]).map_err(internal)?;
            let pen_ids = self.store.pg.exec(
                "SELECT id FROM pens WHERE farm_id = $1 ORDER BY CASE id WHEN 'skv-01' THEN 1 WHEN 'skv-02' THEN 2 WHEN 'skv-03' THEN 3 WHEN 'klm-04' THEN 4 ELSE 5 END", vec![Param::Text(farm_id.clone())]).map_err(internal)?;
            farms.push(json!({
                "id": farm_id,
                "name": rows.str_of(i, "name"),
                "day_rate": {"amount": rows.int_of(i, "day_rate_amount"), "currency": rows.str_of(i, "day_rate_currency")},
                "sites": (0..sites.len()).map(|s| json!({
                    "code": sites.str_of(s, "code"), "name": sites.str_of(s, "name"),
                    "latitude": sites.num_of(s, "latitude"), "longitude": sites.num_of(s, "longitude"),
                })).collect::<Vec<_>>(),
                "pen_ids": (0..pen_ids.len()).map(|p| json!(pen_ids.str_of(p, "id"))).collect::<Vec<_>>(),
            }));
        }
        Ok(json_response(200, &json!({"farms": farms})))
    }

    pub async fn erase_farm(&self, farm_id: &str, body: Value) -> ApiResult<Response> {
        let confirm = body.get("confirm_name").and_then(|v| v.as_str()).unwrap_or("");
        let rows = self.store.pg.exec("SELECT name FROM farms WHERE id = $1", vec![Param::Text(farm_id.into())]).map_err(internal)?;
        if rows.is_empty() { return Err(err(404, "not_found", "Not found")); }
        if confirm != rows.str_of(0, "name") {
            return Err(one_field_published("confirm_name", "Type the farm name exactly to confirm"));
        }
        // Release every lock on the farm's defects.
        let defects = self.store.pg.exec("SELECT id FROM defects WHERE pen_id IN (SELECT id FROM pens WHERE farm_id = $1)",
            vec![Param::Text(farm_id.into())]).map_err(internal)?;
        for i in 0..defects.len() {
            let _ = self.valkey.release_lock_if_holder(&defects.str_of(i, "id"), "").await;
        }
        self.store.s3.delete_prefix(&format!("farms/{farm_id}/")).await.map_err(internal)?;
        self.store.pg.exec("DELETE FROM farms WHERE id = $1", vec![Param::Text(farm_id.into())]).map_err(internal)?;
        self.broadcast(json!({"kind": "farm_erased", "farm_id": farm_id})).await;
        Ok(json_response(200, &json!({"erased": farm_id})))
    }

    // ----- pens -----

    pub async fn pens(&self) -> ApiResult<Response> {
        let rows = self.store.pg.exec(
            "SELECT id FROM pens ORDER BY CASE id WHEN 'skv-01' THEN 1 WHEN 'skv-02' THEN 2 WHEN 'skv-03' THEN 3 WHEN 'klm-04' THEN 4 ELSE 5 END",
            vec![]).map_err(internal)?;
        let mut pens = Vec::new();
        for i in 0..rows.len() {
            pens.push(self.store.pen_json(&rows.str_of(i, "id"), false).map_err(internal)?);
        }
        Ok(json_response(200, &json!({"pens": pens})))
    }

    pub async fn pen(&self, pen_id: &str) -> ApiResult<Response> {
        let pen = self.pen_with_locks(pen_id).await?;
        Ok(json_response(200, &json!({"pen": pen})))
    }

    pub async fn broadcast(&self, event: Value) {
        let _ = self.valkey.publish(&event.to_string()).await;
    }
}

pub fn internal(e: String) -> ApiError {
    ApiError::new(500, "internal", e)
}

pub fn one_field_published(field: &str, message: &str) -> ApiError {
    crate::validate::one_field(field, message)
}

pub fn json_response(status: u16, body: &Value) -> Response {
    let mut resp = Response::builder()
        .status(StatusCode::from_u16(status).unwrap_or(StatusCode::OK))
        .header("content-type", "application/json; charset=utf-8");
    resp = resp.header("cache-control", "no-store");
    let bytes = serde_json::to_vec(body).unwrap_or_default();
    resp.body(Body::from(bytes)).unwrap_or_else(|_| Response::new(Body::from("")))
}

impl App {
    /// The status of a share token, for the report link page's first paint.
    pub async fn share_status(&self, token: &str) -> crate::infra::ApiResult<()> {
        let rows = self.store.pg.exec(
            "SELECT revoked, expires_at FROM report_links WHERE token = $1",
            vec![crate::pg::Param::Text(token.into())]).map_err(internal)?;
        if rows.is_empty() {
            return Err(err(404, "not_found", "This report link does not exist"));
        }
        let expires = match rows.get(0, "expires_at") {
            serde_json::Value::String(s) => s.clone(),
            _ => String::new(),
        };
        let expired = crate::dives::parse_now(&expires).map(|e| chrono::Utc::now() >= e).unwrap_or(false);
        if rows.get(0, "revoked").as_bool() == Some(true) || expired {
            return Err(err(410, "link_inactive", "This report link is no longer active"));
        }
        Ok(())
    }
}
