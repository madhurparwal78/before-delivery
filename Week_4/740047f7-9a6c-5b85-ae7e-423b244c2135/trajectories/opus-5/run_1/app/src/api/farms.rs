use super::{
    broadcast, check_json_size, event, ok, parse_json_body, require_device, AppState,
};
use crate::error::{ApiError, ApiResult};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::Response;
use serde_json::{json, Value};

pub async fn list_devices(State(state): State<AppState>) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let devices = crate::model::device_names(&client).await?;
    let ids: Vec<String> = devices.iter().map(|(id, _)| id.clone()).collect();
    let online = state.live.online(&ids).await?;
    let rows: Vec<Value> = devices
        .iter()
        .zip(online)
        .map(|((id, name), online)| json!({"id": id, "name": name, "online": online}))
        .collect();
    Ok(ok(json!({"devices": rows})))
}

pub async fn heartbeat(
    State(state): State<AppState>,
    Path(device_id): Path<String>,
) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let rows = client
        .query("select id, name from devices where id = $1", &[&device_id])
        .await?;
    let row = rows.first().ok_or_else(ApiError::not_found)?;
    state.live.heartbeat(&device_id).await?;
    Ok(ok(json!({
        "device": {
            "id": row.get::<_, String>(0),
            "name": row.get::<_, String>(1),
            "online": true,
        }
    })))
}

pub async fn list_farms(State(state): State<AppState>) -> ApiResult<Response> {
    let client = state.pool.get().await?;
    let farms = client
        .query(
            "select id, name, day_rate_amount, day_rate_currency from farms order by ord",
            &[],
        )
        .await?;
    let sites = client
        .query(
            "select farm_id, code, name, latitude, longitude from sites order by farm_id, ord",
            &[],
        )
        .await?;
    let pens = client
        .query("select id, farm_id from pens order by ord", &[])
        .await?;
    let rows: Vec<Value> = farms
        .iter()
        .map(|farm| {
            let farm_id: String = farm.get(0);
            json!({
                "id": farm_id,
                "name": farm.get::<_, String>(1),
                "day_rate": {
                    "amount": farm.get::<_, i64>(2),
                    "currency": farm.get::<_, String>(3),
                },
                "sites": sites
                    .iter()
                    .filter(|site| site.get::<_, String>(0) == farm_id)
                    .map(|site| json!({
                        "code": site.get::<_, String>(1),
                        "name": site.get::<_, String>(2),
                        "latitude": site.get::<_, f64>(3),
                        "longitude": site.get::<_, f64>(4),
                    }))
                    .collect::<Vec<Value>>(),
                "pen_ids": pens
                    .iter()
                    .filter(|pen| pen.get::<_, String>(1) == farm_id)
                    .map(|pen| Value::String(pen.get::<_, String>(0)))
                    .collect::<Vec<Value>>(),
            })
        })
        .collect();
    Ok(ok(json!({"farms": rows})))
}

/// Erasing a farm removes the farm and everything under it, releases every lock
/// on its defects and deletes every object under its prefix.
pub async fn erase_farm(
    State(state): State<AppState>,
    Path(farm_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    check_json_size(&body)?;
    let mut client = state.pool.get().await?;
    let farms = client
        .query("select name from farms where id = $1", &[&farm_id])
        .await?;
    let farm_name: String = farms.first().ok_or_else(ApiError::not_found)?.get(0);
    let device = require_device(&client, &headers).await?;
    let payload = parse_json_body(&body)?;
    let confirm = payload
        .get("confirm_name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if confirm != farm_name {
        return Err(ApiError::validation(
            "confirm_name",
            "Type the farm name exactly to confirm",
        ));
    }
    let defect_ids: Vec<String> = client
        .query(
            "select d.id from defects d join pens p on p.id = d.pen_id where p.farm_id = $1",
            &[&farm_id],
        )
        .await?
        .iter()
        .map(|row| row.get(0))
        .collect();
    let transaction = client.transaction().await?;
    transaction
        .execute("delete from farms where id = $1", &[&farm_id])
        .await?;
    transaction.commit().await?;
    state.live.release_locks(&defect_ids).await?;
    state
        .store
        .delete_prefix(&format!("farms/{farm_id}/"))
        .await?;
    broadcast(
        &state,
        event(
            "farm.erased",
            Some(&device),
            vec![
                ("farm_id", Value::String(farm_id.clone())),
                ("farm_name", Value::String(farm_name)),
            ],
        ),
    )
    .await;
    Ok(ok(json!({"erased": farm_id})))
}
