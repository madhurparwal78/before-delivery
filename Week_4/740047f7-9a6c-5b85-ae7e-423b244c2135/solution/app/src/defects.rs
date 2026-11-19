//! Defects: marking, editing, deleting, history, edit locks, stills and repairs.

use crate::app::{created, ok, Ctx, Device, Reply, Shared, STILL_LIMIT};
use crate::db;
use crate::error::{ApiError, ApiResult};
use crate::model::{self, Defect, PenRow};
use crate::rules::{self, Geometry, Kind};
use crate::s3::sha256_hex;
use chrono::Utc;
use serde_json::{json, Map, Value};
use deadpool_postgres::GenericClient;

pub type FieldErrors = Vec<(String, String)>;

pub const REPAIR_METHODS: [&str; 4] = ["patch", "lace", "replace_panel", "clean"];

/// The pen as every write returns it: panels, grade and every defect and placeholder with its lock.
pub async fn pen_view(app: &Shared, db: &impl GenericClient, pen: &PenRow) -> ApiResult<Value> {
    let defects = model::defects_of_pen(db, &pen.id, false).await?;
    let ids: Vec<String> = defects.iter().map(|d| d.id.clone()).collect();
    let locks = app.locks_for(&ids).await?;
    let latest = model::latest_revision(db, &pen.id).await?;
    Ok(model::pen_json(pen, &defects, &locks, latest.as_ref(), true))
}

pub async fn defect_view(app: &Shared, defect: &Defect, g: &Geometry) -> ApiResult<Value> {
    let lock = app.lock_of(&defect.id).await?;
    Ok(model::defect_json(defect, g, lock.as_ref()))
}

pub fn note_field(obj: &Map<String, Value>, key: &str, errors: &mut FieldErrors) -> Option<String> {
    match obj.get(key) {
        None => None,
        Some(Value::String(text)) if rules::graphemes(text) <= rules::NOTE_LIMIT => Some(text.clone()),
        Some(Value::String(_)) => {
            errors.push((key.into(), rules::NOTE_TOO_LONG.into()));
            None
        }
        Some(_) => {
            errors.push((key.into(), format!("{key} must be a string")));
            None
        }
    }
}

fn finite(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64).filter(|v| v.is_finite())
}

/// Reads the bearing and depth of a request, in tenths. `current` supplies what a PATCH leaves unchanged.
pub fn read_position(obj: &Map<String, Value>, g: &Geometry, current: Option<(i64, i64)>, errors: &mut FieldErrors) -> Option<(i64, i64)> {
    if let Some(point) = obj.get("wall_point").filter(|v| !v.is_null()) {
        let coords = (finite(point.get("x_m")), finite(point.get("y_m")), finite(point.get("z_m")));
        let (Some(x), Some(y), Some(z)) = coords else {
            errors.push(("wall_point".into(), "wall_point needs numeric x_m, y_m and z_m".into()));
            return None;
        };
        let depth = rules::depth_tenths(-y);
        if !rules::depth_in_range(g, depth) {
            errors.push(("wall_point".into(), format!("The net wall runs from 0 to {} m deep", g.net_depth_m)));
            return None;
        }
        return Some((rules::bearing_tenths(rules::wall_point_bearing(x, z)), depth));
    }
    let bearing = match obj.get("bearing_deg") {
        Some(value) => match finite(Some(value)) {
            Some(degrees) => Some(rules::bearing_tenths(degrees)),
            None => {
                errors.push(("bearing_deg".into(), "bearing_deg must be a number".into()));
                None
            }
        },
        None => current.map(|c| c.0),
    };
    let depth = match obj.get("depth_m") {
        Some(value) => match finite(Some(value)) {
            Some(metres) if rules::depth_in_range(g, rules::depth_tenths(metres)) => Some(rules::depth_tenths(metres)),
            Some(_) => {
                errors.push(("depth_m".into(), format!("depth_m must be between 0 and {}", g.net_depth_m)));
                None
            }
            None => {
                errors.push(("depth_m".into(), "depth_m must be a number".into()));
                None
            }
        },
        None => current.map(|c| c.1),
    };
    if bearing.is_none() && !errors.iter().any(|(k, _)| k == "bearing_deg") {
        errors.push(("bearing_deg".into(), "bearing_deg or wall_point is required".into()));
    }
    if depth.is_none() && !errors.iter().any(|(k, _)| k == "depth_m") {
        errors.push(("depth_m".into(), "depth_m is required".into()));
    }
    Some((bearing?, depth?))
}

pub async fn create(ctx: &mut Ctx, pen_id: &str) -> ApiResult<Reply> {
    let raw = ctx.read_json().await?;
    let app = ctx.app.clone();
    let mut db = app.db().await?;
    let tx = db.transaction().await?;
    let pen = model::pen_row(&tx, pen_id).await?.ok_or_else(ApiError::not_found)?;
    let device = ctx.device()?;
    let obj = raw.object()?;
    let g = pen.geometry;
    let mut errors = vec![];
    let kind = match obj.get("type") {
        Some(Value::String(name)) => Kind::parse(name),
        _ => None,
    };
    if kind.is_none() {
        errors.push(("type".into(), "type must be hole, tear, chafe or fouling".into()));
    }
    let position = read_position(&obj, &g, None, &mut errors);
    let size = match kind {
        Some(kind) => match rules::validate_size(kind, obj.get("size")) {
            Ok(size) => Some(size),
            Err(more) => {
                errors.extend(more);
                None
            }
        },
        None => None,
    };
    let note = note_field(&obj, "note", &mut errors);
    let private_note = note_field(&obj, "private_note", &mut errors);
    let (Some(kind), Some((bearing_t, depth_t)), Some(size)) = (kind, position, size) else {
        return Err(ApiError::validation(errors));
    };
    if !errors.is_empty() {
        return Err(ApiError::validation(errors));
    }
    let number = db::next_number(&tx, "defect_seq").await?;
    let id = db::make_id("D-", number);
    let now = Utc::now();
    insert_defect(&tx, &id, number, &pen, kind, bearing_t, depth_t, &Value::Object(size), &note.unwrap_or_default(), &private_note.unwrap_or_default(), now).await?;
    let defect = model::defect_by_id(&tx, &id, false).await?.ok_or_else(ApiError::not_found)?;
    let changes = model::diff(None, &model::history_fields(&defect, &g));
    db::insert_history(&tx, &id, now, &device.id, &device.name, "created", &changes, "new defect").await?;
    let pen_json = pen_view(&app, &tx, &pen).await?;
    tx.commit().await?;
    app.emit("defect.created", Some(&device), json!({"pen_id": pen.id, "defect_id": id})).await;
    let view = pen_json["defects"].as_array().and_then(|all| all.iter().find(|d| d["id"] == json!(id))).cloned().unwrap_or(Value::Null);
    created(json!({"defect": view, "pen": pen_json}))
}

#[allow(clippy::too_many_arguments)]
pub async fn insert_defect(
    db: &impl GenericClient,
    id: &str,
    number: i32,
    pen: &PenRow,
    kind: Kind,
    bearing_t: i64,
    depth_t: i64,
    size: &Value,
    note: &str,
    private_note: &str,
    now: chrono::DateTime<Utc>,
) -> ApiResult<()> {
    db.execute(
        "INSERT INTO defects (id, seq, pen_id, type, bearing_t, depth_t, size, note, private_note, status, removed, version, created_at, updated_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',false,1,$10,$10)",
        &[&id, &number, &pen.id, &kind.name(), &(bearing_t as i32), &(depth_t as i32), size, &note, &private_note, &now],
    )
    .await?;
    Ok(())
}

pub async fn get(ctx: &mut Ctx, id: &str) -> ApiResult<Reply> {
    let app = ctx.app.clone();
    let db = app.db().await?;
    let defect = model::defect_by_id(&db, id, false).await?.ok_or_else(ApiError::not_found)?;
    let pen = model::pen_row(&db, &defect.pen_id).await?.ok_or_else(ApiError::not_found)?;
    ok(json!({"defect": defect_view(&app, &defect, &pen.geometry).await?}))
}

pub async fn history(ctx: &mut Ctx, id: &str) -> ApiResult<Reply> {
    let db = ctx.app.db().await?;
    if model::defect_by_id(&db, id, false).await?.is_none() {
        return Err(ApiError::not_found());
    }
    let rows = db
        .query("SELECT at, device_id, device_name, action, changes, detail FROM defect_history WHERE defect_id = $1 ORDER BY id", &[&id])
        .await?;
    let entries: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({"at": rules::iso(r.get(0)), "device_id": r.get::<_, String>(1), "device_name": r.get::<_, String>(2),
                "action": r.get::<_, String>(3), "changes": r.get::<_, Value>(4), "detail": r.get::<_, String>(5)})
        })
        .collect();
    ok(json!({"history": entries}))
}

pub async fn patch(ctx: &mut Ctx, id: &str) -> ApiResult<Reply> {
    let raw = ctx.read_json().await?;
    let app = ctx.app.clone();
    let mut db = app.db().await?;
    let tx = db.transaction().await?;
    let mut defect = model::defect_by_id(&tx, id, true).await?.ok_or_else(ApiError::not_found)?;
    let device = ctx.device()?;
    app.require_unlocked(&defect.id, &device).await?;
    if defect.removed {
        return Err(ApiError::removed(&defect.id));
    }
    let lenient = raw.lenient();
    if let Some(sent) = lenient.as_ref().and_then(|o| o.get("version")).and_then(Value::as_i64) {
        if sent != defect.version as i64 {
            return Err(ApiError::conflict("version_conflict", &format!("{} changed on another device — reopen to see the latest", defect.id)));
        }
    }
    let obj = raw.object()?;
    let pen = model::pen_row(&tx, &defect.pen_id).await?.ok_or_else(ApiError::not_found)?;
    let g = pen.geometry;
    let mut errors = vec![];
    if obj.get("version").and_then(Value::as_i64).is_none() {
        errors.push(("version".into(), "version must be a whole number".into()));
    }
    if let Some(kind) = obj.get("type") {
        if kind.as_str() != Some(defect.kind.name()) {
            errors.push(("type".into(), "Type cannot change".into()));
        }
    }
    let before = model::history_fields(&defect, &g);
    let moves = ["bearing_deg", "depth_m", "wall_point"].iter().any(|k| obj.contains_key(*k));
    if moves {
        if let Some((bearing_t, depth_t)) = read_position(&obj, &g, Some((defect.bearing_t, defect.depth_t)), &mut errors) {
            defect.bearing_t = bearing_t;
            defect.depth_t = depth_t;
        }
    }
    if obj.contains_key("size") {
        match rules::validate_size(defect.kind, obj.get("size")) {
            Ok(size) => defect.size = Value::Object(size),
            Err(more) => errors.extend(more),
        }
    }
    if let Some(note) = note_field(&obj, "note", &mut errors) {
        defect.note = note;
    }
    if let Some(note) = note_field(&obj, "private_note", &mut errors) {
        defect.private_note = note;
    }
    if !errors.is_empty() {
        return Err(ApiError::validation(errors));
    }
    let now = Utc::now();
    defect.version += 1;
    tx.execute(
        "UPDATE defects SET bearing_t=$2, depth_t=$3, size=$4, note=$5, private_note=$6, version=$7, updated_at=$8 WHERE id=$1",
        &[&defect.id, &(defect.bearing_t as i32), &(defect.depth_t as i32), &defect.size, &defect.note, &defect.private_note, &defect.version, &now],
    )
    .await?;
    let changes = model::diff(Some(&before), &model::history_fields(&defect, &g));
    db::insert_history(&tx, &defect.id, now, &device.id, &device.name, "updated", &changes, "").await?;
    let pen_json = pen_view(&app, &tx, &pen).await?;
    tx.commit().await?;
    app.emit("defect.updated", Some(&device), json!({"pen_id": pen.id, "defect_id": defect.id})).await;
    ok(json!({"defect": find_defect(&pen_json, &defect.id), "pen": pen_json}))
}

pub fn find_defect(pen_json: &Value, id: &str) -> Value {
    pen_json["defects"].as_array().and_then(|all| all.iter().find(|d| d["id"] == json!(id))).cloned().unwrap_or(Value::Null)
}

pub async fn delete(ctx: &mut Ctx, id: &str) -> ApiResult<Reply> {
    let app = ctx.app.clone();
    let mut db = app.db().await?;
    let tx = db.transaction().await?;
    let defect = model::defect_by_id(&tx, id, true).await?.ok_or_else(ApiError::not_found)?;
    let device = ctx.device()?;
    app.require_unlocked(&defect.id, &device).await?;
    if defect.removed {
        return Err(ApiError::removed(&defect.id));
    }
    let pen = model::pen_row(&tx, &defect.pen_id).await?.ok_or_else(ApiError::not_found)?;
    let now = Utc::now();
    tx.execute("UPDATE defects SET removed = true, updated_at = $2 WHERE id = $1", &[&defect.id, &now]).await?;
    db::insert_history(&tx, &defect.id, now, &device.id, &device.name, "removed", &json!({}), "").await?;
    let pen_json = pen_view(&app, &tx, &pen).await?;
    tx.commit().await?;
    app.release_lock(&defect.id, &device).await?;
    app.emit("defect.removed", Some(&device), json!({"pen_id": pen.id, "defect_id": defect.id})).await;
    ok(json!({"defect": find_defect(&pen_json, &defect.id), "pen": pen_json}))
}

pub async fn lock(ctx: &mut Ctx, id: &str) -> ApiResult<Reply> {
    let app = ctx.app.clone();
    let db = app.db().await?;
    let defect = model::defect_by_id(&db, id, false).await?.ok_or_else(ApiError::not_found)?;
    let device = ctx.device()?;
    app.require_unlocked(&defect.id, &device).await?;
    if defect.removed {
        return Err(ApiError::removed(&defect.id));
    }
    let held_before = app.lock_of(&defect.id).await?.is_some();
    let info = app.take_lock(&defect.id, &device).await?;
    if !held_before {
        app.emit("lock.taken", Some(&device), json!({"pen_id": defect.pen_id, "defect_id": defect.id})).await;
    }
    ok(json!({"lock": info.json()}))
}

pub async fn unlock(ctx: &mut Ctx, id: &str) -> ApiResult<Reply> {
    let app = ctx.app.clone();
    let db = app.db().await?;
    let defect = model::defect_by_id(&db, id, false).await?.ok_or_else(ApiError::not_found)?;
    let device = ctx.device()?;
    app.require_unlocked(&defect.id, &device).await?;
    if app.release_lock(&defect.id, &device).await? {
        app.emit("lock.released", Some(&device), json!({"pen_id": defect.pen_id, "defect_id": defect.id})).await;
    }
    Ok(Reply::NoContent)
}

pub async fn attach_still(ctx: &mut Ctx, id: &str) -> ApiResult<Reply> {
    let bytes = ctx.read(STILL_LIMIT).await?;
    let app = ctx.app.clone();
    let mut db = app.db().await?;
    let tx = db.transaction().await?;
    let defect = model::defect_by_id(&tx, id, true).await?.ok_or_else(ApiError::not_found)?;
    let device = ctx.device()?;
    app.require_unlocked(&defect.id, &device).await?;
    if defect.removed {
        return Err(ApiError::removed(&defect.id));
    }
    let content_type = ctx.header("content-type").unwrap_or_default().split(';').next().unwrap_or("").trim().to_lowercase();
    if content_type != "image/jpeg" && content_type != "image/png" {
        return Err(ApiError::field("content_type", "Stills must be JPEG or PNG"));
    }
    if bytes.is_empty() {
        return Err(ApiError::field("body", "The upload is empty"));
    }
    let pen = model::pen_row(&tx, &defect.pen_id).await?.ok_or_else(ApiError::not_found)?;
    let number = db::next_number(&tx, "still_seq").await?;
    let still_id = db::make_id("S-", number);
    let sha = sha256_hex(&bytes);
    let size = bytes.len() as i64;
    app.s3.put(&format!("farms/{}/stills/{still_id}", pen.farm_id), bytes.to_vec(), &content_type).await.map_err(ApiError::internal)?;
    let now = Utc::now();
    let file_name = ctx.file_name();
    tx.execute(
        "INSERT INTO stills (id, seq, farm_id, defect_id, content_type, size_bytes, sha256, file_name, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        &[&still_id, &number, &pen.farm_id, &defect.id, &content_type, &size, &sha, &file_name, &now],
    )
    .await?;
    db::insert_history(&tx, &defect.id, now, &device.id, &device.name, "still_attached", &json!({}), &still_id).await?;
    tx.commit().await?;
    app.emit("defect.still", Some(&device), json!({"pen_id": pen.id, "defect_id": defect.id})).await;
    created(json!({"still": {"id": still_id, "content_type": content_type, "size_bytes": size, "sha256": sha, "file_name": file_name}}))
}

pub async fn still_raw(ctx: &mut Ctx, id: &str) -> ApiResult<Reply> {
    let app = ctx.app.clone();
    let db = app.db().await?;
    let rows = db.query("SELECT farm_id, content_type, sha256, file_name FROM stills WHERE id = $1", &[&id]).await?;
    let row = rows.first().ok_or_else(ApiError::not_found)?;
    let farm: String = row.get(0);
    let body = app.s3.get(&format!("farms/{farm}/stills/{id}")).await.map_err(ApiError::internal)?.ok_or_else(ApiError::not_found)?;
    Ok(Reply::Raw { content_type: row.get(1), sha256: Some(row.get(2)), body, download: Some(row.get(3)) })
}

/// Records a repair on an open defect: status, version, history. The caller holds the row lock.
pub async fn apply_repair(
    tx: &impl GenericClient,
    pen: &PenRow,
    defect: &mut Defect,
    device: &Device,
    method: &str,
    note: &str,
    proposal_id: Option<&str>,
) -> ApiResult<crate::model::Repair> {
    let before = model::history_fields(defect, &pen.geometry);
    let number = db::next_number(tx, "repair_seq").await?;
    let now = Utc::now();
    let source = if proposal_id.is_some() { "copilot" } else { "manual" };
    let repair = db::repair_of(db::make_id("R-", number), method, note, source, proposal_id.map(String::from), now);
    tx.execute(
        "INSERT INTO repairs (id, seq, defect_id, method, note, source, proposal_id, recorded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        &[&repair.id, &number, &defect.id, &method, &note, &source, &repair.proposal_id, &now],
    )
    .await?;
    defect.status = "repaired".into();
    defect.version += 1;
    tx.execute("UPDATE defects SET status = 'repaired', version = $2, updated_at = $3 WHERE id = $1", &[&defect.id, &defect.version, &now]).await?;
    defect.repairs.push(repair.clone());
    let detail = match proposal_id {
        Some(proposal) => format!("{method} (copilot proposal {proposal})"),
        None => method.to_string(),
    };
    let changes = model::diff(Some(&before), &model::history_fields(defect, &pen.geometry));
    db::insert_history(tx, &defect.id, now, &device.id, &device.name, "repaired", &changes, &detail).await?;
    Ok(repair)
}

pub async fn repair(ctx: &mut Ctx, id: &str) -> ApiResult<Reply> {
    let raw = ctx.read_json().await?;
    let app = ctx.app.clone();
    let mut db = app.db().await?;
    let tx = db.transaction().await?;
    let mut defect = model::defect_by_id(&tx, id, true).await?.ok_or_else(ApiError::not_found)?;
    let device = ctx.device()?;
    app.require_unlocked(&defect.id, &device).await?;
    if defect.removed {
        return Err(ApiError::removed(&defect.id));
    }
    if defect.status == "repaired" {
        return Err(ApiError::already_repaired(&defect.id));
    }
    let obj = raw.object()?;
    let mut errors = vec![];
    let method = obj.get("method").and_then(Value::as_str).filter(|m| REPAIR_METHODS.contains(m)).map(String::from);
    if method.is_none() {
        errors.push(("method".into(), "method must be patch, lace, replace_panel or clean".into()));
    }
    let note = note_field(&obj, "note", &mut errors);
    let Some(method) = method.filter(|_| errors.is_empty()) else { return Err(ApiError::validation(errors)) };
    let pen = model::pen_row(&tx, &defect.pen_id).await?.ok_or_else(ApiError::not_found)?;
    let repair = apply_repair(&tx, &pen, &mut defect, &device, &method, &note.unwrap_or_default(), None).await?;
    let pen_json = pen_view(&app, &tx, &pen).await?;
    tx.commit().await?;
    app.emit("defect.repaired", Some(&device), json!({"pen_id": pen.id, "defect_id": defect.id})).await;
    created(json!({
        "repair": {"id": repair.id, "method": repair.method, "note": repair.note, "source": repair.source,
            "proposal_id": repair.proposal_id, "recorded_at": rules::iso(repair.recorded_at)},
        "defect": find_defect(&pen_json, &defect.id), "pen": pen_json}))
}
