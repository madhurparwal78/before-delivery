use crate::error::ApiResult;
use crate::model::DefectRecord;
use chrono::{DateTime, Utc};
use deadpool_postgres::GenericClient;
use serde_json::{json, Map, Value};

#[derive(Clone, Debug)]
pub struct Device {
    pub id: String,
    pub name: String,
}

fn field_values(defect: &DefectRecord) -> Vec<(String, Value)> {
    let size = defect.size.to_json();
    let mut values = vec![
        ("bearing_deg".to_string(), Value::from(defect.bearing_deg)),
        ("depth_m".to_string(), Value::from(defect.depth_m)),
        ("chart_x_m".to_string(), Value::from(defect.chart_x_m)),
        ("chart_y_m".to_string(), Value::from(defect.chart_y_m)),
        ("cell".to_string(), Value::String(defect.cell.clone())),
    ];
    for key in defect.defect_type.size_keys() {
        values.push((
            format!("size.{key}"),
            size.get(key).cloned().unwrap_or(Value::Null),
        ));
    }
    values.push(("note".to_string(), Value::String(defect.note.clone())));
    values.push((
        "private_note".to_string(),
        Value::String(defect.private_note.clone()),
    ));
    values.push(("status".to_string(), Value::String(defect.status.clone())));
    values
}

/// A `created` entry lists every stored field with `before` null.
pub fn created_changes(defect: &DefectRecord) -> Value {
    let mut changes = Map::new();
    for (field, after) in field_values(defect) {
        changes.insert(field, json!({"before": Value::Null, "after": after}));
    }
    Value::Object(changes)
}

/// Only fields that changed are included.
pub fn diff_changes(before: &DefectRecord, after: &DefectRecord) -> Value {
    let mut changes = Map::new();
    let after_values = field_values(after);
    for (field, old) in field_values(before) {
        if let Some((_, new)) = after_values.iter().find(|(name, _)| *name == field) {
            if *new != old {
                changes.insert(field, json!({"before": old, "after": new}));
            }
        }
    }
    Value::Object(changes)
}

pub fn status_change(before: &str, after: &str) -> Value {
    json!({"status": {"before": before, "after": after}})
}

pub fn no_changes() -> Value {
    Value::Object(Map::new())
}

pub async fn write<C: GenericClient>(
    client: &C,
    defect_id: &str,
    device: &Device,
    action: &str,
    changes: &Value,
    detail: &str,
    at: DateTime<Utc>,
) -> ApiResult<()> {
    client
        .execute(
            "insert into defect_history(defect_id, at, device_id, device_name, action, changes, detail) \
             values ($1, $2, $3, $4, $5, $6, $7)",
            &[&defect_id, &at, &device.id, &device.name, &action, changes, &detail],
        )
        .await?;
    Ok(())
}
