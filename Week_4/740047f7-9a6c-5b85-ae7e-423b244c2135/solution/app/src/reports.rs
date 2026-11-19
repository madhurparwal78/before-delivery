//! Report revisions and their packs, restore, report links and the public report JSON.

use crate::app::{created, ok, Ctx, Reply, Shared};
use crate::db;
use crate::defects::pen_view;
use crate::error::{ApiError, ApiResult};
use crate::model::{self, Defect, PenRow};
use crate::rules;
use crate::s3::{sha256_hex, S3};
use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Value};
use deadpool_postgres::GenericClient;

const INACTIVE: &str = "This link is no longer active";
const CHANGED: &str = "Link changed on another device — the list has been refreshed";

fn snapshot_json(defects: &[Defect]) -> Value {
    Value::Array(
        defects
            .iter()
            .map(|d| {
                json!({
                    "id": d.id, "type": d.kind.name(), "bearing_t": d.bearing_t, "depth_t": d.depth_t, "size": d.size,
                    "note": d.note, "private_note": d.private_note, "status": d.status, "removed": d.removed,
                    "version": d.version, "created_at": rules::iso(d.created_at), "updated_at": rules::iso(d.updated_at),
                    "repairs": d.repairs.iter().map(|r| json!({"id": r.id, "method": r.method, "note": r.note, "source": r.source,
                        "proposal_id": r.proposal_id, "recorded_at": rules::iso(r.recorded_at)})).collect::<Vec<_>>(),
                    "stills": d.stills.iter().map(|s| json!({"id": s.id, "sha256": s.sha256, "size_bytes": s.size_bytes})).collect::<Vec<_>>(),
                })
            })
            .collect(),
    )
}

fn pack_json(pen: &PenRow, defects: &[Defect], number: i32, published: DateTime<Utc>) -> Value {
    let g = &pen.geometry;
    let summary = model::summarize(g, defects);
    let items: Vec<Value> = defects
        .iter()
        .map(|d| {
            let mut item = model::public_json(d, g);
            if !d.removed {
                item["stills"] = Value::Array(d.stills.iter().map(|s| json!({"id": s.id, "sha256": s.sha256, "size_bytes": s.size_bytes})).collect());
            }
            item
        })
        .collect();
    json!({
        "format": "pensight-report-pack-1", "revision": number, "published_at": rules::iso(published),
        "farm": {"name": pen.farm_name}, "site": {"code": pen.site_code, "name": pen.site_name},
        "pen": {"id": pen.id, "name": pen.name, "circumference_m": g.circumference_m, "net_depth_m": g.net_depth_m, "grid": model::grid_json(g)},
        "grade": summary.grade_json(), "open_defects": summary.open, "max_fouling_cover_pct": rules::pct(summary.max_cover_t),
        "panels": summary.panels_json(g), "defects": items,
    })
}

pub async fn store_revision(db: &impl GenericClient, s3: &S3, pen: &PenRow, defects: &[Defect], number: i32, published: DateTime<Utc>) -> ApiResult<Value> {
    let pack = serde_json::to_vec(&pack_json(pen, defects, number, published)).map_err(ApiError::internal)?;
    let sha = sha256_hex(&pack);
    let size = pack.len() as i64;
    s3.put(&format!("farms/{}/reports/{}/revision-{number}.json", pen.farm_id, pen.id), pack, "application/json").await.map_err(ApiError::internal)?;
    let summary = model::summarize(&pen.geometry, defects);
    db.execute(
        "INSERT INTO report_revisions (pen_id, number, published_at, sha256, size_bytes, grade_letter, grade_label, open_defects, snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        &[&pen.id, &number, &published, &sha, &size, &summary.letter, &summary.label, &(summary.open as i32), &snapshot_json(defects)],
    )
    .await?;
    Ok(revision_json(number, published, &sha, size, summary.letter, summary.label, summary.open as i64))
}

fn revision_json(number: i32, published: DateTime<Utc>, sha: &str, size: i64, letter: &str, label: &str, open: i64) -> Value {
    json!({"number": number, "published_at": rules::iso(published), "sha256": sha, "size_bytes": size,
        "grade": {"letter": letter, "label": label}, "open_defects": open})
}

/// 423 when another device holds the lock on any defect of the pen.
async fn require_pen_unlocked(app: &Shared, defects: &[Defect], device_id: &str) -> ApiResult<()> {
    let ids: Vec<String> = defects.iter().map(|d| d.id.clone()).collect();
    let locks = app.locks_for(&ids).await?;
    for id in &ids {
        if let Some(lock) = locks.get(id).filter(|l| l.device_id != device_id) {
            return Err(ApiError::locked(&lock.device_id, &lock.device_name, lock.expires_in_s));
        }
    }
    Ok(())
}

pub async fn list(ctx: &mut Ctx, pen_id: &str) -> ApiResult<Reply> {
    let db = ctx.app.db().await?;
    model::pen_row(&db, pen_id).await?.ok_or_else(ApiError::not_found)?;
    let rows = db
        .query("SELECT number, published_at, sha256, size_bytes, grade_letter, grade_label, open_defects FROM report_revisions WHERE pen_id = $1 ORDER BY number DESC", &[&pen_id])
        .await?;
    let revisions: Vec<Value> = rows
        .iter()
        .map(|r| revision_json(r.get(0), r.get(1), &r.get::<_, String>(2), r.get(3), &r.get::<_, String>(4), &r.get::<_, String>(5), r.get::<_, i32>(6) as i64))
        .collect();
    ok(json!({"revisions": revisions}))
}

pub async fn publish(ctx: &mut Ctx, pen_id: &str) -> ApiResult<Reply> {
    let app = ctx.app.clone();
    let mut db = app.db().await?;
    let tx = db.transaction().await?;
    let pen = model::pen_row(&tx, pen_id).await?.ok_or_else(ApiError::not_found)?;
    let device = ctx.device()?;
    tx.execute("SELECT 1 FROM pens WHERE id = $1 FOR UPDATE", &[&pen_id]).await?;
    let defects = model::defects_of_pen(&tx, pen_id, true).await?;
    require_pen_unlocked(&app, &defects, &device.id).await?;
    let number: i32 = tx.query_one("SELECT COALESCE(MAX(number), 0) + 1 FROM report_revisions WHERE pen_id = $1", &[&pen_id]).await?.get(0);
    let revision = store_revision(&tx, &app.s3, &pen, &defects, number, Utc::now()).await?;
    tx.commit().await?;
    app.emit("revision.published", Some(&device), json!({"pen_id": pen_id, "number": number})).await;
    created(json!({"revision": revision}))
}

pub async fn pack(ctx: &mut Ctx, pen_id: &str, number: &str) -> ApiResult<Reply> {
    let app = ctx.app.clone();
    let db = app.db().await?;
    let pen = model::pen_row(&db, pen_id).await?.ok_or_else(ApiError::not_found)?;
    let number: i32 = number.parse().map_err(|_| ApiError::not_found())?;
    let rows = db.query("SELECT sha256 FROM report_revisions WHERE pen_id = $1 AND number = $2", &[&pen_id, &number]).await?;
    let sha: String = rows.first().ok_or_else(ApiError::not_found)?.get(0);
    let body = app.s3.get(&format!("farms/{}/reports/{pen_id}/revision-{number}.json", pen.farm_id)).await.map_err(ApiError::internal)?.ok_or_else(ApiError::not_found)?;
    Ok(Reply::Raw { content_type: "application/json".into(), sha256: Some(sha), body, download: Some(format!("{pen_id}-revision-{number}.json")) })
}

pub async fn restore(ctx: &mut Ctx, pen_id: &str) -> ApiResult<Reply> {
    let raw = ctx.read_json().await?;
    let app = ctx.app.clone();
    let mut db = app.db().await?;
    let tx = db.transaction().await?;
    let pen = model::pen_row(&tx, pen_id).await?.ok_or_else(ApiError::not_found)?;
    let device = ctx.device()?;
    tx.execute("SELECT 1 FROM pens WHERE id = $1 FOR UPDATE", &[&pen_id]).await?;
    let current = model::defects_of_pen(&tx, pen_id, true).await?;
    require_pen_unlocked(&app, &current, &device.id).await?;
    let obj = raw.object()?;
    let number = obj.get("revision").and_then(Value::as_i64).filter(|n| i32::try_from(*n).is_ok());
    let Some(number) = number else { return Err(ApiError::field("revision", "revision must be a whole number")) };
    let rows = tx.query("SELECT snapshot FROM report_revisions WHERE pen_id = $1 AND number = $2", &[&pen_id, &(number as i32)]).await?;
    let snapshot: Value = rows.first().ok_or_else(ApiError::not_found)?.get(0);
    let snap = snapshot.as_array().cloned().unwrap_or_default();
    let keep: Vec<String> = snap.iter().filter_map(|d| d["id"].as_str().map(String::from)).collect();
    let now = Utc::now();
    let mut dropped = vec![];
    for defect in &current {
        if !keep.contains(&defect.id) {
            dropped.push(defect.id.clone());
        }
    }
    tx.execute("DELETE FROM import_ledger WHERE defect_id = ANY($1)", &[&dropped]).await?;
    tx.execute("DELETE FROM defects WHERE id = ANY($1)", &[&dropped]).await?;
    for item in &snap {
        restore_one(&tx, &pen, &current, item, number, &device, now).await?;
    }
    let pen_json = pen_view(&app, &tx, &pen).await?;
    tx.commit().await?;
    app.drop_locks(&dropped).await?;
    app.emit("defect.restored", Some(&device), json!({"pen_id": pen_id, "revision": number, "pen_name": pen.name})).await;
    ok(json!({"pen": pen_json}))
}

async fn restore_one(
    tx: &impl GenericClient,
    pen: &PenRow,
    current: &[Defect],
    item: &Value,
    revision: i64,
    device: &crate::app::Device,
    now: DateTime<Utc>,
) -> ApiResult<()> {
    let id = item["id"].as_str().unwrap_or_default();
    let existing = current.iter().find(|d| d.id == id);
    let snap_version = item["version"].as_i64().unwrap_or(1) as i32;
    let version = existing.map(|d| d.version.max(snap_version)).unwrap_or(snap_version) + 1;
    let bearing_t = item["bearing_t"].as_i64().unwrap_or(0) as i32;
    let depth_t = item["depth_t"].as_i64().unwrap_or(0) as i32;
    let created_at: DateTime<Utc> = item["created_at"].as_str().and_then(|t| DateTime::parse_from_rfc3339(t).ok()).map(|t| t.with_timezone(&Utc)).unwrap_or(now);
    let number: i32 = id.get(2..).and_then(|n| n.parse().ok()).unwrap_or(0);
    let removed = item["removed"].as_bool().unwrap_or(false);
    let status = item["status"].as_str().unwrap_or("open");
    let (kind, note, private_note) = (item["type"].as_str().unwrap_or("chafe"), item["note"].as_str().unwrap_or(""), item["private_note"].as_str().unwrap_or(""));
    if existing.is_some() {
        tx.execute(
            "UPDATE defects SET bearing_t=$2, depth_t=$3, size=$4, note=$5, private_note=$6, status=$7, removed=$8, version=$9, updated_at=$10 WHERE id=$1",
            &[&id, &bearing_t, &depth_t, &item["size"], &note, &private_note, &status, &removed, &version, &now],
        )
        .await?;
    } else {
        tx.execute(
            "INSERT INTO defects (id, seq, pen_id, type, bearing_t, depth_t, size, note, private_note, status, removed, version, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
            &[&id, &number, &pen.id, &kind, &bearing_t, &depth_t, &item["size"], &note, &private_note, &status, &removed, &version, &created_at, &now],
        )
        .await?;
    }
    tx.execute("DELETE FROM repairs WHERE defect_id = $1", &[&id]).await?;
    for repair in item["repairs"].as_array().cloned().unwrap_or_default() {
        let repair_id = repair["id"].as_str().unwrap_or_default();
        let seq: i32 = repair_id.get(2..).and_then(|n| n.parse().ok()).unwrap_or(0);
        let at: DateTime<Utc> = repair["recorded_at"].as_str().and_then(|t| DateTime::parse_from_rfc3339(t).ok()).map(|t| t.with_timezone(&Utc)).unwrap_or(now);
        tx.execute(
            "INSERT INTO repairs (id, seq, defect_id, method, note, source, proposal_id, recorded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            &[&repair_id, &seq, &id, &repair["method"].as_str().unwrap_or(""), &repair["note"].as_str().unwrap_or(""), &repair["source"].as_str().unwrap_or("manual"), &repair["proposal_id"].as_str(), &at],
        )
        .await?;
    }
    tx.execute("UPDATE stills SET defect_id = NULL WHERE defect_id = $1", &[&id]).await?;
    let still_ids: Vec<String> = item["stills"].as_array().cloned().unwrap_or_default().iter().filter_map(|s| s["id"].as_str().map(String::from)).collect();
    tx.execute("UPDATE stills SET defect_id = $1 WHERE id = ANY($2)", &[&id, &still_ids]).await?;
    let restored = model::defect_by_id(tx, id, false).await?.ok_or_else(ApiError::not_found)?;
    let after = model::history_fields(&restored, &pen.geometry);
    let changes = match existing {
        Some(before) => model::diff(Some(&model::history_fields(before, &pen.geometry)), &after),
        None => model::diff(None, &after),
    };
    db::insert_history(tx, id, now, &device.id, &device.name, "restored", &changes, &format!("revision {revision}")).await?;
    Ok(())
}

// ---------------------------------------------------------------------------- links

pub struct LinkRow {
    pub id: String,
    pub pen_id: String,
    pub token: String,
    pub revoked: bool,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

const LINK_COLS: &str = "id, pen_id, token, revoked, created_at, expires_at";

fn link_row(row: &tokio_postgres::Row) -> LinkRow {
    LinkRow { id: row.get(0), pen_id: row.get(1), token: row.get(2), revoked: row.get(3), created_at: row.get(4), expires_at: row.get(5) }
}

pub fn request_origin(ctx: &Ctx) -> String {
    if let Some(url) = ctx.app.cfg.public_url.as_ref() {
        return url.trim_end_matches('/').to_string();
    }
    let host = ctx.header("host").unwrap_or_else(|| format!("127.0.0.1:{}", ctx.app.cfg.port));
    format!("http://{host}")
}

fn link_json(link: &LinkRow, origin: &str, now: DateTime<Utc>) -> Value {
    let (status, left) = rules::link_state(link.revoked, link.expires_at, now);
    let path = format!("/r/{}", link.token);
    json!({"id": link.id, "pen_id": link.pen_id, "token": link.token, "path": path, "url": format!("{origin}{path}"), "status": status,
        "created_at": rules::iso(link.created_at), "expires_at": rules::iso(link.expires_at), "expires_in_s": left})
}

fn random_token() -> ApiResult<String> {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).map_err(ApiError::internal)?;
    Ok(hex::encode(bytes))
}

pub async fn links(ctx: &mut Ctx, pen_id: &str) -> ApiResult<Reply> {
    let db = ctx.app.db().await?;
    model::pen_row(&db, pen_id).await?.ok_or_else(ApiError::not_found)?;
    let now = Utc::now();
    let origin = request_origin(ctx);
    let rows = db.query(&format!("SELECT {LINK_COLS} FROM report_links WHERE pen_id = $1 ORDER BY seq DESC"), &[&pen_id]).await?;
    let list: Vec<Value> = rows.iter().map(|r| link_json(&link_row(r), &origin, now)).collect();
    ok(json!({"server_now": rules::iso(now), "links": list}))
}

pub async fn create_link(ctx: &mut Ctx, pen_id: &str) -> ApiResult<Reply> {
    let raw = ctx.read_json().await?;
    let app = ctx.app.clone();
    let db = app.db().await?;
    let pen = model::pen_row(&db, pen_id).await?.ok_or_else(ApiError::not_found)?;
    let device = ctx.device()?;
    let obj = raw.object()?;
    let seconds = obj.get("expires_in_seconds").and_then(Value::as_i64).filter(|s| (10..=2_592_000).contains(s));
    let Some(seconds) = seconds else {
        return Err(ApiError::field("expires_in_seconds", "expires_in_seconds must be a whole number from 10 to 2592000"));
    };
    let now = Utc::now();
    let number = db::next_number(&db, "link_seq").await?;
    let id = db::make_id("L-", number);
    let token = random_token()?;
    let expires = now + Duration::seconds(seconds);
    db.execute("INSERT INTO report_links (id, seq, pen_id, token, revoked, created_at, expires_at) VALUES ($1,$2,$3,$4,false,$5,$6)", &[&id, &number, &pen.id, &token, &now, &expires]).await?;
    db.execute("INSERT INTO link_tokens (token, link_id) VALUES ($1, $2)", &[&token, &id]).await?;
    app.emit("link.created", Some(&device), json!({"pen_id": pen.id})).await;
    let link = LinkRow { id, pen_id: pen.id.clone(), token, revoked: false, created_at: now, expires_at: expires };
    created(json!({"link": link_json(&link, &request_origin(ctx), now)}))
}

pub async fn regenerate(ctx: &mut Ctx, link_id: &str) -> ApiResult<Reply> {
    let raw = ctx.read_json().await?;
    let app = ctx.app.clone();
    let mut db = app.db().await?;
    let tx = db.transaction().await?;
    let rows = tx.query(&format!("SELECT {LINK_COLS} FROM report_links WHERE id = $1 FOR UPDATE"), &[&link_id]).await?;
    let mut link = link_row(rows.first().ok_or_else(ApiError::not_found)?);
    let device = ctx.device()?;
    let now = Utc::now();
    if rules::link_state(link.revoked, link.expires_at, now).0 != "active" {
        return Err(ApiError::conflict("link_state", INACTIVE));
    }
    let obj = raw.object()?;
    let Some(sent) = obj.get("token").and_then(Value::as_str) else { return Err(ApiError::field("token", "token must be a string")) };
    if sent != link.token {
        return Err(ApiError::conflict("link_state", CHANGED));
    }
    link.token = random_token()?;
    tx.execute("UPDATE report_links SET token = $2 WHERE id = $1", &[&link.id, &link.token]).await?;
    tx.execute("INSERT INTO link_tokens (token, link_id) VALUES ($1, $2)", &[&link.token, &link.id]).await?;
    tx.commit().await?;
    app.emit("link.regenerated", Some(&device), json!({"pen_id": link.pen_id})).await;
    ok(json!({"link": link_json(&link, &request_origin(ctx), now)}))
}

pub async fn revoke(ctx: &mut Ctx, link_id: &str) -> ApiResult<Reply> {
    let app = ctx.app.clone();
    let mut db = app.db().await?;
    let tx = db.transaction().await?;
    let rows = tx.query(&format!("SELECT {LINK_COLS} FROM report_links WHERE id = $1 FOR UPDATE"), &[&link_id]).await?;
    let mut link = link_row(rows.first().ok_or_else(ApiError::not_found)?);
    let device = ctx.device()?;
    let changed = !link.revoked;
    if changed {
        tx.execute("UPDATE report_links SET revoked = true WHERE id = $1", &[&link.id]).await?;
        link.revoked = true;
    }
    tx.commit().await?;
    if changed {
        app.emit("link.revoked", Some(&device), json!({"pen_id": link.pen_id})).await;
    }
    ok(json!({"link": link_json(&link, &request_origin(ctx), Utc::now())}))
}

pub enum Share {
    Active(Box<Value>),
    Inactive,
    Unknown,
}

/// The public report JSON for a token, or why there is none.
pub async fn share_data(app: &Shared, token: &str) -> ApiResult<Share> {
    let db = app.db().await?;
    let rows = db.query("SELECT link_id FROM link_tokens WHERE token = $1", &[&token]).await?;
    let Some(row) = rows.first() else { return Ok(Share::Unknown) };
    let link_id: String = row.get(0);
    let rows = db.query(&format!("SELECT {LINK_COLS} FROM report_links WHERE id = $1"), &[&link_id]).await?;
    let Some(row) = rows.first() else { return Ok(Share::Unknown) };
    let link = link_row(row);
    let now = Utc::now();
    let (status, left) = rules::link_state(link.revoked, link.expires_at, now);
    if status != "active" || link.token != token {
        return Ok(Share::Inactive);
    }
    let Some(pen) = model::pen_row(&db, &link.pen_id).await? else { return Ok(Share::Unknown) };
    let defects = model::defects_of_pen(&db, &pen.id, false).await?;
    let g = &pen.geometry;
    let summary = model::summarize(g, &defects);
    let latest = model::latest_revision(&db, &pen.id).await?;
    Ok(Share::Active(Box::new(json!({
        "pen": {"name": pen.name, "site_name": pen.site_name, "farm_name": pen.farm_name,
            "circumference_m": g.circumference_m, "net_depth_m": g.net_depth_m, "grid": model::grid_json(g)},
        "grade": summary.grade_json(), "open_defects": summary.open, "max_fouling_cover_pct": rules::pct(summary.max_cover_t),
        "panels": summary.panels_json(g),
        "defects": defects.iter().map(|d| model::public_json(d, g)).collect::<Vec<_>>(),
        "latest_revision": latest.map(|r| json!({"number": r.number, "published_at": rules::iso(r.published_at)})),
        "link": {"status": "active", "expires_at": rules::iso(link.expires_at), "expires_in_s": left},
    }))))
}

pub async fn share(ctx: &mut Ctx, token: &str) -> ApiResult<Reply> {
    match share_data(&ctx.app, token).await? {
        Share::Active(body) => ok(*body),
        Share::Inactive => Err(ApiError::gone()),
        Share::Unknown => Err(ApiError::not_found()),
    }
}
