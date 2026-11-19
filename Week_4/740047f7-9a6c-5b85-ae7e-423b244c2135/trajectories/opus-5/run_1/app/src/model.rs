use crate::domain::grade::{self, Grade, OpenDefect};
use crate::domain::position::PenGrid;
use crate::domain::size::{self, DefectType, FoulingPatchInput, Size};
use crate::domain::{clearance, link, round_to};
use crate::error::{ApiError, ApiResult};
use crate::valkey::{EditLock, Live};
use chrono::{DateTime, SecondsFormat, Utc};
use deadpool_postgres::GenericClient;
use serde_json::{json, Map, Value};

pub fn stamp(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[derive(Clone, Debug)]
pub struct PenRecord {
    pub id: String,
    pub farm_id: String,
    pub farm_name: String,
    pub site_code: String,
    pub site_name: String,
    pub latitude: f64,
    pub longitude: f64,
    pub pen_no: i32,
    pub name: String,
    pub circumference_m: f64,
    pub net_depth_m: f64,
    pub columns: i32,
    pub rows: i32,
}

impl PenRecord {
    pub fn grid(&self) -> PenGrid {
        PenGrid {
            circumference_m: self.circumference_m,
            net_depth_m: self.net_depth_m,
            columns: self.columns,
            rows: self.rows,
        }
    }

    pub fn grid_json(&self) -> Value {
        let grid = self.grid();
        json!({
            "columns": self.columns,
            "rows": self.rows,
            "panel_width_m": round_to(grid.panel_width_m(), 2),
            "panel_height_m": round_to(grid.panel_height_m(), 2),
        })
    }
}

#[derive(Clone, Debug)]
pub struct DefectRecord {
    pub id: String,
    pub pen_id: String,
    pub farm_id: String,
    pub defect_type: DefectType,
    pub bearing_deg: f64,
    pub depth_m: f64,
    pub chart_x_m: f64,
    pub chart_y_m: f64,
    pub cell: String,
    pub size: Size,
    pub note: String,
    pub private_note: String,
    pub status: String,
    pub removed: bool,
    pub version: i32,
    pub updated_at: DateTime<Utc>,
}

impl DefectRecord {
    pub fn area_cm2(&self) -> Option<i64> {
        size::area_cm2(self.size)
    }

    pub fn patch_area_m2(&self, grid: PenGrid) -> Option<f64> {
        size::patch_area_m2(self.chart_x_m, self.depth_m, self.size, grid)
    }

    pub fn is_open(&self) -> bool {
        !self.removed && self.status == "open"
    }
}

const PEN_COLUMNS: &str = "p.id, p.farm_id, f.name, p.site_code, s.name, s.latitude, s.longitude, \
     p.pen_no, p.name, p.circumference_m, p.net_depth_m, p.grid_columns, p.grid_rows";

fn pen_from_row(row: &tokio_postgres::Row) -> PenRecord {
    PenRecord {
        id: row.get(0),
        farm_id: row.get(1),
        farm_name: row.get(2),
        site_code: row.get(3),
        site_name: row.get(4),
        latitude: row.get(5),
        longitude: row.get(6),
        pen_no: row.get(7),
        name: row.get(8),
        circumference_m: row.get(9),
        net_depth_m: row.get(10),
        columns: row.get(11),
        rows: row.get(12),
    }
}

pub async fn load_pens<C: GenericClient>(client: &C) -> ApiResult<Vec<PenRecord>> {
    let sql = format!(
        "select {PEN_COLUMNS} from pens p \
         join farms f on f.id = p.farm_id join sites s on s.code = p.site_code order by p.ord"
    );
    let rows = client.query(sql.as_str(), &[]).await?;
    Ok(rows.iter().map(pen_from_row).collect())
}

pub async fn load_pen<C: GenericClient>(client: &C, pen_id: &str) -> ApiResult<Option<PenRecord>> {
    let sql = format!(
        "select {PEN_COLUMNS} from pens p \
         join farms f on f.id = p.farm_id join sites s on s.code = p.site_code where p.id = $1"
    );
    let rows = client.query(sql.as_str(), &[&pen_id]).await?;
    Ok(rows.first().map(pen_from_row))
}

pub async fn require_pen<C: GenericClient>(client: &C, pen_id: &str) -> ApiResult<PenRecord> {
    load_pen(client, pen_id)
        .await?
        .ok_or_else(ApiError::not_found)
}

const DEFECT_COLUMNS: &str = "id, pen_id, farm_id, type, bearing_deg, depth_m, chart_x_m, \
     chart_y_m, cell, size, note, private_note, status, removed, version, updated_at";

fn defect_from_row(row: &tokio_postgres::Row) -> ApiResult<DefectRecord> {
    let raw_type: String = row.get(3);
    let defect_type = DefectType::parse(&raw_type)
        .ok_or_else(|| ApiError::internal("stored defect type is not known"))?;
    let raw_size: Value = row.get(9);
    let size = Size::from_json(defect_type, &raw_size)
        .ok_or_else(|| ApiError::internal("stored defect size is not usable"))?;
    Ok(DefectRecord {
        id: row.get(0),
        pen_id: row.get(1),
        farm_id: row.get(2),
        defect_type,
        bearing_deg: row.get(4),
        depth_m: row.get(5),
        chart_x_m: row.get(6),
        chart_y_m: row.get(7),
        cell: row.get(8),
        size,
        note: row.get(10),
        private_note: row.get(11),
        status: row.get(12),
        removed: row.get(13),
        version: row.get(14),
        updated_at: row.get(15),
    })
}

pub async fn load_pen_defects<C: GenericClient>(
    client: &C,
    pen_id: &str,
) -> ApiResult<Vec<DefectRecord>> {
    let sql = format!("select {DEFECT_COLUMNS} from defects where pen_id = $1 order by id");
    let rows = client.query(sql.as_str(), &[&pen_id]).await?;
    rows.iter().map(defect_from_row).collect()
}

pub async fn load_defect<C: GenericClient>(
    client: &C,
    defect_id: &str,
) -> ApiResult<Option<DefectRecord>> {
    let sql = format!("select {DEFECT_COLUMNS} from defects where id = $1");
    let rows = client.query(sql.as_str(), &[&defect_id]).await?;
    rows.first().map(defect_from_row).transpose()
}

/// Reads the defect row with a row lock, so writes to one defect are applied
/// one at a time.
pub async fn load_defect_for_update<C: GenericClient>(
    client: &C,
    defect_id: &str,
) -> ApiResult<Option<DefectRecord>> {
    let sql = format!("select {DEFECT_COLUMNS} from defects where id = $1 for update");
    let rows = client.query(sql.as_str(), &[&defect_id]).await?;
    rows.first().map(defect_from_row).transpose()
}

pub async fn load_repairs<C: GenericClient>(
    client: &C,
    defect_ids: &[String],
) -> ApiResult<Vec<(String, Value)>> {
    let rows = client
        .query(
            "select defect_id, id, method, note, source, proposal_id, recorded_at from repairs \
             where defect_id = any($1) order by recorded_at, ord",
            &[&defect_ids],
        )
        .await?;
    Ok(rows
        .iter()
        .map(|row| {
            let defect_id: String = row.get(0);
            let proposal_id: Option<String> = row.get(5);
            let recorded_at: DateTime<Utc> = row.get(6);
            (
                defect_id,
                json!({
                    "id": row.get::<_, String>(1),
                    "method": row.get::<_, String>(2),
                    "note": row.get::<_, String>(3),
                    "source": row.get::<_, String>(4),
                    "proposal_id": proposal_id,
                    "recorded_at": stamp(recorded_at),
                }),
            )
        })
        .collect())
}

pub async fn load_stills<C: GenericClient>(
    client: &C,
    defect_ids: &[String],
) -> ApiResult<Vec<(String, Value)>> {
    let rows = client
        .query(
            "select defect_id, id, content_type, size_bytes, sha256, file_name from stills \
             where defect_id = any($1) order by id",
            &[&defect_ids],
        )
        .await?;
    Ok(rows
        .iter()
        .map(|row| {
            (
                row.get::<_, String>(0),
                json!({
                    "id": row.get::<_, String>(1),
                    "content_type": row.get::<_, String>(2),
                    "size_bytes": row.get::<_, i64>(3),
                    "sha256": row.get::<_, String>(4),
                    "file_name": row.get::<_, String>(5),
                }),
            )
        })
        .collect())
}

fn of_defect(pairs: &[(String, Value)], defect_id: &str) -> Vec<Value> {
    pairs
        .iter()
        .filter(|(owner, _)| owner == defect_id)
        .map(|(_, value)| value.clone())
        .collect()
}

pub struct PenCondition {
    pub grade: Grade,
    pub open_defects: i64,
    pub panels: Vec<(String, f64)>,
    pub max_fouling_cover_pct: f64,
}

/// The pen's derived condition: fouling cover per panel and the grade.
pub fn condition(pen: &PenRecord, defects: &[DefectRecord]) -> PenCondition {
    let grid = pen.grid();
    let open: Vec<&DefectRecord> = defects.iter().filter(|d| d.is_open()).collect();
    let patches: Vec<FoulingPatchInput> = open
        .iter()
        .filter(|d| d.defect_type == DefectType::Fouling)
        .map(|d| FoulingPatchInput {
            chart_x_m: d.chart_x_m,
            depth_m: d.depth_m,
            size: d.size,
        })
        .collect();
    let panels = size::panel_cover_pct(&patches, grid);
    let max_fouling_cover_pct = panels
        .iter()
        .map(|(_, pct)| *pct)
        .fold(0.0f64, |best, pct| best.max(pct));
    let open_facts: Vec<OpenDefect> = open
        .iter()
        .map(|d| OpenDefect {
            defect_type: d.defect_type,
            size: d.size,
            area_cm2: d.area_cm2(),
        })
        .collect();
    PenCondition {
        grade: grade::grade(&open_facts, max_fouling_cover_pct),
        open_defects: open.len() as i64,
        panels,
        max_fouling_cover_pct,
    }
}

pub fn grade_json(grade: Grade) -> Value {
    json!({"letter": grade.letter, "label": grade.label})
}

pub fn panels_json(panels: &[(String, f64)]) -> Value {
    Value::Array(
        panels
            .iter()
            .map(|(cell, pct)| json!({"cell": cell, "fouling_cover_pct": pct}))
            .collect(),
    )
}

pub fn placeholder_json(id: &str, pen_id: &str) -> Value {
    json!({"id": id, "pen_id": pen_id, "removed": true, "label": "Defect removed"})
}

pub fn defect_json(
    defect: &DefectRecord,
    grid: PenGrid,
    repairs: Vec<Value>,
    stills: Vec<Value>,
    lock: Option<&EditLock>,
    lock_device_name: Option<&str>,
) -> Value {
    if defect.removed {
        return placeholder_json(&defect.id, &defect.pen_id);
    }
    json!({
        "id": defect.id,
        "pen_id": defect.pen_id,
        "type": defect.defect_type.as_str(),
        "bearing_deg": defect.bearing_deg,
        "depth_m": defect.depth_m,
        "chart_x_m": defect.chart_x_m,
        "chart_y_m": defect.chart_y_m,
        "cell": defect.cell,
        "size": defect.size.to_json(),
        "area_cm2": defect.area_cm2(),
        "patch_area_m2": defect.patch_area_m2(grid),
        "note": defect.note,
        "private_note": defect.private_note,
        "status": defect.status,
        "removed": false,
        "version": defect.version,
        "repairs": repairs,
        "stills": stills,
        "lock": lock.map(|lock| json!({
            "device_id": lock.device_id,
            "device_name": lock_device_name.unwrap_or(lock.device_id.as_str()),
            "expires_in_s": lock.expires_in_s,
        })),
        "updated_at": stamp(defect.updated_at),
    })
}

/// The public defect: no private note, version, lock, stills or updated_at, and
/// each repair reduced to method, note and the time it was recorded.
pub fn public_defect_json(defect: &DefectRecord, grid: PenGrid, repairs: &[Value]) -> Value {
    if defect.removed {
        return placeholder_json(&defect.id, &defect.pen_id);
    }
    json!({
        "id": defect.id,
        "pen_id": defect.pen_id,
        "type": defect.defect_type.as_str(),
        "bearing_deg": defect.bearing_deg,
        "depth_m": defect.depth_m,
        "chart_x_m": defect.chart_x_m,
        "chart_y_m": defect.chart_y_m,
        "cell": defect.cell,
        "size": defect.size.to_json(),
        "area_cm2": defect.area_cm2(),
        "patch_area_m2": defect.patch_area_m2(grid),
        "note": defect.note,
        "status": defect.status,
        "removed": false,
        "repairs": Value::Array(
            repairs
                .iter()
                .map(|repair| json!({
                    "method": repair.get("method").cloned().unwrap_or(Value::Null),
                    "note": repair.get("note").cloned().unwrap_or(Value::Null),
                    "recorded_at": repair.get("recorded_at").cloned().unwrap_or(Value::Null),
                }))
                .collect(),
        ),
    })
}

pub async fn latest_revision<C: GenericClient>(
    client: &C,
    pen_id: &str,
) -> ApiResult<Option<(i32, DateTime<Utc>)>> {
    let rows = client
        .query(
            "select number, published_at from report_revisions where pen_id = $1 order by number desc limit 1",
            &[&pen_id],
        )
        .await?;
    Ok(rows.first().map(|row| (row.get(0), row.get(1))))
}

pub async fn device_names<C: GenericClient>(client: &C) -> ApiResult<Vec<(String, String)>> {
    let rows = client
        .query("select id, name from devices order by ord", &[])
        .await?;
    Ok(rows
        .iter()
        .map(|row| (row.get(0), row.get(1)))
        .collect())
}

/// The full pen object, with panels and defects when asked for.
pub async fn pen_payload<C: GenericClient>(
    client: &C,
    live: &Live,
    pen: &PenRecord,
    detail: bool,
) -> ApiResult<Value> {
    let defects = load_pen_defects(client, &pen.id).await?;
    let condition = condition(pen, &defects);
    let revision = latest_revision(client, &pen.id).await?;
    let mut body = Map::new();
    body.insert("id".into(), Value::String(pen.id.clone()));
    body.insert("farm_id".into(), Value::String(pen.farm_id.clone()));
    body.insert("farm_name".into(), Value::String(pen.farm_name.clone()));
    body.insert("site_code".into(), Value::String(pen.site_code.clone()));
    body.insert("site_name".into(), Value::String(pen.site_name.clone()));
    body.insert("pen_no".into(), Value::from(pen.pen_no));
    body.insert("name".into(), Value::String(pen.name.clone()));
    body.insert("circumference_m".into(), Value::from(pen.circumference_m));
    body.insert("net_depth_m".into(), Value::from(pen.net_depth_m));
    body.insert("grid".into(), pen.grid_json());
    body.insert("grade".into(), grade_json(condition.grade));
    body.insert("open_defects".into(), Value::from(condition.open_defects));
    body.insert(
        "max_fouling_cover_pct".into(),
        Value::from(condition.max_fouling_cover_pct),
    );
    body.insert(
        "latest_revision".into(),
        match revision {
            Some((number, published_at)) => {
                json!({"number": number, "published_at": stamp(published_at)})
            }
            None => Value::Null,
        },
    );
    if detail {
        let ids: Vec<String> = defects.iter().map(|d| d.id.clone()).collect();
        let repairs = load_repairs(client, &ids).await?;
        let stills = load_stills(client, &ids).await?;
        let locks = live.lock_holders(&ids).await?;
        let names = device_names(client).await?;
        let grid = pen.grid();
        body.insert("panels".into(), panels_json(&condition.panels));
        body.insert(
            "defects".into(),
            Value::Array(
                defects
                    .iter()
                    .map(|defect| {
                        let lock = locks
                            .iter()
                            .find(|(id, _)| *id == defect.id)
                            .map(|(_, lock)| lock);
                        let lock_name = lock.and_then(|lock| {
                            names
                                .iter()
                                .find(|(id, _)| *id == lock.device_id)
                                .map(|(_, name)| name.as_str())
                        });
                        defect_json(
                            defect,
                            grid,
                            of_defect(&repairs, &defect.id),
                            of_defect(&stills, &defect.id),
                            lock,
                            lock_name,
                        )
                    })
                    .collect(),
            ),
        );
    }
    Ok(Value::Object(body))
}

pub async fn history_json<C: GenericClient>(client: &C, defect_id: &str) -> ApiResult<Value> {
    let rows = client
        .query(
            "select at, device_id, device_name, action, changes, detail from defect_history \
             where defect_id = $1 order by seq",
            &[&defect_id],
        )
        .await?;
    Ok(Value::Array(
        rows.iter()
            .map(|row| {
                let at: DateTime<Utc> = row.get(0);
                json!({
                    "at": stamp(at),
                    "device_id": row.get::<_, String>(1),
                    "device_name": row.get::<_, String>(2),
                    "action": row.get::<_, String>(3),
                    "changes": row.get::<_, Value>(4),
                    "detail": row.get::<_, String>(5),
                })
            })
            .collect(),
    ))
}

#[derive(Clone, Debug)]
pub struct LinkRecord {
    pub id: String,
    pub pen_id: String,
    pub token: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub revoked: bool,
}

pub fn link_from_row(row: &tokio_postgres::Row) -> LinkRecord {
    LinkRecord {
        id: row.get(0),
        pen_id: row.get(1),
        token: row.get(2),
        created_at: row.get(3),
        expires_at: row.get(4),
        revoked: row.get(5),
    }
}

pub const LINK_COLUMNS: &str = "id, pen_id, token, created_at, expires_at, revoked";

pub fn link_json(record: &LinkRecord, now: DateTime<Utc>, base_url: &str) -> Value {
    let status = link::status(record.revoked, record.expires_at, now);
    let path = format!("/r/{}", record.token);
    json!({
        "id": record.id,
        "pen_id": record.pen_id,
        "token": record.token,
        "path": path,
        "url": format!("{base_url}{path}"),
        "status": status.as_str(),
        "created_at": stamp(record.created_at),
        "expires_at": stamp(record.expires_at),
        "expires_in_s": link::expires_in_s(status, record.expires_at, now),
    })
}

pub struct DiveRecord {
    pub id: String,
    pub pen_id: String,
    pub status: String,
    pub planned_start: DateTime<Utc>,
    pub planned_minutes: i32,
    pub diver_certificate_no: String,
    pub clearance: Option<Value>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub track: Value,
}

pub const DIVE_COLUMNS: &str = "id, pen_id, status, planned_start, planned_minutes, \
     diver_certificate_no, clearance, started_at, finished_at, track";

pub fn dive_from_row(row: &tokio_postgres::Row) -> DiveRecord {
    DiveRecord {
        id: row.get(0),
        pen_id: row.get(1),
        status: row.get(2),
        planned_start: row.get(3),
        planned_minutes: row.get(4),
        diver_certificate_no: row.get(5),
        clearance: row.get(6),
        started_at: row.get(7),
        finished_at: row.get(8),
        track: row.get(9),
    }
}

pub async fn dive_json<C: GenericClient>(
    client: &C,
    dive: &DiveRecord,
    now: DateTime<Utc>,
) -> ApiResult<Value> {
    let rows = client
        .query(
            "select id, content_type, size_bytes, sha256, file_name from sonar_captures \
             where dive_id = $1 order by id",
            &[&dive.id],
        )
        .await?;
    let sonar: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.get::<_, String>(0),
                "content_type": row.get::<_, String>(1),
                "size_bytes": row.get::<_, i64>(2),
                "sha256": row.get::<_, String>(3),
                "file_name": row.get::<_, String>(4),
            })
        })
        .collect();
    let clearance = match (&dive.clearance, dive.status.as_str()) {
        (Some(stored), "planned") | (Some(stored), "cleared") => {
            Value::from(clearance::rederive(stored, now))
        }
        (Some(stored), _) => stored.clone(),
        (None, _) => Value::Null,
    };
    let elapsed_s = match (dive.status.as_str(), dive.started_at) {
        ("started", Some(started_at)) => Value::from((now - started_at).num_seconds().max(0)),
        _ => Value::Null,
    };
    Ok(json!({
        "id": dive.id,
        "pen_id": dive.pen_id,
        "status": dive.status,
        "planned_start": stamp(dive.planned_start),
        "planned_minutes": dive.planned_minutes,
        "diver_certificate_no": dive.diver_certificate_no,
        "clearance": clearance,
        "started_at": dive.started_at.map(stamp),
        "finished_at": dive.finished_at.map(stamp),
        "elapsed_s": elapsed_s,
        "track": dive.track,
        "sonar": sonar,
    }))
}

pub fn import_json(row: &tokio_postgres::Row) -> Value {
    let imported_at: DateTime<Utc> = row.get(5);
    json!({
        "id": row.get::<_, String>(0),
        "farm_id": row.get::<_, String>(1),
        "file_name": row.get::<_, String>(2),
        "sha256": row.get::<_, String>(3),
        "size_bytes": row.get::<_, i64>(4),
        "imported_at": stamp(imported_at),
        "rows": row.get::<_, i32>(6),
        "created": row.get::<_, Value>(7),
        "merged": row.get::<_, Value>(8),
        "already_imported": row.get::<_, Value>(9),
        "orphans": row.get::<_, Value>(10),
        "invalid": row.get::<_, Value>(11),
    })
}

pub const IMPORT_COLUMNS: &str = "id, farm_id, file_name, sha256, size_bytes, imported_at, \
     data_rows, created, merged, already_imported, orphans, invalid";
