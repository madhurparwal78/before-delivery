use super::{
    broadcast, check_json_size, check_upload, created, event, file_name, ok, parse_json_body,
    raw_response, require_device, AppState, STILL_LIMIT,
};
use crate::db;
use crate::domain::copilot::METHODS;
use crate::domain::position::{self, WallPoint};
use crate::domain::size::{self, DefectType};
use crate::domain::text;
use crate::error::{ApiError, ApiResult};
use crate::history::{self, Device};
use crate::model::{
    self, defect_json, load_defect, load_defect_for_update, pen_payload, placeholder_json,
    require_pen, DefectRecord,
};
use crate::store::s3::sha256_hex;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::Utc;
use deadpool_postgres::GenericClient;
use serde_json::{json, Map, Value};

/// While one device holds a defect's lock, another device's write gets 423.
pub async fn check_lock<C: GenericClient>(
    client: &C,
    state: &AppState,
    defect_id: &str,
    device: &Device,
) -> ApiResult<()> {
    let Some(lock) = state.live.lock_holder(defect_id).await? else {
        return Ok(());
    };
    if lock.device_id == device.id {
        return Ok(());
    }
    let names = model::device_names(client).await?;
    let name = names
        .iter()
        .find(|(id, _)| *id == lock.device_id)
        .map(|(_, name)| name.clone())
        .unwrap_or_else(|| lock.device_id.clone());
    Err(ApiError::locked(&lock.device_id, &name, lock.expires_in_s))
}

fn wall_point(raw: &Value) -> ApiResult<WallPoint> {
    let object = raw
        .as_object()
        .ok_or_else(|| ApiError::validation("wall_point", "A net-wall point is required"))?;
    let coordinate = |key: &str| {
        object
            .get(key)
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
            .ok_or_else(|| ApiError::validation("wall_point", "A net-wall point is required"))
    };
    Ok(WallPoint {
        x_m: coordinate("x_m")?,
        y_m: coordinate("y_m")?,
        z_m: coordinate("z_m")?,
    })
}

fn number_field(payload: &Map<String, Value>, key: &str) -> ApiResult<Option<f64>> {
    match payload.get(key) {
        None => Ok(None),
        Some(Value::Number(number)) => number
            .as_f64()
            .filter(|value| value.is_finite())
            .map(Some)
            .ok_or_else(|| ApiError::validation(key, "A number is required")),
        Some(_) => Err(ApiError::validation(key, "A number is required")),
    }
}

fn note_field(payload: &Map<String, Value>, key: &str, current: &str) -> ApiResult<String> {
    match payload.get(key) {
        None => Ok(current.to_string()),
        Some(Value::String(text)) => {
            text::check_note(key, text)?;
            Ok(text.clone())
        }
        Some(_) => Err(ApiError::validation(key, "Text is required")),
    }
}

pub async fn create_defect(
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

    let raw_type = payload
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::validation("type", "A defect type is required"))?;
    let defect_type = DefectType::parse(raw_type)
        .ok_or_else(|| ApiError::validation("type", "A defect type is required"))?;
    let grid = pen.grid();
    let point = match payload.get("wall_point") {
        Some(raw) => Some(wall_point(raw)?),
        None => None,
    };
    let placed = position::resolve(
        number_field(&payload, "bearing_deg")?,
        point,
        number_field(&payload, "depth_m")?,
        grid,
    )?;
    let size = size::parse_size(defect_type, payload.get("size"))?;
    let note = note_field(&payload, "note", "")?;
    let private_note = note_field(&payload, "private_note", "")?;

    let now = Utc::now();
    let transaction = client.transaction().await?;
    let id = db::next_id(&transaction, "defect", "D").await?;
    let record = DefectRecord {
        id: id.clone(),
        pen_id: pen.id.clone(),
        farm_id: pen.farm_id.clone(),
        defect_type,
        bearing_deg: placed.bearing_deg,
        depth_m: placed.depth_m,
        chart_x_m: placed.chart_x_m,
        chart_y_m: placed.chart_y_m,
        cell: placed.cell,
        size,
        note,
        private_note,
        status: "open".to_string(),
        removed: false,
        version: 1,
        updated_at: now,
    };
    insert_defect(&transaction, &record, now).await?;
    history::write(
        &transaction,
        &record.id,
        &device,
        "created",
        &history::created_changes(&record),
        "new defect",
        now,
    )
    .await?;
    let defect = defect_json(&record, grid, Vec::new(), Vec::new(), None, None);
    let pen_json = pen_payload(&transaction, &state.live, &pen, true).await?;
    transaction.commit().await?;
    broadcast(
        &state,
        event(
            "defect.created",
            Some(&device),
            vec![
                ("pen_id", Value::String(pen.id.clone())),
                ("pen_name", Value::String(pen.name.clone())),
                ("defect_id", Value::String(record.id.clone())),
                ("defect", defect.clone()),
                ("pen", pen_json.clone()),
            ],
        ),
    )
    .await;
    Ok(created(json!({"defect": defect, "pen": pen_json})))
}

pub async fn insert_defect<C: GenericClient>(
    client: &C,
    record: &DefectRecord,
    now: chrono::DateTime<Utc>,
) -> ApiResult<()> {
    client
        .execute(
            "insert into defects(id, pen_id, farm_id, type, bearing_deg, depth_m, chart_x_m, \
             chart_y_m, cell, size, note, private_note, status, removed, version, created_at, updated_at) \
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false,$14,$15,$15)",
            &[
                &record.id,
                &record.pen_id,
                &record.farm_id,
                &record.defect_type.as_str(),
                &record.bearing_deg,
                &record.depth_m,
                &record.chart_x_m,
                &record.chart_y_m,
                &record.cell,
                &record.size.to_json(),
                &record.note,
                &record.private_note,
                &record.status,
                &record.version,
                &now,
            ],
        )
        .await?;
    Ok(())
}

pub async fn full_defect<C: GenericClient>(
    client: &C,
    state: &AppState,
    defect: &DefectRecord,
    grid: crate::domain::position::PenGrid,
) -> ApiResult<Value> {
    let ids = vec![defect.id.clone()];
    let repairs = model::load_repairs(client, &ids).await?;
    let stills = model::load_stills(client, &ids).await?;
    let lock = state.live.lock_holder(&defect.id).await?;
    let names = model::device_names(client).await?;
    let lock_name = lock.as_ref().and_then(|lock| {
        names
            .iter()
            .find(|(id, _)| *id == lock.device_id)
            .map(|(_, name)| name.clone())
    });
    Ok(defect_json(
        defect,
        grid,
        repairs.into_iter().map(|(_, value)| value).collect(),
        stills.into_iter().map(|(_, value)| value).collect(),
        lock.as_ref(),
        lock_name.as_deref(),
    ))
}

pub async fn get_defect(
    State(state): State<AppState>,
    Path(defect_id): Path<String>,
) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let defect = load_defect(&client, &defect_id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    if defect.removed {
        return Ok(ok(json!({
            "defect": placeholder_json(&defect.id, &defect.pen_id)
        })));
    }
    let pen = require_pen(&client, &defect.pen_id).await?;
    let body = full_defect(&client, &state, &defect, pen.grid()).await?;
    Ok(ok(json!({"defect": body})))
}

pub async fn get_history(
    State(state): State<AppState>,
    Path(defect_id): Path<String>,
) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    load_defect(&client, &defect_id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    let history = model::history_json(&client, &defect_id).await?;
    Ok(ok(json!({"history": history})))
}

pub async fn patch_defect(
    State(state): State<AppState>,
    Path(defect_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    check_json_size(&body)?;
    let mut client = state.pool.get().await?;
    let existing = load_defect(&client, &defect_id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    let device = require_device(&client, &headers).await?;
    check_lock(&client, &state, &defect_id, &device).await?;
    let pen = require_pen(&client, &existing.pen_id).await?;
    let payload = parse_json_body(&body)?;

    let now = Utc::now();
    let transaction = client.transaction().await?;
    let before = load_defect_for_update(&transaction, &defect_id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    if before.removed {
        return Err(ApiError::conflict(
            "defect_removed",
            format!("{defect_id} was removed"),
        ));
    }
    let version = payload
        .get("version")
        .and_then(Value::as_i64)
        .ok_or_else(|| ApiError::validation("version", "The current version is required"))?;
    if version != i64::from(before.version) {
        return Err(ApiError::conflict(
            "version_conflict",
            format!("{defect_id} changed on another device — reopen to see the latest"),
        ));
    }
    if payload.contains_key("type") {
        return Err(ApiError::validation("type", "Type cannot change"));
    }
    let grid = pen.grid();
    let point = match payload.get("wall_point") {
        Some(raw) => Some(wall_point(raw)?),
        None => None,
    };
    let bearing = number_field(&payload, "bearing_deg")?;
    let depth = number_field(&payload, "depth_m")?;
    let placed = if point.is_some() {
        position::resolve(None, point, None, grid)?
    } else {
        position::resolve(
            Some(bearing.unwrap_or(before.bearing_deg)),
            None,
            Some(depth.unwrap_or(before.depth_m)),
            grid,
        )?
    };
    let size = match payload.get("size") {
        Some(_) => size::parse_size(before.defect_type, payload.get("size"))?,
        None => before.size,
    };
    let note = note_field(&payload, "note", &before.note)?;
    let private_note = note_field(&payload, "private_note", &before.private_note)?;

    let after = DefectRecord {
        bearing_deg: placed.bearing_deg,
        depth_m: placed.depth_m,
        chart_x_m: placed.chart_x_m,
        chart_y_m: placed.chart_y_m,
        cell: placed.cell,
        size,
        note,
        private_note,
        version: before.version + 1,
        updated_at: now,
        ..before.clone()
    };
    transaction
        .execute(
            "update defects set bearing_deg=$2, depth_m=$3, chart_x_m=$4, chart_y_m=$5, cell=$6, \
             size=$7, note=$8, private_note=$9, version=$10, updated_at=$11 where id=$1",
            &[
                &after.id,
                &after.bearing_deg,
                &after.depth_m,
                &after.chart_x_m,
                &after.chart_y_m,
                &after.cell,
                &after.size.to_json(),
                &after.note,
                &after.private_note,
                &after.version,
                &now,
            ],
        )
        .await?;
    history::write(
        &transaction,
        &after.id,
        &device,
        "updated",
        &history::diff_changes(&before, &after),
        "",
        now,
    )
    .await?;
    let defect = full_defect(&transaction, &state, &after, grid).await?;
    let pen_json = pen_payload(&transaction, &state.live, &pen, true).await?;
    transaction.commit().await?;
    broadcast(
        &state,
        event(
            "defect.updated",
            Some(&device),
            vec![
                ("pen_id", Value::String(pen.id.clone())),
                ("pen_name", Value::String(pen.name.clone())),
                ("defect_id", Value::String(after.id.clone())),
                ("defect", defect.clone()),
                ("pen", pen_json.clone()),
            ],
        ),
    )
    .await;
    Ok(ok(json!({"defect": defect, "pen": pen_json})))
}

pub async fn delete_defect(
    State(state): State<AppState>,
    Path(defect_id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let mut client = state.pool.get().await?;
    let existing = load_defect(&client, &defect_id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    let device = require_device(&client, &headers).await?;
    check_lock(&client, &state, &defect_id, &device).await?;
    let pen = require_pen(&client, &existing.pen_id).await?;

    let now = Utc::now();
    let transaction = client.transaction().await?;
    let before = load_defect_for_update(&transaction, &defect_id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    if before.removed {
        return Err(ApiError::conflict(
            "defect_removed",
            format!("{defect_id} was removed"),
        ));
    }
    transaction
        .execute(
            "update defects set removed = true, updated_at = $2 where id = $1",
            &[&defect_id, &now],
        )
        .await?;
    history::write(
        &transaction,
        &defect_id,
        &device,
        "removed",
        &history::no_changes(),
        "",
        now,
    )
    .await?;
    let placeholder = placeholder_json(&defect_id, &pen.id);
    let pen_json = pen_payload(&transaction, &state.live, &pen, true).await?;
    transaction.commit().await?;
    state.live.release_lock(&defect_id, &device.id).await?;
    broadcast(
        &state,
        event(
            "defect.removed",
            Some(&device),
            vec![
                ("pen_id", Value::String(pen.id.clone())),
                ("pen_name", Value::String(pen.name.clone())),
                ("defect_id", Value::String(defect_id.clone())),
                ("defect", placeholder.clone()),
                ("pen", pen_json.clone()),
            ],
        ),
    )
    .await;
    Ok(ok(json!({"defect": placeholder, "pen": pen_json})))
}

pub async fn take_lock(
    State(state): State<AppState>,
    Path(defect_id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let defect = load_defect(&client, &defect_id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    let device = require_device(&client, &headers).await?;
    match state.live.take_lock(&defect_id, &device.id).await? {
        Err(held) => {
            let names = model::device_names(&client).await?;
            let name = names
                .iter()
                .find(|(id, _)| *id == held.device_id)
                .map(|(_, name)| name.clone())
                .unwrap_or_else(|| held.device_id.clone());
            Err(ApiError::locked(&held.device_id, &name, held.expires_in_s))
        }
        Ok(expires_in_s) => {
            if defect.removed {
                state.live.release_lock(&defect_id, &device.id).await?;
                return Err(ApiError::conflict(
                    "defect_removed",
                    format!("{defect_id} was removed"),
                ));
            }
            broadcast(
                &state,
                event(
                    "lock.changed",
                    Some(&device),
                    vec![
                        ("pen_id", Value::String(defect.pen_id.clone())),
                        ("defect_id", Value::String(defect_id.clone())),
                        ("held", Value::Bool(true)),
                    ],
                ),
            )
            .await;
            Ok(ok(json!({
                "lock": {
                    "device_id": device.id,
                    "device_name": device.name,
                    "expires_in_s": expires_in_s,
                }
            })))
        }
    }
}

pub async fn release_lock(
    State(state): State<AppState>,
    Path(defect_id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let defect = load_defect(&client, &defect_id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    let device = require_device(&client, &headers).await?;
    check_lock(&client, &state, &defect_id, &device).await?;
    state.live.release_lock(&defect_id, &device.id).await?;
    broadcast(
        &state,
        event(
            "lock.changed",
            Some(&device),
            vec![
                ("pen_id", Value::String(defect.pen_id.clone())),
                ("defect_id", Value::String(defect_id.clone())),
                ("held", Value::Bool(false)),
            ],
        ),
    )
    .await;
    Ok(StatusCode::NO_CONTENT.into_response())
}

pub async fn upload_still(
    State(state): State<AppState>,
    Path(defect_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    check_upload(&body, STILL_LIMIT, "Still")?;
    let mut client = state.pool.get().await?;
    load_defect(&client, &defect_id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    let device = require_device(&client, &headers).await?;
    check_lock(&client, &state, &defect_id, &device).await?;

    let now = Utc::now();
    let transaction = client.transaction().await?;
    let defect = load_defect_for_update(&transaction, &defect_id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    if defect.removed {
        return Err(ApiError::conflict(
            "defect_removed",
            format!("{defect_id} was removed"),
        ));
    }
    let content_type = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap_or(value).trim().to_string())
        .unwrap_or_default();
    if content_type != "image/jpeg" && content_type != "image/png" {
        return Err(ApiError::validation(
            "content_type",
            "Stills must be JPEG or PNG",
        ));
    }
    if body.is_empty() {
        return Err(ApiError::validation("file", "The upload is empty"));
    }
    let id = db::next_id(&transaction, "still", "S").await?;
    let sha256 = sha256_hex(&body);
    let name = file_name(&headers);
    transaction
        .execute(
            "insert into stills(id, farm_id, defect_id, content_type, size_bytes, sha256, file_name, created_at) \
             values ($1,$2,$3,$4,$5,$6,$7,$8)",
            &[
                &id,
                &defect.farm_id,
                &defect_id,
                &content_type,
                &(body.len() as i64),
                &sha256,
                &name,
                &now,
            ],
        )
        .await?;
    history::write(
        &transaction,
        &defect_id,
        &device,
        "still_attached",
        &history::no_changes(),
        &id,
        now,
    )
    .await?;
    state
        .store
        .put(
            &format!("farms/{}/stills/{id}", defect.farm_id),
            body.to_vec(),
            &content_type,
        )
        .await?;
    transaction.commit().await?;
    let still = json!({
        "id": id,
        "content_type": content_type,
        "size_bytes": body.len(),
        "sha256": sha256,
        "file_name": name,
    });
    broadcast(
        &state,
        event(
            "defect.still_attached",
            Some(&device),
            vec![
                ("pen_id", Value::String(defect.pen_id.clone())),
                ("defect_id", Value::String(defect_id.clone())),
            ],
        ),
    )
    .await;
    Ok(created(json!({"still": still})))
}

pub async fn raw_still(
    State(state): State<AppState>,
    Path(still_id): Path<String>,
) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let rows = client
        .query(
            "select farm_id, content_type, sha256, file_name from stills where id = $1",
            &[&still_id],
        )
        .await?;
    let row = rows.first().ok_or_else(ApiError::not_found)?;
    let farm_id: String = row.get(0);
    let bytes = state
        .store
        .get(&format!("farms/{farm_id}/stills/{still_id}"))
        .await?
        .ok_or_else(ApiError::not_found)?;
    Ok(raw_response(
        bytes,
        &row.get::<_, String>(1),
        &row.get::<_, String>(2),
        &row.get::<_, String>(3),
    ))
}

pub struct RepairOutcome {
    pub repair: Value,
    pub defect: DefectRecord,
}

/// A repair moves a defect from open to repaired. One repair record, whether
/// manual or an applied proposal.
pub async fn apply_repair<C: GenericClient>(
    client: &C,
    device: &Device,
    defect: &DefectRecord,
    method: &str,
    note: &str,
    source: &str,
    proposal_id: Option<&str>,
    now: chrono::DateTime<Utc>,
) -> ApiResult<RepairOutcome> {
    let id = db::next_id(client, "repair", "R").await?;
    client
        .execute(
            "insert into repairs(id, defect_id, method, note, source, proposal_id, recorded_at) \
             values ($1,$2,$3,$4,$5,$6,$7)",
            &[&id, &defect.id, &method, &note, &source, &proposal_id, &now],
        )
        .await?;
    let version = defect.version + 1;
    client
        .execute(
            "update defects set status = 'repaired', version = $2, updated_at = $3 where id = $1",
            &[&defect.id, &version, &now],
        )
        .await?;
    let detail = match proposal_id {
        Some(proposal_id) => format!("{method} (copilot proposal {proposal_id})"),
        None => method.to_string(),
    };
    history::write(
        client,
        &defect.id,
        device,
        "repaired",
        &history::status_change(&defect.status, "repaired"),
        &detail,
        now,
    )
    .await?;
    Ok(RepairOutcome {
        repair: json!({
            "id": id,
            "method": method,
            "note": note,
            "source": source,
            "proposal_id": proposal_id,
            "recorded_at": model::stamp(now),
        }),
        defect: DefectRecord {
            status: "repaired".to_string(),
            version,
            updated_at: now,
            ..defect.clone()
        },
    })
}

pub async fn record_repair(
    State(state): State<AppState>,
    Path(defect_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    check_json_size(&body)?;
    let mut client = state.pool.get().await?;
    let existing = load_defect(&client, &defect_id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    let device = require_device(&client, &headers).await?;
    check_lock(&client, &state, &defect_id, &device).await?;
    let pen = require_pen(&client, &existing.pen_id).await?;
    let payload = parse_json_body(&body)?;

    let now = Utc::now();
    let transaction = client.transaction().await?;
    let defect = load_defect_for_update(&transaction, &defect_id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    if defect.removed {
        return Err(ApiError::conflict(
            "defect_removed",
            format!("{defect_id} was removed"),
        ));
    }
    if defect.status == "repaired" {
        return Err(ApiError::conflict(
            "already_repaired",
            format!("{defect_id} is already repaired"),
        ));
    }
    let method = payload
        .get("method")
        .and_then(Value::as_str)
        .filter(|method| METHODS.contains(method))
        .ok_or_else(|| ApiError::validation("method", "A repair method is required"))?;
    let note = note_field(&payload, "note", "")?;
    let outcome = apply_repair(
        &transaction,
        &device,
        &defect,
        method,
        &note,
        "manual",
        None,
        now,
    )
    .await?;
    let grid = pen.grid();
    let defect_body = full_defect(&transaction, &state, &outcome.defect, grid).await?;
    let pen_json = pen_payload(&transaction, &state.live, &pen, true).await?;
    transaction.commit().await?;
    broadcast(
        &state,
        event(
            "defect.repaired",
            Some(&device),
            vec![
                ("pen_id", Value::String(pen.id.clone())),
                ("pen_name", Value::String(pen.name.clone())),
                ("defect_id", Value::String(defect_id.clone())),
                ("defect", defect_body.clone()),
                ("pen", pen_json.clone()),
            ],
        ),
    )
    .await;
    Ok(created(json!({
        "repair": outcome.repair,
        "defect": defect_body,
        "pen": pen_json,
    })))
}

