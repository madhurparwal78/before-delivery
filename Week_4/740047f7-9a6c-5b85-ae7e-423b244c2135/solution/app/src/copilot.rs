//! The findings copilot: the chat-completion request, tool-call validation, proposals and their application.

use crate::app::{ok, Ctx, Reply, Shared};
use crate::db;
use crate::defects::{apply_repair, find_defect, pen_view, REPAIR_METHODS};
use crate::error::{ApiError, ApiResult};
use crate::model::{self, Defect};
use crate::rules;
use chrono::Utc;
use serde_json::{json, Value};
use std::time::Duration;

const UNAVAILABLE: &str = "Copilot unavailable";
const COPILOT_TIMEOUT: Duration = Duration::from_secs(20);

fn tools() -> Value {
    json!([
        {"type": "function", "function": {
            "name": "focus_defects", "description": "Point the camera at the defects that matter for the question.",
            "parameters": {"type": "object", "properties": {"defect_ids": {"type": "array", "items": {"type": "string"}}}, "required": ["defect_ids"]}}},
        {"type": "function", "function": {
            "name": "propose_repair", "description": "Propose a repair for one open defect.",
            "parameters": {"type": "object", "properties": {
                "defect_id": {"type": "string"}, "method": {"type": "string", "enum": REPAIR_METHODS}, "note": {"type": "string"}},
                "required": ["defect_id", "method", "note"]}}},
    ])
}

/// The findings context: eight keys per non-removed defect and nothing else.
fn findings_context(pen_name: &str, defects: &[Defect], g: &rules::Geometry) -> String {
    let items: Vec<Value> = defects
        .iter()
        .filter(|d| !d.removed)
        .map(|d| {
            let derived = d.derived(g);
            json!({"id": d.id, "type": d.kind.name(), "status": d.status, "cell": derived.cell, "size": d.size,
                "area_cm2": derived.area_cm2, "patch_area_m2": derived.patch_area_m2, "note": d.note})
        })
        .collect();
    format!("Pensight findings context\n{}", json!({"pen": pen_name, "defects": items}))
}

struct Proposal {
    defect_id: String,
    method: String,
    note: String,
}

struct Reading {
    focus: Vec<String>,
    dropped: Vec<String>,
    rejected: Vec<Value>,
    proposals: Vec<Proposal>,
}

fn push_unique(list: &mut Vec<String>, id: &str) {
    if !list.iter().any(|x| x == id) {
        list.push(id.to_string());
    }
}

fn string_args<'a>(args: &'a Value, keys: &[&str]) -> Option<Vec<&'a str>> {
    let object = args.as_object()?;
    keys.iter().map(|k| object.get(*k).and_then(Value::as_str)).collect()
}

/// Handles every tool call in reply order; the first rule that applies decides it.
fn read_calls(calls: &[Value], defects: &[Defect]) -> Reading {
    let mut reading = Reading { focus: vec![], dropped: vec![], rejected: vec![], proposals: vec![] };
    let live = |id: &str| defects.iter().any(|d| d.id == id && !d.removed);
    for call in calls {
        let call_id = call["id"].as_str().unwrap_or_default();
        let name = call["function"]["name"].as_str().unwrap_or_default();
        let mut reject = |reason: &str| reading.rejected.push(json!({"tool_call_id": call_id, "reason": reason}));
        if name != "focus_defects" && name != "propose_repair" {
            reject("unknown_tool");
            continue;
        }
        let args: Value = call["function"]["arguments"].as_str().and_then(|a| serde_json::from_str(a).ok()).unwrap_or(Value::Null);
        if name == "focus_defects" {
            let ids: Option<Vec<&str>> = args.get("defect_ids").and_then(Value::as_array).and_then(|l| l.iter().map(Value::as_str).collect());
            let Some(ids) = ids else {
                reject("invalid_arguments");
                continue;
            };
            for id in ids {
                if live(id) {
                    push_unique(&mut reading.focus, id);
                } else {
                    push_unique(&mut reading.dropped, id);
                }
            }
            continue;
        }
        let Some(&[defect_id, method, note]) = string_args(&args, &["defect_id", "method", "note"]).as_deref() else {
            reject("invalid_arguments");
            continue;
        };
        if !live(defect_id) {
            push_unique(&mut reading.dropped, defect_id);
        } else if !REPAIR_METHODS.contains(&method) {
            reject("unknown_method");
        } else if rules::graphemes(note) > rules::NOTE_LIMIT {
            reject("note_too_long");
        } else if defects.iter().any(|d| d.id == defect_id && d.status == "repaired") {
            reject("already_repaired");
        } else if reading.proposals.iter().any(|p| p.defect_id == defect_id) {
            reject("duplicate_proposal");
        } else {
            reading.proposals.push(Proposal { defect_id: defect_id.into(), method: method.into(), note: note.into() });
        }
    }
    reading
}

async fn ask_provider(app: &Shared, context: String, question: &str) -> ApiResult<Value> {
    let request = json!({
        "model": "pensight-findings-1",
        "messages": [{"role": "system", "content": context}, {"role": "user", "content": question}],
        "tools": tools(), "tool_choice": "auto",
    });
    let url = format!("{}/v1/chat/completions", app.cfg.wiremock_url);
    let failed = |timed_out: bool| ApiError::provider("copilot_unavailable", UNAVAILABLE, timed_out);
    let response = app.http.post(url).json(&request).timeout(COPILOT_TIMEOUT).send().await.map_err(|e| failed(e.is_timeout()))?;
    if !response.status().is_success() {
        return Err(failed(false));
    }
    let body: Value = response.json().await.map_err(|e| failed(e.is_timeout()))?;
    let message = body["choices"].get(0).map(|choice| choice["message"].clone()).unwrap_or(Value::Null);
    if !message.is_object() {
        return Err(failed(false));
    }
    Ok(message)
}

pub async fn ask(ctx: &mut Ctx, pen_id: &str) -> ApiResult<Reply> {
    let raw = ctx.read_json().await?;
    let app = ctx.app.clone();
    let db = app.db().await?;
    let pen = model::pen_row(&db, pen_id).await?.ok_or_else(ApiError::not_found)?;
    ctx.device()?;
    let obj = raw.object()?;
    let question = match obj.get("question") {
        Some(Value::String(q)) if q.trim().is_empty() => return Err(ApiError::field("question", "Ask a question")),
        Some(Value::String(q)) if rules::graphemes(q) > rules::NOTE_LIMIT => return Err(ApiError::field("question", rules::NOTE_TOO_LONG)),
        Some(Value::String(q)) => q.clone(),
        _ => return Err(ApiError::field("question", "question must be a string")),
    };
    let defects = model::defects_of_pen(&db, pen_id, false).await?;
    let message = ask_provider(&app, findings_context(&pen.name, &defects, &pen.geometry), &question).await?;
    let text = message["content"].as_str().unwrap_or_default().to_string();
    let calls = message["tool_calls"].as_array().cloned().unwrap_or_default();
    let reading = read_calls(&calls, &defects);
    let answer_number = db::next_number(&db, "answer_seq").await?;
    let answer_id = db::make_id("CA-", answer_number);
    db.execute(
        "INSERT INTO copilot_answers (id, pen_id, question, text, focus, dropped, rejected, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        &[&answer_id, &pen.id, &question, &text, &json!(reading.focus), &json!(reading.dropped), &json!(reading.rejected), &Utc::now()],
    )
    .await?;
    let mut proposals = vec![];
    for proposal in &reading.proposals {
        let id = db::make_id("RP-", db::next_number(&db, "proposal_seq").await?);
        db.execute(
            "INSERT INTO proposals (id, answer_id, defect_id, method, note, status) VALUES ($1,$2,$3,$4,$5,'proposed')",
            &[&id, &answer_id, &proposal.defect_id, &proposal.method, &proposal.note],
        )
        .await?;
        proposals.push(json!({"id": id, "defect_id": proposal.defect_id, "method": proposal.method, "note": proposal.note, "status": "proposed"}));
    }
    ok(json!({"answer": {"id": answer_id, "question": question, "text": text, "focus": reading.focus,
        "dropped_ids": reading.dropped, "rejected_calls": reading.rejected, "proposals": proposals}}))
}

pub async fn apply(ctx: &mut Ctx, proposal_id: &str) -> ApiResult<Reply> {
    let app = ctx.app.clone();
    let mut db = app.db().await?;
    let tx = db.transaction().await?;
    let rows = tx
        .query("SELECT defect_id, method, note, status, applied_response FROM proposals WHERE id = $1 FOR UPDATE", &[&proposal_id])
        .await?;
    let row = rows.first().ok_or_else(ApiError::not_found)?;
    let (defect_id, method, note): (String, String, String) = (row.get(0), row.get(1), row.get(2));
    let stored: Option<Value> = row.get(4);
    let device = ctx.device()?;
    if let Some(body) = stored {
        return ok(body);
    }
    let mut defect = model::defect_by_id(&tx, &defect_id, true).await?.ok_or_else(ApiError::not_found)?;
    app.require_unlocked(&defect.id, &device).await?;
    if defect.removed {
        return Err(ApiError::removed(&defect.id));
    }
    if defect.status == "repaired" {
        return Err(ApiError::already_repaired(&defect.id));
    }
    let pen = model::pen_row(&tx, &defect.pen_id).await?.ok_or_else(ApiError::not_found)?;
    let repair = apply_repair(&tx, &pen, &mut defect, &device, &method, &note, Some(proposal_id)).await?;
    let pen_json = pen_view(&app, &tx, &pen).await?;
    let body = json!({
        "proposal": {"id": proposal_id, "defect_id": defect.id, "method": method, "note": note, "status": "applied", "repair_id": repair.id},
        "repair": {"id": repair.id, "method": repair.method, "note": repair.note, "source": repair.source,
            "proposal_id": repair.proposal_id, "recorded_at": rules::iso(repair.recorded_at)},
        "defect": find_defect(&pen_json, &defect.id), "pen": pen_json,
    });
    tx.execute("UPDATE proposals SET status = 'applied', repair_id = $2, applied_response = $3 WHERE id = $1", &[&proposal_id, &repair.id, &body]).await?;
    tx.commit().await?;
    app.emit("defect.repaired", Some(&device), json!({"pen_id": pen.id, "defect_id": defect.id})).await;
    ok(body)
}
