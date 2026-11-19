use super::{links::TokenState, AppState};
use crate::error::ApiResult;
use axum::extract::{Path, Request, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::Utc;

const DIST: &str = "web/dist";

fn content_type(path: &str) -> &'static str {
    match path.rsplit_once('.').map(|(_, extension)| extension) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("woff2") => "font/woff2",
        Some("png") => "image/png",
        Some("ico") => "image/x-icon",
        _ => "application/octet-stream",
    }
}

async fn read_asset(relative: &str) -> Option<Vec<u8>> {
    if relative.contains("..") {
        return None;
    }
    tokio::fs::read(format!("{DIST}/{relative}")).await.ok()
}

async fn shell(status: StatusCode) -> Response {
    match read_asset("index.html").await {
        Some(bytes) => (
            status,
            [(header::CONTENT_TYPE, content_type("index.html"))],
            bytes,
        )
            .into_response(),
        None => (
            StatusCode::INTERNAL_SERVER_ERROR,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            "The Pensight console has not been built",
        )
            .into_response(),
    }
}

/// Only the built frontend assets, the API and the report link pages are
/// served.
pub async fn static_asset(request: Request) -> Response {
    let path = request.uri().path().trim_start_matches('/').to_string();
    if !path.is_empty() {
        if let Some(bytes) = read_asset(&path).await {
            return (
                StatusCode::OK,
                [(header::CONTENT_TYPE, content_type(&path))],
                bytes,
            )
                .into_response();
        }
    }
    shell(StatusCode::OK).await
}

pub async fn report_link_page(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let status = match super::links::resolve_token(&client, &token, Utc::now()).await? {
        TokenState::Active(_) => StatusCode::OK,
        TokenState::Inactive => StatusCode::GONE,
        TokenState::Unknown => StatusCode::NOT_FOUND,
    };
    Ok(shell(status).await)
}
