use super::text::{grapheme_count, NOTE_LIMIT};
use serde_json::{json, Value};

pub const MODEL: &str = "pensight-findings-1";
pub const CONTEXT_HEADING: &str = "Pensight findings context";
pub const METHODS: [&str; 4] = ["patch", "lace", "replace_panel", "clean"];

/// One non-removed defect as the copilot is allowed to see it.
pub struct FindingsDefect {
    pub id: String,
    pub defect_type: String,
    pub status: String,
    pub cell: String,
    pub size: Value,
    pub area_cm2: Option<i64>,
    pub patch_area_m2: Option<f64>,
    pub note: String,
}

/// The findings context: exactly eight keys per non-removed defect and nothing
/// else from Pensight.
pub fn findings_context(pen_name: &str, defects: &[FindingsDefect]) -> String {
    let payload = json!({
        "pen": pen_name,
        "defects": defects
            .iter()
            .map(|defect| json!({
                "id": defect.id,
                "type": defect.defect_type,
                "status": defect.status,
                "cell": defect.cell,
                "size": defect.size,
                "area_cm2": defect.area_cm2,
                "patch_area_m2": defect.patch_area_m2,
                "note": defect.note,
            }))
            .collect::<Vec<Value>>(),
    });
    format!(
        "{CONTEXT_HEADING}\n{}",
        serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string())
    )
}

pub fn request_body(findings: &str, question: &str) -> Value {
    json!({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": findings},
            {"role": "user", "content": question},
        ],
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "focus_defects",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "defect_ids": {"type": "array", "items": {"type": "string"}}
                        },
                        "required": ["defect_ids"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "propose_repair",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "defect_id": {"type": "string"},
                            "method": {"type": "string", "enum": METHODS},
                            "note": {"type": "string"}
                        },
                        "required": ["defect_id", "method", "note"]
                    }
                }
            }
        ],
        "tool_choice": "auto"
    })
}

pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

pub struct PenDefectFacts {
    pub id: String,
    pub repaired: bool,
}

pub struct ProposedRepair {
    pub defect_id: String,
    pub method: String,
    pub note: String,
}

pub struct RejectedCall {
    pub tool_call_id: String,
    pub reason: &'static str,
}

#[derive(Default)]
pub struct ToolOutcome {
    pub focus: Vec<String>,
    pub dropped_ids: Vec<String>,
    pub rejected_calls: Vec<RejectedCall>,
    pub proposals: Vec<ProposedRepair>,
}

fn push_once(list: &mut Vec<String>, value: &str) {
    if !list.iter().any(|existing| existing == value) {
        list.push(value.to_string());
    }
}

/// Tool calls are handled in reply order, and the first step that applies
/// decides each call. No proposal exists any other way.
pub fn validate_tool_calls(calls: &[ToolCall], defects: &[PenDefectFacts]) -> ToolOutcome {
    let mut outcome = ToolOutcome::default();
    for call in calls {
        if call.name != "focus_defects" && call.name != "propose_repair" {
            outcome.rejected_calls.push(RejectedCall {
                tool_call_id: call.id.clone(),
                reason: "unknown_tool",
            });
            continue;
        }
        let arguments: Option<Value> = serde_json::from_str(&call.arguments).ok();
        let Some(Value::Object(arguments)) = arguments else {
            outcome.rejected_calls.push(RejectedCall {
                tool_call_id: call.id.clone(),
                reason: "invalid_arguments",
            });
            continue;
        };
        if call.name == "focus_defects" {
            let ids = arguments
                .get("defect_ids")
                .and_then(Value::as_array)
                .filter(|items| items.iter().all(Value::is_string));
            let Some(ids) = ids else {
                outcome.rejected_calls.push(RejectedCall {
                    tool_call_id: call.id.clone(),
                    reason: "invalid_arguments",
                });
                continue;
            };
            for id in ids.iter().filter_map(Value::as_str) {
                if defects.iter().any(|defect| defect.id == id) {
                    push_once(&mut outcome.focus, id);
                } else {
                    push_once(&mut outcome.dropped_ids, id);
                }
            }
            continue;
        }
        let defect_id = arguments.get("defect_id").and_then(Value::as_str);
        let method = arguments.get("method").and_then(Value::as_str);
        let note = arguments.get("note").and_then(Value::as_str);
        let (Some(defect_id), Some(method), Some(note)) = (defect_id, method, note) else {
            outcome.rejected_calls.push(RejectedCall {
                tool_call_id: call.id.clone(),
                reason: "invalid_arguments",
            });
            continue;
        };
        let Some(defect) = defects.iter().find(|defect| defect.id == defect_id) else {
            push_once(&mut outcome.dropped_ids, defect_id);
            continue;
        };
        if !METHODS.contains(&method) {
            outcome.rejected_calls.push(RejectedCall {
                tool_call_id: call.id.clone(),
                reason: "unknown_method",
            });
            continue;
        }
        if grapheme_count(note) > NOTE_LIMIT {
            outcome.rejected_calls.push(RejectedCall {
                tool_call_id: call.id.clone(),
                reason: "note_too_long",
            });
            continue;
        }
        if defect.repaired {
            outcome.rejected_calls.push(RejectedCall {
                tool_call_id: call.id.clone(),
                reason: "already_repaired",
            });
            continue;
        }
        if outcome
            .proposals
            .iter()
            .any(|proposal| proposal.defect_id == defect_id)
        {
            outcome.rejected_calls.push(RejectedCall {
                tool_call_id: call.id.clone(),
                reason: "duplicate_proposal",
            });
            continue;
        }
        outcome.proposals.push(ProposedRepair {
            defect_id: defect_id.to_string(),
            method: method.to_string(),
            note: note.to_string(),
        });
    }
    outcome
}
