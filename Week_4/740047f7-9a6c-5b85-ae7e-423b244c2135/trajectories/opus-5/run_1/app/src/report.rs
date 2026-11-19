use crate::error::{ApiError, ApiResult};
use crate::history::{self, Device};
use crate::model::{
    self, condition, load_pen_defects, load_repairs, public_defect_json, stamp, DefectRecord,
    PenRecord,
};
use crate::store::s3::sha256_hex;
use chrono::{DateTime, Utc};
use deadpool_postgres::GenericClient;
use serde_json::{json, Value};

pub fn object_key(farm_id: &str, pen_id: &str, number: i32) -> String {
    format!("farms/{farm_id}/reports/{pen_id}/revision-{number}.json")
}

pub struct Published {
    pub bytes: Vec<u8>,
    pub sha256: String,
    pub snapshot: Value,
    pub grade_letter: String,
    pub grade_label: String,
    pub open_defects: i64,
}

/// Snapshots every defect, placeholder, private note, repair and still
/// attachment of the pen, and builds the immutable report pack.
pub async fn build<C: GenericClient>(
    client: &C,
    pen: &PenRecord,
    number: i32,
    published_at: DateTime<Utc>,
) -> ApiResult<Published> {
    let defects = load_pen_defects(client, &pen.id).await?;
    let ids: Vec<String> = defects.iter().map(|d| d.id.clone()).collect();
    let repairs = load_repairs(client, &ids).await?;
    let stills = model::load_stills(client, &ids).await?;
    let condition = condition(pen, &defects);
    let grid = pen.grid();

    let created_at_rows = client
        .query(
            "select id, created_at from defects where pen_id = $1",
            &[&pen.id],
        )
        .await?;

    let mut snapshot_defects = Vec::new();
    let mut pack_defects = Vec::new();
    for defect in &defects {
        let defect_repairs: Vec<Value> = repairs
            .iter()
            .filter(|(owner, _)| owner == &defect.id)
            .map(|(_, value)| value.clone())
            .collect();
        let defect_stills: Vec<Value> = stills
            .iter()
            .filter(|(owner, _)| owner == &defect.id)
            .map(|(_, value)| value.clone())
            .collect();
        let created_at: Option<DateTime<Utc>> = created_at_rows
            .iter()
            .find(|row| row.get::<_, String>(0) == defect.id)
            .map(|row| row.get(1));
        snapshot_defects.push(json!({
            "id": defect.id,
            "pen_id": defect.pen_id,
            "farm_id": defect.farm_id,
            "type": defect.defect_type.as_str(),
            "bearing_deg": defect.bearing_deg,
            "depth_m": defect.depth_m,
            "chart_x_m": defect.chart_x_m,
            "chart_y_m": defect.chart_y_m,
            "cell": defect.cell,
            "size": defect.size.to_json(),
            "note": defect.note,
            "private_note": defect.private_note,
            "status": defect.status,
            "removed": defect.removed,
            "version": defect.version,
            "created_at": created_at.map(stamp),
            "repairs": defect_repairs.clone(),
            "still_ids": defect_stills
                .iter()
                .filter_map(|still| still.get("id").cloned())
                .collect::<Vec<Value>>(),
        }));
        let mut public = public_defect_json(defect, grid, &defect_repairs);
        if let Some(object) = public.as_object_mut() {
            object.insert(
                "stills".into(),
                Value::Array(
                    defect_stills
                        .iter()
                        .map(|still| {
                            json!({
                                "id": still.get("id").cloned().unwrap_or(Value::Null),
                                "sha256": still.get("sha256").cloned().unwrap_or(Value::Null),
                                "size_bytes": still.get("size_bytes").cloned().unwrap_or(Value::Null),
                            })
                        })
                        .collect(),
                ),
            );
        }
        pack_defects.push(public);
    }

    let pack = json!({
        "format": "pensight-report-pack-1",
        "revision": number,
        "published_at": stamp(published_at),
        "farm": {"name": pen.farm_name},
        "site": {"code": pen.site_code, "name": pen.site_name},
        "pen": {
            "id": pen.id,
            "name": pen.name,
            "circumference_m": pen.circumference_m,
            "net_depth_m": pen.net_depth_m,
            "grid": pen.grid_json(),
        },
        "grade": model::grade_json(condition.grade),
        "open_defects": condition.open_defects,
        "max_fouling_cover_pct": condition.max_fouling_cover_pct,
        "panels": model::panels_json(&condition.panels),
        "defects": Value::Array(pack_defects),
    });
    let bytes = serde_json::to_vec(&pack)?;
    Ok(Published {
        sha256: sha256_hex(&bytes),
        bytes,
        snapshot: json!({"defects": Value::Array(snapshot_defects)}),
        grade_letter: condition.grade.letter.to_string(),
        grade_label: condition.grade.label.to_string(),
        open_defects: condition.open_defects,
    })
}

/// Restoring makes the pen's defects exactly the snapshot.
pub async fn restore<C: GenericClient>(
    client: &C,
    pen: &PenRecord,
    number: i32,
    snapshot: &Value,
    device: &Device,
    at: DateTime<Utc>,
) -> ApiResult<()> {
    let entries = snapshot
        .get("defects")
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::internal("stored revision snapshot is not usable"))?;
    let snapshot_ids: Vec<String> = entries
        .iter()
        .filter_map(|entry| entry.get("id")?.as_str().map(str::to_string))
        .collect();

    client
        .execute(
            "update stills set defect_id = null where defect_id in (select id from defects where pen_id = $1)",
            &[&pen.id],
        )
        .await?;
    client
        .execute(
            "delete from repairs where defect_id in (select id from defects where pen_id = $1)",
            &[&pen.id],
        )
        .await?;
    client
        .execute(
            "delete from defects where pen_id = $1 and not (id = any($2))",
            &[&pen.id, &snapshot_ids],
        )
        .await?;

    let current = load_pen_defects(client, &pen.id).await?;
    for entry in entries {
        let defect = snapshot_defect(pen, entry)?;
        let before = current.iter().find(|existing| existing.id == defect.id);
        let snapshot_version = entry
            .get("version")
            .and_then(Value::as_i64)
            .unwrap_or(1) as i32;
        let version = before.map_or(snapshot_version, |b| b.version.max(snapshot_version)) + 1;
        let created_at = entry
            .get("created_at")
            .and_then(Value::as_str)
            .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
            .map(|value| value.with_timezone(&Utc))
            .unwrap_or(at);
        client
            .execute(
                "insert into defects(id, pen_id, farm_id, type, bearing_deg, depth_m, chart_x_m, \
                 chart_y_m, cell, size, note, private_note, status, removed, version, created_at, updated_at) \
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) \
                 on conflict (id) do update set bearing_deg = excluded.bearing_deg, \
                 depth_m = excluded.depth_m, chart_x_m = excluded.chart_x_m, \
                 chart_y_m = excluded.chart_y_m, cell = excluded.cell, size = excluded.size, \
                 note = excluded.note, private_note = excluded.private_note, \
                 status = excluded.status, removed = excluded.removed, version = excluded.version, \
                 updated_at = excluded.updated_at",
                &[
                    &defect.id,
                    &pen.id,
                    &pen.farm_id,
                    &defect.defect_type.as_str(),
                    &defect.bearing_deg,
                    &defect.depth_m,
                    &defect.chart_x_m,
                    &defect.chart_y_m,
                    &defect.cell,
                    &defect.size.to_json(),
                    &defect.note,
                    &defect.private_note,
                    &defect.status,
                    &defect.removed,
                    &version,
                    &created_at,
                    &at,
                ],
            )
            .await?;
        for repair in entry
            .get("repairs")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new())
        {
            let recorded_at = repair
                .get("recorded_at")
                .and_then(Value::as_str)
                .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
                .map(|value| value.with_timezone(&Utc))
                .unwrap_or(at);
            client
                .execute(
                    "insert into repairs(id, defect_id, method, note, source, proposal_id, recorded_at) \
                     values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing",
                    &[
                        &repair.get("id").and_then(Value::as_str).unwrap_or_default(),
                        &defect.id,
                        &repair.get("method").and_then(Value::as_str).unwrap_or_default(),
                        &repair.get("note").and_then(Value::as_str).unwrap_or_default(),
                        &repair.get("source").and_then(Value::as_str).unwrap_or("manual"),
                        &repair.get("proposal_id").and_then(Value::as_str),
                        &recorded_at,
                    ],
                )
                .await?;
        }
        let still_ids: Vec<String> = entry
            .get("still_ids")
            .and_then(Value::as_array)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| id.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        if !still_ids.is_empty() {
            client
                .execute(
                    "update stills set defect_id = $1 where id = any($2)",
                    &[&defect.id, &still_ids],
                )
                .await?;
        }
        let changes = match before {
            Some(before) => history::diff_changes(before, &defect),
            None => history::created_changes(&defect),
        };
        history::write(
            client,
            &defect.id,
            device,
            "restored",
            &changes,
            &format!("revision {number}"),
            at,
        )
        .await?;
    }
    Ok(())
}

fn snapshot_defect(pen: &PenRecord, entry: &Value) -> ApiResult<DefectRecord> {
    let unusable = || ApiError::internal("stored revision snapshot is not usable");
    let defect_type = entry
        .get("type")
        .and_then(Value::as_str)
        .and_then(crate::domain::size::DefectType::parse)
        .ok_or_else(unusable)?;
    let size = entry
        .get("size")
        .and_then(|raw| crate::domain::size::Size::from_json(defect_type, raw))
        .ok_or_else(unusable)?;
    Ok(DefectRecord {
        id: entry
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(unusable)?
            .to_string(),
        pen_id: pen.id.clone(),
        farm_id: pen.farm_id.clone(),
        defect_type,
        bearing_deg: entry.get("bearing_deg").and_then(Value::as_f64).unwrap_or(0.0),
        depth_m: entry.get("depth_m").and_then(Value::as_f64).unwrap_or(0.0),
        chart_x_m: entry.get("chart_x_m").and_then(Value::as_f64).unwrap_or(0.0),
        chart_y_m: entry.get("chart_y_m").and_then(Value::as_f64).unwrap_or(0.0),
        cell: entry
            .get("cell")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        size,
        note: entry
            .get("note")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        private_note: entry
            .get("private_note")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        status: entry
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("open")
            .to_string(),
        removed: entry
            .get("removed")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        version: entry.get("version").and_then(Value::as_i64).unwrap_or(1) as i32,
        updated_at: at_or_now(entry),
    })
}

fn at_or_now(entry: &Value) -> DateTime<Utc> {
    entry
        .get("created_at")
        .and_then(Value::as_str)
        .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
        .map(|value| value.with_timezone(&Utc))
        .unwrap_or_else(Utc::now)
}
