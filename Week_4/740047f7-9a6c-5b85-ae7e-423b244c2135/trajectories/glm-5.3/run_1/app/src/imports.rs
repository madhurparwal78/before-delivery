//! Legacy CSV import: parsing, matching by site code and pen number,
//! merging nearby same-type marks, the import ledger and the replay rule.

use crate::api::{err, internal, json_response, now_iso, App};
use crate::domain::{self, FoulingPatch, Grid};
use crate::infra::ApiResult;
use crate::pg::Param;
use crate::s3::sha256_hex;
use axum::response::Response;
use serde_json::{json, Value};

const HEADER: [&str; 9] = ["site_code", "pen_no", "observed_at", "kind", "bearing", "depth_m", "size_a_cm", "size_b_cm", "note"];
const FILE_LIMIT: usize = 2_000_000;

pub struct Csv {
    pub sep: char,
    pub rows: Vec<Vec<String>>,
}

pub fn parse_csv(bytes: &[u8]) -> Option<Csv> {
    let mut text = String::from_utf8_lossy(bytes).into_owned();
    if text.starts_with('\u{FEFF}') { text.remove(0); }
    let sep = if text.lines().next().unwrap_or("").contains(';') { ';' } else { ',' };
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut field = String::new();
    let mut row: Vec<String> = Vec::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();
    let mut started = false;
    while let Some(c) = chars.next() {
        match c {
            '"' if in_quotes => {
                if chars.peek() == Some(&'"') { field.push('"'); chars.next(); }
                else { in_quotes = false; }
            }
            '"' => { in_quotes = true; started = true; }
            _ if c == sep && !in_quotes => { row.push(take(&mut field, started)); started = false; }
            '\r' if !in_quotes && chars.peek() == Some(&'\n') => { chars.next(); row.push(take(&mut field, started)); started = false; rows.push(take_row(&mut row)); }
            '\n' if !in_quotes => { row.push(take(&mut field, started)); started = false; rows.push(take_row(&mut row)); }
            _ => { field.push(c); started = true; }
        }
    }
    if !field.is_empty() || started || !row.is_empty() {
        row.push(take(&mut field, started));
        rows.push(take_row(&mut row));
    }
    if rows.is_empty() { return None; }
    let header = rows[0].iter().map(|h| h.trim().to_lowercase()).collect::<Vec<_>>();
    if header.len() != HEADER.len() || HEADER.iter().zip(&header).any(|(want, got)| want != got) {
        return None;
    }
    Some(Csv { sep, rows: rows[1..].to_vec() })
}

fn take(field: &mut String, started: bool) -> String {
    if !started && field.is_empty() { return String::new(); }
    std::mem::take(field)
}

fn take_row(row: &mut Vec<String>) -> Vec<String> {
    let r = std::mem::take(row);
    r.into_iter().map(|c| c).collect()
}

fn parse_number(s: &str, sep: char) -> Option<f64> {
    let t = s.trim();
    if t.is_empty() { return None; }
    let t = if sep == ';' { t.replace(',', ".") } else { t.to_string() };
    t.parse::<f64>().ok()
}

impl App {
    pub async fn farm_imports(&self, farm_id: &str) -> ApiResult<Response> {
        let rows = self.store.pg.exec("SELECT 1 AS ok FROM farms WHERE id = $1", vec![Param::Text(farm_id.into())]).map_err(internal)?;
        if rows.is_empty() { return Err(err(404, "not_found", "Not found")); }
        let imports = self.store.pg.exec(
            "SELECT id FROM imports WHERE farm_id = $1 ORDER BY imported_at DESC, id DESC", vec![Param::Text(farm_id.into())]).map_err(internal)?;
        let mut out = Vec::new();
        for i in 0..imports.len() {
            out.push(self.import_json(&imports.str_of(i, "id")).map_err(internal)?);
        }
        Ok(json_response(200, &json!({"imports": out})))
    }

    pub fn import_json(&self, import_id: &str) -> Result<Value, String> {
        let rows = self.store.pg.exec(
            "SELECT id, farm_id, file_name, sha256, size_bytes, imported_at, rows, created, merged, already_imported, orphans, invalid FROM imports WHERE id = $1",
            vec![Param::Text(import_id.into())])?;
        if rows.is_empty() { return Ok(Value::Null); }
        Ok(json!({
            "id": rows.str_of(0, "id"), "farm_id": rows.str_of(0, "farm_id"),
            "file_name": rows.str_of(0, "file_name"), "sha256": rows.str_of(0, "sha256"),
            "size_bytes": rows.int_of(0, "size_bytes"), "imported_at": fix_iso(rows.get(0, "imported_at")),
            "rows": rows.int_of(0, "rows"),
            "created": parse_col(&rows.get(0, "created")),
            "merged": parse_col(&rows.get(0, "merged")),
            "already_imported": parse_col(&rows.get(0, "already_imported")),
            "orphans": parse_col(&rows.get(0, "orphans")),
            "invalid": parse_col(&rows.get(0, "invalid")),
        }))
    }

    pub async fn import_raw(&self, import_id: &str) -> ApiResult<Response> {
        let rows = self.store.pg.exec("SELECT farm_id, sha256 FROM imports WHERE id = $1", vec![Param::Text(import_id.into())]).map_err(internal)?;
        if rows.is_empty() { return Err(err(404, "not_found", "Not found")); }
        let key = format!("farms/{}/imports/{}.csv", rows.str_of(0, "farm_id"), import_id);
        let bytes = self.store.s3.get(&key).await.map_err(internal)?;
        Ok(crate::defects::raw_response(bytes, "text/csv; charset=utf-8", &rows.str_of(0, "sha256")))
    }

    pub async fn import_csv(&self, farm_id: &str, bytes: Vec<u8>, file_name: &str) -> ApiResult<Response> {
        let exists = self.store.pg.exec("SELECT 1 AS ok FROM farms WHERE id = $1", vec![Param::Text(farm_id.into())]).map_err(internal)?;
        if exists.is_empty() { return Err(err(404, "not_found", "Not found")); }
        if bytes.is_empty() { return Err(crate::validate::one_field("file", "Upload body is empty")); }
        if bytes.len() > FILE_LIMIT {
            return Err(err(413, "too_large", "Import file is larger than 2,000,000 bytes"));
        }
        // Imports of one farm are applied one at a time, in arrival order.
        let guard = self.locks.import(farm_id);
        let _g = guard.lock().await;
        let sha = sha256_hex(&bytes);
        let replay = self.store.pg.exec(
            "SELECT id FROM imports WHERE farm_id = $1 AND sha256 = $2",
            vec![Param::Text(farm_id.into()), Param::Text(sha.clone())]).map_err(internal)?;
        if !replay.is_empty() {
            let import = self.import_json(&replay.str_of(0, "id")).map_err(internal)?;
            return Ok(json_response(200, &json!({"import": import, "replayed": true})));
        }
        let csv = parse_csv(&bytes).ok_or_else(|| crate::validate::one_field("file", "Import file has no recognisable header"))?;

        let mut created: Vec<Value> = Vec::new();
        let mut merged: Vec<Value> = Vec::new();
        let mut already: Vec<Value> = Vec::new();
        let mut orphans: Vec<Value> = Vec::new();
        let mut invalid: Vec<Value> = Vec::new();
        let mut fingerprints: Vec<String> = Vec::new();
        let data_rows = csv.rows.len() as i64;
        for (idx, row) in csv.rows.iter().enumerate() {
            let row_no = idx as i64 + 2;
            if row.iter().all(|c| c.trim().is_empty()) { continue; }
            let site_code = row.get(0).cloned().unwrap_or_default();
            let pen_no_text = row.get(1).cloned().unwrap_or_default();
            let kind = row.get(3).cloned().unwrap_or_default().trim().to_uppercase();
            let bearing_text = row.get(4).cloned().unwrap_or_default();
            let depth_text = row.get(5).cloned().unwrap_or_default();
            let size_a = row.get(6).cloned().unwrap_or_default();
            let size_b = row.get(7).cloned().unwrap_or_default();
            let note = row.get(8).cloned().unwrap_or_default();
            if row.len() < 8 { invalid.push(json!({"row": row_no, "reason": "Row has too few columns"})); continue; }

            // Match the pen by site code and pen number.
            let pen_no = pen_no_text.trim().trim_start_matches('0').parse::<i64>().ok();
            let pen = match pen_no {
                Some(n) => self.store.pg.exec(
                    "SELECT p.id, p.circumference_m, p.net_depth_m, p.grid_columns, p.grid_rows FROM pens p JOIN sites s ON s.id = p.site_id \
                     WHERE p.farm_id = $1 AND lower(s.code) = lower($2) AND p.pen_no = $3",
                    vec![Param::Text(farm_id.into()), Param::Text(site_code.trim().into()), Param::Int(n)]).map_err(internal)?,
                None => self.store.pg.exec("SELECT p.id FROM pens p WHERE 1 = 0", vec![]).map_err(internal)?,
            };
            let pen_id = if pen.is_empty() { None } else { Some(pen.str_of(0, "id")) };
            let pen_id = match pen_id {
                Some(p) => p,
                None => {
                    orphans.push(json!({"row": row_no, "site_code": site_code.trim(), "pen_no": pen_no_text.trim()}));
                    continue;
                }
            };
            let grid = Grid {
                circumference_m: pen.num_of(0, "circumference_m"),
                net_depth_m: pen.num_of(0, "net_depth_m"),
                columns: pen.int_of(0, "grid_columns") as usize,
                rows: pen.int_of(0, "grid_rows") as usize,
            };
            let defect_type = match kind.as_str() {
                "HOLE" => "hole",
                "TEAR" => "tear",
                "CHAFE" => "chafe",
                "FOULING" => "fouling",
                _ => { invalid.push(json!({"row": row_no, "reason": "Unknown kind"})); continue; }
            };
            let bearing = match parse_number(&bearing_text, csv.sep) { Some(b) if b.is_finite() => b, _ => { invalid.push(json!({"row": row_no, "reason": "Bearing is not a number"})); continue; } };
            let depth = match parse_number(&depth_text, csv.sep) { Some(d) if d.is_finite() => d, _ => { invalid.push(json!({"row": row_no, "reason": "Depth is not a number"})); continue; } };
            if depth < 0.0 || depth > grid.net_depth_m {
                invalid.push(json!({"row": row_no, "reason": format!("Depth must be between 0 and {}", grid.net_depth_m)}));
                continue;
            }
            let a = parse_number(&size_a, csv.sep);
            let b = parse_number(&size_b, csv.sep);
            let (a, b) = match (a, b) { (Some(x), Some(y)) => (x, y), _ => { invalid.push(json!({"row": row_no, "reason": "Sizes are not numbers"})); continue; } };
            let size = match defect_type {
                "hole" => {
                    if !(1.0..=2000.0).contains(&a) || !(1.0..=2000.0).contains(&b) || a.fract() != 0.0 || b.fract() != 0.0 {
                        invalid.push(json!({"row": row_no, "reason": "Hole sizes must be whole centimetres from 1 to 2,000"})); continue;
                    }
                    json!({"width_cm": a as i64, "height_cm": b as i64})
                }
                "tear" => {
                    if !(1.0..=2000.0).contains(&a) || !(0.0..=200.0).contains(&b) || a.fract() != 0.0 || b.fract() != 0.0 {
                        invalid.push(json!({"row": row_no, "reason": "Tear sizes must be whole centimetres, length 1 to 2,000 and gap 0 to 200"})); continue;
                    }
                    json!({"length_cm": a as i64, "gap_cm": b as i64})
                }
                "chafe" => {
                    if !(1.0..=2000.0).contains(&a) || !(1.0..=200.0).contains(&b) || a.fract() != 0.0 || b.fract() != 0.0 {
                        invalid.push(json!({"row": row_no, "reason": "Chafe sizes must be whole centimetres, length 1 to 2,000 and width 1 to 200"})); continue;
                    }
                    json!({"length_cm": a as i64, "width_cm": b as i64})
                }
                _ => {
                    let wm = domain::round_to(a / 100.0, 1);
                    let hm = domain::round_to(b / 100.0, 1);
                    if !(0.1..=100.0).contains(&wm) || !(0.1..=100.0).contains(&hm) {
                        invalid.push(json!({"row": row_no, "reason": "Fouling sizes must be from 0.1 to 100.0 m"})); continue;
                    }
                    json!({"width_m": wm, "height_m": hm})
                }
            };
            let pos = domain::position_for(&grid, bearing, depth);
            // Fingerprint: farm, normalised site code and pen number, kind, normalised bearing, depth, both sizes, note.
            let fingerprint = format!("{}|{}|{}|{}|{}|{}|{}|{}|{}",
                farm_id, site_code.trim().to_lowercase(), pen_no_text.trim().trim_start_matches('0'),
                defect_type, pos.bearing_deg, pos.depth_m, serde_json::to_string(&size).unwrap_or_default(), note, csv.sep);
            let ledger = self.store.pg.exec(
                "SELECT defect_id FROM import_ledger WHERE farm_id = $1 AND fingerprint = $2",
                vec![Param::Text(farm_id.into()), Param::Text(fingerprint.clone())]).map_err(internal)?;
            if !ledger.is_empty() {
                already.push(json!({"row": row_no, "defect_id": ledger.str_of(0, "defect_id")}));
                continue;
            }
            if fingerprints.contains(&fingerprint) {
                let existing = created.iter().chain(merged.iter())
                    .find(|c| c["fingerprint"].as_str() == Some(fingerprint.as_str()));
                if let Some(e) = existing {
                    already.push(json!({"row": row_no, "defect_id": e["defect_id"].clone()}));
                }
                continue;
            }
            // Merge into the nearest existing same-type defect.
            let candidates = self.store.pg.exec(
                "SELECT id, chart_x_m, depth_m FROM defects WHERE pen_id = $1 AND type = $2 AND removed = false AND status IN ('open','repaired') ORDER BY id",
                vec![Param::Text(pen_id.clone()), Param::Text(defect_type.into())]).map_err(internal)?;
            let mut best: Option<(String, f64, f64)> = None;
            for ci in 0..candidates.len() {
                let cx = candidates.num_of(ci, "chart_x_m");
                let cd = candidates.num_of(ci, "depth_m");
                let dist = wrap_distance(pos.chart_x_m, cx, grid.circumference_m);
                let ddiff = (pos.depth_m - cd).abs();
                if dist <= 1.00 && ddiff <= 1.0 {
                    match &best {
                        Some((_, bd, bdd)) if (dist, ddiff) >= (*bd, *bdd) => {}
                        _ => best = Some((candidates.str_of(ci, "id"), dist, ddiff)),
                    }
                    let _ = best.as_ref().map(|(bid, bd, bdd)| (bid.clone(), *bd, *bdd));
                }
            }
            let at = now_iso();
            let device_name = "Topside laptop";
            let device_id = "DEV-1";
            match best {
                Some((target, _, _)) => {
                    self.write_history(&target, &at, device_id, device_name, "merged", &json!({}), "")?;
                    let detail = format!("import row {row_no}");
                    self.store.pg.exec("UPDATE defect_history SET detail = $2, import_row = $3 WHERE defect_id = $1 AND action = 'merged' AND detail = ''",
                        vec![Param::Text(target.clone()), Param::Text(detail.clone()), Param::Int(row_no)]).map_err(internal)?;
                    merged.push(json!({"row": row_no, "defect_id": target.clone(), "fingerprint": fingerprint}));
                    fingerprints.push(fingerprint);
                    let _ = (device_name, device_id);
                }
                None => {
                    let id = self.next_defect_id()?;
                    let area = domain::defect_area_cm2(defect_type, &size);
                    let patch_area = if defect_type == "fouling" {
                        Some(FoulingPatch {
                            chart_x_m: pos.chart_x_m, depth_m: pos.depth_m,
                            width_m: size.get("width_m").and_then(|v| v.as_f64()).unwrap_or(0.0),
                            height_m: size.get("height_m").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        }.clipped_area_m2(&grid))
                    } else { None };
                    self.store.pg.exec(
                        "INSERT INTO defects (id, pen_id, type, bearing_deg, depth_m, chart_x_m, chart_y_m, cell, size, area_cm2, patch_area_m2, note, private_note, status, removed, version, created_at, updated_at) \
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'','open',false,1,$13,$13)",
                        vec![Param::Text(id.clone()), Param::Text(pen_id.clone()), Param::Text(defect_type.into()),
                             Param::Float(pos.bearing_deg), Param::Float(pos.depth_m), Param::Float(pos.chart_x_m), Param::Float(pos.chart_y_m),
                             Param::Text(pos.cell.clone()), Param::Json(size.clone()),
                             area.map(Param::Float).unwrap_or(Param::Null),
                             patch_area.map(Param::Float).unwrap_or(Param::Null),
                             Param::Text(note.clone()), Param::Timestamp(crate::api::ts_of(&at))]).map_err(internal)?;
                    created.push(json!({"row": row_no, "defect_id": id.clone(), "fingerprint": fingerprint}));
                    fingerprints.push(fingerprint);
                    let _ = (device_name, device_id);
                }
            }
        }
        // Store the import and its ledger rows.
        let import_id = self.next_prefixed_id("IM", "imports")?;
        let at = now_iso();
        let key = format!("farms/{farm_id}/imports/{import_id}.csv");
        self.store.s3.put(&key, &bytes, "text/csv").await.map_err(internal)?;
        self.store.pg.exec(
            "INSERT INTO imports (id, farm_id, file_name, sha256, size_bytes, imported_at, rows, created, merged, already_imported, orphans, invalid) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
            vec![Param::Text(import_id.clone()), Param::Text(farm_id.into()), Param::Text(file_name.into()),
                 Param::Text(sha), Param::Int(bytes.len() as i64), Param::Timestamp(crate::api::ts_of(&at)), Param::Int(data_rows),
                 Param::Json(strip_fp(&created)), Param::Json(strip_fp(&merged)), Param::Json(strip_fp(&already)),
                 Param::Json(json!(orphans)), Param::Json(json!(invalid))]).map_err(internal)?;
        for entry in created.iter().chain(merged.iter()) {
            let fp = entry["fingerprint"].as_str().unwrap_or("");
            self.store.pg.exec(
                "INSERT INTO import_ledger (farm_id, fingerprint, import_id, row_no, defect_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (farm_id, fingerprint) DO NOTHING",
                vec![Param::Text(farm_id.into()), Param::Text(fp.into()), Param::Text(import_id.clone()),
                     Param::Int(entry["row"].as_i64().unwrap_or(0)), Param::Text(entry["defect_id"].as_str().unwrap_or("").into())]).map_err(internal)?;
        }
        self.broadcast(json!({"kind": "imported", "farm_id": farm_id})).await;
        let import = self.import_json(&import_id).map_err(internal)?;
        Ok(json_response(201, &json!({"import": import, "replayed": false})))
    }
}

fn strip_fp(v: &[Value]) -> Value {
    Value::Array(v.iter().map(|e| {
        let mut o = e.clone();
        if let Some(map) = o.as_object_mut() { map.remove("fingerprint"); }
        o
    }).collect())
}

fn parse_col(v: &Value) -> Value {
    match v {
        Value::String(s) => serde_json::from_str(s).unwrap_or(json!([])),
        other => other.clone(),
    }
}

fn fix_iso(v: Value) -> String {
    match v { Value::String(s) => { if s.contains('T') { s } else { format!("{s}Z") } }, _ => String::new() }
}

fn wrap_distance(a: f64, b: f64, circ: f64) -> f64 {
    let d = (a - b).abs().min(circ - (a - b).abs());
    d
}
