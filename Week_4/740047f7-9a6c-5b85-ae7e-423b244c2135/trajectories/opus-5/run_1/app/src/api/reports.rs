use super::{
    broadcast, check_json_size, created, event, ok, parse_json_body, raw_response, require_device,
    AppState,
};
use crate::error::{ApiError, ApiResult};
use crate::history::Device;
use crate::model::{self, pen_payload, require_pen, stamp};
use crate::report;
use crate::valkey::Live;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::Response;
use chrono::{DateTime, Utc};
use deadpool_postgres::GenericClient;
use serde_json::{json, Value};

/// Publish and Restore are refused while another device holds the lock on one
/// of the pen's defects.
pub async fn check_pen_locks<C: GenericClient>(
    client: &C,
    live: &Live,
    pen_id: &str,
    device: &Device,
) -> ApiResult<()> {
    let ids: Vec<String> = client
        .query("select id from defects where pen_id = $1", &[&pen_id])
        .await?
        .iter()
        .map(|row| row.get(0))
        .collect();
    let held = live.lock_holders(&ids).await?;
    let Some((_, lock)) = held.iter().find(|(_, lock)| lock.device_id != device.id) else {
        return Ok(());
    };
    let names = model::device_names(client).await?;
    let name = names
        .iter()
        .find(|(id, _)| *id == lock.device_id)
        .map(|(_, name)| name.clone())
        .unwrap_or_else(|| lock.device_id.clone());
    Err(ApiError::locked(&lock.device_id, &name, lock.expires_in_s))
}

fn revision_json(row: &tokio_postgres::Row) -> Value {
    let published_at: DateTime<Utc> = row.get(1);
    json!({
        "number": row.get::<_, i32>(0),
        "published_at": stamp(published_at),
        "sha256": row.get::<_, String>(2),
        "size_bytes": row.get::<_, i64>(3),
        "grade": {"letter": row.get::<_, String>(4), "label": row.get::<_, String>(5)},
        "open_defects": row.get::<_, i32>(6),
    })
}

const REVISION_COLUMNS: &str =
    "number, published_at, sha256, size_bytes, grade_letter, grade_label, open_defects";

pub async fn list_revisions(
    State(state): State<AppState>,
    Path(pen_id): Path<String>,
) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    require_pen(&client, &pen_id).await?;
    let sql = format!(
        "select {REVISION_COLUMNS} from report_revisions where pen_id = $1 order by number desc"
    );
    let rows = client.query(sql.as_str(), &[&pen_id]).await?;
    Ok(ok(json!({
        "revisions": rows.iter().map(revision_json).collect::<Vec<Value>>()
    })))
}

pub async fn publish_revision(
    State(state): State<AppState>,
    Path(pen_id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let mut client = state.pool.get().await?;
    let pen = require_pen(&client, &pen_id).await?;
    let device = require_device(&client, &headers).await?;
    check_pen_locks(&client, &state.live, &pen_id, &device).await?;

    let now = Utc::now();
    let transaction = client.transaction().await?;
    let next = transaction
        .query_one(
            "select coalesce(max(number), 0) + 1 from report_revisions where pen_id = $1",
            &[&pen_id],
        )
        .await?
        .get::<_, i32>(0);
    let published = report::build(&transaction, &pen, next, now).await?;
    transaction
        .execute(
            "insert into report_revisions(pen_id, number, published_at, sha256, size_bytes, \
             grade_letter, grade_label, open_defects, snapshot) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            &[
                &pen_id,
                &next,
                &now,
                &published.sha256,
                &(published.bytes.len() as i64),
                &published.grade_letter,
                &published.grade_label,
                &(published.open_defects as i32),
                &published.snapshot,
            ],
        )
        .await?;
    state
        .store
        .put(
            &report::object_key(&pen.farm_id, &pen.id, next),
            published.bytes.clone(),
            "application/json",
        )
        .await?;
    transaction.commit().await?;
    let revision = json!({
        "number": next,
        "published_at": stamp(now),
        "sha256": published.sha256,
        "size_bytes": published.bytes.len(),
        "grade": {"letter": published.grade_letter, "label": published.grade_label},
        "open_defects": published.open_defects,
    });
    broadcast(
        &state,
        event(
            "revision.published",
            Some(&device),
            vec![
                ("pen_id", Value::String(pen_id)),
                ("pen_name", Value::String(pen.name.clone())),
                ("revision", revision.clone()),
            ],
        ),
    )
    .await;
    Ok(created(json!({"revision": revision})))
}

pub async fn download_pack(
    State(state): State<AppState>,
    Path((pen_id, number)): Path<(String, String)>,
) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let pen = require_pen(&client, &pen_id).await?;
    let number: i32 = number.parse().map_err(|_| ApiError::not_found())?;
    let rows = client
        .query(
            "select sha256 from report_revisions where pen_id = $1 and number = $2",
            &[&pen_id, &number],
        )
        .await?;
    let row = rows.first().ok_or_else(ApiError::not_found)?;
    let bytes = state
        .store
        .get(&report::object_key(&pen.farm_id, &pen.id, number))
        .await?
        .ok_or_else(ApiError::not_found)?;
    Ok(raw_response(
        bytes,
        "application/json",
        &row.get::<_, String>(0),
        &format!("{pen_id}-revision-{number}.json"),
    ))
}

pub async fn restore_revision(
    State(state): State<AppState>,
    Path(pen_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    check_json_size(&body)?;
    let mut client = state.pool.get().await?;
    let pen = require_pen(&client, &pen_id).await?;
    let device = require_device(&client, &headers).await?;
    let payload = parse_json_body(&body)?;
    let number = payload
        .get("revision")
        .and_then(Value::as_i64)
        .ok_or_else(|| ApiError::validation("revision", "A revision number is required"))?
        as i32;
    let snapshot: Value = client
        .query(
            "select snapshot from report_revisions where pen_id = $1 and number = $2",
            &[&pen_id, &number],
        )
        .await?
        .first()
        .map(|row| row.get(0))
        .ok_or_else(ApiError::not_found)?;
    check_pen_locks(&client, &state.live, &pen_id, &device).await?;

    let now = Utc::now();
    let transaction = client.transaction().await?;
    report::restore(&transaction, &pen, number, &snapshot, &device, now).await?;
    let pen_json = pen_payload(&transaction, &state.live, &pen, true).await?;
    transaction.commit().await?;
    broadcast(
        &state,
        event(
            "pen.restored",
            Some(&device),
            vec![
                ("pen_id", Value::String(pen_id)),
                ("pen_name", Value::String(pen.name.clone())),
                ("revision", Value::from(number)),
                ("pen", pen_json.clone()),
            ],
        ),
    )
    .await;
    Ok(ok(json!({"pen": pen_json})))
}
