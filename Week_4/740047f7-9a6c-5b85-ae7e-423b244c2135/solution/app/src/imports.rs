//! Legacy CSV imports: parsing, pen matching, merging, the import ledger and one-at-a-time application per farm.

use crate::app::{created, ok, Ctx, Reply, IMPORT_LIMIT};
use crate::db;
use crate::defects::insert_defect;
use crate::error::{ApiError, ApiResult};
use crate::model::{self, Defect, PenRow};
use crate::rules::{self, Geometry, Kind};
use crate::s3::sha256_hex;
use chrono::Utc;
use serde_json::{json, Value};
use std::collections::HashMap;

const HEADER: [&str; 9] = ["site_code", "pen_no", "observed_at", "kind", "bearing", "depth_m", "size_a_cm", "size_b_cm", "note"];

/// Splits CSV text into records; quoted fields may hold the separator and line breaks.
fn parse_records(text: &str, separator: char) -> Vec<Vec<String>> {
    let (mut records, mut record, mut field) = (vec![], vec![], String::new());
    let (mut quoted, mut was_quoted) = (false, false);
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            } else {
                field.push(c);
            }
        } else if c == '"' && field.is_empty() && !was_quoted {
            quoted = true;
            was_quoted = true;
        } else if c == separator {
            record.push(std::mem::take(&mut field));
            was_quoted = false;
        } else if c == '\n' || c == '\r' {
            if c == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            record.push(std::mem::take(&mut field));
            was_quoted = false;
            records.push(std::mem::take(&mut record));
        } else {
            field.push(c);
        }
    }
    if !field.is_empty() || !record.is_empty() || was_quoted {
        record.push(field);
        records.push(record);
    }
    records
}

struct Row {
    site_code: String,
    pen_no: String,
    kind: String,
    bearing: String,
    depth: String,
    size_a: String,
    size_b: String,
    note: String,
}

fn number(text: &str, decimal_comma: bool) -> Option<f64> {
    let cleaned = if decimal_comma { text.replace(',', ".") } else { text.to_string() };
    cleaned.parse::<f64>().ok().filter(|v| v.is_finite())
}

struct Valid {
    kind: Kind,
    bearing_t: i64,
    depth_t: i64,
    size: Value,
}

fn validate(row: &Row, g: &Geometry, decimal_comma: bool) -> Result<Valid, String> {
    let kind = Kind::parse(&row.kind.to_lowercase()).ok_or("kind must be HOLE, TEAR, CHAFE or FOULING")?;
    let bearing = number(&row.bearing, decimal_comma).ok_or("bearing is not a number")?;
    let depth = number(&row.depth, decimal_comma).ok_or("depth_m is not a number")?;
    let depth_t = rules::depth_tenths(depth);
    if !rules::depth_in_range(g, depth_t) {
        return Err(format!("depth_m must be between 0 and {}", g.net_depth_m));
    }
    let (a, b) = (number(&row.size_a, decimal_comma).ok_or("size_a_cm is not a number")?, number(&row.size_b, decimal_comma).ok_or("size_b_cm is not a number")?);
    let [first, second] = kind.size_keys();
    let scale = if kind == Kind::Fouling { 100.0 } else { 1.0 };
    let given = json!({first: a / scale, second: b / scale});
    let size = rules::validate_size(kind, Some(&given)).map_err(|errors| errors.first().map(|e| e.1.clone()).unwrap_or_default())?;
    Ok(Valid { kind, bearing_t: rules::bearing_tenths(bearing), depth_t, size: Value::Object(size) })
}

fn fingerprint(farm: &str, site: &str, pen_no: i64, row: &Row, valid: &Valid) -> String {
    sha256_hex(format!("{farm}|{site}|{pen_no}|{}|{}|{}|{}|{}|{}", valid.kind.name(), valid.bearing_t, valid.depth_t, valid.size, row.note.len(), row.note).as_bytes())
}

/// The wrap-aware chart-x distance in hundredths of a metre.
fn wrap_distance(g: &Geometry, a: i64, b: i64) -> i64 {
    let around = g.circumference_m * 100;
    let d = (a - b).abs();
    d.min(around - d)
}

fn nearest<'a>(g: &Geometry, defects: &'a [Defect], valid: &Valid) -> Option<&'a Defect> {
    let x = rules::chart_x_h(g, valid.bearing_t);
    defects
        .iter()
        .filter(|d| !d.removed && d.kind == valid.kind)
        .map(|d| (wrap_distance(g, rules::chart_x_h(g, d.bearing_t), x), (d.depth_t - valid.depth_t).abs(), d))
        .filter(|(dx, dd, _)| *dx <= 100 && *dd <= 10)
        .min_by(|a, b| (a.0, a.1, &a.2.id).cmp(&(b.0, b.1, &b.2.id)))
        .map(|(_, _, d)| d)
}

fn import_json(row: &tokio_postgres::Row) -> Value {
    let mut out = json!({
        "id": row.get::<_, String>(0), "farm_id": row.get::<_, String>(1), "file_name": row.get::<_, String>(2),
        "sha256": row.get::<_, String>(3), "size_bytes": row.get::<_, i64>(4), "imported_at": rules::iso(row.get(5)), "rows": row.get::<_, i32>(6),
    });
    if let (Some(target), Value::Object(result)) = (out.as_object_mut(), row.get::<_, Value>(7)) {
        target.extend(result);
    }
    out
}

const IMPORT_COLS: &str = "id, farm_id, file_name, sha256, size_bytes, imported_at, rows, result";

pub async fn list(ctx: &mut Ctx, farm_id: &str) -> ApiResult<Reply> {
    let db = ctx.app.db().await?;
    if db.query("SELECT 1 FROM farms WHERE id = $1", &[&farm_id]).await?.is_empty() {
        return Err(ApiError::not_found());
    }
    let rows = db.query(&format!("SELECT {IMPORT_COLS} FROM imports WHERE farm_id = $1 ORDER BY seq DESC"), &[&farm_id]).await?;
    ok(json!({"imports": rows.iter().map(import_json).collect::<Vec<_>>()}))
}

pub async fn raw(ctx: &mut Ctx, import_id: &str) -> ApiResult<Reply> {
    let app = ctx.app.clone();
    let db = app.db().await?;
    let rows = db.query("SELECT farm_id, sha256, file_name FROM imports WHERE id = $1", &[&import_id]).await?;
    let row = rows.first().ok_or_else(ApiError::not_found)?;
    let farm: String = row.get(0);
    let body = app.s3.get(&format!("farms/{farm}/imports/{import_id}.csv")).await.map_err(ApiError::internal)?.ok_or_else(ApiError::not_found)?;
    Ok(Reply::Raw { content_type: "text/csv".into(), sha256: Some(row.get(1)), body, download: Some(row.get(2)) })
}

fn farm_lock_key(farm_id: &str) -> i64 {
    let digest = sha256_hex(farm_id.as_bytes());
    i64::from_str_radix(&digest[..15], 16).unwrap_or(0)
}

pub async fn import(ctx: &mut Ctx, farm_id: &str) -> ApiResult<Reply> {
    let bytes = ctx.read(IMPORT_LIMIT).await?;
    let app = ctx.app.clone();
    let mut db = app.db().await?;
    let tx = db.transaction().await?;
    if tx.query("SELECT 1 FROM farms WHERE id = $1", &[&farm_id]).await?.is_empty() {
        return Err(ApiError::not_found());
    }
    let device = ctx.device()?;
    if bytes.is_empty() {
        return Err(ApiError::field("file", "The import file is empty"));
    }
    tx.execute("SELECT pg_advisory_xact_lock($1)", &[&farm_lock_key(farm_id)]).await?;
    let sha = sha256_hex(&bytes);
    let earlier = tx.query(&format!("SELECT {IMPORT_COLS} FROM imports WHERE farm_id = $1 AND sha256 = $2 ORDER BY seq LIMIT 1"), &[&farm_id, &sha]).await?;
    if let Some(row) = earlier.first() {
        return Ok(Reply::Json(200, json!({"import": import_json(row), "replayed": true})));
    }
    let text = String::from_utf8_lossy(&bytes);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let first_line = text.lines().next().unwrap_or("");
    let separator = if first_line.contains(';') { ';' } else { ',' };
    let records = parse_records(text, separator);
    let names: Vec<String> = records.first().map(|h| h.iter().map(|c| c.trim().to_lowercase()).collect()).unwrap_or_default();
    let column: Option<Vec<usize>> = HEADER.iter().map(|h| names.iter().position(|n| n == h)).collect();
    let Some(column) = column else { return Err(ApiError::field("file", "No recognisable header row")) };

    let pens: Vec<PenRow> = model::all_pen_rows(&tx).await?.into_iter().filter(|p| p.farm_id == farm_id).collect();
    let mut by_pen: HashMap<String, Vec<Defect>> = HashMap::new();
    for pen in &pens {
        by_pen.insert(pen.id.clone(), model::defects_of_pen(&tx, &pen.id, true).await?);
    }
    let import_number = db::next_number(&tx, "import_seq").await?;
    let import_id = db::make_id("IM-", import_number);
    let now = Utc::now();
    let (mut made, mut merged, mut already, mut orphans, mut invalid) = (vec![], vec![], vec![], vec![], vec![]);
    let mut touched: Vec<String> = vec![];
    let mut data_rows = 0;
    for (index, record) in records.iter().enumerate().skip(1) {
        if record.iter().all(|c| c.trim().is_empty()) {
            continue;
        }
        data_rows += 1;
        let row_no = index + 1;
        let cell = |i: usize| record.get(column[i]).cloned().unwrap_or_default();
        let trimmed = |i: usize| cell(i).trim().to_string();
        let row = Row {
            site_code: trimmed(0), pen_no: trimmed(1), kind: trimmed(3), bearing: trimmed(4), depth: trimmed(5),
            size_a: trimmed(6), size_b: trimmed(7), note: cell(8),
        };
        let wanted_no = row.pen_no.parse::<i64>().ok();
        let pen = pens.iter().find(|p| p.site_code.eq_ignore_ascii_case(&row.site_code) && Some(p.pen_no as i64) == wanted_no);
        let Some(pen) = pen else {
            orphans.push(json!({"row": row_no, "site_code": row.site_code, "pen_no": row.pen_no}));
            continue;
        };
        let valid = match validate(&row, &pen.geometry, separator == ';') {
            Ok(valid) => valid,
            Err(reason) => {
                invalid.push(json!({"row": row_no, "reason": reason}));
                continue;
            }
        };
        let print = fingerprint(farm_id, &pen.site_code.to_lowercase(), pen.pen_no as i64, &row, &valid);
        let seen = tx.query("SELECT defect_id FROM import_ledger WHERE farm_id = $1 AND fingerprint = $2", &[&farm_id, &print]).await?;
        if let Some(entry) = seen.first() {
            already.push(json!({"row": row_no, "defect_id": entry.get::<_, String>(0)}));
            continue;
        }
        let defects = by_pen.entry(pen.id.clone()).or_default();
        let detail = format!("{import_id} row {row_no}");
        let (defect_id, action, changes) = match nearest(&pen.geometry, defects, &valid).map(|d| d.id.clone()) {
            Some(target) => {
                merged.push(json!({"row": row_no, "defect_id": target}));
                (target, "merged", json!({}))
            }
            None => {
                let number = db::next_number(&tx, "defect_seq").await?;
                let id = db::make_id("D-", number);
                insert_defect(&tx, &id, number, pen, valid.kind, valid.bearing_t, valid.depth_t, &valid.size, &row.note, "", now).await?;
                let defect = model::defect_by_id(&tx, &id, false).await?.ok_or_else(ApiError::not_found)?;
                let changes = model::diff(None, &model::history_fields(&defect, &pen.geometry));
                defects.push(defect);
                made.push(json!({"row": row_no, "defect_id": id}));
                (id, "imported", changes)
            }
        };
        db::insert_history(&tx, &defect_id, now, &device.id, &device.name, action, &changes, &detail).await?;
        tx.execute("INSERT INTO import_ledger (farm_id, fingerprint, defect_id, import_id) VALUES ($1,$2,$3,$4)", &[&farm_id, &print, &defect_id, &import_id]).await?;
        if !touched.contains(&pen.id) {
            touched.push(pen.id.clone());
        }
    }
    let file_name = ctx.file_name();
    let result = json!({"created": made, "merged": merged, "already_imported": already, "orphans": orphans, "invalid": invalid});
    app.s3.put(&format!("farms/{farm_id}/imports/{import_id}.csv"), bytes.to_vec(), "text/csv").await.map_err(ApiError::internal)?;
    tx.execute(
        "INSERT INTO imports (id, seq, farm_id, file_name, sha256, size_bytes, imported_at, rows, result) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        &[&import_id, &import_number, &farm_id, &file_name, &sha, &(bytes.len() as i64), &now, &(data_rows as i32), &result],
    )
    .await?;
    let stored = tx.query_one(&format!("SELECT {IMPORT_COLS} FROM imports WHERE id = $1"), &[&import_id]).await?;
    let body = import_json(&stored);
    tx.commit().await?;
    app.emit("import.created", Some(&device), json!({"farm_id": farm_id, "pen_ids": touched})).await;
    created(json!({"import": body, "replayed": false}))
}
