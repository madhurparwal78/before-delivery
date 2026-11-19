//! Dive planning, forecast clearance, the dive lifecycle, track samples and sonar captures.

use crate::app::{created, ok, Ctx, Reply, Shared, SONAR_LIMIT};
use crate::db;
use crate::error::{ApiError, ApiResult};
use crate::model::{self, PenRow};
use crate::rules::{self, HourReading};
use crate::s3::sha256_hex;
use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use serde_json::{json, Value};
use std::time::Duration as StdDuration;
use deadpool_postgres::GenericClient;

const UNAVAILABLE: &str = "Forecast unavailable — try again shortly";
const NEEDS_GO: &str = "Dive needs a fresh GO before it can start";
const FORECAST_TIMEOUT: StdDuration = StdDuration::from_secs(10);

fn parse_instant(text: &str) -> Option<DateTime<Utc>> {
    NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%SZ").ok().map(|n| n.and_utc())
}

/// A stored clearance as it reads now: a GO whose forecast has aged past six hours reads stale.
fn clearance_now(stored: &Value, status: &str, now: DateTime<Utc>) -> Value {
    let mut clearance = stored.clone();
    let open = status == "planned" || status == "cleared";
    let issued = clearance["issued_at"].as_str().and_then(parse_instant);
    if let (true, Some("GO"), Some(issued)) = (open, clearance["result"].as_str(), issued) {
        if rules::is_stale(issued, now) {
            clearance["result"] = json!("Forecast stale");
            clearance["message"] = json!(format!(
                "Forecast stale — issued {} UTC {}, more than 6 hours ago",
                rules::hhmm(issued),
                issued.format("%Y-%m-%d")
            ));
        }
    }
    clearance
}

struct DiveRow {
    id: String,
    pen_id: String,
    status: String,
    planned_start: DateTime<Utc>,
    planned_minutes: i32,
    certificate: String,
    clearance: Option<Value>,
    started_at: Option<DateTime<Utc>>,
    finished_at: Option<DateTime<Utc>>,
}

const DIVE_COLS: &str = "id, pen_id, status, planned_start, planned_minutes, diver_certificate_no, clearance, started_at, finished_at";

fn dive_row(row: &tokio_postgres::Row) -> DiveRow {
    DiveRow {
        id: row.get(0),
        pen_id: row.get(1),
        status: row.get(2),
        planned_start: row.get(3),
        planned_minutes: row.get(4),
        certificate: row.get(5),
        clearance: row.get(6),
        started_at: row.get(7),
        finished_at: row.get(8),
    }
}

async fn fetch_dive(db: &impl GenericClient, id: &str) -> ApiResult<DiveRow> {
    Ok(dive_row(&db.query_one(&format!("SELECT {DIVE_COLS} FROM dives WHERE id = $1"), &[&id]).await?))
}

async fn dive_json(db: &impl GenericClient, dive: &DiveRow, now: DateTime<Utc>) -> ApiResult<Value> {
    let track: Vec<Value> = db
        .query("SELECT t_s, bearing_t, depth_t FROM dive_track WHERE dive_id = $1 ORDER BY idx", &[&dive.id])
        .await?
        .iter()
        .map(|r| json!({"t_s": r.get::<_, i32>(0), "bearing_deg": r.get::<_, i32>(1) as f64 / 10.0, "depth_m": r.get::<_, i32>(2) as f64 / 10.0}))
        .collect();
    let sonar: Vec<Value> = db
        .query("SELECT id, content_type, size_bytes, sha256, file_name FROM sonar WHERE dive_id = $1 ORDER BY seq", &[&dive.id])
        .await?
        .iter()
        .map(|r| json!({"id": r.get::<_, String>(0), "content_type": r.get::<_, String>(1), "size_bytes": r.get::<_, i64>(2), "sha256": r.get::<_, String>(3), "file_name": r.get::<_, String>(4)}))
        .collect();
    let elapsed = (dive.status == "started").then(|| dive.started_at.map(|s| (now - s).num_seconds().max(0))).flatten();
    Ok(json!({
        "id": dive.id, "pen_id": dive.pen_id, "status": dive.status, "planned_start": rules::iso(dive.planned_start),
        "planned_minutes": dive.planned_minutes, "diver_certificate_no": dive.certificate,
        "clearance": dive.clearance.as_ref().map(|c| clearance_now(c, &dive.status, now)),
        "started_at": dive.started_at.map(rules::iso), "finished_at": dive.finished_at.map(rules::iso),
        "elapsed_s": elapsed, "track": track, "sonar": sonar,
    }))
}

pub async fn list(ctx: &mut Ctx) -> ApiResult<Reply> {
    let db = ctx.app.db().await?;
    let now = Utc::now();
    let rows = db.query(&format!("SELECT {DIVE_COLS} FROM dives ORDER BY seq DESC"), &[]).await?;
    let mut dives = vec![];
    for row in &rows {
        dives.push(dive_json(&db, &dive_row(row), now).await?);
    }
    ok(json!({"server_now": rules::iso(now), "dives": dives}))
}

pub async fn get(ctx: &mut Ctx, id: &str) -> ApiResult<Reply> {
    let db = ctx.app.db().await?;
    let rows = db.query(&format!("SELECT {DIVE_COLS} FROM dives WHERE id = $1"), &[&id]).await?;
    let dive = dive_row(rows.first().ok_or_else(ApiError::not_found)?);
    let now = Utc::now();
    ok(json!({"server_now": rules::iso(now), "dive": dive_json(&db, &dive, now).await?}))
}

pub async fn plan(ctx: &mut Ctx) -> ApiResult<Reply> {
    let raw = ctx.read_json().await?;
    let app = ctx.app.clone();
    let db = app.db().await?;
    let device = ctx.device()?;
    let obj = raw.object()?;
    let mut errors: Vec<(String, String)> = vec![];
    let pen = match obj.get("pen_id").and_then(Value::as_str) {
        Some(id) => model::pen_row(&db, id).await?,
        None => None,
    };
    if pen.is_none() {
        errors.push(("pen_id".into(), "pen_id must name a pen".into()));
    }
    let now = Utc::now();
    let start = obj.get("planned_start").and_then(Value::as_str).and_then(parse_instant);
    match start {
        Some(start) if start >= now - Duration::minutes(30) && start <= now + Duration::hours(48) => {}
        Some(_) => errors.push(("planned_start".into(), "planned_start must lie between 30 minutes ago and 48 hours ahead".into())),
        None => errors.push(("planned_start".into(), "planned_start must be written YYYY-MM-DDTHH:MM:SSZ".into())),
    }
    let minutes = obj.get("planned_minutes").and_then(Value::as_i64).filter(|m| (15..=240).contains(m));
    if minutes.is_none() {
        errors.push(("planned_minutes".into(), "planned_minutes must be a whole number from 15 to 240".into()));
    }
    let certificate = obj.get("diver_certificate_no").and_then(Value::as_str).map(|c| c.trim().to_string()).filter(|c| (1..=40).contains(&rules::graphemes(c)));
    if certificate.is_none() {
        errors.push(("diver_certificate_no".into(), "diver_certificate_no is required, 1 to 40 characters".into()));
    }
    let (Some(pen), Some(start), Some(minutes), Some(certificate)) = (pen, start, minutes, certificate) else {
        return Err(ApiError::validation(errors));
    };
    if !errors.is_empty() {
        return Err(ApiError::validation(errors));
    }
    let number = db::next_number(&db, "dive_seq").await?;
    let id = db::make_id("DIVE-", number);
    db.execute(
        "INSERT INTO dives (id, seq, pen_id, status, planned_start, planned_minutes, diver_certificate_no, created_at) VALUES ($1,$2,$3,'planned',$4,$5,$6,$7)",
        &[&id, &number, &pen.id, &start, &(minutes as i32), &certificate, &now],
    )
    .await?;
    app.emit("dive.changed", Some(&device), json!({"pen_id": pen.id})).await;
    created(json!({"dive": dive_json(&db, &fetch_dive(&db, &id).await?, now).await?}))
}

enum Outcome {
    Decided(Value),
    Failed { timed_out: bool },
}

async fn fetch_forecast(app: &Shared, pen: &PenRow, hours: &[DateTime<Utc>]) -> Result<(DateTime<Utc>, Vec<HourReading>), bool> {
    let hour_text = |at: DateTime<Utc>| at.format("%Y-%m-%dT%H:00").to_string();
    let (Some(&first), Some(&last)) = (hours.first(), hours.last()) else { return Err(false) };
    let query = [
        ("latitude", format!("{:.4}", pen.latitude)),
        ("longitude", format!("{:.4}", pen.longitude)),
        ("hourly", "ocean_current_velocity,wave_height".to_string()),
        ("start_hour", hour_text(first)),
        ("end_hour", hour_text(last)),
    ];
    let response = app.http.get(format!("{}/v1/marine", app.cfg.wiremock_url)).query(&query).timeout(FORECAST_TIMEOUT).send().await;
    let response = match response {
        Ok(r) => r,
        Err(error) => return Err(error.is_timeout()),
    };
    if !response.status().is_success() {
        return Err(false);
    }
    let body: Value = match response.json().await {
        Ok(v) => v,
        Err(error) => return Err(error.is_timeout()),
    };
    let issued = body["issued_at"].as_str().and_then(|t| DateTime::parse_from_rfc3339(t).ok()).map(|t| t.with_timezone(&Utc));
    let (Some(times), Some(currents), Some(waves)) =
        (body["hourly"]["time"].as_array(), body["hourly"]["ocean_current_velocity"].as_array(), body["hourly"]["wave_height"].as_array())
    else {
        return Err(false);
    };
    let Some(issued) = issued else { return Err(false) };
    if times.len() != currents.len() || times.len() != waves.len() {
        return Err(false);
    }
    let mut readings = vec![];
    for hour in hours {
        let label = hour.format("%Y-%m-%dT%H:%MZ").to_string();
        let Some(at) = times.iter().position(|t| t.as_str() == Some(label.as_str())) else { return Err(false) };
        let (Some(current), Some(wave)) = (currents[at].as_f64(), waves[at].as_f64()) else { return Err(false) };
        readings.push(HourReading { time: *hour, current_m_s: current, wave_m: wave });
    }
    Ok((issued, readings))
}

async fn check(app: &Shared, pen: &PenRow, dive: &DiveRow, now: DateTime<Utc>) -> Outcome {
    let hours = rules::planned_hours(dive.planned_start, dive.planned_minutes as i64);
    match fetch_forecast(app, pen, &hours).await {
        Err(timed_out) => Outcome::Failed { timed_out },
        Ok((issued, readings)) => {
            let (result, message) = rules::decide(issued, now, &readings);
            let rows: Vec<Value> = readings
                .iter()
                .map(|h| json!({"time": rules::iso(h.time), "current_m_s": h.current_m_s, "wave_m": h.wave_m, "within_limits": rules::within_limits(h)}))
                .collect();
            Outcome::Decided(json!({"result": result, "message": message, "checked_at": rules::iso(now), "issued_at": rules::iso(issued), "hours": rows}))
        }
    }
}

pub async fn clearance(ctx: &mut Ctx, id: &str) -> ApiResult<Reply> {
    let app = ctx.app.clone();
    let db = app.db().await?;
    let rows = db.query(&format!("SELECT {DIVE_COLS} FROM dives WHERE id = $1"), &[&id]).await?;
    let dive = dive_row(rows.first().ok_or_else(ApiError::not_found)?);
    let device = ctx.device()?;
    if dive.status == "started" || dive.status == "recorded" {
        return Err(ApiError::conflict("dive_state", &format!("A forecast cannot be checked for a dive that is {}", dive.status)));
    }
    let pen = model::pen_row(&db, &dive.pen_id).await?.ok_or_else(ApiError::not_found)?;
    let ticket = db::next_number(&db, "check_seq").await? as i64;
    let now = Utc::now();
    let outcome = check(&app, &pen, &dive, now).await;
    let (stored, failure) = match outcome {
        Outcome::Decided(clearance) => (clearance, None),
        Outcome::Failed { timed_out } => (
            json!({"result": "Forecast unavailable", "message": UNAVAILABLE, "checked_at": rules::iso(now), "issued_at": null, "hours": []}),
            Some(timed_out),
        ),
    };
    db.execute(
        "UPDATE dives SET clearance = $2, check_seq = $3, status = 'cleared' WHERE id = $1 AND check_seq < $3 AND status IN ('planned', 'cleared')",
        &[&dive.id, &stored, &ticket],
    )
    .await?;
    app.emit("dive.changed", Some(&device), json!({"pen_id": pen.id})).await;
    if let Some(timed_out) = failure {
        return Err(ApiError::provider("forecast_unavailable", UNAVAILABLE, timed_out));
    }
    ok(json!({"dive": dive_json(&db, &fetch_dive(&db, &dive.id).await?, Utc::now()).await?}))
}

async fn locked_dive(tx: &impl GenericClient, id: &str) -> ApiResult<DiveRow> {
    let rows = tx.query(&format!("SELECT {DIVE_COLS} FROM dives WHERE id = $1 FOR UPDATE"), &[&id]).await?;
    Ok(dive_row(rows.first().ok_or_else(ApiError::not_found)?))
}

pub async fn start(ctx: &mut Ctx, id: &str) -> ApiResult<Reply> {
    let app = ctx.app.clone();
    let mut db = app.db().await?;
    let tx = db.transaction().await?;
    let dive = locked_dive(&tx, id).await?;
    let device = ctx.device()?;
    match dive.status.as_str() {
        "started" => return Err(ApiError::conflict("dive_state", "Dive has already started")),
        "recorded" => return Err(ApiError::conflict("dive_state", "Dive is already recorded")),
        _ => {}
    }
    let now = Utc::now();
    let fresh_go = dive.status == "cleared"
        && dive.clearance.as_ref().map(|c| clearance_now(c, &dive.status, now)["result"] == json!("GO")).unwrap_or(false);
    if !fresh_go {
        return Err(ApiError::conflict("dive_not_cleared", NEEDS_GO));
    }
    tx.execute("UPDATE dives SET status = 'started', started_at = $2 WHERE id = $1", &[&dive.id, &now]).await?;
    let body = dive_json(&tx, &fetch_dive(&tx, &dive.id).await?, now).await?;
    tx.commit().await?;
    app.emit("dive.changed", Some(&device), json!({"pen_id": dive.pen_id})).await;
    ok(json!({"dive": body}))
}

pub async fn finish(ctx: &mut Ctx, id: &str) -> ApiResult<Reply> {
    let raw = ctx.read_json().await?;
    let app = ctx.app.clone();
    let mut db = app.db().await?;
    let tx = db.transaction().await?;
    let dive = locked_dive(&tx, id).await?;
    let device = ctx.device()?;
    if dive.status != "started" {
        return Err(ApiError::conflict("dive_state", "Dive is not running"));
    }
    let pen = model::pen_row(&tx, &dive.pen_id).await?.ok_or_else(ApiError::not_found)?;
    let obj = raw.object()?;
    let samples = match obj.get("track").and_then(Value::as_array) {
        Some(list) if (1..=1000).contains(&list.len()) => list.clone(),
        _ => return Err(ApiError::field("track", "track must hold 1 to 1000 samples")),
    };
    let mut errors = vec![];
    let mut parsed = vec![];
    let mut previous_t = 0i64;
    for (i, sample) in samples.iter().enumerate() {
        let field = format!("track[{i}]");
        let t = sample["t_s"].as_i64().filter(|t| *t >= 0);
        let bearing = sample["bearing_deg"].as_f64().filter(|b| b.is_finite());
        let depth = sample["depth_m"].as_f64().filter(|d| d.is_finite());
        let (Some(t), Some(bearing), Some(depth)) = (t, bearing, depth) else {
            errors.push((field, "t_s, bearing_deg and depth_m must be numbers, with t_s a whole number of seconds".to_string()));
            continue;
        };
        let depth_t = rules::depth_tenths(depth);
        if (i == 0 && t != 0) || t < previous_t {
            errors.push((field, if i == 0 { "t_s must start at 0".to_string() } else { "t_s must not decrease".to_string() }));
        } else if !rules::depth_in_range(&pen.geometry, depth_t) {
            errors.push((field, format!("depth_m must be between 0 and {}", pen.geometry.net_depth_m)));
        } else {
            previous_t = t;
            parsed.push((t as i32, rules::bearing_tenths(bearing) as i32, depth_t as i32));
        }
    }
    if !errors.is_empty() {
        return Err(ApiError::validation(errors));
    }
    for (i, (t, bearing, depth)) in parsed.iter().enumerate() {
        tx.execute("INSERT INTO dive_track (dive_id, idx, t_s, bearing_t, depth_t) VALUES ($1,$2,$3,$4,$5)", &[&dive.id, &(i as i32), t, bearing, depth]).await?;
    }
    let now = Utc::now();
    tx.execute("UPDATE dives SET status = 'recorded', finished_at = $2 WHERE id = $1", &[&dive.id, &now]).await?;
    let body = dive_json(&tx, &fetch_dive(&tx, &dive.id).await?, now).await?;
    tx.commit().await?;
    app.emit("dive.changed", Some(&device), json!({"pen_id": dive.pen_id})).await;
    ok(json!({"dive": body}))
}

pub async fn attach_sonar(ctx: &mut Ctx, id: &str) -> ApiResult<Reply> {
    let bytes = ctx.read(SONAR_LIMIT).await?;
    let app = ctx.app.clone();
    let mut db = app.db().await?;
    let tx = db.transaction().await?;
    let dive = locked_dive(&tx, id).await?;
    let device = ctx.device()?;
    if dive.status == "planned" {
        return Err(ApiError::conflict("dive_state", "A planned dive has no sonar to attach"));
    }
    if bytes.is_empty() {
        return Err(ApiError::field("body", "The upload is empty"));
    }
    let pen = model::pen_row(&tx, &dive.pen_id).await?.ok_or_else(ApiError::not_found)?;
    let number = db::next_number(&tx, "sonar_seq").await?;
    let capture_id = db::make_id("SC-", number);
    let content_type = ctx.header("content-type").unwrap_or_else(|| "application/octet-stream".into());
    let (sha, size, file_name) = (sha256_hex(&bytes), bytes.len() as i64, ctx.file_name());
    app.s3.put(&format!("farms/{}/sonar/{capture_id}", pen.farm_id), bytes.to_vec(), &content_type).await.map_err(ApiError::internal)?;
    tx.execute(
        "INSERT INTO sonar (id, seq, farm_id, dive_id, content_type, size_bytes, sha256, file_name, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        &[&capture_id, &number, &pen.farm_id, &dive.id, &content_type, &size, &sha, &file_name, &Utc::now()],
    )
    .await?;
    tx.commit().await?;
    app.emit("dive.changed", Some(&device), json!({"pen_id": pen.id})).await;
    created(json!({"capture": {"id": capture_id, "content_type": content_type, "size_bytes": size, "sha256": sha, "file_name": file_name}}))
}

pub async fn sonar_raw(ctx: &mut Ctx, id: &str) -> ApiResult<Reply> {
    let app = ctx.app.clone();
    let db = app.db().await?;
    let rows = db.query("SELECT farm_id, content_type, sha256, file_name FROM sonar WHERE id = $1", &[&id]).await?;
    let row = rows.first().ok_or_else(ApiError::not_found)?;
    let farm: String = row.get(0);
    let body = app.s3.get(&format!("farms/{farm}/sonar/{id}")).await.map_err(ApiError::internal)?.ok_or_else(ApiError::not_found)?;
    Ok(Reply::Raw { content_type: row.get(1), sha256: Some(row.get(2)), body, download: Some(row.get(3)) })
}
