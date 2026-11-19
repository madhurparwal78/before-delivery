//! The findings copilot: the findings context, tool-call validation,
//! repair proposals and their idempotent replay.

use crate::api::{err, internal, json_response, now_iso, App};
use crate::infra::{ApiError, ApiResult};
use crate::pg::Param;
use crate::validate::{one_field, NOTE_LIMIT};
use axum::response::Response;
use serde_json::{json, Value};
use std::time::Duration as StdDuration;

const PROVIDER_TIMEOUT: StdDuration = StdDuration::from_secs(20);

impl App {
    /// The findings context: exactly eight keys per non-removed defect.
    pub fn findings_context(&self, pen: &Value) -> Value {
        let mut defects = Vec::new();
        for d in pen["defects"].as_array().cloned().unwrap_or_default() {
            if d["removed"].as_bool() == Some(true) { continue; }
            defects.push(json!({
                "id": d["id"],
                "type": d["type"],
                "status": d["status"],
                "cell": d["cell"],
                "size": d["size"],
                "area_cm2": d["area_cm2"],
                "patch_area_m2": d["patch_area_m2"],
                "note": d["note"],
            }));
        }
        json!({"pen": pen["name"], "defects": defects})
    }

    pub async fn ask_copilot(&self, pen_id: &str, body: Value) -> ApiResult<Response> {
        if !self.store.pen_exists(pen_id).map_err(internal)? {
            return Err(err(404, "not_found", "Not found"));
        }
        let question = match body.get("question").and_then(|v| v.as_str()) {
            Some(q) => q.to_string(),
            None => return Err(one_field("question", "Question is required")),
        };
        if crate::domain::perceived_len(&question) > NOTE_LIMIT {
            return Err(one_field("question", "Question is longer than 500 characters"));
        }
        if question.trim().is_empty() {
            return Err(one_field("question", "Question must not be blank"));
        }
        let pen = self.store.pen_json(pen_id, true).map_err(internal)?;
        let context = self.findings_context(&pen);
        let request = json!({
            "model": "pensight-findings-1",
            "messages": [
                {"role": "system", "content": format!("Pensight findings context\n{}", context)},
                {"role": "user", "content": question},
            ],
            "tools": [
                {"type": "function", "function": {
                    "name": "focus_defects",
                    "description": "Point the camera at defects",
                    "parameters": {"type": "object", "properties": {"defect_ids": {"type": "array", "items": {"type": "string"}}}, "required": ["defect_ids"]},
                }},
                {"type": "function", "function": {
                    "name": "propose_repair",
                    "description": "Propose a repair for a defect",
                    "parameters": {"type": "object", "properties": {
                        "defect_id": {"type": "string"},
                        "method": {"type": "string", "enum": ["patch", "lace", "replace_panel", "clean"]},
                        "note": {"type": "string"},
                    }, "required": ["defect_id", "method", "note"]},
                }},
            ],
            "tool_choice": "auto",
        });
        let url = format!("{}/v1/chat/completions", self.wiremock_url.trim_end_matches('/'));
        let raw = tokio::time::timeout(PROVIDER_TIMEOUT,
            self.http.request_raw("POST", &url, Some(request.to_string()), "application/json", &[], StdDuration::from_secs(19))).await;
        let (_status, _headers, body_bytes) = match raw {
            Ok(Ok((s, _h, b))) => (s, _h, b),
            Ok(Err(_)) => return Err(ApiError::new(502, "copilot_unavailable", "Copilot unavailable")),
            Err(_) => return Err(ApiError::new(504, "copilot_unavailable", "Copilot unavailable")),
        };
        let _ = _status;
        let parsed: Value = match serde_json::from_slice(&body_bytes) {
            Ok(v) => v,
            Err(_) => return Err(ApiError::new(502, "copilot_unavailable", "Copilot unavailable")),
        };
        if parsed.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("message")).is_none() {
            return Err(ApiError::new(502, "copilot_unavailable", "Copilot unavailable"));
        }
        if _status >= 300 {
            return Err(ApiError::new(502, "copilot_unavailable", "Copilot unavailable"));
        }
        let message = parsed["choices"][0]["message"].clone();
        let text = message.get("content").and_then(|c| c.as_str()).unwrap_or("").to_string();
        let tool_calls = message.get("tool_calls").and_then(|t| t.as_array()).cloned().unwrap_or_default();

        // Validate tool calls in reply order.
        let mut focus: Vec<String> = Vec::new();
        let mut dropped: Vec<String> = Vec::new();
        let mut rejected: Vec<Value> = Vec::new();
        let mut proposals: Vec<Value> = Vec::new();
        let mut proposal_defects: Vec<String> = Vec::new();
        let pen_defects = pen["defects"].as_array().cloned().unwrap_or_default();
        let live = |id: &str| pen_defects.iter().find(|d| d["id"].as_str() == Some(id) && d["removed"].as_bool() != Some(true));
        let repaired = |id: &str| pen_defects.iter().any(|d| d["id"].as_str() == Some(id) && d["status"].as_str() == Some("repaired") && d["removed"].as_bool() != Some(true));
        for call in &tool_calls {
            let tool_call_id = call.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let function = call.get("function").cloned().unwrap_or(Value::Null);
            let name = function.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let args_text = function.get("arguments").and_then(|v| v.as_str()).unwrap_or("");
            let args: Value = serde_json::from_str(args_text).unwrap_or(Value::Null);
            if name != "focus_defects" && name != "propose_repair" {
                rejected.push(json!({"tool_call_id": tool_call_id, "reason": "unknown_tool"}));
                continue;
            }
            if !args.is_object() {
                rejected.push(json!({"tool_call_id": tool_call_id, "reason": "invalid_arguments"}));
                continue;
            }
            if name == "focus_defects" {
                let ids = args.get("defect_ids");
                let list: Vec<String> = match ids {
                    Some(Value::Array(a)) => a.iter().filter_map(|v| v.as_str().map(String::from)).collect(),
                    _ => {
                        rejected.push(json!({"tool_call_id": tool_call_id, "reason": "invalid_arguments"}));
                        continue;
                    }
                };
                for id in list {
                    if live(&id).is_some() {
                        if !focus.contains(&id) { focus.push(id); }
                    } else if !dropped.contains(&id) {
                        dropped.push(id);
                    }
                }
            } else {
                let defect_id = args.get("defect_id").and_then(|v| v.as_str());
                let method = args.get("method").and_then(|v| v.as_str());
                let note = args.get("note").and_then(|v| v.as_str());
                let (defect_id, method, note) = match (defect_id, method, note) {
                    (Some(d), Some(m), Some(n)) => (d.to_string(), m.to_string(), n.to_string()),
                    _ => {
                        rejected.push(json!({"tool_call_id": tool_call_id, "reason": "invalid_arguments"}));
                        continue;
                    }
                };
                if live(&defect_id).is_none() {
                    if !dropped.contains(&defect_id) { dropped.push(defect_id); }
                    continue;
                }
                if !["patch", "lace", "replace_panel", "clean"].contains(&method.as_str()) {
                    rejected.push(json!({"tool_call_id": tool_call_id, "reason": "unknown_method"}));
                    continue;
                }
                if crate::domain::perceived_len(&note) > NOTE_LIMIT {
                    rejected.push(json!({"tool_call_id": tool_call_id, "reason": "note_too_long"}));
                    continue;
                }
                if repaired(&defect_id) {
                    rejected.push(json!({"tool_call_id": tool_call_id, "reason": "already_repaired"}));
                    continue;
                }
                if proposal_defects.contains(&defect_id) {
                    rejected.push(json!({"tool_call_id": tool_call_id, "reason": "duplicate_proposal"}));
                    continue;
                }
                proposal_defects.push(defect_id.clone());
                proposals.push(json!({
                    "id": "", "defect_id": defect_id, "method": method, "note": note, "status": "proposed",
                }));
            }
        }

        // Store the answer and its proposals.
        let guard = self.locks.dive("copilot");
        let _g = guard.lock().await;
        let answer_id = self.next_prefixed_id("CA", "copilot_answers")?;
        let at = now_iso();
        self.store.pg.exec(
            "INSERT INTO copilot_answers (id, pen_id, question, text, focus, dropped_ids, rejected_calls, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            vec![Param::Text(answer_id.clone()), Param::Text(pen_id.into()), Param::Text(question.clone()),
                 Param::Text(text.clone()), Param::Json(json!(focus)), Param::Json(json!(dropped)),
                 Param::Json(json!(rejected)), Param::Timestamp(crate::api::ts_of(&at))]).map_err(internal)?;
        let mut out_proposals = Vec::new();
        let mut n = 1;
        let first_proposal_id = self.next_prefixed_id("RP", "proposals")?;
        let first_n: i64 = first_proposal_id.trim_start_matches("RP-").parse().unwrap_or(1);
        for p in &mut proposals.clone() {
            let pid = format!("RP-{:04}", first_n + n - 1);
            let defect_id = p["defect_id"].as_str().unwrap_or("").to_string();
            let method = p["method"].as_str().unwrap_or("").to_string();
            let note = p["note"].as_str().unwrap_or("").to_string();
            self.store.pg.exec(
                "INSERT INTO proposals (id, answer_id, defect_id, method, note, status) VALUES ($1,$2,$3,$4,$5,'proposed')",
                vec![Param::Text(pid.clone()), Param::Text(answer_id.clone()), Param::Text(defect_id.clone()),
                     Param::Text(method.clone()), Param::Text(note.clone())]).map_err(internal)?;
            out_proposals.push(json!({"id": pid, "defect_id": defect_id.clone(), "method": method.clone(), "note": note.clone(), "status": "proposed"}));
            n += 1;
        }
        Ok(json_response(200, &json!({"answer": {
            "id": answer_id,
            "question": question,
            "text": text,
            "focus": focus,
            "dropped_ids": dropped,
            "rejected_calls": rejected,
            "proposals": out_proposals,
        }})))
    }

    pub async fn apply_proposal(&self, proposal_id: &str, device_id: &str) -> ApiResult<Response> {
        // Replay check first, after 405/403/413/404.
        let replay = self.store.pg.exec(
            "SELECT response FROM applied_proposals WHERE proposal_id = $1", vec![Param::Text(proposal_id.into())]).map_err(internal)?;
        if !replay.is_empty() {
            let stored: Value = match replay.get(0, "response") {
                Value::String(s) => serde_json::from_str(&s).unwrap_or(Value::Null),
                other => other,
            };
            if stored.is_object() { return Ok(json_response(200, &stored)); }
        }
        let rows = self.store.pg.exec(
            "SELECT p.id, p.defect_id, p.method, p.note, p.status, c.pen_id FROM proposals p JOIN copilot_answers c ON c.id = p.answer_id WHERE p.id = $1",
            vec![Param::Text(proposal_id.into())]).map_err(internal)?;
        if rows.is_empty() { return Err(err(404, "not_found", "Not found")); }
        let defect_id = rows.str_of(0, "defect_id");
        let method = rows.str_of(0, "method");
        let note = rows.str_of(0, "note");
        let pen_id = rows.str_of(0, "pen_id");
        let guard = self.locks.defect(&defect_id);
        let _g = guard.lock().await;
        self.check_removed(&defect_id)?;
        if let Some(e) = self.lock_refusal_for(&defect_id, device_id).await { return Err(e); }
        let status_rows = self.store.pg.exec("SELECT status FROM defects WHERE id = $1", vec![Param::Text(defect_id.clone())]).map_err(internal)?;
        if status_rows.str_of(0, "status") == "repaired" {
            return Err(err(409, "already_repaired", format!("{defect_id} is already repaired")));
        }
        let at = now_iso();
        let repair_id = self.next_prefixed_id("R", "repairs")?;
        let device_name = self.device_name_of(device_id)?;
        self.store.pg.exec(
            "INSERT INTO repairs (id, defect_id, method, note, source, proposal_id, recorded_at, device_id, device_name) VALUES ($1,$2,$3,$4,'copilot',$5,$6,$7,$8)",
            vec![Param::Text(repair_id.clone()), Param::Text(defect_id.clone()), Param::Text(method.clone()),
                 Param::Text(note.clone()), Param::Text(proposal_id.into()), Param::Timestamp(crate::api::ts_of(&at)),
                 Param::Text(device_id.into()), Param::Text(device_name.clone())]).map_err(internal)?;
        self.store.pg.exec("UPDATE defects SET status = 'repaired', version = version + 1, updated_at = now() WHERE id = $1",
            vec![Param::Text(defect_id.clone())]).map_err(internal)?;
        self.store.pg.exec("UPDATE proposals SET status = 'applied', repair_id = $2, applied_at = now() WHERE id = $1",
            vec![Param::Text(proposal_id.into()), Param::Text(repair_id.clone())]).map_err(internal)?;
        self.write_history(&defect_id, &at, device_id, &device_name, "repaired",
            &json!({"status": {"before": "open", "after": "repaired"}}),
            &format!("{method} (copilot proposal {proposal_id})"))?;
        self.broadcast(json!({"kind": "defect_repaired", "defect_id": defect_id, "pen_id": pen_id, "device_id": device_id, "device_name": device_name})).await;
        let repair = json!({"id": repair_id, "method": method, "note": note, "source": "copilot", "proposal_id": proposal_id, "recorded_at": at});
        let defect = self.store.defect_json(&defect_id, true, None).map_err(internal)?;
        let pen = self.store.pen_json(&pen_id, true).map_err(internal)?;
        let body = json!({
            "proposal": {"id": proposal_id, "defect_id": defect_id, "method": method, "note": note, "status": "applied", "repair_id": repair_id},
            "repair": repair, "defect": defect, "pen": pen,
        });
        self.store.pg.exec("INSERT INTO applied_proposals (proposal_id, response) VALUES ($1,$2)",
            vec![Param::Text(proposal_id.into()), Param::Json(body.clone())]).map_err(internal)?;
        Ok(json_response(200, &body))
    }
}
