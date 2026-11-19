use super::text::{grapheme_count, SEARCH_LIMIT, SEARCH_TOO_LONG};
use crate::error::{ApiError, ApiResult};
use serde_json::{json, Value};

pub struct SearchFarm {
    pub id: String,
    pub name: String,
    pub site_fields: Vec<String>,
}

pub struct SearchPen {
    pub id: String,
    pub name: String,
}

pub struct SearchDefect {
    pub id: String,
    pub pen_name: String,
}

pub struct SearchCorpus {
    pub farms: Vec<SearchFarm>,
    pub pens: Vec<SearchPen>,
    pub defects: Vec<SearchDefect>,
    pub defect_notes: Vec<String>,
}

/// Every character matches itself literally, so a query is never a pattern.
fn matches(haystack: &str, needle_lower: &str) -> bool {
    haystack.to_lowercase().contains(needle_lower)
}

pub fn parse_query(raw: &str) -> ApiResult<Option<String>> {
    let trimmed = raw.trim();
    if grapheme_count(trimmed) > SEARCH_LIMIT {
        return Err(ApiError::validation_many(
            SEARCH_TOO_LONG,
            [("q".to_string(), Value::String(SEARCH_TOO_LONG.to_string()))]
                .into_iter()
                .collect(),
        ));
    }
    if grapheme_count(trimmed) < 2 {
        return Ok(None);
    }
    Ok(Some(trimmed.to_lowercase()))
}

pub fn run(corpus: &SearchCorpus, needle_lower: &str) -> Vec<Value> {
    let mut results = Vec::new();
    for farm in &corpus.farms {
        let hit = matches(&farm.name, needle_lower)
            || farm
                .site_fields
                .iter()
                .any(|field| matches(field, needle_lower));
        if hit {
            results.push(json!({"kind":"farm","id":farm.id,"label":farm.name}));
        }
    }
    for pen in &corpus.pens {
        if matches(&pen.name, needle_lower) {
            results.push(json!({"kind":"pen","id":pen.id,"label":pen.name}));
        }
    }
    for (defect, note) in corpus.defects.iter().zip(corpus.defect_notes.iter()) {
        if matches(&defect.id, needle_lower) || matches(note, needle_lower) {
            results.push(json!({
                "kind": "defect",
                "id": defect.id,
                "label": format!("{} — {}", defect.id, defect.pen_name),
            }));
        }
    }
    results
}
