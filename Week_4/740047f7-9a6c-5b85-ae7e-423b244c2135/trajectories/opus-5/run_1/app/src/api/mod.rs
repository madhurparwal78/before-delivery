pub mod assets;
pub mod defects;
pub mod dives;
pub mod farms;
pub mod imports;
pub mod links;
pub mod pens;
pub mod reports;

use crate::config::Config;
use crate::error::{ApiError, ApiResult};
use crate::history::Device;
use crate::store::s3::ObjectStore;
use crate::valkey::Live;
use axum::body::Bytes;
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, HeaderName, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::Router;
use deadpool_postgres::{GenericClient, Pool};
use serde_json::{json, Map, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub const JSON_BODY_LIMIT: usize = 64_000;
pub const STILL_LIMIT: usize = 8_000_000;
pub const SONAR_LIMIT: usize = 20_000_000;
pub const IMPORT_LIMIT: usize = 2_000_000;
pub const DEVICE_HEADER: &str = "x-pensight-device";

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub pool: Pool,
    pub store: ObjectStore,
    pub live: Live,
    pub http: reqwest::Client,
    pub ready: Arc<AtomicBool>,
}

impl AppState {
    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }
}

pub fn json_response(status: StatusCode, body: Value) -> Response {
    let bytes = serde_json::to_vec(&body).unwrap_or_else(|_| b"{}".to_vec());
    (
        status,
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        bytes,
    )
        .into_response()
}

pub fn ok(body: Value) -> Response {
    json_response(StatusCode::OK, body)
}

pub fn created(body: Value) -> Response {
    json_response(StatusCode::CREATED, body)
}

/// Raw bytes download with the exact stored content and its SHA-256.
pub fn raw_response(bytes: Vec<u8>, content_type: &str, sha256: &str, file_name: &str) -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type.to_string()),
            (
                HeaderName::from_static("x-content-sha256"),
                sha256.to_string(),
            ),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{}\"", file_name.replace('"', "")),
            ),
        ],
        bytes,
    )
        .into_response()
}

pub fn parse_json_body(bytes: &Bytes) -> ApiResult<Map<String, Value>> {
    if bytes.is_empty() {
        return Ok(Map::new());
    }
    match serde_json::from_slice::<Value>(bytes) {
        Ok(Value::Object(map)) => Ok(map),
        _ => Err(ApiError::body_not_object()),
    }
}

pub fn check_json_size(bytes: &Bytes) -> ApiResult<()> {
    if bytes.len() > JSON_BODY_LIMIT {
        return Err(ApiError::too_large(
            "Request body is larger than 64,000 bytes",
        ));
    }
    Ok(())
}

pub fn check_upload(bytes: &Bytes, limit: usize, label: &str) -> ApiResult<()> {
    if bytes.len() > limit {
        return Err(ApiError::too_large(format!(
            "{label} is larger than {} bytes",
            thousands(limit)
        )));
    }
    Ok(())
}

fn thousands(value: usize) -> String {
    let digits = value.to_string();
    let mut out = String::new();
    for (index, ch) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

pub fn file_name(headers: &HeaderMap) -> String {
    headers
        .get("x-filename")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("upload")
        .to_string()
}

pub fn device_header(headers: &HeaderMap) -> Option<String> {
    headers
        .get(DEVICE_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

/// Every write under /api, except the report link paths, names its device.
pub async fn require_device<C: GenericClient>(
    client: &C,
    headers: &HeaderMap,
) -> ApiResult<Device> {
    let id = device_header(headers).ok_or_else(ApiError::unknown_device)?;
    let rows = client
        .query("select id, name from devices where id = $1", &[&id])
        .await?;
    let row = rows.first().ok_or_else(ApiError::unknown_device)?;
    Ok(Device {
        id: row.get(0),
        name: row.get(1),
    })
}

pub fn base_url(state: &AppState, headers: &HeaderMap) -> String {
    state.config.public_url.clone().unwrap_or_else(|| {
        let host = headers
            .get(header::HOST)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("localhost");
        format!("http://{host}")
    })
}

/// The app's own origin: the origin of APP_PUBLIC_URL when set, otherwise the
/// request's own scheme and Host.
fn app_origin(state: &AppState, headers: &HeaderMap) -> String {
    state.config.configured_origin().unwrap_or_else(|| {
        let host = headers
            .get(header::HOST)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("localhost");
        format!("http://{host}")
    })
}

/// The server boundary, in the published precedence: 405 by method and path
/// alone, then 403 for a foreign Origin.
pub async fn boundary(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    let method = request.method().clone();
    let is_report_link = path.starts_with("/api/share/") || path.starts_with("/r/");
    if is_report_link && method != Method::GET && method != Method::HEAD {
        return ApiError::read_only().into_response();
    }
    if path.starts_with("/api")
        && matches!(method, Method::POST | Method::PATCH | Method::DELETE)
        && !path.starts_with("/api/share/")
    {
        if let Some(origin) = request
            .headers()
            .get(header::ORIGIN)
            .and_then(|value| value.to_str().ok())
        {
            if origin != app_origin(&state, request.headers()) {
                return ApiError::cross_origin().into_response();
            }
        }
    }
    if !state.is_ready() {
        if path == "/api/health" {
            return json_response(
                StatusCode::SERVICE_UNAVAILABLE,
                json!({"status": "starting"}),
            );
        }
        return ApiError::starting().into_response();
    }
    next.run(request).await
}

async fn health(State(state): State<AppState>) -> Response {
    if state.is_ready() {
        ok(json!({"status": "ok"}))
    } else {
        json_response(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"status": "starting"}),
        )
    }
}

async fn events(State(state): State<AppState>) -> Response {
    use futures_util::StreamExt;
    use tokio_stream::wrappers::BroadcastStream;
    let stream = BroadcastStream::new(state.live.events.subscribe()).map(|message| {
        let payload = message.unwrap_or_else(|_| "{}".to_string());
        Ok::<String, std::convert::Infallible>(format!("data: {payload}\n\n"))
    });
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/event-stream"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        axum::body::Body::from_stream(stream),
    )
        .into_response()
}

async fn not_found() -> Response {
    ApiError::not_found().into_response()
}

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/api/health", get(health))
        .route("/api/events", get(events))
        .route("/api/devices", get(farms::list_devices))
        .route(
            "/api/devices/{device_id}/heartbeat",
            post(farms::heartbeat),
        )
        .route("/api/farms", get(farms::list_farms))
        .route("/api/farms/{farm_id}", delete(farms::erase_farm))
        .route(
            "/api/farms/{farm_id}/imports",
            get(imports::list_imports).post(imports::create_import),
        )
        .route("/api/imports/{import_id}/raw", get(imports::raw_import))
        .route("/api/pens", get(pens::list_pens))
        .route("/api/pens/{pen_id}", get(pens::get_pen))
        .route(
            "/api/pens/{pen_id}/defects",
            post(defects::create_defect),
        )
        .route(
            "/api/defects/{defect_id}",
            get(defects::get_defect)
                .patch(defects::patch_defect)
                .delete(defects::delete_defect),
        )
        .route(
            "/api/defects/{defect_id}/history",
            get(defects::get_history),
        )
        .route(
            "/api/defects/{defect_id}/lock",
            post(defects::take_lock).delete(defects::release_lock),
        )
        .route(
            "/api/defects/{defect_id}/stills",
            post(defects::upload_still),
        )
        .route("/api/stills/{still_id}/raw", get(defects::raw_still))
        .route(
            "/api/defects/{defect_id}/repairs",
            post(defects::record_repair),
        )
        .route("/api/pens/{pen_id}/copilot", post(pens::copilot))
        .route(
            "/api/proposals/{proposal_id}/apply",
            post(pens::apply_proposal),
        )
        .route("/api/dives", get(dives::list_dives).post(dives::plan_dive))
        .route("/api/dives/{dive_id}", get(dives::get_dive))
        .route(
            "/api/dives/{dive_id}/clearance",
            post(dives::check_clearance),
        )
        .route("/api/dives/{dive_id}/start", post(dives::start_dive))
        .route("/api/dives/{dive_id}/finish", post(dives::finish_dive))
        .route("/api/dives/{dive_id}/sonar", post(dives::upload_sonar))
        .route("/api/sonar/{capture_id}/raw", get(dives::raw_sonar))
        .route(
            "/api/pens/{pen_id}/reports",
            get(reports::list_revisions).post(reports::publish_revision),
        )
        .route(
            "/api/pens/{pen_id}/reports/{number}/pack",
            get(reports::download_pack),
        )
        .route("/api/pens/{pen_id}/restore", post(reports::restore_revision))
        .route(
            "/api/pens/{pen_id}/links",
            get(links::list_links).post(links::create_link),
        )
        .route(
            "/api/links/{link_id}/regenerate",
            post(links::regenerate_link),
        )
        .route("/api/links/{link_id}/revoke", post(links::revoke_link))
        .route(
            "/api/share/{token}",
            get(links::share).fallback(read_only_route),
        )
        .route("/api/search", get(pens::search))
        .route("/api/exports/defects.csv", get(pens::export_defects))
        .fallback(not_found);

    Router::new()
        .merge(api)
        .route("/r/{token}", get(assets::report_link_page))
        .fallback(assets::static_asset)
        .method_not_allowed_fallback(not_found)
        .layer(axum::extract::DefaultBodyLimit::max(64 * 1024 * 1024))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            boundary,
        ))
        .with_state(state)
}

async fn read_only_route() -> Response {
    ApiError::read_only().into_response()
}

/// Every broadcast change is published on the Valkey channel and relayed to the
/// open consoles.
pub async fn broadcast(state: &AppState, event: Value) {
    let _ = state.live.publish(&event).await;
}

pub fn event(
    kind: &str,
    device: Option<&Device>,
    extra: Vec<(&str, Value)>,
) -> Value {
    let mut body = Map::new();
    body.insert("type".into(), Value::String(kind.to_string()));
    body.insert(
        "device_id".into(),
        device
            .map(|device| Value::String(device.id.clone()))
            .unwrap_or(Value::Null),
    );
    body.insert(
        "device_name".into(),
        device
            .map(|device| Value::String(device.name.clone()))
            .unwrap_or(Value::Null),
    );
    for (key, value) in extra {
        body.insert(key.to_string(), value);
    }
    Value::Object(body)
}
