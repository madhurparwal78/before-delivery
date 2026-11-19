//! The store layer: all data access through Postgres, plus the seed.

use crate::domain::{self, DefectSummary, FoulingPatch, Grid};

use crate::pg::{Param, Pg};
use crate::s3::S3;
use std::sync::Arc;

pub struct Store {
    pub pg: Arc<Pg>,
    pub s3: Arc<S3>,
}

impl Store {
    pub fn connect(database_url: &str, s3: Arc<S3>) -> Result<Arc<Store>, String> {
        let pg = Pg::connect(database_url)?;
        Ok(Arc::new(Store { pg, s3 }))
    }

    // ---------- devices ----------

    pub fn devices(&self) -> Result<Vec<(String, String)>, String> {
        let rows = self.pg.exec("SELECT id, name FROM devices ORDER BY id", vec![])?;
        Ok(rows.rows.iter().map(|r| (r[0].as_str().unwrap_or("").to_string(), r[1].as_str().unwrap_or("").to_string())).collect())
    }

    pub fn device_name(&self, device_id: &str) -> Result<Option<String>, String> {
        let rows = self.pg.exec("SELECT name FROM devices WHERE id = $1", vec![Param::Text(device_id.into())])?;
        Ok(rows.text_opt(0, "name"))
    }

    // ---------- farms and pens ----------

    pub fn pen_grid(&self, pen_id: &str) -> Result<Grid, String> {
        let rows = self.pg.exec(
            "SELECT circumference_m, net_depth_m, grid_columns, grid_rows FROM pens WHERE id = $1",
            vec![Param::Text(pen_id.into())],
        )?;
        if rows.is_empty() { return Err("pen not found".into()); }
        Ok(Grid {
            circumference_m: rows.num_of(0, "circumference_m"),
            net_depth_m: rows.num_of(0, "net_depth_m"),
            columns: rows.int_of(0, "grid_columns") as usize,
            rows: rows.int_of(0, "grid_rows") as usize,
        })
    }

    /// Every panel of a pen, row by row, with its fouling cover from the open fouling defects.
    pub fn pen_panels(&self, grid: &Grid, pen_id: &str) -> Result<(Vec<serde_json::Value>, f64, Vec<FoulingPatch>), String> {
        // Only open, non-removed fouling defects cover panels.
        let live: Vec<FoulingPatch> = {
            let rows = self.pg.exec(
                "SELECT chart_x_m, depth_m, size->>'width_m', size->>'height_m' FROM defects \
                 WHERE pen_id = $1 AND type = 'fouling' AND status = 'open' AND removed = false ORDER BY id",
                vec![Param::Text(pen_id.into())],
            )?;
            rows.rows.iter().map(|r| FoulingPatch {
                chart_x_m: r[0].as_f64().unwrap_or(0.0),
                depth_m: r[1].as_f64().unwrap_or(0.0),
                width_m: r[2].as_str().and_then(|s| s.parse().ok()).unwrap_or(0.0),
                height_m: r[3].as_str().and_then(|s| s.parse().ok()).unwrap_or(0.0),
            }).collect()
        };
        let mut panels = Vec::new();
        let mut max_cover = 0.0f64;
        for row in 0..grid.rows {
            for col in 0..grid.columns {
                let cell = format!("{}{}", domain::base26(col), row + 1);
                let cover = domain::panel_fouling_cover_pct(grid, &cell, &live);
                if cover > max_cover { max_cover = cover; }
                panels.push(serde_json::json!({"cell": cell, "fouling_cover_pct": cover}));
            }
        }
        Ok((panels, max_cover, live))
    }

    /// The pen condition grade, open-defect count and fouling cover.
    pub fn pen_condition(&self, pen_id: &str) -> Result<(char, &'static str, i64, f64), String> {
        let grid = self.pen_grid(pen_id)?;
        let (_, max_cover, _) = self.pen_panels(&grid, pen_id)?;
        let rows = self.pg.exec(
            "SELECT type, size, status, removed FROM defects WHERE pen_id = $1 ORDER BY id",
            vec![Param::Text(pen_id.into())],
        )?;
        let mut open: Vec<DefectSummary> = Vec::new();
        let mut open_count = 0i64;
        for r in &rows.rows {
            let status = r[2].as_str().unwrap_or("");
            let removed = r[3].as_bool() == Some(true);
            if removed || status != "open" { continue; }
            open_count += 1;
            open.push(DefectSummary {
                defect_type: r[0].as_str().unwrap_or("").to_string(),
                size: r[1].clone(),
            });
        }
        let (letter, label) = domain::pen_grade(&open, max_cover);
        Ok((letter, label, open_count, max_cover))
    }

    pub fn pen_json(&self, pen_id: &str, include_defects: bool) -> Result<serde_json::Value, String> {
        self.pen_json_with_locks(pen_id, include_defects, &Default::default())
    }

    pub fn pen_json_with_locks(&self, pen_id: &str, include_defects: bool, locks: &std::collections::HashMap<String, (String, i64)>) -> Result<serde_json::Value, String> {
        let rows = self.pg.exec(
            "SELECT p.id, p.name, p.circumference_m, p.net_depth_m, p.grid_columns, p.grid_rows, p.pen_no, \
                    f.id AS farm_id, f.name AS farm_name, s.code AS site_code, s.name AS site_name, \
                    s.latitude, s.longitude \
             FROM pens p JOIN farms f ON f.id = p.farm_id JOIN sites s ON s.id = p.site_id WHERE p.id = $1",
            vec![Param::Text(pen_id.into())],
        )?;
        if rows.is_empty() { return Ok(serde_json::Value::Null); }
        let grid = Grid {
            circumference_m: rows.num_of(0, "circumference_m"),
            net_depth_m: rows.num_of(0, "net_depth_m"),
            columns: rows.int_of(0, "grid_columns") as usize,
            rows: rows.int_of(0, "grid_rows") as usize,
        };
        let (panels, max_cover, _) = self.pen_panels(&grid, pen_id)?;
        let (letter, label, open_count, _) = self.pen_condition(pen_id)?;
        let latest = self.latest_revision(pen_id)?;
        let mut pen = serde_json::json!({
            "id": rows.str_of(0, "id"),
            "farm_id": rows.str_of(0, "farm_id"),
            "farm_name": rows.str_of(0, "farm_name"),
            "site_code": rows.str_of(0, "site_code"),
            "site_name": rows.str_of(0, "site_name"),
            "pen_no": rows.int_of(0, "pen_no"),
            "name": rows.str_of(0, "name"),
            "circumference_m": rows.num_of(0, "circumference_m"),
            "net_depth_m": rows.num_of(0, "net_depth_m"),
            "grid": {"columns": grid.columns, "rows": grid.rows,
                     "panel_width_m": domain::round_to(grid.panel_width_m(), 2),
                     "panel_height_m": domain::round_to(grid.panel_height_m(), 2)},
            "grade": {"letter": letter.to_string(), "label": label},
            "open_defects": open_count,
            "max_fouling_cover_pct": max_cover,
            "panels": panels,
            "latest_revision": latest,
        });
        if include_defects {
            pen["defects"] = serde_json::Value::Array(self.defects_of_pen(pen_id, locks)?);
        }
        Ok(pen)
    }

    pub fn latest_revision(&self, pen_id: &str) -> Result<serde_json::Value, String> {
        let rows = self.pg.exec(
            "SELECT number, published_at FROM revisions WHERE pen_id = $1 ORDER BY number DESC LIMIT 1",
            vec![Param::Text(pen_id.into())],
        )?;
        if rows.is_empty() { return Ok(serde_json::Value::Null); }
        Ok(serde_json::json!({
            "number": rows.int_of(0, "number"),
            "published_at": iso(&rows.get(0, "published_at")),
        }))
    }

    pub fn defects_of_pen(&self, pen_id: &str, locks: &std::collections::HashMap<String, (String, i64)>) -> Result<Vec<serde_json::Value>, String> {
        let rows = self.pg.exec(
            "SELECT id FROM defects WHERE pen_id = $1 ORDER BY id",
            vec![Param::Text(pen_id.into())],
        )?;
        let mut out = Vec::new();
        for i in 0..rows.len() {
            let id = rows.str_of(i, "id");
            let lock = locks.get(&id).cloned();
            out.push(self.defect_json(&id, false, lock)?);
        }
        Ok(out)
    }

    pub fn defect_json(&self, defect_id: &str, include_placeholder: bool, lock: Option<(String, i64)>) -> Result<serde_json::Value, String> {
        let rows = self.pg.exec(
            "SELECT d.id, d.pen_id, d.type, d.bearing_deg, d.depth_m, d.chart_x_m, d.chart_y_m, d.cell, \
                    d.size, d.area_cm2, d.patch_area_m2, d.note, d.private_note, d.status, d.removed, d.version, d.updated_at \
             FROM defects d WHERE d.id = $1",
            vec![Param::Text(defect_id.into())],
        )?;
        if rows.is_empty() { return Ok(serde_json::Value::Null); }
        if rows.get(0, "removed").as_bool() == Some(true) {
            if include_placeholder {
                return Ok(serde_json::json!({
                    "id": rows.str_of(0, "id"), "pen_id": rows.str_of(0, "pen_id"),
                    "removed": true, "label": "Defect removed"
                }));
            }
            return Ok(serde_json::Value::Null);
        }
        let defect_id = rows.str_of(0, "id");
        let repairs = self.repairs_json(&defect_id)?;
        let stills = self.stills_json(&defect_id)?;
        let lock_json = match lock {
            Some((holder, ttl)) => self.lock_json_sync(&defect_id, Some(holder.as_str()), ttl),
            None => serde_json::Value::Null,
        };
        Ok(serde_json::json!({
            "id": defect_id,
            "pen_id": rows.str_of(0, "pen_id"),
            "type": rows.str_of(0, "type"),
            "bearing_deg": rows.num_of(0, "bearing_deg"),
            "depth_m": rows.num_of(0, "depth_m"),
            "chart_x_m": rows.num_of(0, "chart_x_m"),
            "chart_y_m": rows.num_of(0, "chart_y_m"),
            "cell": rows.str_of(0, "cell"),
            "size": parse_json(&rows.get(0, "size")),
            "area_cm2": opt_num(&rows.get(0, "area_cm2")),
            "patch_area_m2": opt_num(&rows.get(0, "patch_area_m2")),
            "note": rows.str_of(0, "note"),
            "private_note": rows.str_of(0, "private_note"),
            "status": rows.str_of(0, "status"),
            "removed": false,
            "version": rows.int_of(0, "version"),
            "repairs": repairs,
            "stills": stills,
            "lock": lock_json,
            "updated_at": iso(&rows.get(0, "updated_at")),
        }))
    }

    pub fn placeholder_json(&self, defect_id: &str) -> Result<serde_json::Value, String> {
        let rows = self.pg.exec(
            "SELECT id, pen_id FROM defects WHERE id = $1",
            vec![Param::Text(defect_id.into())],
        )?;
        if rows.is_empty() { return Ok(serde_json::Value::Null); }
        Ok(serde_json::json!({"id": rows.str_of(0, "id"), "pen_id": rows.str_of(0, "pen_id"), "removed": true, "label": "Defect removed"}))
    }

    fn repairs_json(&self, defect_id: &str) -> Result<Vec<serde_json::Value>, String> {
        let rows = self.pg.exec(
            "SELECT id, method, note, source, proposal_id, recorded_at FROM repairs WHERE defect_id = $1 ORDER BY recorded_at, id",
            vec![Param::Text(defect_id.into())],
        )?;
        Ok((0..rows.len()).map(|i| serde_json::json!({
            "id": rows.str_of(i, "id"),
            "method": rows.str_of(i, "method"),
            "note": rows.str_of(i, "note"),
            "source": rows.str_of(i, "source"),
            "proposal_id": match rows.get(i, "proposal_id") { serde_json::Value::String(s) => serde_json::json!(s), _ => serde_json::Value::Null },
            "recorded_at": iso(&rows.get(i, "recorded_at")),
        })).collect())
    }

    fn stills_json(&self, defect_id: &str) -> Result<Vec<serde_json::Value>, String> {
        let rows = self.pg.exec(
            "SELECT id, content_type, size_bytes, sha256, file_name FROM stills WHERE defect_id = $1 ORDER BY id",
            vec![Param::Text(defect_id.into())],
        )?;
        Ok((0..rows.len()).map(|i| serde_json::json!({
            "id": rows.str_of(i, "id"),
            "content_type": rows.str_of(i, "content_type"),
            "size_bytes": rows.int_of(i, "size_bytes"),
            "sha256": rows.str_of(i, "sha256"),
            "file_name": rows.str_of(i, "file_name"),
        })).collect())
    }

    fn lock_json_sync(&self, _defect_id: &str, holder: Option<&str>, ttl: i64) -> serde_json::Value {
        let holder = match holder {
            Some(h) if !h.is_empty() => h,
            _ => return serde_json::Value::Null,
        };
        let name = match self.device_name(holder) {
            Ok(Some(n)) if !n.is_empty() => n,
            _ => return serde_json::Value::Null,
        };
        serde_json::json!({"device_id": holder, "device_name": name, "expires_in_s": ttl.max(0)})
    }

    pub fn history_json(&self, defect_id: &str) -> Result<Vec<serde_json::Value>, String> {
        let rows = self.pg.exec(
            "SELECT at, device_id, device_name, action, changes, detail FROM defect_history \
             WHERE defect_id = $1 ORDER BY at, id",
            vec![Param::Text(defect_id.into())],
        )?;
        Ok((0..rows.len()).map(|i| serde_json::json!({
            "at": iso(&rows.get(i, "at")),
            "device_id": rows.str_of(i, "device_id"),
            "device_name": rows.str_of(i, "device_name"),
            "action": rows.str_of(i, "action"),
            "changes": parse_json(&rows.get(i, "changes")),
            "detail": rows.str_of(i, "detail"),
        })).collect())
    }

    pub fn pen_exists(&self, pen_id: &str) -> Result<bool, String> {
        let rows = self.pg.exec("SELECT 1 AS ok FROM pens WHERE id = $1", vec![Param::Text(pen_id.into())])?;
        Ok(!rows.is_empty())
    }

    pub fn pen_id_of_defect(&self, defect_id: &str) -> Result<Option<String>, String> {
        let rows = self.pg.exec("SELECT pen_id FROM defects WHERE id = $1", vec![Param::Text(defect_id.into())])?;
        Ok(rows.text_opt(0, "pen_id"))
    }
}

fn parse_json(v: &serde_json::Value) -> serde_json::Value {
    match v {
        serde_json::Value::String(s) => serde_json::from_str(s).unwrap_or(serde_json::Value::Null),
        other => other.clone(),
    }
}

fn opt_num(v: &serde_json::Value) -> serde_json::Value {
    match v {
        serde_json::Value::Null => serde_json::Value::Null,
        serde_json::Value::String(s) => serde_json::json!(s.parse::<f64>().ok()),
        other => other.clone(),
    }
}

pub fn iso(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => {
            if s.contains('T') { s.clone() } else { format!("{s}Z") }
        }
        _ => String::new(),
    }
}
