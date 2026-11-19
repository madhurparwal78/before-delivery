use super::{
    base_url, broadcast, check_json_size, created, event, ok, parse_json_body, require_device,
    AppState,
};
use crate::db;
use crate::domain::link::{self, LinkStatus};
use crate::error::{ApiError, ApiResult};
use crate::model::{
    self, link_from_row, link_json, pen_payload, public_defect_json, require_pen, stamp,
    LinkRecord, LINK_COLUMNS,
};
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::Response;
use axum::body::Bytes;
use chrono::Utc;
use deadpool_postgres::GenericClient;
use serde_json::{json, Value};

async fn load_link<C: GenericClient>(client: &C, link_id: &str) -> ApiResult<LinkRecord> {
    let sql = format!("select {LINK_COLUMNS} from report_links where id = $1");
    let rows = client.query(sql.as_str(), &[&link_id]).await?;
    rows.first()
        .map(link_from_row)
        .ok_or_else(ApiError::not_found)
}

/// Regenerate, revoke and status reads are applied one at a time per link.
async fn load_link_for_update<C: GenericClient>(
    client: &C,
    link_id: &str,
) -> ApiResult<LinkRecord> {
    let sql = format!("select {LINK_COLUMNS} from report_links where id = $1 for update");
    let rows = client.query(sql.as_str(), &[&link_id]).await?;
    rows.first()
        .map(link_from_row)
        .ok_or_else(ApiError::not_found)
}

pub async fn list_links(
    State(state): State<AppState>,
    Path(pen_id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    require_pen(&client, &pen_id).await?;
    let now = Utc::now();
    let sql = format!(
        "select {LINK_COLUMNS} from report_links where pen_id = $1 order by created_at desc, id desc"
    );
    let rows = client.query(sql.as_str(), &[&pen_id]).await?;
    let base = base_url(&state, &headers);
    Ok(ok(json!({
        "server_now": stamp(now),
        "links": rows
            .iter()
            .map(|row| link_json(&link_from_row(row), now, &base))
            .collect::<Vec<Value>>(),
    })))
}

pub async fn create_link(
    State(state): State<AppState>,
    Path(pen_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    check_json_size(&body)?;
    let client = state.pool.get().await?;
    let pen = require_pen(&client, &pen_id).await?;
    let device = require_device(&client, &headers).await?;
    let payload = parse_json_body(&body)?;
    let seconds = link::parse_expires_in_seconds(payload.get("expires_in_seconds"))?;
    let now = Utc::now();
    let expires_at = now + chrono::Duration::seconds(seconds);
    let id = db::next_id(&client, "link", "L").await?;
    let token = link::new_token();
    client
        .execute(
            "insert into report_links(id, pen_id, farm_id, token, created_at, expires_at, revoked) \
             values ($1,$2,$3,$4,$5,$6,false)",
            &[&id, &pen.id, &pen.farm_id, &token, &now, &expires_at],
        )
        .await?;
    client
        .execute(
            "insert into report_link_tokens(token, link_id) values ($1,$2)",
            &[&token, &id],
        )
        .await?;
    let record = load_link(&client, &id).await?;
    let body = link_json(&record, now, &base_url(&state, &headers));
    broadcast(
        &state,
        event(
            "link.created",
            Some(&device),
            vec![
                ("pen_id", Value::String(pen.id.clone())),
                ("link_id", Value::String(id)),
            ],
        ),
    )
    .await;
    Ok(created(json!({"link": body})))
}

pub async fn regenerate_link(
    State(state): State<AppState>,
    Path(link_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    check_json_size(&body)?;
    let mut client = state.pool.get().await?;
    load_link(&client, &link_id).await?;
    let device = require_device(&client, &headers).await?;
    let payload = parse_json_body(&body)?;
    let now = Utc::now();
    let transaction = client.transaction().await?;
    let record = load_link_for_update(&transaction, &link_id).await?;
    if link::status(record.revoked, record.expires_at, now) != LinkStatus::Active {
        return Err(ApiError::conflict("link_state", link::INACTIVE_MESSAGE));
    }
    let token = payload
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::validation("token", "The link's current token is required"))?;
    if token != record.token {
        return Err(ApiError::conflict(
            "link_state",
            link::CHANGED_ELSEWHERE_MESSAGE,
        ));
    }
    let fresh = link::new_token();
    transaction
        .execute(
            "update report_links set token = $2 where id = $1",
            &[&link_id, &fresh],
        )
        .await?;
    transaction
        .execute(
            "insert into report_link_tokens(token, link_id) values ($1,$2)",
            &[&fresh, &link_id],
        )
        .await?;
    let updated = load_link_for_update(&transaction, &link_id).await?;
    let body = link_json(&updated, now, &base_url(&state, &headers));
    transaction.commit().await?;
    broadcast(
        &state,
        event(
            "link.regenerated",
            Some(&device),
            vec![
                ("pen_id", Value::String(updated.pen_id.clone())),
                ("link_id", Value::String(link_id)),
            ],
        ),
    )
    .await;
    Ok(ok(json!({"link": body})))
}

pub async fn revoke_link(
    State(state): State<AppState>,
    Path(link_id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let mut client = state.pool.get().await?;
    load_link(&client, &link_id).await?;
    let device = require_device(&client, &headers).await?;
    let now = Utc::now();
    let transaction = client.transaction().await?;
    load_link_for_update(&transaction, &link_id).await?;
    transaction
        .execute(
            "update report_links set revoked = true where id = $1",
            &[&link_id],
        )
        .await?;
    let updated = load_link_for_update(&transaction, &link_id).await?;
    let body = link_json(&updated, now, &base_url(&state, &headers));
    transaction.commit().await?;
    broadcast(
        &state,
        event(
            "link.revoked",
            Some(&device),
            vec![
                ("pen_id", Value::String(updated.pen_id.clone())),
                ("link_id", Value::String(link_id)),
            ],
        ),
    )
    .await;
    Ok(ok(json!({"link": body})))
}

pub enum TokenState {
    Active(LinkRecord),
    Inactive,
    Unknown,
}

/// An unknown token, or one whose farm was erased, is unknown. A revoked,
/// expired or regenerated-away token is inactive.
pub async fn resolve_token<C: GenericClient>(
    client: &C,
    token: &str,
    now: chrono::DateTime<Utc>,
) -> ApiResult<TokenState> {
    let rows = client
        .query(
            "select link_id from report_link_tokens where token = $1",
            &[&token],
        )
        .await?;
    let Some(row) = rows.first() else {
        return Ok(TokenState::Unknown);
    };
    let link_id: String = row.get(0);
    let sql = format!("select {LINK_COLUMNS} from report_links where id = $1");
    let links = client.query(sql.as_str(), &[&link_id]).await?;
    let Some(record) = links.first().map(link_from_row) else {
        return Ok(TokenState::Unknown);
    };
    if record.token != token
        || link::status(record.revoked, record.expires_at, now) != LinkStatus::Active
    {
        return Ok(TokenState::Inactive);
    }
    Ok(TokenState::Active(record))
}

pub async fn share(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let now = Utc::now();
    let record = match resolve_token(&client, &token, now).await? {
        TokenState::Active(record) => record,
        TokenState::Inactive => return Err(ApiError::link_inactive()),
        TokenState::Unknown => return Err(ApiError::not_found()),
    };
    let pen = require_pen(&client, &record.pen_id).await?;
    let detail = pen_payload(&client, &state.live, &pen, true).await?;
    let defects = model::load_pen_defects(&client, &pen.id).await?;
    let ids: Vec<String> = defects.iter().map(|defect| defect.id.clone()).collect();
    let repairs = model::load_repairs(&client, &ids).await?;
    let grid = pen.grid();
    let public: Vec<Value> = defects
        .iter()
        .map(|defect| {
            let own: Vec<Value> = repairs
                .iter()
                .filter(|(owner, _)| owner == &defect.id)
                .map(|(_, value)| value.clone())
                .collect();
            public_defect_json(defect, grid, &own)
        })
        .collect();
    let status = link::status(record.revoked, record.expires_at, now);
    Ok(ok(json!({
        "pen": {
            "name": pen.name,
            "site_name": pen.site_name,
            "farm_name": pen.farm_name,
            "circumference_m": pen.circumference_m,
            "net_depth_m": pen.net_depth_m,
            "grid": pen.grid_json(),
        },
        "grade": detail.get("grade").cloned().unwrap_or(Value::Null),
        "open_defects": detail.get("open_defects").cloned().unwrap_or(Value::Null),
        "max_fouling_cover_pct": detail
            .get("max_fouling_cover_pct")
            .cloned()
            .unwrap_or(Value::Null),
        "panels": detail.get("panels").cloned().unwrap_or(Value::Null),
        "defects": public,
        "latest_revision": detail.get("latest_revision").cloned().unwrap_or(Value::Null),
        "link": {
            "status": status.as_str(),
            "expires_at": stamp(record.expires_at),
            "expires_in_s": link::expires_in_s(status, record.expires_at, now),
        },
    })))
}
