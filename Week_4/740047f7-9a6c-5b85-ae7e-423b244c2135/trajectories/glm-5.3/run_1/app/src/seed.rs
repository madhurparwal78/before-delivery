//! The idempotent seed: exactly the farms, sites, pens, defects, repair, dive and
//! report revision the brief lists, with the derived values printed there.

use crate::domain::{self, Grid};
use crate::pg::Param;
use crate::s3::S3;
use crate::store::Store;
use chrono::{DateTime, Utc};
use std::sync::Arc;

const CREATED_AT: &str = "2026-11-02T08:30:00Z";
const REPAIR_AT: &str = "2026-11-02T09:05:00Z";
const PUBLISHED_AT: &str = "2026-11-02T10:15:00Z";

fn ts(s: &str) -> DateTime<Utc> {
    chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%SZ")
        .map(|t| t.and_utc())
        .unwrap_or_else(|_| Utc::now())
}

pub async fn apply(store: &Arc<Store>, s3: &Arc<S3>) -> Result<(), String> {
    let pg = &store.pg;
    pg.exec_script(include_str!("schema.sql"))?;

    // Farms, sites and pens.
    pg.exec("INSERT INTO farms (id, name, day_rate_amount, day_rate_currency) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
        vec![Param::Text("skarvholmen".into()), Param::Text("Skarvholmen Laks".into()), Param::Int(14500), Param::Text("NOK".into())])?;
    pg.exec("INSERT INTO farms (id, name, day_rate_amount, day_rate_currency) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
        vec![Param::Text("kalamos".into()), Param::Text("Kalamos Marine".into()), Param::Int(950), Param::Text("EUR".into())])?;
    pg.exec("INSERT INTO sites (id, farm_id, code, name, latitude, longitude) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING",
        vec![Param::Text("skv".into()), Param::Text("skarvholmen".into()), Param::Text("SKV".into()), Param::Text("Skarvholmen North".into()), Param::Float(63.4512), Param::Float(8.7321)])?;
    pg.exec("INSERT INTO sites (id, farm_id, code, name, latitude, longitude) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING",
        vec![Param::Text("klm".into()), Param::Text("kalamos".into()), Param::Text("KLM".into()), Param::Text("Kalamos Bay".into()), Param::Float(38.6215), Param::Float(20.9013)])?;
    for (pen_id, farm_id, site, no, name, circ, depth, cols, rows) in [
        ("skv-01", "skarvholmen", "skv", 1, "Skarvholmen 01", 160.0f64, 20.0f64, 16, 4),
        ("skv-02", "skarvholmen", "skv", 2, "Skarvholmen 02", 160.0, 20.0, 16, 4),
        ("skv-03", "skarvholmen", "skv", 3, "Skarvholmen 03", 120.0, 15.0, 12, 3),
        ("klm-04", "kalamos", "klm", 4, "Kalamos 04", 90.0, 12.0, 9, 3),
    ] {
        pg.exec("INSERT INTO pens (id, farm_id, site_id, pen_no, name, circumference_m, net_depth_m, grid_columns, grid_rows) \
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING",
            vec![Param::Text(pen_id.into()), Param::Text(farm_id.into()), Param::Text(site.into()), Param::Int(no), Param::Text(name.into()),
                 Param::Float(circ), Param::Float(depth), Param::Int(cols), Param::Int(rows)])?;
    }

    pg.exec("INSERT INTO devices (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING",
        vec![Param::Text("DEV-1".into()), Param::Text("Topside laptop".into())])?;
    pg.exec("INSERT INTO devices (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING",
        vec![Param::Text("DEV-2".into()), Param::Text("Deck tablet".into())])?;

    // Defects. All positions, cells, areas and patch areas are derived by the domain rules.
    let created = ts(CREATED_AT);
    let seeds: [(&str, &str, &str, f64, f64, &str, &str, &str); 8] = [
        ("D-0001", "skv-01", "hole", 112.5, 12.4, r#"{"width_cm":30,"height_cm":24}"#, "Hole beside seam, edges frayed", "Farm saw a seal near this pen on 28 October"),
        ("D-0002", "skv-01", "tear", 236.7, 4.8, r#"{"length_cm":45,"gap_cm":6}"#, "Seam tear along vertical rope", ""),
        ("D-0003", "skv-01", "chafe", 300.0, 18.2, r#"{"length_cm":120,"width_cm":15}"#, "Chafe where the sinker tube rubs", "Bill this re-check at half rate"),
        ("D-0004", "skv-01", "fouling", 0.9, 2.0, r#"{"width_m":6.0,"height_m":3.0}"#, "Mussel and kelp growth near surface", ""),
        ("D-0005", "skv-01", "fouling", 202.5, 5.0, r#"{"width_m":4.0,"height_m":4.0}"#, "Hydroid fouling on panel join", ""),
        ("D-0006", "skv-01", "hole", 45.0, 8.0, r#"{"width_cm":10,"height_cm":10}"#, "Small hole, laced on last visit", ""),
        ("D-0007", "skv-02", "chafe", 90.0, 10.0, r#"{"length_cm":40,"width_cm":5}"#, "Light chafe at mooring bridle", ""),
        ("D-0008", "klm-04", "fouling", 180.0, 6.0, r#"{"width_m":5.0,"height_m":2.0}"#, "Algal film on lower panels", ""),
    ];
    for (id, pen_id, ty, bearing, depth, size, note, private_note) in seeds {
        let grid = grid_of(store, pen_id)?;
        let pos = domain::position_for(&grid, bearing, depth);
        let size_val: serde_json::Value = serde_json::from_str(size).map_err(|e| e.to_string())?;
        let area = domain::defect_area_cm2(ty, &size_val);
        let patch_area = fouling_patch_area(ty, &pos, &grid, &size_val);
        let exists = pg.exec("SELECT 1 AS ok FROM defects WHERE id = $1", vec![Param::Text(id.into())])?;
        if exists.is_empty() {
            pg.exec("INSERT INTO defects (id, pen_id, type, bearing_deg, depth_m, chart_x_m, chart_y_m, cell, size, area_cm2, patch_area_m2, note, private_note, status, removed, version, created_at, updated_at) \
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'open',false,1,$14,$14)",
                vec![Param::Text(id.into()), Param::Text(pen_id.into()), Param::Text(ty.into()),
                     Param::Float(pos.bearing_deg), Param::Float(pos.depth_m), Param::Float(pos.chart_x_m), Param::Float(pos.chart_y_m),
                     Param::Text(pos.cell.clone()), Param::Json(size_val.clone()),
                     area.map(Param::Float).unwrap_or(Param::Null),
                     patch_area.map(Param::Float).unwrap_or(Param::Null),
                     Param::Text(note.into()), Param::Text(private_note.into()), Param::Timestamp(created)])?;
            pg.exec("INSERT INTO defect_history (defect_id, at, device_id, device_name, action, changes, detail) VALUES ($1,$2,$3,$4,'created',$5,'new defect')",
                vec![Param::Text(id.into()), Param::Timestamp(created), Param::Text("DEV-1".into()), Param::Text("Topside laptop".into()),
                     Param::Json(created_changes(ty, &pos, area, patch_area, &size_val, note, private_note))])?;
        }
    }

    // Repair on D-0006, by the Topside laptop.
    let exists = pg.exec("SELECT 1 AS ok FROM repairs WHERE id = 'R-0001'", vec![])?;
    if exists.is_empty() {
        pg.exec("INSERT INTO repairs (id, defect_id, method, note, source, proposal_id, recorded_at, device_id, device_name) \
                 SELECT 'R-0001','D-0006','lace','Laced with 3 mm twine','manual',NULL,$1,'DEV-1','Topside laptop' WHERE NOT EXISTS (SELECT 1 FROM repairs WHERE id = 'R-0001')",
            vec![Param::Timestamp(ts(REPAIR_AT))])?;
        pg.exec("UPDATE defects SET status = 'repaired', version = 2, updated_at = $1 WHERE id = 'D-0006' AND status = 'open'",
            vec![Param::Timestamp(ts(REPAIR_AT))])?;
        pg.exec("INSERT INTO defect_history (defect_id, at, device_id, device_name, action, changes, detail) \
                 SELECT 'D-0006',$1,'DEV-1','Topside laptop','repaired','{\"status\":{\"before\":\"open\",\"after\":\"repaired\"}}','lace' WHERE NOT EXISTS (SELECT 1 FROM defect_history WHERE defect_id = 'D-0006' AND action = 'repaired')",
            vec![Param::Timestamp(ts(REPAIR_AT))])?;
    }

    // The seeded recorded dive.
    let exists = pg.exec("SELECT 1 AS ok FROM dives WHERE id = 'DIVE-0001'", vec![])?;
    if exists.is_empty() {
        let hours = serde_json::json!([
            {"time": "2026-11-02T08:00Z", "current_m_s": 0.25, "wave_m": 0.6, "within_limits": true},
            {"time": "2026-11-02T09:00Z", "current_m_s": 0.22, "wave_m": 0.7, "within_limits": true}
        ]);
        pg.exec("INSERT INTO dives (id, pen_id, status, planned_start, planned_minutes, diver_certificate_no, started_at, finished_at, clearance, clearance_checked_at, clearance_issued_at) \
                 SELECT 'DIVE-0001','skv-01','recorded',$1,90,'NO-ROV-48213',$2,$3,$4,$5,$6 WHERE NOT EXISTS (SELECT 1 FROM dives WHERE id = 'DIVE-0001')",
            vec![Param::Timestamp(ts("2026-11-02T08:00:00Z")), Param::Timestamp(ts("2026-11-02T08:04:00Z")),
                 Param::Timestamp(ts("2026-11-02T09:21:00Z")), Param::Json(serde_json::json!({
                     "result": "GO",
                     "message": "GO — every planned hour is within limits",
                     "checked_at": "2026-11-02T07:40:00Z",
                     "issued_at": "2026-11-02T06:00:00Z",
                     "hours": hours,
                 })),
                 Param::Timestamp(ts("2026-11-02T07:40:00Z")), Param::Timestamp(ts("2026-11-02T06:00:00Z"))])?;
        for (t, b, d) in [(0i64, 0.0f64, 1.0f64), (600, 45.0, 8.0), (1500, 112.5, 12.0), (2700, 202.5, 5.0), (3600, 300.0, 17.5), (4620, 355.0, 2.0)] {
            pg.exec("INSERT INTO dive_track (dive_id, t_s, bearing_deg, depth_m) SELECT 'DIVE-0001',$1,$2,$3 WHERE NOT EXISTS (SELECT 1 FROM dive_track WHERE dive_id = 'DIVE-0001' AND t_s = $1)",
                vec![Param::Int(t), Param::Float(b), Param::Float(d)])?;
        }
    }

    // Report revision 1 of Skarvholmen 01, with its pack in MinIO.
    let exists = pg.exec("SELECT 1 AS ok FROM revisions WHERE pen_id = 'skv-01' AND number = 1", vec![])?;
    if exists.is_empty() {
        let grid = grid_of(store, "skv-01")?;
        let snapshot = snapshot_of(store, "skv-01")?;
        let pack = build_pack("skv-01", 1, ts(PUBLISHED_AT), store, &grid, &snapshot)?;
        let sha = crate::s3::sha256_hex(&pack);
        pg.exec("INSERT INTO revisions (pen_id, number, published_at, sha256, size_bytes, grade_letter, open_defects, snapshot) \
                 VALUES ('skv-01',1,$1,$2,$3,'D',5,$4)",
            vec![Param::Timestamp(ts(PUBLISHED_AT)), Param::Text(sha.clone()), Param::Int(pack.len() as i64), Param::Json(snapshot.clone())])?;
        for link in snapshot["stills"].as_array().cloned().unwrap_or_default() {
            pg.exec("INSERT INTO revision_still_links (revision_id, still_id, defect_id) \
                     SELECT id, $1, $2 FROM revisions WHERE pen_id='skv-01' AND number=1",
                vec![Param::Text(link["id"].as_str().unwrap_or("").to_string()), Param::Text(link["defect_id"].as_str().unwrap_or("").to_string())])?;
        }
        s3.put("farms/skarvholmen/reports/skv-01/revision-1.json", &pack, "application/json").await?;
    }

    Ok(())
}

fn grid_of(store: &Arc<Store>, pen_id: &str) -> Result<Grid, String> {
    store.pen_grid(pen_id)
}

fn fouling_patch_area(ty: &str, pos: &domain::Position, grid: &Grid, size: &serde_json::Value) -> Option<f64> {
    if ty != "fouling" { return None; }
    let w = size.get("width_m").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let h = size.get("height_m").and_then(|v| v.as_f64()).unwrap_or(0.0);
    Some(domain::FoulingPatch { chart_x_m: pos.chart_x_m, depth_m: pos.depth_m, width_m: w, height_m: h }.clipped_area_m2(grid))
}

fn created_changes(ty: &str, pos: &domain::Position, area: Option<f64>, patch_area: Option<f64>, size: &serde_json::Value, note: &str, private_note: &str) -> serde_json::Value {
    let mut changes = serde_json::json!({
        "bearing_deg": {"before": null, "after": pos.bearing_deg},
        "depth_m": {"before": null, "after": pos.depth_m},
        "chart_x_m": {"before": null, "after": pos.chart_x_m},
        "chart_y_m": {"before": null, "after": pos.chart_y_m},
        "cell": {"before": null, "after": pos.cell},
        "note": {"before": null, "after": note},
        "private_note": {"before": null, "after": private_note},
    });
    for (k, v) in size.as_object().into_iter().flatten() {
        changes[format!("size.{k}")] = serde_json::json!({"before": null, "after": v});
    }
    if let Some(a) = area {
        changes["area_cm2"] = serde_json::json!({"before": null, "after": a});
    }
    if let Some(a) = patch_area {
        changes["patch_area_m2"] = serde_json::json!({"before": null, "after": a});
    }
    let _ = ty;
    changes
}

pub fn snapshot_of(store: &Arc<Store>, pen_id: &str) -> Result<serde_json::Value, String> {
    let defects = store.defects_of_pen(pen_id, &Default::default())?;
    Ok(serde_json::json!({ "defects": defects }))
}

pub fn build_pack(pen_id: &str, number: i64, published_at: DateTime<Utc>, store: &Arc<Store>, grid: &Grid, snapshot: &serde_json::Value) -> Result<Vec<u8>, String> {
    let rows = store.pg.exec(
        "SELECT p.name, p.circumference_m, p.net_depth_m, p.grid_columns, p.grid_rows, f.name AS farm_name, s.code AS site_code, s.name AS site_name \
         FROM pens p JOIN farms f ON f.id = p.farm_id JOIN sites s ON s.id = p.site_id WHERE p.id = $1",
        vec![Param::Text(pen_id.into())])?;
    let (panels, max_cover, _) = store.pen_panels(grid, pen_id)?;
    let (letter, label, open_count, _) = store.pen_condition(pen_id)?;
    let mut defects = Vec::new();
    for d in snapshot["defects"].as_array().cloned().unwrap_or_default() {
        if d["removed"].as_bool() == Some(true) {
            defects.push(d);
            continue;
        }
        let mut public = d.clone();
        for k in ["private_note", "version", "lock", "stills", "updated_at"] {
            public.as_object_mut().map(|o| o.remove(k));
        }
        let mut repairs = Vec::new();
        for r in d["repairs"].as_array().cloned().unwrap_or_default() {
            repairs.push(serde_json::json!({
                "method": r["method"], "note": r["note"], "recorded_at": r["recorded_at"],
            }));
        }
        public["repairs"] = serde_json::Value::Array(repairs);
        public["stills"] = d["stills"].as_array().cloned().unwrap_or_default()
            .into_iter().map(|s| serde_json::json!({"id": s["id"], "sha256": s["sha256"], "size_bytes": s["size_bytes"]})).collect::<Vec<_>>().into();
        defects.push(public);
    }
    let pack = serde_json::json!({
        "format": "pensight-report-pack-1",
        "revision": number,
        "published_at": published_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        "farm": {"name": rows.str_of(0, "farm_name")},
        "site": {"code": rows.str_of(0, "site_code"), "name": rows.str_of(0, "site_name")},
        "pen": {"id": pen_id, "name": rows.str_of(0, "name"),
                "circumference_m": rows.num_of(0, "circumference_m"), "net_depth_m": rows.num_of(0, "net_depth_m"),
                "grid": {"columns": grid.columns, "rows": grid.rows,
                         "panel_width_m": domain::round_to(grid.panel_width_m(), 2),
                         "panel_height_m": domain::round_to(grid.panel_height_m(), 2)}},
        "grade": {"letter": letter.to_string(), "label": label},
        "open_defects": open_count,
        "max_fouling_cover_pct": max_cover,
        "panels": panels,
        "defects": defects,
    });
    Ok(serde_json::to_vec_pretty(&pack).map_err(|e| e.to_string())?)
}
