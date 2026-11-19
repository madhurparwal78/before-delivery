//! Devices, farms, pens, search and the defect export.

use crate::app::{ok, Ctx, Reply};
use crate::defects::pen_view;
use crate::error::{ApiError, ApiResult};
use crate::model::{self, Defect};
use crate::rules;
use serde_json::{json, Value};
use std::collections::HashMap;

pub async fn devices(ctx: &mut Ctx) -> ApiResult<Reply> {
    let mut list = vec![];
    for device in &ctx.app.devices {
        list.push(json!({"id": device.id, "name": device.name, "online": ctx.app.online(&device.id).await?}));
    }
    ok(json!({"devices": list}))
}

pub async fn heartbeat(ctx: &mut Ctx, device_id: &str) -> ApiResult<Reply> {
    let app = ctx.app.clone();
    let target = app.device(device_id).cloned().ok_or_else(ApiError::not_found)?;
    ctx.device()?;
    app.heartbeat(&target.id).await?;
    ok(json!({"device": {"id": target.id, "name": target.name, "online": true}}))
}

pub async fn farms(ctx: &mut Ctx) -> ApiResult<Reply> {
    let db = ctx.app.db().await?;
    let mut out = vec![];
    for farm in db.query("SELECT id, name, day_rate_amount, day_rate_currency FROM farms ORDER BY ord", &[]).await? {
        let farm_id: String = farm.get(0);
        let sites: Vec<Value> = db
            .query("SELECT code, name, latitude, longitude FROM sites WHERE farm_id = $1 ORDER BY code", &[&farm_id])
            .await?
            .iter()
            .map(|s| json!({"code": s.get::<_, String>(0), "name": s.get::<_, String>(1), "latitude": s.get::<_, f64>(2), "longitude": s.get::<_, f64>(3)}))
            .collect();
        let pen_ids: Vec<String> =
            db.query("SELECT id FROM pens WHERE farm_id = $1 ORDER BY ord", &[&farm_id]).await?.iter().map(|p| p.get(0)).collect();
        out.push(json!({"id": farm_id, "name": farm.get::<_, String>(1),
            "day_rate": {"amount": farm.get::<_, i64>(2), "currency": farm.get::<_, String>(3)},
            "sites": sites, "pen_ids": pen_ids}));
    }
    ok(json!({"farms": out}))
}

pub async fn erase_farm(ctx: &mut Ctx, farm_id: &str) -> ApiResult<Reply> {
    let raw = ctx.read_json().await?;
    let app = ctx.app.clone();
    let mut db = app.db().await?;
    let tx = db.transaction().await?;
    let rows = tx.query("SELECT name FROM farms WHERE id = $1 FOR UPDATE", &[&farm_id]).await?;
    let name: String = rows.first().ok_or_else(ApiError::not_found)?.get(0);
    let device = ctx.device()?;
    let obj = raw.object()?;
    if obj.get("confirm_name").and_then(Value::as_str) != Some(name.as_str()) {
        return Err(ApiError::field("confirm_name", "Type the farm name exactly to confirm"));
    }
    let defect_ids: Vec<String> = tx
        .query("SELECT d.id FROM defects d JOIN pens p ON p.id = d.pen_id WHERE p.farm_id = $1", &[&farm_id])
        .await?
        .iter()
        .map(|r| r.get(0))
        .collect();
    tx.execute("DELETE FROM farms WHERE id = $1", &[&farm_id]).await?;
    tx.commit().await?;
    app.s3.delete_prefix(&format!("farms/{farm_id}/")).await.map_err(ApiError::internal)?;
    app.drop_locks(&defect_ids).await?;
    app.emit("farm.erased", Some(&device), json!({"farm_id": farm_id, "farm_name": name})).await;
    ok(json!({"erased": farm_id}))
}

pub async fn pens(ctx: &mut Ctx) -> ApiResult<Reply> {
    let db = ctx.app.db().await?;
    let mut list = vec![];
    for pen in model::all_pen_rows(&db).await? {
        let defects = model::defects_of_pen(&db, &pen.id, false).await?;
        let latest = model::latest_revision(&db, &pen.id).await?;
        list.push(model::pen_json(&pen, &defects, &HashMap::new(), latest.as_ref(), false));
    }
    ok(json!({"pens": list}))
}

pub async fn pen(ctx: &mut Ctx, pen_id: &str) -> ApiResult<Reply> {
    let app = ctx.app.clone();
    let db = app.db().await?;
    let pen = model::pen_row(&db, pen_id).await?.ok_or_else(ApiError::not_found)?;
    ok(json!({"pen": pen_view(&app, &db, &pen).await?}))
}

pub async fn search(ctx: &mut Ctx) -> ApiResult<Reply> {
    let raw = ctx.query_param("q").unwrap_or_default();
    let query = match rules::search_query(&raw) {
        Err(message) => return Err(ApiError::field("q", message)),
        Ok(None) => return ok(json!({"results": []})),
        Ok(Some(query)) => query,
    };
    let db = ctx.app.db().await?;
    let mut results = vec![];
    for farm in db.query("SELECT id, name FROM farms ORDER BY ord", &[]).await? {
        let (id, name): (String, String) = (farm.get(0), farm.get(1));
        let sites = db.query("SELECT code, name FROM sites WHERE farm_id = $1", &[&id]).await?;
        let site_hit = sites.iter().any(|s| rules::contains_literal(&s.get::<_, String>(0), &query) || rules::contains_literal(&s.get::<_, String>(1), &query));
        if site_hit || rules::contains_literal(&name, &query) {
            results.push(json!({"kind": "farm", "id": id, "label": name}));
        }
    }
    let pens = model::all_pen_rows(&db).await?;
    for pen in &pens {
        if rules::contains_literal(&pen.name, &query) {
            results.push(json!({"kind": "pen", "id": pen.id, "label": pen.name}));
        }
    }
    let names: HashMap<&str, &str> = pens.iter().map(|p| (p.id.as_str(), p.name.as_str())).collect();
    for defect in model::all_defects(&db).await? {
        if !defect.removed && (rules::contains_literal(&defect.id, &query) || rules::contains_literal(&defect.note, &query)) {
            let pen_name = names.get(defect.pen_id.as_str()).copied().unwrap_or("");
            results.push(json!({"kind": "defect", "id": defect.id, "label": format!("{} — {pen_name}", defect.id)}));
        }
    }
    ok(json!({"results": results}))
}

fn export_row(defect: &Defect, pen: &model::PenRow) -> String {
    let derived = defect.derived(&pen.geometry);
    let cells = [
        rules::csv_text(&pen.farm_name),
        rules::csv_text(&pen.site_code),
        rules::csv_text(&pen.name),
        rules::csv_text(&defect.id),
        rules::csv_text(defect.kind.name()),
        format!("{:.1}", defect.bearing_t as f64 / 10.0),
        format!("{:.1}", defect.depth_t as f64 / 10.0),
        format!("{:.2}", derived.chart_x_h as f64 / 100.0),
        format!("{:.2}", defect.depth_t as f64 / 10.0),
        rules::csv_text(&derived.cell),
        derived.area_cm2.map(|a| a.to_string()).unwrap_or_default(),
        derived.patch_area_m2.map(|a| format!("{a:.1}")).unwrap_or_default(),
        rules::csv_text(&defect.status),
        rules::csv_text(&defect.note),
    ];
    cells.join(",")
}

pub async fn export(ctx: &mut Ctx) -> ApiResult<Reply> {
    let db = ctx.app.db().await?;
    let pens: HashMap<String, model::PenRow> = model::all_pen_rows(&db).await?.into_iter().map(|p| (p.id.clone(), p)).collect();
    let mut body = String::from("farm,site_code,pen,defect_id,type,bearing_deg,depth_m,chart_x_m,chart_y_m,cell,area_cm2,patch_area_m2,status,note\n");
    for defect in model::all_defects(&db).await?.iter().filter(|d| !d.removed) {
        if let Some(pen) = pens.get(&defect.pen_id) {
            body.push_str(&export_row(defect, pen));
            body.push('\n');
        }
    }
    Ok(Reply::Raw { content_type: "text/csv; charset=utf-8".into(), sha256: None, body: body.into_bytes(), download: Some("defects.csv".into()) })
}
