use super::{
    broadcast, check_upload, created, event, file_name, ok, raw_response, require_device, AppState,
    IMPORT_LIMIT,
};
use crate::db;
use crate::domain::legacy::{self, MergeCandidate};
use crate::error::{ApiError, ApiResult};
use crate::history;
use crate::model::{
    import_json, load_pen_defects, pen_payload, require_pen, DefectRecord, PenRecord,
    IMPORT_COLUMNS,
};
use crate::store::s3::sha256_hex;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::Response;
use chrono::Utc;
use deadpool_postgres::GenericClient;
use serde_json::{json, Value};
use std::collections::HashMap;

pub async fn list_imports(
    State(state): State<AppState>,
    Path(farm_id): Path<String>,
) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let farms = client
        .query("select 1 from farms where id = $1", &[&farm_id])
        .await?;
    if farms.is_empty() {
        return Err(ApiError::not_found());
    }
    let sql = format!(
        "select {IMPORT_COLUMNS} from imports where farm_id = $1 order by imported_at desc, id desc"
    );
    let rows = client.query(sql.as_str(), &[&farm_id]).await?;
    Ok(ok(json!({
        "imports": rows.iter().map(import_json).collect::<Vec<Value>>()
    })))
}

pub async fn raw_import(
    State(state): State<AppState>,
    Path(import_id): Path<String>,
) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let rows = client
        .query(
            "select farm_id, sha256, file_name from imports where id = $1",
            &[&import_id],
        )
        .await?;
    let row = rows.first().ok_or_else(ApiError::not_found)?;
    let farm_id: String = row.get(0);
    let bytes = state
        .store
        .get(&format!("farms/{farm_id}/imports/{import_id}.csv"))
        .await?
        .ok_or_else(ApiError::not_found)?;
    Ok(raw_response(
        bytes,
        "text/csv; charset=utf-8",
        &row.get::<_, String>(1),
        &row.get::<_, String>(2),
    ))
}

pub async fn create_import(
    State(state): State<AppState>,
    Path(farm_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    check_upload(&body, IMPORT_LIMIT, "Import file")?;
    let mut client = state.pool.get().await?;
    let farms = client
        .query("select 1 from farms where id = $1", &[&farm_id])
        .await?;
    if farms.is_empty() {
        return Err(ApiError::not_found());
    }
    if body.is_empty() {
        return Err(ApiError::validation("file", "The upload is empty"));
    }
    let sha256 = sha256_hex(&body);
    let size = body.len() as i64;

    let transaction = client.transaction().await?;
    db::lock_farm_imports(&transaction, &farm_id).await?;
    let sql = format!(
        "select {IMPORT_COLUMNS} from imports where farm_id = $1 and sha256 = $2 and size_bytes = $3"
    );
    let replay = transaction
        .query(sql.as_str(), &[&farm_id, &sha256, &size])
        .await?;
    if let Some(row) = replay.first() {
        let body = import_json(row);
        transaction.commit().await?;
        return Ok(ok(json!({"import": body, "replayed": true})));
    }
    let device = require_device(&transaction, &headers).await?;
    let parsed = legacy::parse(&body)
        .ok_or_else(|| ApiError::validation("file", "The file has no recognisable header"))?;

    let pens: Vec<PenRecord> = crate::model::load_pens(&transaction)
        .await?
        .into_iter()
        .filter(|pen| pen.farm_id == farm_id)
        .collect();
    let site_codes: Vec<String> = transaction
        .query("select code from sites where farm_id = $1", &[&farm_id])
        .await?
        .iter()
        .map(|row| legacy::normalise_site_code(&row.get::<_, String>(0)))
        .collect();

    let mut candidates: HashMap<String, Vec<MergeCandidate>> = HashMap::new();
    for pen in &pens {
        let defects = load_pen_defects(&transaction, &pen.id).await?;
        candidates.insert(
            pen.id.clone(),
            defects
                .iter()
                .filter(|defect| !defect.removed)
                .map(|defect| MergeCandidate {
                    id: defect.id.clone(),
                    defect_type: defect.defect_type,
                    chart_x_m: defect.chart_x_m,
                    depth_m: defect.depth_m,
                })
                .collect(),
        );
    }
    let mut ledger: HashMap<String, String> = transaction
        .query(
            "select fingerprint, defect_id from import_ledger where farm_id = $1",
            &[&farm_id],
        )
        .await?
        .iter()
        .map(|row| (row.get(0), row.get(1)))
        .collect();

    let now = Utc::now();
    let import_id = db::next_id(&transaction, "import", "IM").await?;
    let mut created_rows = Vec::new();
    let mut merged_rows = Vec::new();
    let mut already_rows = Vec::new();
    let mut orphan_rows = Vec::new();
    let mut invalid_rows = Vec::new();
    let mut touched: Vec<String> = Vec::new();

    for row in &parsed.rows {
        let site_code = legacy::normalise_site_code(&row.site_code_raw);
        let pen_no = legacy::normalise_pen_no(&row.pen_no_raw);
        let matched = match pen_no {
            Some(pen_no) if site_codes.contains(&site_code) => pens.iter().find(|pen| {
                legacy::normalise_site_code(&pen.site_code) == site_code && pen.pen_no == pen_no
            }),
            _ => None,
        };
        let Some(pen) = matched else {
            orphan_rows.push(json!({
                "row": row.row,
                "site_code": row.site_code_raw,
                "pen_no": row.pen_no_raw,
            }));
            continue;
        };
        let grid = pen.grid();
        let defect = match legacy::row_defect(row, grid) {
            Ok(defect) => defect,
            Err(reason) => {
                invalid_rows.push(json!({"row": row.row, "reason": reason}));
                continue;
            }
        };
        let fingerprint = legacy::fingerprint(&farm_id, &site_code, pen.pen_no, &defect);
        if let Some(defect_id) = ledger.get(&fingerprint) {
            already_rows.push(json!({"row": row.row, "defect_id": defect_id}));
            continue;
        }
        let pen_candidates = candidates.entry(pen.id.clone()).or_default();
        let target = legacy::nearest_merge(pen_candidates, &defect, grid)
            .map(|found| found.id.clone());
        if !touched.contains(&pen.id) {
            touched.push(pen.id.clone());
        }
        match target {
            Some(defect_id) => {
                history::write(
                    &transaction,
                    &defect_id,
                    &device,
                    "merged",
                    &history::no_changes(),
                    &format!("{import_id} row {}", row.row),
                    now,
                )
                .await?;
                merged_rows.push(json!({"row": row.row, "defect_id": defect_id}));
                ledger.insert(fingerprint.clone(), defect_id.clone());
                transaction
                    .execute(
                        "insert into import_ledger(farm_id, fingerprint, defect_id, import_id) \
                         values ($1,$2,$3,$4) on conflict (farm_id, fingerprint) do nothing",
                        &[&farm_id, &fingerprint, &defect_id, &import_id],
                    )
                    .await?;
            }
            None => {
                let defect_id = db::next_id(&transaction, "defect", "D").await?;
                let record = DefectRecord {
                    id: defect_id.clone(),
                    pen_id: pen.id.clone(),
                    farm_id: farm_id.clone(),
                    defect_type: defect.defect_type,
                    bearing_deg: defect.bearing_deg,
                    depth_m: defect.depth_m,
                    chart_x_m: defect.chart_x_m,
                    chart_y_m: defect.chart_y_m,
                    cell: defect.cell.clone(),
                    size: defect.size,
                    note: defect.note.clone(),
                    private_note: String::new(),
                    status: "open".to_string(),
                    removed: false,
                    version: 1,
                    updated_at: now,
                };
                super::defects::insert_defect(&transaction, &record, now).await?;
                history::write(
                    &transaction,
                    &defect_id,
                    &device,
                    "imported",
                    &history::created_changes(&record),
                    &format!("{import_id} row {}", row.row),
                    now,
                )
                .await?;
                created_rows.push(json!({"row": row.row, "defect_id": defect_id}));
                ledger.insert(fingerprint.clone(), defect_id.clone());
                transaction
                    .execute(
                        "insert into import_ledger(farm_id, fingerprint, defect_id, import_id) \
                         values ($1,$2,$3,$4) on conflict (farm_id, fingerprint) do nothing",
                        &[&farm_id, &fingerprint, &defect_id, &import_id],
                    )
                    .await?;
                candidates
                    .entry(pen.id.clone())
                    .or_default()
                    .push(MergeCandidate {
                        id: defect_id,
                        defect_type: defect.defect_type,
                        chart_x_m: defect.chart_x_m,
                        depth_m: defect.depth_m,
                    });
            }
        }
    }

    let name = file_name(&headers);
    transaction
        .execute(
            "insert into imports(id, farm_id, file_name, sha256, size_bytes, imported_at, \
             data_rows, created, merged, already_imported, orphans, invalid) \
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
            &[
                &import_id,
                &farm_id,
                &name,
                &sha256,
                &size,
                &now,
                &(parsed.rows.len() as i32),
                &Value::Array(created_rows),
                &Value::Array(merged_rows),
                &Value::Array(already_rows),
                &Value::Array(orphan_rows),
                &Value::Array(invalid_rows),
            ],
        )
        .await?;
    state
        .store
        .put(
            &format!("farms/{farm_id}/imports/{import_id}.csv"),
            body.to_vec(),
            "text/csv",
        )
        .await?;
    let sql = format!("select {IMPORT_COLUMNS} from imports where id = $1");
    let stored = transaction.query(sql.as_str(), &[&import_id]).await?;
    let import_body = stored
        .first()
        .map(import_json)
        .ok_or_else(|| ApiError::internal("the import was not stored"))?;
    let mut pen_payloads = serde_json::Map::new();
    for pen_id in &touched {
        let pen = require_pen(&transaction, pen_id).await?;
        pen_payloads.insert(
            pen_id.clone(),
            pen_payload(&transaction, &state.live, &pen, true).await?,
        );
    }
    transaction.commit().await?;
    broadcast(
        &state,
        event(
            "import.created",
            Some(&device),
            vec![
                ("farm_id", Value::String(farm_id)),
                ("import", import_body.clone()),
                ("pens", Value::Object(pen_payloads)),
            ],
        ),
    )
    .await;
    Ok(created(json!({"import": import_body, "replayed": false})))
}
