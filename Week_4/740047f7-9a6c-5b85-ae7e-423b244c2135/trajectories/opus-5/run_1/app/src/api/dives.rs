use super::{
    check_json_size, check_upload, created, file_name, ok, parse_json_body, raw_response,
    require_device, AppState, SONAR_LIMIT,
};
use crate::db;
use crate::domain::clearance::{self, Decision};
use crate::domain::position;
use crate::error::{ApiError, ApiResult};
use crate::model::{self, dive_from_row, dive_json, require_pen, stamp, DiveRecord, DIVE_COLUMNS};
use crate::providers::forecast::{self, ForecastOutcome};
use crate::store::s3::sha256_hex;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::Response;
use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use deadpool_postgres::GenericClient;
use serde_json::{json, Map, Value};

async fn load_dive<C: GenericClient>(client: &C, dive_id: &str) -> ApiResult<DiveRecord> {
    let sql = format!("select {DIVE_COLUMNS} from dives where id = $1");
    let rows = client.query(sql.as_str(), &[&dive_id]).await?;
    rows.first()
        .map(dive_from_row)
        .ok_or_else(ApiError::not_found)
}

async fn load_dive_for_update<C: GenericClient>(
    client: &C,
    dive_id: &str,
) -> ApiResult<DiveRecord> {
    let sql = format!("select {DIVE_COLUMNS} from dives where id = $1 for update");
    let rows = client.query(sql.as_str(), &[&dive_id]).await?;
    rows.first()
        .map(dive_from_row)
        .ok_or_else(ApiError::not_found)
}

pub async fn list_dives(State(state): State<AppState>) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let now = Utc::now();
    let sql = format!(
        "select {DIVE_COLUMNS} from dives order by created_at desc, id desc"
    );
    let rows = client.query(sql.as_str(), &[]).await?;
    let mut dives = Vec::new();
    for row in &rows {
        let dive = dive_from_row(row);
        dives.push(dive_json(&client, &dive, now).await?);
    }
    Ok(ok(json!({"server_now": stamp(now), "dives": dives})))
}

pub async fn get_dive(
    State(state): State<AppState>,
    Path(dive_id): Path<String>,
) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let now = Utc::now();
    let dive = load_dive(&client, &dive_id).await?;
    Ok(ok(json!({
        "server_now": stamp(now),
        "dive": dive_json(&client, &dive, now).await?
    })))
}

pub async fn plan_dive(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    check_json_size(&body)?;
    let client = state.pool.get().await?;
    require_device(&client, &headers).await?;
    let payload = parse_json_body(&body)?;
    let now = Utc::now();

    let pen_id = payload
        .get("pen_id")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::validation("pen_id", "A pen is required"))?;
    let pen = model::load_pen(&client, pen_id)
        .await?
        .ok_or_else(|| ApiError::validation("pen_id", "A pen is required"))?;
    let planned_start = parse_planned_start(&payload)?;
    if planned_start < now - Duration::minutes(30) || planned_start > now + Duration::hours(48) {
        return Err(ApiError::validation(
            "planned_start",
            "Planned start must be between 30 minutes ago and 48 hours from now",
        ));
    }
    let planned_minutes = payload
        .get("planned_minutes")
        .and_then(Value::as_i64)
        .filter(|minutes| (15..=240).contains(minutes))
        .ok_or_else(|| {
            ApiError::validation("planned_minutes", "Planned minutes must be from 15 to 240")
        })? as i32;
    let certificate = payload
        .get("diver_certificate_no")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.chars().count() <= 40)
        .ok_or_else(|| {
            ApiError::validation(
                "diver_certificate_no",
                "A diver certificate number is required",
            )
        })?;

    let id = db::next_id(&client, "dive", "DIVE").await?;
    client
        .execute(
            "insert into dives(id, pen_id, farm_id, status, planned_start, planned_minutes, \
             diver_certificate_no, clearance, clearance_started_at, started_at, finished_at, track, created_at) \
             values ($1,$2,$3,'planned',$4,$5,$6,null,null,null,null,'[]'::jsonb,$7)",
            &[
                &id,
                &pen.id,
                &pen.farm_id,
                &planned_start,
                &planned_minutes,
                &certificate,
                &now,
            ],
        )
        .await?;
    let dive = load_dive(&client, &id).await?;
    Ok(created(json!({
        "dive": dive_json(&client, &dive, now).await?
    })))
}

fn parse_planned_start(payload: &Map<String, Value>) -> ApiResult<DateTime<Utc>> {
    let raw = payload
        .get("planned_start")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::validation("planned_start", "A planned start is required"))?;
    NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%SZ")
        .map(|naive| naive.and_utc())
        .map_err(|_| {
            ApiError::validation(
                "planned_start",
                "Planned start must be written YYYY-MM-DDTHH:MM:SSZ",
            )
        })
}

pub async fn check_clearance(
    State(state): State<AppState>,
    Path(dive_id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let dive = load_dive(&client, &dive_id).await?;
    require_device(&client, &headers).await?;
    if dive.status != "planned" && dive.status != "cleared" {
        return Err(ApiError::conflict(
            "dive_state",
            if dive.status == "started" {
                "Dive has already started"
            } else {
                "Dive is already recorded"
            },
        ));
    }
    let pen = require_pen(&client, &dive.pen_id).await?;
    let hours = clearance::planned_hours(dive.planned_start, i64::from(dive.planned_minutes));
    let started_at = Utc::now();
    let outcome = forecast::fetch(
        &state.http,
        &state.config.wiremock_url,
        pen.latitude,
        pen.longitude,
        &hours,
    )
    .await;
    let now = Utc::now();
    let (payload, failure) = match outcome {
        ForecastOutcome::Hours {
            issued_at,
            hours: values,
        } => {
            let decision: Decision = clearance::decide(issued_at, &values, now);
            (
                clearance::clearance_json(&decision, now, Some(issued_at), &values),
                None,
            )
        }
        ForecastOutcome::Unavailable { timed_out } => {
            (clearance::unavailable_json(now), Some(timed_out))
        }
    };
    // The latest clearance is the one whose check started last.
    client
        .execute(
            "update dives set clearance = $2, clearance_started_at = $3, status = 'cleared' \
             where id = $1 and status in ('planned','cleared') \
             and (clearance_started_at is null or clearance_started_at < $3)",
            &[&dive_id, &payload, &started_at],
        )
        .await?;
    if let Some(timed_out) = failure {
        return Err(ApiError::provider(
            "forecast_unavailable",
            timed_out,
            clearance::UNAVAILABLE_MESSAGE,
        ));
    }
    let updated = load_dive(&client, &dive_id).await?;
    Ok(ok(json!({
        "dive": dive_json(&client, &updated, now).await?
    })))
}

pub async fn start_dive(
    State(state): State<AppState>,
    Path(dive_id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let mut client = state.pool.get().await?;
    load_dive(&client, &dive_id).await?;
    require_device(&client, &headers).await?;
    let now = Utc::now();
    let transaction = client.transaction().await?;
    let dive = load_dive_for_update(&transaction, &dive_id).await?;
    match dive.status.as_str() {
        "started" => {
            return Err(ApiError::conflict("dive_state", "Dive has already started"))
        }
        "recorded" => {
            return Err(ApiError::conflict("dive_state", "Dive is already recorded"))
        }
        "planned" => {
            return Err(ApiError::conflict(
                "dive_not_cleared",
                "Dive needs a fresh GO before it can start",
            ))
        }
        _ => {}
    }
    let fresh_go = dive
        .clearance
        .as_ref()
        .map(|stored| clearance::rederive(stored, now))
        .and_then(|rederived| {
            rederived
                .get("result")
                .and_then(Value::as_str)
                .map(|result| result == "GO")
        })
        .unwrap_or(false);
    if !fresh_go {
        return Err(ApiError::conflict(
            "dive_not_cleared",
            "Dive needs a fresh GO before it can start",
        ));
    }
    transaction
        .execute(
            "update dives set status = 'started', started_at = $2 where id = $1",
            &[&dive_id, &now],
        )
        .await?;
    let updated = load_dive_for_update(&transaction, &dive_id).await?;
    let body = dive_json(&transaction, &updated, now).await?;
    transaction.commit().await?;
    Ok(ok(json!({"dive": body})))
}

pub async fn finish_dive(
    State(state): State<AppState>,
    Path(dive_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    check_json_size(&body)?;
    let mut client = state.pool.get().await?;
    load_dive(&client, &dive_id).await?;
    require_device(&client, &headers).await?;
    let payload = parse_json_body(&body)?;
    let now = Utc::now();
    let transaction = client.transaction().await?;
    let dive = load_dive_for_update(&transaction, &dive_id).await?;
    if dive.status != "started" {
        return Err(ApiError::conflict("dive_state", "Dive is not running"));
    }
    let pen = require_pen(&transaction, &dive.pen_id).await?;
    let track = parse_track(payload.get("track"), pen.grid())?;
    transaction
        .execute(
            "update dives set status = 'recorded', finished_at = $2, track = $3 where id = $1",
            &[&dive_id, &now, &track],
        )
        .await?;
    let updated = load_dive_for_update(&transaction, &dive_id).await?;
    let body = dive_json(&transaction, &updated, now).await?;
    transaction.commit().await?;
    Ok(ok(json!({"dive": body})))
}

/// Track samples need nondecreasing whole-second `t_s` starting from 0, with
/// bearings and depths following the position rules.
fn parse_track(raw: Option<&Value>, grid: position::PenGrid) -> ApiResult<Value> {
    let samples = raw
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::validation("track", "One to 1,000 track samples are required"))?;
    if samples.is_empty() || samples.len() > 1000 {
        return Err(ApiError::validation(
            "track",
            "One to 1,000 track samples are required",
        ));
    }
    let mut previous = -1i64;
    let mut out = Vec::new();
    for (index, sample) in samples.iter().enumerate() {
        let field = format!("track[{index}]");
        let object = sample
            .as_object()
            .ok_or_else(|| ApiError::validation(&field, "A track sample is required"))?;
        let t_s = object
            .get("t_s")
            .and_then(Value::as_i64)
            .ok_or_else(|| ApiError::validation(&field, "t_s must be a whole second"))?;
        if index == 0 && t_s != 0 {
            return Err(ApiError::validation(&field, "t_s must start from 0"));
        }
        if t_s < previous {
            return Err(ApiError::validation(&field, "t_s must not decrease"));
        }
        previous = t_s;
        let bearing = object
            .get("bearing_deg")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
            .ok_or_else(|| ApiError::validation(&field, "bearing_deg must be a number"))?;
        let depth = object
            .get("depth_m")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
            .ok_or_else(|| ApiError::validation(&field, "depth_m must be a number"))?;
        let placed = position::resolve(Some(bearing), None, Some(depth), grid)
            .map_err(|error| ApiError::validation(&field, error.message))?;
        out.push(json!({
            "t_s": t_s,
            "bearing_deg": placed.bearing_deg,
            "depth_m": placed.depth_m,
        }));
    }
    Ok(Value::Array(out))
}

pub async fn upload_sonar(
    State(state): State<AppState>,
    Path(dive_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    check_upload(&body, SONAR_LIMIT, "Sonar capture")?;
    let client = state.pool.get().await?;
    let dive = load_dive(&client, &dive_id).await?;
    require_device(&client, &headers).await?;
    if dive.status == "planned" {
        return Err(ApiError::conflict(
            "dive_state",
            "Dive has not been started",
        ));
    }
    if body.is_empty() {
        return Err(ApiError::validation("file", "The upload is empty"));
    }
    let pen = require_pen(&client, &dive.pen_id).await?;
    let id = db::next_id(&client, "sonar", "SC").await?;
    let content_type = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let sha256 = sha256_hex(&body);
    let name = file_name(&headers);
    state
        .store
        .put(
            &format!("farms/{}/sonar/{id}", pen.farm_id),
            body.to_vec(),
            &content_type,
        )
        .await?;
    client
        .execute(
            "insert into sonar_captures(id, dive_id, farm_id, content_type, size_bytes, sha256, file_name, created_at) \
             values ($1,$2,$3,$4,$5,$6,$7,$8)",
            &[
                &id,
                &dive_id,
                &pen.farm_id,
                &content_type,
                &(body.len() as i64),
                &sha256,
                &name,
                &Utc::now(),
            ],
        )
        .await?;
    Ok(created(json!({
        "capture": {
            "id": id,
            "content_type": content_type,
            "size_bytes": body.len(),
            "sha256": sha256,
            "file_name": name,
        }
    })))
}

pub async fn raw_sonar(
    State(state): State<AppState>,
    Path(capture_id): Path<String>,
) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let rows = client
        .query(
            "select farm_id, content_type, sha256, file_name from sonar_captures where id = $1",
            &[&capture_id],
        )
        .await?;
    let row = rows.first().ok_or_else(ApiError::not_found)?;
    let farm_id: String = row.get(0);
    let bytes = state
        .store
        .get(&format!("farms/{farm_id}/sonar/{capture_id}"))
        .await?
        .ok_or_else(ApiError::not_found)?;
    Ok(raw_response(
        bytes,
        &row.get::<_, String>(1),
        &row.get::<_, String>(2),
        &row.get::<_, String>(3),
    ))
}
