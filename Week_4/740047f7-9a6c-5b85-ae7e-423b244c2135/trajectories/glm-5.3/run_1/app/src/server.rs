//! The HTTP server: routing, the origin guard, body limits,
//! the live-update stream, static assets and the report link pages.

use crate::api::{into_response, App, Locks, Shared};
use crate::config::Config;
use crate::infra::ApiError;
use crate::store::Store;
use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Request, State};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::Response;
use axum::routing::{delete, get, post};
use axum::Router;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub app: Shared,
    pub boot: Arc<AtomicBool>,
    pub events: tokio::sync::broadcast::Sender<Value>,
    pub assets: Arc<Assets>,
}

pub struct Assets {
    pub index: Vec<u8>,
    pub files: HashMap<String, (String, Vec<u8>)>,
}

impl Assets {
    pub fn load() -> Result<Assets, String> {
        let dir = std::path::Path::new("web/dist");
        let mut files = HashMap::new();
        let index_path = dir.join("index.html");
        let mut index = include_bytes!("fallback_index.html").to_vec();
        if index_path.exists() {
            index = std::fs::read(&index_path).map_err(|e| e.to_string())?;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
                    files.insert(name, (mime_of(&path.to_string_lossy()), bytes));
                } else if path.is_dir() {
                    if let Ok(subs) = std::fs::read_dir(&path) {
                        for sub in subs.flatten() {
                            if sub.path().is_file() {
                                let rel = format!("{}/{}",
                                    path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                                    sub.file_name().to_string_lossy().to_string());
                                let bytes = std::fs::read(sub.path()).map_err(|e| e.to_string())?;
                                files.insert(rel, (mime_of(&sub.path().to_string_lossy()), bytes));
                            }
                        }
                    }
                }
            }
        }
        Ok(Assets { index, files })
    }
}

fn mime_of(name: &str) -> String {
    if name.ends_with(".js") { "text/javascript; charset=utf-8".into() }
    else if name.ends_with(".css") { "text/css; charset=utf-8".into() }
    else if name.ends_with(".woff2") { "font/woff2".into() }
    else if name.ends_with(".woff") { "font/woff".into() }
    else if name.ends_with(".svg") { "image/svg+xml".into() }
    else if name.ends_with(".png") { "image/png".into() }
    else if name.ends_with(".json") { "application/json".into() }
    else if name.ends_with(".html") { "text/html; charset=utf-8".into() }
    else { "application/octet-stream".into() }
}

// ---------- the live-update stream ----------

async fn events_broadcaster(valkey: crate::infra::ValkeyHandle) -> tokio::sync::broadcast::Sender<Value> {
    let (tx, _) = tokio::sync::broadcast::channel::<Value>(256);
    let relay = tx.clone();
    tokio::spawn(async move {
        loop {
            match valkey.subscribe().await {
                Ok(mut stream) => {
                    let mut buf: Vec<u8> = Vec::new();
                    let mut chunk = [0u8; 4096];
                    loop {
                        let read = tokio::io::AsyncReadExt::read(&mut stream, &mut chunk);
                        match tokio::time::timeout(std::time::Duration::from_secs(30), read).await {
                            Ok(Ok(0)) => break,
                            Ok(Ok(n)) => {
                                buf.extend_from_slice(&chunk[..n]);
                                // Emit only whole subscribe-message frames, and keep any
                                // incomplete tail for the next read.
                                if let Some(consumed) = drain_frames(&mut buf) {
                                    for payload in consumed {
                                        let _ = relay.send(payload);
                                    }
                                }
                                if buf.len() > 1_000_000 { buf.clear(); }
                            }
                            Ok(Err(_)) => break,
                            Err(_) => continue,
                        }
                    }
                }
                Err(_) => tokio::time::sleep(std::time::Duration::from_secs(1)).await,
            }
        }
    });
    tx
}


/// Drain every complete subscribe-message frame from the buffer, keeping any partial tail.
/// Returns the payloads in frame order.
fn drain_frames(buf: &mut Vec<u8>) -> Option<Vec<Value>> {
    let mut out = Vec::new();
    loop {
        let text = String::from_utf8_lossy(buf);
        let bytes = text.as_bytes();
        if bytes.first() != Some(&b'*') {
            // resync to the next frame start
            match bytes.iter().position(|&b| b == b'*') {
                Some(pos) => { buf.drain(..pos); }
                None => { buf.clear(); return if out.is_empty() { None } else { Some(out) }; }
            }
            continue;
        }
        let head_end = match find_crlf(bytes, 0) { Some(p) => p, None => break };
        let count: usize = match text[..head_end].trim_start_matches('*').trim().parse() { Ok(c) => c, Err(_) => { buf.drain(..1); continue; } };
        let mut pos = head_end + 2;
        let mut seen = 0usize;
        let mut payload: Option<Value> = None;
        while seen < count {
            let h_end = match find_crlf(bytes, pos) { Some(p) => p, None => { pos = usize::MAX; break; } };
            let header = &text[pos..h_end];
            pos = h_end + 2;
            if let Some(len_text) = header.strip_prefix('$') {
                let n: usize = match len_text.parse() { Ok(v) => v, Err(_) => break };
                if pos + n + 2 > bytes.len() { pos = usize::MAX; break; }
                let body = &text[pos..pos + n];
                if seen == count - 1 { payload = serde_json::from_str(body).ok(); }
                pos += n + 2;
            }
            seen += 1;
        }
        if pos == usize::MAX { break; }   // incomplete frame; keep the tail
        if let Some(p) = payload.take() { out.push(p); }
        buf.drain(..pos);
    }
    if out.is_empty() { None } else { Some(out) }
}

fn find_crlf(bytes: &[u8], from: usize) -> Option<usize> {
    let mut i = from;
    while i + 1 < bytes.len() {
        if bytes[i] == b'\r' && bytes[i + 1] == b'\n' { return Some(i); }
        i += 1;
    }
    None
}

// ---------- routing ----------

pub async fn serve(cfg: Config, boot: Arc<AtomicBool>, assets: Arc<Assets>) -> Result<(), String> {
    let s3 = Arc::new(crate::s3::S3::new(&cfg)?);
    let store = Store::connect(&cfg.database_url, s3.clone())?;
    let valkey = crate::infra::Valkey::new(&cfg.valkey_url)?;
    let app: Shared = Arc::new(App {
        locks: Locks::new(),
        store,
        valkey: valkey.clone(),
        http: crate::http_client::Http::new(),
        wiremock_url: cfg.wiremock_url.clone(),
        cfg: cfg.clone(),
    });

    // Bind before seeding so health answers while the services come up.
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], cfg.app_public_port));
    let listener = tokio::net::TcpListener::bind(addr).await.map_err(|e| e.to_string())?;
    eprintln!("pensight: listening on {addr}");

    let events = events_broadcaster(valkey).await;
    let state = AppState { app: app.clone(), boot: boot.clone(), events, assets: assets.clone() };

    // The schema and the seed, applied idempotently on every start.
    crate::seed::apply(&app.store, &s3).await.map_err(|e| format!("seed: {e}"))?;
    eprintln!("pensight: schema and seed applied");

    let router = build_router(state);
    axum::serve(listener, router).await.map_err(|e| e.to_string())
}

fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/", get(page_handler))
        .route("/pens/{pen_id}", get(page_handler))
        .route("/dives", get(page_handler))
        .route("/imports", get(page_handler))
        .route("/reports", get(page_handler))
        .route("/devices", get(page_handler))
        .route("/r/{token}", get(share_page))
        .route("/api/health", get(api_health))
        .route("/api/devices", get(api_devices))
        .route("/api/devices/{device_id}/heartbeat", post(api_heartbeat))
        .route("/api/farms", get(api_farms))
        .route("/api/farms/{farm_id}", delete(api_erase_farm))
        .route("/api/pens", get(api_pens))
        .route("/api/pens/{pen_id}", get(api_pen))
        .route("/api/pens/{pen_id}/defects", post(api_create_defect))
        .route("/api/defects/{defect_id}", get(api_get_defect).patch(api_patch_defect).delete(api_delete_defect))
        .route("/api/defects/{defect_id}/history", get(api_history))
        .route("/api/defects/{defect_id}/lock", post(api_take_lock).delete(api_release_lock))
        .route("/api/defects/{defect_id}/stills", post(api_attach_still))
        .route("/api/stills/{still_id}/raw", get(api_still_raw))
        .route("/api/defects/{defect_id}/repairs", post(api_record_repair))
        .route("/api/pens/{pen_id}/copilot", post(api_ask_copilot))
        .route("/api/proposals/{proposal_id}/apply", post(api_apply_proposal))
        .route("/api/dives", get(api_dives).post(api_plan_dive))
        .route("/api/dives/{dive_id}", get(api_dive))
        .route("/api/dives/{dive_id}/clearance", post(api_check_forecast))
        .route("/api/dives/{dive_id}/start", post(api_start_dive))
        .route("/api/dives/{dive_id}/finish", post(api_finish_dive))
        .route("/api/dives/{dive_id}/sonar", post(api_attach_sonar))
        .route("/api/sonar/{capture_id}/raw", get(api_sonar_raw))
        .route("/api/farms/{farm_id}/imports", get(api_farm_imports).post(api_import_csv))
        .route("/api/imports/{import_id}/raw", get(api_import_raw))
        .route("/api/pens/{pen_id}/reports", get(api_pen_reports).post(api_publish_revision))
        .route("/api/pens/{pen_id}/reports/{n}/pack", get(api_revision_pack))
        .route("/api/pens/{pen_id}/restore", post(api_restore_revision))
        .route("/api/pens/{pen_id}/links", get(api_pen_links).post(api_create_link))
        .route("/api/links/{link_id}/regenerate", post(api_regenerate_link))
        .route("/api/links/{link_id}/revoke", post(api_revoke_link))
        .route("/api/share/{token}", get(api_share_json))
        .route("/api/search", get(api_search))
        .route("/api/exports/defects.csv", get(api_export))
        .route("/api/events", get(api_events))
        .route("/{*path}", get(asset_or_404))
        .fallback(fallback_404)
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .with_state(state)
}

// ---------- shared helpers ----------

fn not_ready() -> Response {
    json_status(StatusCode::SERVICE_UNAVAILABLE, &json!({"error": {"code": "starting", "message": "Pensight is starting"}}))
}

fn starting_health() -> Response {
    Response::builder().status(StatusCode::SERVICE_UNAVAILABLE)
        .header("content-type", "application/json; charset=utf-8")
        .header("cache-control", "no-store")
        .body(Body::from(serde_json::to_vec(&json!({"status": "starting"})).unwrap_or_default()))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

fn json_status(status: StatusCode, body: &Value) -> Response {
    Response::builder().status(status)
        .header("content-type", "application/json; charset=utf-8")
        .header("cache-control", "no-store")
        .body(Body::from(serde_json::to_vec(body).unwrap_or_default()))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

fn html_response(body: Vec<u8>) -> Response {
    Response::builder().status(StatusCode::OK)
        .header("content-type", "text/html; charset=utf-8")
        .header("cache-control", "no-store")
        .body(Body::from(body))
        .unwrap_or_else(|_| Response::new(Body::from(String::new())))
}

fn last_segment(uri: &Uri) -> String {
    uri.path().rsplit('/').next().unwrap_or("").to_string()
}

fn segment_before(uri: &Uri, tail: &str) -> String {
    let path = uri.path();
    let marker = format!("/{tail}");
    let idx = path.rfind(&marker).unwrap_or(path.len());
    path[..idx].rsplit('/').next().unwrap_or("").to_string()
}

fn device_of(headers: &HeaderMap) -> Result<String, ApiError> {
    let header = headers.get("x-pensight-device").and_then(|v| v.to_str().ok()).unwrap_or("");
    if header.is_empty() {
        return Err(ApiError::new(422, "validation", "Unknown device")
            .with_fields(json!({"device": "Unknown device"})));
    }
    Ok(header.to_string())
}

/// The origin guard: a foreign Origin on any write is refused.
async fn origin_guard(state: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    if let Some(o) = origin {
        if let Some(own) = state.app.cfg.public_origin() {
            if o != own {
                return Err(ApiError::cross_origin());
            }
        }
    }
    Ok(())
}

async fn read_json_guarded(req: Request) -> Result<Value, ApiError> {
    let bytes = axum::body::to_bytes(req.into_body(), 64_001)
        .await
        .map_err(|_| ApiError::new(413, "too_large", "Body is too large"))?;
    if bytes.len() > 64_000 {
        return Err(ApiError::new(413, "too_large", "Body is too large"));
    }
    if bytes.is_empty() { return Ok(json!({})); }
    let text = String::from_utf8_lossy(&bytes);
    let v: Value = serde_json::from_str(&text)
        .map_err(|_| ApiError::new(422, "validation", "Body is not valid JSON"))?;
    if !v.is_object() {
        return Err(ApiError::new(422, "validation", "Body must be a JSON object")
            .with_fields(json!({"body": "Body must be a JSON object"})));
    }
    Ok(v)
}

async fn read_upload(req: Request, limit: usize) -> Result<(Vec<u8>, String, String), ApiError> {
    let content_type = req.headers().get("content-type").and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .split(';').next().unwrap_or("application/octet-stream").trim().to_string();
    let file_name = req.headers().get("x-filename").and_then(|v| v.to_str().ok()).unwrap_or("upload").to_string();
    let bytes = axum::body::to_bytes(req.into_body(), limit)
        .await
        .map_err(|_| ApiError::new(413, "too_large", "Upload is too large"))?;
    if bytes.len() >= limit {
        return Err(ApiError::new(413, "too_large", "Upload is too large"));
    }
    if bytes.is_empty() {
        return Err(ApiError::new(422, "validation", "Upload body is empty"));
    }
    Ok((bytes.to_vec(), content_type, file_name))
}

fn urldecode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(h) = u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("zz"), 16) {
                out.push(h);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' { out.push(b' '); i += 1; continue; }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ---------- handlers: health, devices, farms, pens ----------

async fn api_events(State(state): State<AppState>) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let rx = state.events.subscribe();
    let stream = async_stream::stream! {
        let mut rx = rx;
        loop {
            match rx.recv().await {
                Ok(event) => yield Ok::<_, std::convert::Infallible>(format!("data: {}\n\n", event)),
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    };
    Response::builder().status(StatusCode::OK)
        .header("content-type", "text/event-stream")
        .header("cache-control", "no-store")
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

async fn api_health(State(state): State<AppState>) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return starting_health(); }
    let pg_ok = state.app.store.pg.exec("SELECT 1 AS ok", vec![]).is_ok();
    let valkey_ok = state.app.valkey.ping().await.unwrap_or(false);
    let s3_ok = state.app.store.s3.head_bucket().await.is_ok();
    if pg_ok && valkey_ok && s3_ok {
        crate::api::json_response(200, &json!({"status": "ok"}))
    } else {
        starting_health()
    }
}

async fn api_devices(State(state): State<AppState>) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    into_response(state.app.devices().await)
}

async fn api_heartbeat(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    let _ = req;
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let device = match last_segment(&req.uri()) {
        _ => match device_of(&headers) {
            Ok(d) => d,
            Err(e) => return into_response(Err(e)),
        },
    };
    into_response(state.app.heartbeat(&device).await)
}

async fn api_farms(State(state): State<AppState>) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    into_response(state.app.farms().await)
}

async fn api_erase_farm(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let farm_id = last_segment(&req.uri());
    if let Err(e) = device_of(&headers) { return into_response(Err(e)); }
    let body = match read_json_guarded(req).await { Ok(b) => b, Err(e) => return into_response(Err(e)) };
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.erase_farm(&farm_id, body).await)
}

async fn api_pens(State(state): State<AppState>) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    into_response(state.app.pens().await)
}

async fn api_pen(State(state): State<AppState>, uri: Uri) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let pen_id = uri.path().trim_start_matches("/api/pens/").split('/').next().unwrap_or("").to_string();
    into_response(state.app.pen(&pen_id).await)
}

// ---------- handlers: defects ----------

async fn api_create_defect(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let pen_id = req.uri().path().trim_start_matches("/api/pens/").trim_end_matches("/defects").to_string();
    let device = match device_of(&headers) { Ok(d) => d, Err(e) => return into_response(Err(e)) };
    let body = match read_json_guarded(req).await { Ok(b) => b, Err(e) => return into_response(Err(e)) };
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.create_defect(&pen_id, body, &device).await)
}

async fn api_patch_defect(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let defect_id = last_segment(&req.uri());
    let device = match device_of(&headers) { Ok(d) => d, Err(e) => return into_response(Err(e)) };
    let body = match read_json_guarded(req).await { Ok(b) => b, Err(e) => return into_response(Err(e)) };
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.patch_defect(&defect_id, body, &device).await)
}

async fn api_delete_defect(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let defect_id = last_segment(&req.uri());
    let device = match device_of(&headers) { Ok(d) => d, Err(e) => return into_response(Err(e)) };
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.delete_defect(&defect_id, &device).await)
}

async fn api_get_defect(State(state): State<AppState>, uri: Uri) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let defect_id = last_segment(&uri);
    into_response(state.app.defect_by_id(&defect_id).await)
}

async fn api_history(State(state): State<AppState>, uri: Uri) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let defect_id = segment_before(&uri, "history");
    into_response(state.app.defect_history(&defect_id).await)
}

async fn api_take_lock(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let defect_id = segment_before(&req.uri(), "lock");
    let device = match device_of(&headers) { Ok(d) => d, Err(e) => return into_response(Err(e)) };
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.take_lock(&defect_id, &device).await)
}

async fn api_release_lock(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let defect_id = segment_before(&req.uri(), "lock");
    let device = match device_of(&headers) { Ok(d) => d, Err(e) => return into_response(Err(e)) };
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.release_lock(&defect_id, &device).await)
}

async fn api_attach_still(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let defect_id = segment_before(&req.uri(), "stills");
    let device = match device_of(&headers) { Ok(d) => d, Err(e) => return into_response(Err(e)) };
    let (bytes, content_type, file_name) = match read_upload(req, 8_000_001).await {
        Ok(b) => b, Err(e) => return into_response(Err(e)),
    };
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.attach_still(&defect_id, bytes, &content_type, &file_name, &device).await)
}

async fn api_still_raw(State(state): State<AppState>, uri: Uri) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let id = segment_before(&uri, "raw");
    into_response(state.app.still_raw(&id).await)
}

async fn api_record_repair(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let defect_id = segment_before(&req.uri(), "repairs");
    let device = match device_of(&headers) { Ok(d) => d, Err(e) => return into_response(Err(e)) };
    let body = match read_json_guarded(req).await { Ok(b) => b, Err(e) => return into_response(Err(e)) };
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.record_repair(&defect_id, body, &device).await)
}

async fn api_ask_copilot(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let pen_id = req.uri().path().trim_start_matches("/api/pens/").trim_end_matches("/copilot").to_string();
    if let Err(e) = device_of(&headers) { return into_response(Err(e)); }
    let body = match read_json_guarded(req).await { Ok(b) => b, Err(e) => return into_response(Err(e)) };
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.ask_copilot(&pen_id, body).await)
}

async fn api_apply_proposal(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let proposal_id = req.uri().path().trim_start_matches("/api/proposals/").trim_end_matches("/apply").to_string();
    let device = match device_of(&headers) { Ok(d) => d, Err(e) => return into_response(Err(e)) };
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.apply_proposal(&proposal_id, &device).await)
}

// ---------- handlers: dives ----------

async fn api_dives(State(state): State<AppState>) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    into_response(state.app.dives().await)
}

async fn api_plan_dive(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    if let Err(e) = device_of(&headers) { return into_response(Err(e)); }
    let body = match read_json_guarded(req).await { Ok(b) => b, Err(e) => return into_response(Err(e)) };
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.plan_dive(body).await)
}

async fn api_dive(State(state): State<AppState>, uri: Uri) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let id = last_segment(&uri);
    into_response(state.app.dive(&id).await)
}

async fn api_check_forecast(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let dive_id = segment_before(&req.uri(), "clearance");
    if let Err(e) = device_of(&headers) { return into_response(Err(e)); }
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.check_forecast(&dive_id).await)
}

async fn api_start_dive(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let dive_id = segment_before(&req.uri(), "start");
    if let Err(e) = device_of(&headers) { return into_response(Err(e)); }
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.start_dive(&dive_id).await)
}

async fn api_finish_dive(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let dive_id = segment_before(&req.uri(), "finish");
    if let Err(e) = device_of(&headers) { return into_response(Err(e)); }
    let body = match read_json_guarded(req).await { Ok(b) => b, Err(e) => return into_response(Err(e)) };
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.finish_dive(&dive_id, body).await)
}

async fn api_attach_sonar(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let dive_id = segment_before(&req.uri(), "sonar");
    let (bytes, content_type, file_name) = match read_upload(req, 20_000_001).await {
        Ok(b) => b, Err(e) => return into_response(Err(e)),
    };
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.attach_sonar(&dive_id, bytes, &content_type, &file_name).await)
}

async fn api_sonar_raw(State(state): State<AppState>, uri: Uri) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let id = segment_before(&uri, "raw");
    into_response(state.app.sonar_raw(&id).await)
}

// ---------- handlers: imports ----------

async fn api_farm_imports(State(state): State<AppState>, uri: Uri) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let farm_id = segment_before(&uri, "imports");
    into_response(state.app.farm_imports(&farm_id).await)
}

async fn api_import_csv(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let farm_id = segment_before(&req.uri(), "imports");
    let (bytes, _content_type, file_name) = match read_upload(req, 2_000_001).await {
        Ok(b) => b, Err(e) => return into_response(Err(e)),
    };
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.import_csv(&farm_id, bytes, &file_name).await)
}

async fn api_import_raw(State(state): State<AppState>, uri: Uri) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let id = segment_before(&uri, "raw");
    into_response(state.app.import_raw(&id).await)
}

// ---------- handlers: reports, links, share, search, export ----------

async fn api_pen_reports(State(state): State<AppState>, uri: Uri) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let pen_id = segment_before(&uri, "reports");
    into_response(state.app.pen_reports(&pen_id).await)
}

async fn api_publish_revision(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let pen_id = segment_before(&req.uri(), "reports");
    let device = match device_of(&headers) { Ok(d) => d, Err(e) => return into_response(Err(e)) };
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.publish_revision(&pen_id, &device).await)
}

async fn api_revision_pack(State(state): State<AppState>, uri: Uri) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let parts: Vec<&str> = uri.path().split('/').collect();
    let pen_id = parts.get(3).unwrap_or(&"").to_string();
    let n: i64 = parts.get(5).unwrap_or(&"").parse().unwrap_or(-1);
    into_response(state.app.revision_pack(&pen_id, n).await)
}

async fn api_restore_revision(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let pen_id = segment_before(&req.uri(), "restore");
    let device = match device_of(&headers) { Ok(d) => d, Err(e) => return into_response(Err(e)) };
    let body = match read_json_guarded(req).await { Ok(b) => b, Err(e) => return into_response(Err(e)) };
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.restore_revision(&pen_id, body, &device).await)
}

async fn api_pen_links(State(state): State<AppState>, uri: Uri) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let pen_id = segment_before(&uri, "links");
    into_response(state.app.pen_links(&pen_id).await)
}

async fn api_create_link(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let pen_id = segment_before(&req.uri(), "links");
    if let Err(e) = device_of(&headers) { return into_response(Err(e)); }
    let body = match read_json_guarded(req).await { Ok(b) => b, Err(e) => return into_response(Err(e)) };
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    into_response(state.app.create_link(&pen_id, body).await)
}

async fn api_regenerate_link(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let link_id = segment_before(&req.uri(), "regenerate");
    if let Err(e) = device_of(&headers) { return into_response(Err(e)); }
    let body = match read_json_guarded(req).await { Ok(b) => b, Err(e) => return into_response(Err(e)) };
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    let origin = headers.get("origin").and_then(|v| v.to_str().ok()).map(|s| s.to_string());
    into_response(state.app.regenerate_link(&link_id, body, origin.as_deref()).await)
}

async fn api_revoke_link(State(state): State<AppState>, headers: HeaderMap, req: Request) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let link_id = segment_before(&req.uri(), "revoke");
    if let Err(e) = device_of(&headers) { return into_response(Err(e)); }
    if let Err(e) = origin_guard(&state, &headers).await { return into_response(Err(e)); }
    let origin = headers.get("origin").and_then(|v| v.to_str().ok()).map(|s| s.to_string());
    into_response(state.app.revoke_link(&link_id, origin.as_deref()).await)
}

async fn api_share_json(State(state): State<AppState>, uri: Uri) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let token = last_segment(&uri);
    into_response(state.app.share_json(&token).await)
}

async fn api_search(State(state): State<AppState>, uri: Uri) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    let q = uri.query().and_then(|q| q.split_once("q=")).map(|(_, v)| v.to_string()).unwrap_or_default();
    into_response(state.app.search(&urldecode(&q)).await)
}

async fn api_export(State(state): State<AppState>) -> Response {
    if !state.boot.load(Ordering::SeqCst) { return not_ready(); }
    into_response(state.app.export_csv().await)
}

// ---------- pages and assets ----------

async fn page_handler(State(state): State<AppState>) -> Response {
    html_response(state.assets.index.clone())
}

/// The report link page: the HTML shell carries the server's verdict,
/// and the page's own re-checks take over from there.
async fn share_page(State(state): State<AppState>, uri: Uri) -> Response {
    let token = last_segment(&uri);
    let verdict = match state.app.share_status(&token).await {
        Ok(()) => "active",
        Err(e) if e.status == 410 => "inactive",
        Err(_) => "missing",
    };
    let mut page = String::from_utf8_lossy(&state.assets.index).into_owned();
    if let Some(pos) = page.find("</head>") {
        page.insert_str(pos, &format!("<meta name=\"share-status\" content=\"{verdict}\">"));
    }
    html_response(page.into_bytes())
}

async fn asset_or_404(State(state): State<AppState>, uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    match state.assets.files.get(path) {
        Some((mime, bytes)) => Response::builder()
            .status(StatusCode::OK)
            .header("content-type", mime.as_str())
            .header("cache-control", "no-store")
            .body(Body::from(bytes.clone()))
            .unwrap_or_else(|_| Response::new(Body::empty())),
        None => not_found_response(),
    }
}

async fn fallback_404() -> Response {
    not_found_response()
}

fn not_found_response() -> Response {
    json_status(StatusCode::NOT_FOUND, &json!({"error": {"code": "not_found", "message": "Not found"}}))
}
