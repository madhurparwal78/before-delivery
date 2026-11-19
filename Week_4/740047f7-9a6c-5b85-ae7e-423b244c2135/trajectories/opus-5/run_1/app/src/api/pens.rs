use super::{
    broadcast, check_json_size, event, ok, parse_json_body, require_device, AppState,
};
use crate::db;
use crate::domain::copilot::{self, FindingsDefect, PenDefectFacts};
use crate::domain::export;
use crate::domain::search::{self, SearchCorpus, SearchDefect, SearchFarm, SearchPen};
use crate::domain::text;
use crate::error::{ApiError, ApiResult};
use crate::model::{
    self, load_defect_for_update, load_pen_defects, load_pens, pen_payload, require_pen,
};
use crate::providers::chat::{self, ChatOutcome};
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::Utc;
use serde_json::{json, Value};
use std::collections::HashMap;

pub async fn list_pens(State(state): State<AppState>) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let pens = load_pens(&client).await?;
    let mut rows = Vec::new();
    for pen in &pens {
        rows.push(pen_payload(&client, &state.live, pen, false).await?);
    }
    Ok(ok(json!({"pens": rows})))
}

pub async fn get_pen(
    State(state): State<AppState>,
    Path(pen_id): Path<String>,
) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let pen = require_pen(&client, &pen_id).await?;
    Ok(ok(json!({
        "pen": pen_payload(&client, &state.live, &pen, true).await?
    })))
}

pub async fn copilot(
    State(state): State<AppState>,
    Path(pen_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    check_json_size(&body)?;
    let mut client = state.pool.get().await?;
    let pen = require_pen(&client, &pen_id).await?;
    require_device(&client, &headers).await?;
    let payload = parse_json_body(&body)?;
    let question = payload
        .get("question")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::validation("question", "A question is required"))?;
    text::check_question(question)?;

    let defects = load_pen_defects(&client, &pen.id).await?;
    let grid = pen.grid();
    let findings: Vec<FindingsDefect> = defects
        .iter()
        .filter(|defect| !defect.removed)
        .map(|defect| FindingsDefect {
            id: defect.id.clone(),
            defect_type: defect.defect_type.as_str().to_string(),
            status: defect.status.clone(),
            cell: defect.cell.clone(),
            size: defect.size.to_json(),
            area_cm2: defect.area_cm2(),
            patch_area_m2: defect.patch_area_m2(grid),
            note: defect.note.clone(),
        })
        .collect();
    let context = copilot::findings_context(&pen.name, &findings);
    let request = copilot::request_body(&context, question);
    let reply = match chat::complete(&state.http, &state.config.wiremock_url, &request).await {
        ChatOutcome::Reply(reply) => reply,
        ChatOutcome::Unavailable { timed_out } => {
            return Err(ApiError::provider(
                "copilot_unavailable",
                timed_out,
                "Copilot unavailable",
            ))
        }
    };

    let facts: Vec<PenDefectFacts> = defects
        .iter()
        .filter(|defect| !defect.removed)
        .map(|defect| PenDefectFacts {
            id: defect.id.clone(),
            repaired: defect.status == "repaired",
        })
        .collect();
    let outcome = copilot::validate_tool_calls(&reply.tool_calls, &facts);

    let now = Utc::now();
    let transaction = client.transaction().await?;
    let answer_id = db::next_id(&transaction, "answer", "CA").await?;
    let focus = Value::Array(
        outcome
            .focus
            .iter()
            .map(|id| Value::String(id.clone()))
            .collect(),
    );
    let dropped = Value::Array(
        outcome
            .dropped_ids
            .iter()
            .map(|id| Value::String(id.clone()))
            .collect(),
    );
    let rejected = Value::Array(
        outcome
            .rejected_calls
            .iter()
            .map(|call| json!({"tool_call_id": call.tool_call_id, "reason": call.reason}))
            .collect(),
    );
    transaction
        .execute(
            "insert into copilot_answers(id, pen_id, question, text, focus, dropped_ids, rejected_calls, created_at) \
             values ($1,$2,$3,$4,$5,$6,$7,$8)",
            &[
                &answer_id,
                &pen.id,
                &question,
                &reply.content,
                &focus,
                &dropped,
                &rejected,
                &now,
            ],
        )
        .await?;
    let mut proposals = Vec::new();
    for proposal in &outcome.proposals {
        let id = db::next_id(&transaction, "proposal", "RP").await?;
        transaction
            .execute(
                "insert into proposals(id, answer_id, pen_id, defect_id, method, note, status) \
                 values ($1,$2,$3,$4,$5,$6,'proposed')",
                &[
                    &id,
                    &answer_id,
                    &pen.id,
                    &proposal.defect_id,
                    &proposal.method,
                    &proposal.note,
                ],
            )
            .await?;
        proposals.push(json!({
            "id": id,
            "defect_id": proposal.defect_id,
            "method": proposal.method,
            "note": proposal.note,
            "status": "proposed",
        }));
    }
    transaction.commit().await?;
    Ok(ok(json!({
        "answer": {
            "id": answer_id,
            "question": question,
            "text": reply.content,
            "focus": focus,
            "dropped_ids": dropped,
            "rejected_calls": rejected,
            "proposals": proposals,
        }
    })))
}

pub async fn apply_proposal(
    State(state): State<AppState>,
    Path(proposal_id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let mut client = state.pool.get().await?;
    let rows = client
        .query(
            "select defect_id, method, note, status, repair_id, applied from proposals where id = $1",
            &[&proposal_id],
        )
        .await?;
    let row = rows.first().ok_or_else(ApiError::not_found)?;
    let defect_id: String = row.get(0);
    let method: String = row.get(1);
    let note: String = row.get(2);
    let status: String = row.get(3);
    let stored: Option<Value> = row.get(5);
    if status == "applied" {
        if let Some(stored) = stored {
            return Ok(ok(stored));
        }
    }
    let device = require_device(&client, &headers).await?;
    super::defects::check_lock(&client, &state, &defect_id, &device).await?;

    let now = Utc::now();
    let transaction = client.transaction().await?;
    let replay = transaction
        .query(
            "select applied from proposals where id = $1 and status = 'applied' for update",
            &[&proposal_id],
        )
        .await?;
    if let Some(applied) = replay.first().and_then(|row| row.get::<_, Option<Value>>(0)) {
        return Ok(ok(applied));
    }
    let defect = load_defect_for_update(&transaction, &defect_id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    if defect.removed {
        return Err(ApiError::conflict(
            "defect_removed",
            format!("{defect_id} was removed"),
        ));
    }
    if defect.status == "repaired" {
        return Err(ApiError::conflict(
            "already_repaired",
            format!("{defect_id} is already repaired"),
        ));
    }
    let pen = require_pen(&transaction, &defect.pen_id).await?;
    let outcome = super::defects::apply_repair(
        &transaction,
        &device,
        &defect,
        &method,
        &note,
        "copilot",
        Some(&proposal_id),
        now,
    )
    .await?;
    let repair_id = outcome
        .repair
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let defect_body =
        super::defects::full_defect(&transaction, &state, &outcome.defect, pen.grid()).await?;
    let pen_json = pen_payload(&transaction, &state.live, &pen, true).await?;
    let applied = json!({
        "proposal": {
            "id": proposal_id,
            "defect_id": defect_id,
            "method": method,
            "note": note,
            "status": "applied",
            "repair_id": repair_id,
        },
        "repair": outcome.repair,
        "defect": defect_body,
        "pen": pen_json,
    });
    transaction
        .execute(
            "update proposals set status = 'applied', repair_id = $2, applied = $3 where id = $1",
            &[&proposal_id, &repair_id, &applied],
        )
        .await?;
    transaction.commit().await?;
    broadcast(
        &state,
        event(
            "defect.repaired",
            Some(&device),
            vec![
                ("pen_id", Value::String(pen.id.clone())),
                ("pen_name", Value::String(pen.name.clone())),
                ("defect_id", Value::String(defect_id.clone())),
                ("defect", applied["defect"].clone()),
                ("pen", applied["pen"].clone()),
            ],
        ),
    )
    .await;
    Ok(ok(applied))
}

#[derive(serde::Deserialize)]
pub struct SearchQuery {
    q: Option<String>,
}

pub async fn search(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> ApiResult<Response> {
    let raw = query.q.unwrap_or_default();
    let Some(needle) = search::parse_query(&raw)? else {
        return Ok(ok(json!({"results": Vec::<Value>::new()})));
    };
    let client = state.pool.get().await?;
    let farm_rows = client
        .query("select id, name from farms order by ord", &[])
        .await?;
    let site_rows = client
        .query("select farm_id, code, name from sites order by ord", &[])
        .await?;
    let pens = load_pens(&client).await?;
    let defect_rows = client
        .query(
            "select d.id, d.note, p.name from defects d join pens p on p.id = d.pen_id \
             where d.removed = false order by d.id",
            &[],
        )
        .await?;
    let corpus = SearchCorpus {
        farms: farm_rows
            .iter()
            .map(|row| {
                let id: String = row.get(0);
                SearchFarm {
                    site_fields: site_rows
                        .iter()
                        .filter(|site| site.get::<_, String>(0) == id)
                        .flat_map(|site| {
                            [site.get::<_, String>(1), site.get::<_, String>(2)]
                        })
                        .collect(),
                    id,
                    name: row.get(1),
                }
            })
            .collect(),
        pens: pens
            .iter()
            .map(|pen| SearchPen {
                id: pen.id.clone(),
                name: pen.name.clone(),
            })
            .collect(),
        defects: defect_rows
            .iter()
            .map(|row| SearchDefect {
                id: row.get(0),
                pen_name: row.get(2),
            })
            .collect(),
        defect_notes: defect_rows.iter().map(|row| row.get(1)).collect(),
    };
    Ok(ok(json!({"results": search::run(&corpus, &needle)})))
}

pub async fn export_defects(State(state): State<AppState>) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let pens = load_pens(&client).await?;
    let by_id: HashMap<String, &model::PenRecord> =
        pens.iter().map(|pen| (pen.id.clone(), pen)).collect();
    let mut defects = Vec::new();
    for pen in &pens {
        defects.extend(load_pen_defects(&client, &pen.id).await?);
    }
    defects.sort_by(|a, b| a.id.cmp(&b.id));
    let mut rows = Vec::new();
    for defect in defects.iter().filter(|defect| !defect.removed) {
        let Some(pen) = by_id.get(&defect.pen_id) else {
            continue;
        };
        rows.push(vec![
            export::text_cell(&pen.farm_name),
            export::text_cell(&pen.site_code),
            export::text_cell(&pen.name),
            export::text_cell(&defect.id),
            export::text_cell(defect.defect_type.as_str()),
            export::numeric_cell(Some(defect.bearing_deg), 1),
            export::numeric_cell(Some(defect.depth_m), 1),
            export::numeric_cell(Some(defect.chart_x_m), 2),
            export::numeric_cell(Some(defect.chart_y_m), 2),
            export::text_cell(&defect.cell),
            export::whole_cell(defect.area_cm2()),
            export::numeric_cell(defect.patch_area_m2(pen.grid()), 1),
            export::text_cell(&defect.status),
            export::text_cell(&defect.note),
        ]);
    }
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8".to_string()),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"defects.csv\"".to_string(),
            ),
        ],
        export::document(rows),
    )
        .into_response())
}
