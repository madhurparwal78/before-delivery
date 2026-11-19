mod app;
mod config;
mod copilot;
mod db;
mod defects;
mod dives;
mod error;
mod imports;
mod model;
mod pens;
mod reports;
mod rules;
mod s3;
mod valkey;
mod web;

use app::{App, Ctx, Device, Reply, Shared};
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, Response, StatusCode};
use axum::Router;
use config::Config;
use error::{ApiError, ApiResult};
use serde_json::json;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, OnceCell};

const BOOT_BUDGET: Duration = Duration::from_secs(60);

#[derive(Clone)]
struct Boot {
    ready: Arc<OnceCell<Shared>>,
    assets: Arc<web::Assets>,
}

fn json_response(status: u16, body: &serde_json::Value) -> Response<Body> {
    Response::builder()
        .status(StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR))
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
        .body(Body::from(body.to_string()))
        .unwrap_or_default()
}

pub fn error_response(error: &ApiError) -> Response<Body> {
    json_response(error.status, &error.body())
}

fn render(reply: Reply) -> Response<Body> {
    match reply {
        Reply::Json(status, body) => json_response(status, &body),
        Reply::NoContent => Response::builder().status(204).body(Body::empty()).unwrap_or_default(),
        Reply::Raw { content_type, sha256, body, download } => {
            let mut builder = Response::builder().status(200).header(header::CONTENT_TYPE, content_type);
            if let Some(sha) = sha256 {
                builder = builder.header("X-Content-SHA256", sha);
            }
            if let Some(name) = download {
                let safe: String = name.chars().map(|c| if c.is_ascii_graphic() && c != '"' && c != '\\' { c } else { '_' }).collect();
                builder = builder.header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{safe}\""));
            }
            builder.body(Body::from(body)).unwrap_or_default()
        }
    }
}

fn app_origin(ctx: &Ctx) -> String {
    if let Some(origin) = ctx.app.cfg.public_origin() {
        return origin;
    }
    format!("http://{}", ctx.header("host").unwrap_or_default().to_lowercase())
}

fn is_write(method: &str) -> bool {
    matches!(method, "POST" | "PATCH" | "DELETE")
}

async fn dispatch(ctx: &mut Ctx) -> ApiResult<Reply> {
    let path = ctx.path.clone();
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    let method = ctx.method.clone();
    match (method.as_str(), parts.as_slice()) {
        ("GET", ["api", "health"]) => app::ok(json!({"status": "ok"})),
        ("GET", ["api", "devices"]) => pens::devices(ctx).await,
        ("POST", ["api", "devices", id, "heartbeat"]) => pens::heartbeat(ctx, id).await,
        ("GET", ["api", "farms"]) => pens::farms(ctx).await,
        ("DELETE", ["api", "farms", id]) => pens::erase_farm(ctx, id).await,
        ("GET", ["api", "farms", id, "imports"]) => imports::list(ctx, id).await,
        ("POST", ["api", "farms", id, "imports"]) => imports::import(ctx, id).await,
        ("GET", ["api", "imports", id, "raw"]) => imports::raw(ctx, id).await,
        ("GET", ["api", "pens"]) => pens::pens(ctx).await,
        ("GET", ["api", "pens", id]) => pens::pen(ctx, id).await,
        ("POST", ["api", "pens", id, "defects"]) => defects::create(ctx, id).await,
        ("POST", ["api", "pens", id, "copilot"]) => copilot::ask(ctx, id).await,
        ("GET", ["api", "pens", id, "reports"]) => reports::list(ctx, id).await,
        ("POST", ["api", "pens", id, "reports"]) => reports::publish(ctx, id).await,
        ("GET", ["api", "pens", id, "reports", n, "pack"]) => reports::pack(ctx, id, n).await,
        ("POST", ["api", "pens", id, "restore"]) => reports::restore(ctx, id).await,
        ("GET", ["api", "pens", id, "links"]) => reports::links(ctx, id).await,
        ("POST", ["api", "pens", id, "links"]) => reports::create_link(ctx, id).await,
        ("GET", ["api", "defects", id]) => defects::get(ctx, id).await,
        ("PATCH", ["api", "defects", id]) => defects::patch(ctx, id).await,
        ("DELETE", ["api", "defects", id]) => defects::delete(ctx, id).await,
        ("GET", ["api", "defects", id, "history"]) => defects::history(ctx, id).await,
        ("POST", ["api", "defects", id, "lock"]) => defects::lock(ctx, id).await,
        ("DELETE", ["api", "defects", id, "lock"]) => defects::unlock(ctx, id).await,
        ("POST", ["api", "defects", id, "stills"]) => defects::attach_still(ctx, id).await,
        ("POST", ["api", "defects", id, "repairs"]) => defects::repair(ctx, id).await,
        ("GET", ["api", "stills", id, "raw"]) => defects::still_raw(ctx, id).await,
        ("POST", ["api", "proposals", id, "apply"]) => copilot::apply(ctx, id).await,
        ("GET", ["api", "dives"]) => dives::list(ctx).await,
        ("POST", ["api", "dives"]) => dives::plan(ctx).await,
        ("GET", ["api", "dives", id]) => dives::get(ctx, id).await,
        ("POST", ["api", "dives", id, "clearance"]) => dives::clearance(ctx, id).await,
        ("POST", ["api", "dives", id, "start"]) => dives::start(ctx, id).await,
        ("POST", ["api", "dives", id, "finish"]) => dives::finish(ctx, id).await,
        ("POST", ["api", "dives", id, "sonar"]) => dives::attach_sonar(ctx, id).await,
        ("GET", ["api", "sonar", id, "raw"]) => dives::sonar_raw(ctx, id).await,
        ("POST", ["api", "links", id, "regenerate"]) => reports::regenerate(ctx, id).await,
        ("POST", ["api", "links", id, "revoke"]) => reports::revoke(ctx, id).await,
        ("GET", ["api", "share", token]) => reports::share(ctx, token).await,
        ("GET", ["api", "search"]) => pens::search(ctx).await,
        ("GET", ["api", "exports", "defects.csv"]) => pens::export(ctx).await,
        _ => Err(ApiError::not_found()),
    }
}

/// Method and path alone decide 405; a write from a foreign origin is refused before anything else.
fn gate(ctx: &Ctx) -> ApiResult<()> {
    let parts: Vec<&str> = ctx.path.trim_matches('/').split('/').collect();
    let report_link = matches!(parts.as_slice(), ["api", "share", _] | ["r", _]);
    if report_link && ctx.method != "GET" {
        return Err(ApiError::read_only());
    }
    if is_write(&ctx.method) && ctx.path.starts_with("/api") {
        if let Some(origin) = ctx.header("origin") {
            if origin.to_lowercase() != app_origin(ctx) {
                return Err(ApiError::cross_origin());
            }
        }
    }
    Ok(())
}

async fn handle(State(boot): State<Boot>, request: Request) -> Response<Body> {
    let (parts, body) = request.into_parts();
    let path = parts.uri.path().to_string();
    let Some(app) = boot.ready.get().cloned() else {
        if path == "/api/health" {
            return json_response(503, &json!({"status": "starting"}));
        }
        return error_response(&ApiError::starting());
    };
    let mut ctx = Ctx {
        app: app.clone(),
        method: parts.method.as_str().to_string(),
        path: path.clone(),
        query: parts.uri.query().unwrap_or("").to_string(),
        headers: parts.headers,
        body: Some(body),
    };
    if let Err(error) = gate(&ctx) {
        return error_response(&error);
    }
    if path == "/api/events" && ctx.method == "GET" {
        return web::event_stream(&app);
    }
    if path.starts_with("/api") {
        return match dispatch(&mut ctx).await {
            Ok(reply) => render(reply),
            Err(error) => error_response(&error),
        };
    }
    web::serve(&boot.assets, &mut ctx).await
}

async fn connect(cfg: &Config) -> Result<Shared, String> {
    let pg: tokio_postgres::Config = cfg.database_url.parse().map_err(|e: tokio_postgres::Error| e.to_string())?;
    let manager = deadpool_postgres::Manager::new(pg, tokio_postgres::NoTls);
    let pool = deadpool_postgres::Pool::builder(manager).max_size(24).build().map_err(|e| e.to_string())?;
    {
        let mut client = pool.get().await.map_err(|e| e.to_string())?;
        let tx = client.transaction().await.map_err(|e| e.to_string())?;
        tx.execute("SELECT pg_advisory_xact_lock(7340000)", &[]).await.map_err(|e| e.to_string())?;
        db::migrate(&tx).await?;
        tx.commit().await.map_err(|e| e.to_string())?;
    }
    let s3 = s3::S3::new(&cfg.s3_endpoint, &cfg.s3_region, &cfg.s3_bucket, &cfg.s3_access_key_id, &cfg.s3_secret_access_key)?;
    s3.ensure_bucket().await?;
    let valkey = valkey::Valkey::new(&cfg.valkey_url)?;
    valkey.ping().await?;
    db::seed(&pool, &s3).await?;
    let devices = {
        let client = pool.get().await.map_err(|e| e.to_string())?;
        let rows = client.query("SELECT id, name FROM devices ORDER BY ord", &[]).await.map_err(|e| e.to_string())?;
        rows.iter().map(|r| Device { id: r.get(0), name: r.get(1) }).collect()
    };
    let (events, _) = broadcast::channel(256);
    let http = reqwest::Client::builder().build().map_err(|e| e.to_string())?;
    Ok(Arc::new(App { cfg: cfg.clone(), pool, s3, valkey, http, events, devices }))
}

async fn boot_services(cfg: Arc<Config>, ready: Arc<OnceCell<Shared>>) {
    let started = Instant::now();
    loop {
        match connect(&cfg).await {
            Ok(app) => {
                let relay = app.clone();
                tokio::spawn(async move {
                    let sender = relay.events.clone();
                    relay
                        .valkey
                        .subscribe_forever(move |payload| {
                            let _ = sender.send(payload);
                        })
                        .await;
                });
                let _ = ready.set(app);
                return;
            }
            Err(error) if started.elapsed() < BOOT_BUDGET => {
                eprintln!("waiting for services: {error}");
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            Err(error) => {
                eprintln!("services did not become ready within 60 seconds: {error}");
                std::process::exit(1);
            }
        }
    }
}

#[tokio::main]
async fn main() {
    let cfg = match Config::from_env() {
        Ok(cfg) => Arc::new(cfg),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };
    let assets = match web::Assets::load() {
        Ok(assets) => Arc::new(assets),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };
    let ready = Arc::new(OnceCell::new());
    tokio::spawn(boot_services(cfg.clone(), ready.clone()));
    let boot = Boot { ready, assets };
    let router: Router = Router::new().fallback(handle).with_state(boot);
    let listener = match tokio::net::TcpListener::bind(("0.0.0.0", cfg.port)).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("cannot bind port {}: {error}", cfg.port);
            std::process::exit(1);
        }
    };
    if let Err(error) = axum::serve(listener, router).await {
        eprintln!("server stopped: {error}");
        std::process::exit(1);
    }
}
