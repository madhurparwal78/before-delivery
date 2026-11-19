//! Validation of request bodies against the published field rules,
//! with grapheme-cluster counting for text limits.

use crate::domain::{perceived_len, round_to};
use crate::infra::ApiError;
use serde_json::{json, Value};

pub fn fields_error(fields: Vec<(String, String)>) -> ApiError {
    let mut map = serde_json::Map::new();
    let mut first = String::new();
    for (k, v) in fields {
        if first.is_empty() { first = v.clone(); }
        map.insert(k.to_string(), json!(v));
    }
    ApiError::new(422, "validation", first).with_fields(Value::Object(map))
}

pub fn one_field(field: &str, message: &str) -> ApiError {
    fields_error(vec![(field.to_string(), message.to_string())])
}

/// A required whole number.
pub fn required_int(body: &Value, field: &str) -> Result<i64, ApiError> {
    match body.get(field) {
        Some(Value::Number(n)) if n.is_i64() || n.is_u64() => Ok(n.as_i64().unwrap_or(0)),
        Some(Value::Number(n)) if n.as_f64().map(|f| f.fract() == 0.0).unwrap_or(false) => Ok(n.as_f64().unwrap_or(0.0) as i64),
        Some(_) => Err(one_field(field, &format!("{field} must be a whole number"))),
        None => Err(one_field(field, &format!("{field} is required"))),
    }
}

pub fn text_field(body: &Value, field: &str) -> Result<Option<String>, ApiError> {
    match body.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(one_field(field, &format!("{field} must be text"))),
    }
}

pub const NOTE_LIMIT: usize = 500;

pub fn note_field(body: &Value, field: &str) -> Result<Option<String>, ApiError> {
    let s = text_field(body, field)?;
    if let Some(t) = &s {
        if perceived_len(t) > NOTE_LIMIT {
            return Err(one_field(field, &format!("{} is longer than {} characters", human_field(field), NOTE_LIMIT)));
        }
    }
    Ok(s)
}

fn human_field(field: &str) -> &'static str {
    match field {
        "note" => "Note",
        "private_note" => "Private note",
        "repair_note" => "Repair note",
        _ => "Text",
    }
}

/// The size object of a defect by type.
pub fn size_for_type(body: &Value, defect_type: &str) -> Result<Value, ApiError> {
    let size = body.get("size").cloned().unwrap_or(Value::Null);
    if !size.is_object() {
        return Err(one_field("size", "Size is required"));
    }
    let (a_key, a_min, a_max, b_key, b_min, b_max) = match defect_type {
        "hole" => ("width_cm", 1.0, 2000.0, "height_cm", 1.0, 2000.0),
        "tear" => ("length_cm", 1.0, 2000.0, "gap_cm", 0.0, 200.0),
        "chafe" => ("length_cm", 1.0, 2000.0, "width_cm", 1.0, 200.0),
        "fouling" => ("width_m", 0.1, 100.0, "height_m", 0.1, 100.0),
        _ => return Err(one_field("type", "Type must be hole, tear, chafe or fouling")),
    };
    let mut fields: Vec<(String, String)> = Vec::new();
    let a = whole_or_decimal(&size, a_key, defect_type)?;
    let b = whole_or_decimal(&size, b_key, defect_type)?;
    let check = |k: &str, v: f64, lo: f64, hi: f64, f: &mut Vec<(String, String)>| {
        if v < lo || v > hi {
            f.push((format!("size.{k}"), format!("{k} must be between {}", fmt_range(lo, hi, defect_type))));
        }
    };
    let mut out = serde_json::Map::new();
    let av = a.0; let bv = b.0;
    check(a_key, av, a_min, a_max, &mut fields);
    check(b_key, bv, b_min, b_max, &mut fields);
    if !fields.is_empty() { return Err(fields_error(fields)); }
    if defect_type == "fouling" {
        out.insert(a_key.to_string(), json!(round_to(av, 1)));
        out.insert(b_key.to_string(), json!(round_to(bv, 1)));
    } else {
        if av.fract() != 0.0 { return Err(one_field(&format!("size.{a_key}"), &format!("{a_key} must be a whole number"))); }
        if bv.fract() != 0.0 { return Err(one_field(&format!("size.{b_key}"), &format!("{b_key} must be a whole number"))); }
        out.insert(a_key.to_string(), json!(av as i64));
        out.insert(b_key.to_string(), json!(bv as i64));
    }
    Ok(Value::Object(out))
}

fn fmt_range(lo: f64, hi: f64, defect_type: &str) -> String {
    if defect_type == "fouling" {
        format!("{:.1} to {:.1}", lo, hi)
    } else if hi.fract() == 0.0 {
        format!("{} to {}", lo as i64, hi as i64)
    } else {
        format!("{:.1} to {:.1}", lo, hi)
    }
}

fn whole_or_decimal(size: &Value, key: &str, defect_type: &str) -> Result<(f64, ()), ApiError> {
    let v = size.get(key).cloned().unwrap_or(Value::Null);
    let _ = defect_type;
    let n = match v {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        _ => return Err(one_field(&format!("size.{key}"), &format!("{key} is required"))),
    };
    if n.is_nan() || n.is_infinite() {
        return Err(one_field(&format!("size.{key}"), &format!("{key} must be a finite number")));
    }
    Ok((n, ()))
}
