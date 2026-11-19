//! The built frontend, the report link pages and the live-update stream.

use crate::app::{Ctx, Shared};
use crate::error::ApiError;
use crate::reports::{share_data, Share};
use axum::body::Body;
use axum::http::{header, Response};
use std::path::PathBuf;
use tokio::sync::broadcast::error::RecvError;

pub struct Assets {
    root: PathBuf,
}

const CONSOLE_ROUTES: [&str; 5] = ["dives", "imports", "reports", "devices", "pens"];

impl Assets {
    pub fn load() -> Result<Assets, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let beside = exe.ancestors().nth(3).map(|root| root.join("web").join("dist"));
        let root = beside.filter(|p| p.join("index.html").is_file()).unwrap_or_else(|| PathBuf::from("web/dist"));
        if !root.join("index.html").is_file() {
            return Err(format!("frontend build not found in {}", root.display()));
        }
        Ok(Assets { root })
    }

    /// The shell page, read per request so a rebuilt frontend is served at once.
    async fn index(&self) -> Option<String> {
        tokio::fs::read_to_string(self.root.join("index.html")).await.ok()
    }
}

fn content_type(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("") {
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "woff2" => "font/woff2",
        "svg" => "image/svg+xml",
        "json" => "application/json",
        "html" => "text/html; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn page(status: u16, html: String) -> Response<Body> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(html))
        .unwrap_or_default()
}

fn with_message(index: &str, message: &str) -> String {
    index.replace("<div id=\"root\"></div>", &format!("<div id=\"root\"><main class=\"boot-message\"><h1>{message}</h1></main></div>"))
}

pub async fn serve(assets: &Assets, ctx: &mut Ctx) -> Response<Body> {
    let parts: Vec<&str> = ctx.path.trim_matches('/').split('/').collect();
    let Some(index) = assets.index().await else { return crate::error_response(&ApiError::not_found()) };
    match parts.as_slice() {
        ["r", token] => match share_data(&ctx.app, token).await {
            Ok(Share::Active(_)) => page(200, index),
            Ok(Share::Inactive) => page(410, with_message(&index, "This report link is no longer active")),
            Ok(Share::Unknown) => page(404, with_message(&index, "This report link does not exist")),
            Err(error) => crate::error_response(&error),
        },
        [""] => page(200, index),
        [first, ..] if CONSOLE_ROUTES.contains(first) && (parts.len() == 1 || *first == "pens" && parts.len() == 2) => page(200, index),
        ["assets", name] if !name.contains("..") => file(assets, &format!("assets/{name}"), true).await,
        ["fonts", name] if !name.contains("..") && name.ends_with(".woff2") => file(assets, &format!("fonts/{name}"), true).await,
        [name] if !name.contains("..") && name.contains('.') && *name != "index.html" => file(assets, name, false).await,
        _ => crate::error_response(&ApiError::not_found()),
    }
}

async fn file(assets: &Assets, name: &str, immutable: bool) -> Response<Body> {
    match tokio::fs::read(assets.root.join(name)).await {
        Ok(bytes) => Response::builder()
            .header(header::CONTENT_TYPE, content_type(name))
            .header(header::CACHE_CONTROL, if immutable { "public, max-age=31536000, immutable" } else { "no-cache" })
            .body(Body::from(bytes))
            .unwrap_or_default(),
        Err(_) => crate::error_response(&ApiError::not_found()),
    }
}

/// Relays every event published on the Valkey channel to one open console, with a comment ping every 15 seconds.
pub fn event_stream(app: &Shared) -> Response<Body> {
    let receiver = app.events.subscribe();
    let first = futures_util::stream::once(async { Ok::<_, std::convert::Infallible>(bytes::Bytes::from_static(b": connected\n\n")) });
    let rest = futures_util::stream::unfold(receiver, |mut receiver| async move {
        let chunk = loop {
            match tokio::time::timeout(std::time::Duration::from_secs(15), receiver.recv()).await {
                Ok(Ok(payload)) => break bytes::Bytes::from(format!("data: {payload}\n\n")),
                Ok(Err(RecvError::Lagged(_))) => break bytes::Bytes::from_static(b"data: {\"type\":\"resync\"}\n\n"),
                Ok(Err(RecvError::Closed)) => return None,
                Err(_) => break bytes::Bytes::from_static(b": ping\n\n"),
            }
        };
        Some((Ok::<_, std::convert::Infallible>(chunk), receiver))
    });
    use futures_util::StreamExt;
    Response::builder()
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from_stream(first.chain(rest)))
        .unwrap_or_default()
}
