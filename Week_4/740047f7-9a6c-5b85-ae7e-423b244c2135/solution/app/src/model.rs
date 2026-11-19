//! Pens, defects and their views: row loaders and the JSON shapes of the published API.

use crate::error::ApiResult;
use crate::rules::{self, Geometry, Kind, OpenDefect, Patch};
use chrono::{DateTime, Utc};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use deadpool_postgres::GenericClient;
use tokio_postgres::Row;

pub struct PenRow {
    pub id: String,
    pub farm_id: String,
    pub farm_name: String,
    pub site_code: String,
    pub site_name: String,
    pub latitude: f64,
    pub longitude: f64,
    pub pen_no: i32,
    pub name: String,
    pub geometry: Geometry,
}

impl PenRow {
    fn from_row(row: &Row) -> PenRow {
        PenRow {
            id: row.get(0),
            farm_id: row.get(1),
            farm_name: row.get(2),
            site_code: row.get(3),
            site_name: row.get(4),
            latitude: row.get(5),
            longitude: row.get(6),
            pen_no: row.get(7),
            name: row.get(8),
            geometry: Geometry {
                circumference_m: row.get::<_, i32>(9) as i64,
                net_depth_m: row.get::<_, i32>(10) as i64,
                columns: row.get::<_, i32>(11) as i64,
                rows: row.get::<_, i32>(12) as i64,
            },
        }
    }
}

const PEN_SELECT: &str = "SELECT p.id, p.farm_id, f.name, p.site_code, s.name, s.latitude, s.longitude, p.pen_no, p.name, \
    p.circumference_m, p.net_depth_m, p.grid_columns, p.grid_rows \
    FROM pens p JOIN farms f ON f.id = p.farm_id JOIN sites s ON s.code = p.site_code";

pub async fn pen_row(db: &impl GenericClient, pen_id: &str) -> ApiResult<Option<PenRow>> {
    let rows = db.query(&format!("{PEN_SELECT} WHERE p.id = $1"), &[&pen_id]).await?;
    Ok(rows.first().map(PenRow::from_row))
}

pub async fn all_pen_rows(db: &impl GenericClient) -> ApiResult<Vec<PenRow>> {
    let rows = db.query(&format!("{PEN_SELECT} ORDER BY p.ord"), &[]).await?;
    Ok(rows.iter().map(PenRow::from_row).collect())
}

#[derive(Clone)]
pub struct Repair {
    pub id: String,
    pub method: String,
    pub note: String,
    pub source: String,
    pub proposal_id: Option<String>,
    pub recorded_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct Still {
    pub id: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub file_name: String,
}

#[derive(Clone)]
pub struct Defect {
    pub id: String,
    pub pen_id: String,
    pub kind: Kind,
    pub bearing_t: i64,
    pub depth_t: i64,
    pub size: Value,
    pub note: String,
    pub private_note: String,
    pub status: String,
    pub removed: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub repairs: Vec<Repair>,
    pub stills: Vec<Still>,
}

const DEFECT_COLS: &str = "id, pen_id, type, bearing_t, depth_t, size, note, private_note, status, removed, version, created_at, updated_at";

fn defect_from_row(row: &Row) -> Defect {
    let kind: String = row.get(2);
    Defect {
        id: row.get(0),
        pen_id: row.get(1),
        kind: Kind::parse(&kind).unwrap_or(Kind::Chafe),
        bearing_t: row.get::<_, i32>(3) as i64,
        depth_t: row.get::<_, i32>(4) as i64,
        size: row.get(5),
        note: row.get(6),
        private_note: row.get(7),
        status: row.get(8),
        removed: row.get(9),
        version: row.get(10),
        created_at: row.get(11),
        updated_at: row.get(12),
        repairs: vec![],
        stills: vec![],
    }
}

async fn attach_children(db: &impl GenericClient, defects: &mut [Defect]) -> ApiResult<()> {
    let ids: Vec<String> = defects.iter().map(|d| d.id.clone()).collect();
    let mut repairs: HashMap<String, Vec<Repair>> = HashMap::new();
    for row in db
        .query("SELECT defect_id, id, method, note, source, proposal_id, recorded_at FROM repairs WHERE defect_id = ANY($1) ORDER BY seq", &[&ids])
        .await?
    {
        repairs.entry(row.get(0)).or_default().push(Repair {
            id: row.get(1),
            method: row.get(2),
            note: row.get(3),
            source: row.get(4),
            proposal_id: row.get(5),
            recorded_at: row.get(6),
        });
    }
    let mut stills: HashMap<String, Vec<Still>> = HashMap::new();
    for row in db
        .query("SELECT defect_id, id, content_type, size_bytes, sha256, file_name FROM stills WHERE defect_id = ANY($1) ORDER BY seq", &[&ids])
        .await?
    {
        stills.entry(row.get(0)).or_default().push(Still {
            id: row.get(1),
            content_type: row.get(2),
            size_bytes: row.get(3),
            sha256: row.get(4),
            file_name: row.get(5),
        });
    }
    for defect in defects {
        defect.repairs = repairs.remove(&defect.id).unwrap_or_default();
        defect.stills = stills.remove(&defect.id).unwrap_or_default();
    }
    Ok(())
}

pub async fn defects_of_pen(db: &impl GenericClient, pen_id: &str, lock_rows: bool) -> ApiResult<Vec<Defect>> {
    let suffix = if lock_rows { " FOR UPDATE" } else { "" };
    let rows = db.query(&format!("SELECT {DEFECT_COLS} FROM defects WHERE pen_id = $1 ORDER BY seq{suffix}"), &[&pen_id]).await?;
    let mut defects: Vec<Defect> = rows.iter().map(defect_from_row).collect();
    attach_children(db, &mut defects).await?;
    Ok(defects)
}

pub async fn all_defects(db: &impl GenericClient) -> ApiResult<Vec<Defect>> {
    let rows = db.query(&format!("SELECT {DEFECT_COLS} FROM defects ORDER BY seq"), &[]).await?;
    let mut defects: Vec<Defect> = rows.iter().map(defect_from_row).collect();
    attach_children(db, &mut defects).await?;
    Ok(defects)
}

/// One defect; `lock_row` takes the row lock that serialises every write to it.
pub async fn defect_by_id(db: &impl GenericClient, id: &str, lock_row: bool) -> ApiResult<Option<Defect>> {
    let suffix = if lock_row { " FOR UPDATE" } else { "" };
    let rows = db.query(&format!("SELECT {DEFECT_COLS} FROM defects WHERE id = $1{suffix}"), &[&id]).await?;
    let Some(row) = rows.first() else { return Ok(None) };
    let mut defects = vec![defect_from_row(row)];
    attach_children(db, &mut defects).await?;
    Ok(defects.pop())
}

pub struct Revision {
    pub number: i32,
    pub published_at: DateTime<Utc>,
}

pub async fn latest_revision(db: &impl GenericClient, pen_id: &str) -> ApiResult<Option<Revision>> {
    let rows = db
        .query("SELECT number, published_at FROM report_revisions WHERE pen_id = $1 ORDER BY number DESC LIMIT 1", &[&pen_id])
        .await?;
    Ok(rows.first().map(|r| Revision { number: r.get(0), published_at: r.get(1) }))
}

// ------------------------------------------------------------------ views

pub struct LockInfo {
    pub device_id: String,
    pub device_name: String,
    pub expires_in_s: i64,
}

impl LockInfo {
    pub fn json(&self) -> Value {
        json!({"device_id": self.device_id, "device_name": self.device_name, "expires_in_s": self.expires_in_s})
    }
}

pub struct Derived {
    pub chart_x_h: i64,
    pub cell: String,
    pub area_cm2: Option<i64>,
    pub patch_area_m2: Option<f64>,
}

impl Defect {
    pub fn derived(&self, g: &Geometry) -> Derived {
        Derived {
            chart_x_h: rules::chart_x_h(g, self.bearing_t),
            cell: rules::cell(g, self.bearing_t, self.depth_t),
            area_cm2: rules::area_cm2(self.kind, &self.size),
            patch_area_m2: (self.kind == Kind::Fouling).then(|| Patch::of(g, self.bearing_t, self.depth_t, &self.size).area_m2(g)),
        }
    }
    pub fn is_open(&self) -> bool {
        !self.removed && self.status == "open"
    }
}

pub fn inspector_json(d: &Defect, g: &Geometry, lock: Option<&LockInfo>) -> Value {
    let derived = d.derived(g);
    json!({
        "id": d.id, "pen_id": d.pen_id, "type": d.kind.name(),
        "bearing_deg": d.bearing_t as f64 / 10.0, "depth_m": d.depth_t as f64 / 10.0,
        "chart_x_m": derived.chart_x_h as f64 / 100.0, "chart_y_m": d.depth_t as f64 / 10.0, "cell": derived.cell,
        "size": d.size, "area_cm2": derived.area_cm2, "patch_area_m2": derived.patch_area_m2,
        "note": d.note, "private_note": d.private_note, "status": d.status, "removed": false, "version": d.version,
        "repairs": d.repairs.iter().map(|r| json!({
            "id": r.id, "method": r.method, "note": r.note, "source": r.source,
            "proposal_id": r.proposal_id, "recorded_at": rules::iso(r.recorded_at)})).collect::<Vec<_>>(),
        "stills": d.stills.iter().map(still_json).collect::<Vec<_>>(),
        "lock": lock.map(LockInfo::json),
        "updated_at": rules::iso(d.updated_at),
    })
}

pub fn still_json(s: &Still) -> Value {
    json!({"id": s.id, "content_type": s.content_type, "size_bytes": s.size_bytes, "sha256": s.sha256, "file_name": s.file_name})
}

pub fn placeholder_json(d: &Defect) -> Value {
    json!({"id": d.id, "pen_id": d.pen_id, "removed": true, "label": "Defect removed"})
}

pub fn defect_json(d: &Defect, g: &Geometry, lock: Option<&LockInfo>) -> Value {
    if d.removed {
        placeholder_json(d)
    } else {
        inspector_json(d, g, lock)
    }
}

/// The public defect: no private note, version, lock, stills or update time; repairs reduced.
pub fn public_json(d: &Defect, g: &Geometry) -> Value {
    if d.removed {
        return placeholder_json(d);
    }
    let Value::Object(mut full) = inspector_json(d, g, None) else { return Value::Null };
    for key in ["private_note", "version", "lock", "stills", "updated_at"] {
        full.remove(key);
    }
    let repairs: Vec<Value> = d
        .repairs
        .iter()
        .map(|r| json!({"method": r.method, "note": r.note, "recorded_at": rules::iso(r.recorded_at)}))
        .collect();
    full.insert("repairs".into(), Value::Array(repairs));
    Value::Object(full)
}

pub struct Summary {
    pub letter: &'static str,
    pub label: &'static str,
    pub open: usize,
    pub max_cover_t: i64,
    pub covers: Vec<i64>,
}

pub fn summarize(g: &Geometry, defects: &[Defect]) -> Summary {
    let open: Vec<&Defect> = defects.iter().filter(|d| d.is_open()).collect();
    let patches: Vec<Patch> =
        open.iter().filter(|d| d.kind == Kind::Fouling).map(|d| Patch::of(g, d.bearing_t, d.depth_t, &d.size)).collect();
    let covers = rules::panel_cover_tenths(g, &patches);
    let max_cover_t = covers.iter().copied().max().unwrap_or(0);
    let facts: Vec<OpenDefect> = open
        .iter()
        .map(|d| OpenDefect {
            kind: d.kind,
            area_cm2: rules::area_cm2(d.kind, &d.size),
            length_cm: d.size.get("length_cm").and_then(Value::as_i64).unwrap_or(0),
        })
        .collect();
    let (letter, label) = rules::grade(&facts, max_cover_t);
    Summary { letter, label, open: open.len(), max_cover_t, covers }
}

impl Summary {
    pub fn grade_json(&self) -> Value {
        json!({"letter": self.letter, "label": self.label})
    }
    pub fn panels_json(&self, g: &Geometry) -> Value {
        let mut panels = vec![];
        for row in 0..g.rows {
            for column in 0..g.columns {
                panels.push(json!({"cell": rules::cell_name(column, row), "fouling_cover_pct": rules::pct(self.covers[(row * g.columns + column) as usize])}));
            }
        }
        Value::Array(panels)
    }
}

pub fn grid_json(g: &Geometry) -> Value {
    json!({"columns": g.columns, "rows": g.rows,
        "panel_width_m": g.panel_width_h() as f64 / 100.0, "panel_height_m": g.panel_height_h() as f64 / 100.0})
}

pub fn pen_json(pen: &PenRow, defects: &[Defect], locks: &HashMap<String, LockInfo>, latest: Option<&Revision>, detail: bool) -> Value {
    let g = &pen.geometry;
    let summary = summarize(g, defects);
    let mut out = Map::new();
    out.insert("id".into(), json!(pen.id));
    out.insert("farm_id".into(), json!(pen.farm_id));
    out.insert("farm_name".into(), json!(pen.farm_name));
    out.insert("site_code".into(), json!(pen.site_code));
    out.insert("site_name".into(), json!(pen.site_name));
    out.insert("pen_no".into(), json!(pen.pen_no));
    out.insert("name".into(), json!(pen.name));
    out.insert("circumference_m".into(), json!(g.circumference_m));
    out.insert("net_depth_m".into(), json!(g.net_depth_m));
    out.insert("grid".into(), grid_json(g));
    out.insert("grade".into(), summary.grade_json());
    out.insert("open_defects".into(), json!(summary.open));
    out.insert("max_fouling_cover_pct".into(), json!(rules::pct(summary.max_cover_t)));
    if detail {
        out.insert("panels".into(), summary.panels_json(g));
        out.insert("defects".into(), Value::Array(defects.iter().map(|d| defect_json(d, g, locks.get(&d.id))).collect()));
    }
    out.insert(
        "latest_revision".into(),
        latest.map(|r| json!({"number": r.number, "published_at": rules::iso(r.published_at)})).unwrap_or(Value::Null),
    );
    Value::Object(out)
}

// ------------------------------------------------------------------ history fields

/// The flat, named fields of a defect that history entries compare.
pub fn history_fields(d: &Defect, g: &Geometry) -> Map<String, Value> {
    let derived = d.derived(g);
    let mut fields = Map::new();
    fields.insert("bearing_deg".into(), json!(d.bearing_t as f64 / 10.0));
    fields.insert("depth_m".into(), json!(d.depth_t as f64 / 10.0));
    fields.insert("chart_x_m".into(), json!(derived.chart_x_h as f64 / 100.0));
    fields.insert("chart_y_m".into(), json!(d.depth_t as f64 / 10.0));
    fields.insert("cell".into(), json!(derived.cell));
    for key in d.kind.size_keys() {
        fields.insert(format!("size.{key}"), d.size.get(key).cloned().unwrap_or(Value::Null));
    }
    fields.insert("note".into(), json!(d.note));
    fields.insert("private_note".into(), json!(d.private_note));
    fields.insert("status".into(), json!(d.status));
    fields
}

/// `before: None` lists every field with a null before; otherwise only the fields that changed.
pub fn diff(before: Option<&Map<String, Value>>, after: &Map<String, Value>) -> Value {
    let mut changes = Map::new();
    for (key, value) in after {
        let old = before.and_then(|b| b.get(key));
        if before.is_none() || old != Some(value) {
            changes.insert(key.clone(), json!({"before": old.cloned().unwrap_or(Value::Null), "after": value}));
        }
    }
    Value::Object(changes)
}
