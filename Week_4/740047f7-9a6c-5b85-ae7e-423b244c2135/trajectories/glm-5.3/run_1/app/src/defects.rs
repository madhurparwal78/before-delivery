//! Defect endpoints: create, patch, delete, locks, history, stills, repairs.
//! The one-at-a-time write rule, the lock check and the version check live here.

use crate::api::{err, internal, json_response, now_iso, App};
use crate::domain::{self, FoulingPatch};
use crate::infra::{ApiError, ApiResult};
use crate::pg::Param;
use crate::s3::sha256_hex;

use crate::validate::{self, one_field};
use axum::body::Body;
use axum::http::StatusCode;
use axum::response::Response;
use serde_json::{json, Value};

impl App {
    // ----- locks -----

    pub async fn take_lock(&self, defect_id: &str, device_id: &str) -> ApiResult<Response> {
        let pen_id = self.defect_pen(defect_id).ok_or_else(|| err(404, "not_found", "Not found"))?;
        self.check_removed(defect_id)?;
        let guard = self.locks.defect(defect_id);
        let _g = guard.lock().await;
        let holder = self.valkey.lock_holder(defect_id).await.map_err(internal)?;
        match holder {
            Some(h) if h == device_id => {
                self.valkey.refresh_lock(defect_id, device_id).await.map_err(internal)?;
                let name = self.device_name_of(device_id)?;
                Ok(json_response(200, &json!({"lock": {"device_id": device_id, "device_name": name, "expires_in_s": 30}})))
            }
            Some(h) => {
                let name = self.device_name_of(&h)?;
                let ttl = self.valkey.lock_ttl(defect_id).await.unwrap_or(30).max(0) as u64;
                Err(ApiError::locked(&h, &name, ttl))
            }
            None => {
                let won = self.valkey.take_lock(defect_id, device_id).await.map_err(internal)?;
                match won {
                    Some(ttl) => {
                        let name = self.device_name_of(device_id)?;
                        self.broadcast(json!({"kind": "lock_taken", "defect_id": defect_id, "pen_id": pen_id, "device_id": device_id, "device_name": name})).await;
                        Ok(json_response(200, &json!({"lock": {"device_id": device_id, "device_name": name, "expires_in_s": ttl}})))
                    }
                    None => {
                        let h = self.valkey.lock_holder(defect_id).await.ok().flatten().unwrap_or_default();
                        let name = self.device_name_of(&h)?;
                        let ttl = self.valkey.lock_ttl(defect_id).await.unwrap_or(30).max(0) as u64;
                        Err(ApiError::locked(&h, &name, ttl))
                    }
                }
            }
        }
    }

    pub async fn release_lock(&self, defect_id: &str, device_id: &str) -> ApiResult<Response> {
        let pen_id = self.defect_pen(defect_id).ok_or_else(|| err(404, "not_found", "Not found"))?;
        let guard = self.locks.defect(defect_id);
        let _g = guard.lock().await;
        let released = self.valkey.release_lock_if_holder(defect_id, device_id).await.map_err(internal)?;
        if released {
            let name = self.device_name_of(device_id)?;
            self.broadcast(json!({"kind": "lock_released", "defect_id": defect_id, "pen_id": pen_id, "device_id": device_id, "device_name": name})).await;
        } else {
            let holder = self.valkey.lock_holder(defect_id).await.ok().flatten();
            if let Some(h) = holder {
                if h != device_id {
                    let name = self.device_name_of(&h)?;
                    let ttl = self.valkey.lock_ttl(defect_id).await.unwrap_or(30).max(0) as u64;
                    return Err(ApiError::locked(&h, &name, ttl));
                }
            }
        }
        Ok(Response::builder().status(StatusCode::NO_CONTENT).body(Body::empty()).unwrap_or_else(|_| Response::new(Body::empty())))
    }

    /// The lock refusal when another device holds the defect's lock.
    pub async fn lock_refusal_for(&self, defect_id: &str, device_id: &str) -> Option<ApiError> {
        let holder = self.valkey.lock_holder(defect_id).await.ok().flatten()?;
        if holder == device_id { return None; }
        let name = self.device_name_of(&holder).ok()?;
        let ttl = self.valkey.lock_ttl(defect_id).await.unwrap_or(30).max(0) as u64;
        Some(ApiError::locked(&holder, &name, ttl))
    }

    pub fn device_name_of(&self, device_id: &str) -> Result<String, ApiError> {
        self.store.device_name(device_id).map_err(internal)?
            .ok_or_else(|| err(422, "validation", "Unknown device"))
            .and_then(|n| if n.is_empty() { Err(err(422, "validation", "Unknown device")) } else { Ok(n) })
    }

    pub fn defect_pen(&self, defect_id: &str) -> Option<String> {
        self.store.pen_id_of_defect(defect_id).ok().flatten()
    }

    pub fn check_removed(&self, defect_id: &str) -> ApiResult<()> {
        let rows = self.store.pg.exec("SELECT removed FROM defects WHERE id = $1", vec![Param::Text(defect_id.into())]).map_err(internal)?;
        if rows.is_empty() { return Err(err(404, "not_found", "Not found")); }
        if rows.get(0, "removed").as_bool() == Some(true) {
            return Err(err(409, "defect_removed", format!("{defect_id} was removed")));
        }
        Ok(())
    }

    // ----- create -----

    pub async fn create_defect(&self, pen_id: &str, body: Value, device_id: &str) -> ApiResult<Response> {
        if !self.store.pen_exists(pen_id).map_err(internal)? {
            return Err(err(404, "not_found", "Not found"));
        }
        let defect_type = match body.get("type").and_then(|v| v.as_str()) {
            Some(t) if ["hole", "tear", "chafe", "fouling"].contains(&t) => t.to_string(),
            Some(_) => return Err(one_field("type", "Type must be hole, tear, chafe or fouling")),
            None => return Err(one_field("type", "Type is required")),
        };
        let grid = self.store.pen_grid(pen_id).map_err(internal)?;
        let net_depth = grid.net_depth_m;

        // Position: either a bearing and depth, or a wall point.
        let (bearing, depth): (f64, f64) = match body.get("wall_point") {
            Some(Value::Object(wp)) => {
                let x = wp.get("x_m").and_then(|v| v.as_f64());
                let y = wp.get("y_m").and_then(|v| v.as_f64());
                let z = wp.get("z_m").and_then(|v| v.as_f64());
                if body.get("depth_m").is_some() && !matches!(body.get("depth_m"), None | Some(Value::Null)) {
                    return Err(one_field("depth_m", "depth_m is not allowed with wall_point"));
                }
                let (x, y, z) = match (x, y, z) {
                    (Some(a), Some(b), Some(c)) => (a, b, c),
                    _ => return Err(one_field("wall_point", "wall_point needs x_m, y_m and z_m")),
                };
                if ![x, y, z].iter().all(|v| v.is_finite()) {
                    return Err(one_field("wall_point", "wall_point must be finite"));
                }
                (domain::wall_point_bearing(x, z), -y)
            }
            Some(_) => return Err(one_field("wall_point", "wall_point must be an object")),
            None => {
                let b = match body.get("bearing_deg") {
                    Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
                    _ => return Err(one_field("bearing_deg", "bearing_deg is required")),
                };
                if !b.is_finite() { return Err(one_field("bearing_deg", "bearing_deg must be finite")); }
                let d = match body.get("depth_m") {
                    Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
                    _ => return Err(one_field("depth_m", "depth_m is required")),
                };
                if !d.is_finite() { return Err(one_field("depth_m", "depth_m must be finite")); }
                (b, d)
            }
        };
        if depth < 0.0 || depth > net_depth {
            return Err(one_field("depth_m", &format!("Depth must be between 0 and {}", format_m(net_depth))));
        }
        let size = validate::size_for_type(&body, &defect_type)?;
        let note = validate::note_field(&body, "note")?.unwrap_or_default();
        let private_note = validate::note_field(&body, "private_note")?.unwrap_or_default();

        let pen_guard = format!("pen:{pen_id}");
        let guard = self.locks.defect(&pen_guard);
        let _g = guard.lock().await;
        let id = self.next_defect_id()?;
        let pos = domain::position_for(&grid, bearing, depth);
        let area = domain::defect_area_cm2(&defect_type, &size);
        let patch_area = if defect_type == "fouling" {
            Some(FoulingPatch {
                chart_x_m: pos.chart_x_m, depth_m: pos.depth_m,
                width_m: size.get("width_m").and_then(|v| v.as_f64()).unwrap_or(0.0),
                height_m: size.get("height_m").and_then(|v| v.as_f64()).unwrap_or(0.0),
            }.clipped_area_m2(&grid))
        } else { None };
        let at = now_iso();
        self.store.pg.exec(
            "INSERT INTO defects (id, pen_id, type, bearing_deg, depth_m, chart_x_m, chart_y_m, cell, size, area_cm2, patch_area_m2, note, private_note, status, removed, version, created_at, updated_at) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'open',false,1,now(),now())",
            vec![Param::Text(id.clone()), Param::Text(pen_id.into()), Param::Text(defect_type.clone()),
                 Param::Float(pos.bearing_deg), Param::Float(pos.depth_m), Param::Float(pos.chart_x_m), Param::Float(pos.chart_y_m),
                 Param::Text(pos.cell.clone()), Param::Json(size.clone()),
                 area.map(Param::Float).unwrap_or(Param::Null),
                 patch_area.map(Param::Float).unwrap_or(Param::Null),
                 Param::Text(note.clone()), Param::Text(private_note.clone())]).map_err(internal)?;
        let device_name = self.device_name_of(device_id)?;
        self.write_history(&id, &at, device_id, &device_name, "created", &created_changes(&defect_type, &pos, area, patch_area, &size, &note, &private_note), "new defect")?;
        self.broadcast(json!({"kind": "defect_created", "defect_id": id, "pen_id": pen_id, "device_id": device_id, "device_name": device_name})).await;
        let defect = self.store.defect_json(&id, true, None).map_err(internal)?;
        let pen = self.store.pen_json(pen_id, true).map_err(internal)?;
        Ok(json_response(201, &json!({"defect": defect, "pen": pen})))
    }

    /// The next free number of a prefixed id sequence, robust to gaps and test rows.
    pub fn next_prefixed_id(&self, prefix: &str, table: &str) -> Result<String, ApiError> {
        let rows = self.store.pg.exec(
            &format!("SELECT id FROM {table} WHERE id LIKE '{prefix}-%' ORDER BY id DESC LIMIT 1"), vec![])
            .map_err(internal)?;
        let next = if rows.is_empty() { 1 } else {
            let last = rows.str_of(0, "id");
            let n: i64 = last.trim_start_matches(&format!("{prefix}-")).parse().unwrap_or(0);
            n + 1
        };
        Ok(format!("{prefix}-{:04}", next))
    }

    pub fn next_defect_id(&self) -> Result<String, ApiError> {
        let rows = self.store.pg.exec("SELECT count(*)::int AS n FROM defects WHERE id LIKE 'D-%'", vec![]).map_err(internal)?;
        let mut n = rows.int_of(0, "n") + 1;
        loop {
            let id = format!("D-{:04}", n);
            let exists = self.store.pg.exec("SELECT 1 AS ok FROM defects WHERE id = $1", vec![Param::Text(id.clone())]).map_err(internal)?;
            if exists.is_empty() { return Ok(id); }
            n += 1;
        }
    }

    pub fn write_history(&self, defect_id: &str, at: &str, device_id: &str, device_name: &str, action: &str, changes: &Value, detail: &str) -> Result<(), ApiError> {
        let at_dt = crate::dives::parse_now(at).unwrap_or_else(chrono::Utc::now);
        self.store.pg.exec(
            "INSERT INTO defect_history (defect_id, at, device_id, device_name, action, changes, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)",
            vec![Param::Text(defect_id.into()), Param::Timestamp(at_dt), Param::Text(device_id.into()), Param::Text(device_name.into()),
                 Param::Text(action.into()), Param::Json(changes.clone()), Param::Text(detail.into())]).map_err(internal)?;
        Ok(())
    }

    // ----- patch -----

    pub async fn patch_defect(&self, defect_id: &str, body: Value, device_id: &str) -> ApiResult<Response> {
        let pen_id = self.defect_pen(defect_id).ok_or_else(|| err(404, "not_found", "Not found"))?;
        if body.get("type").is_some() && body["type"] != Value::Null && body.get("type").and_then(|v| v.as_str()).is_some() {
            return Err(one_field("type", "Type cannot change"));
        }
        let guard = self.locks.defect(defect_id);
        let _g = guard.lock().await;
        self.check_removed(defect_id)?;
        if let Some(e) = self.lock_refusal_for(defect_id, device_id).await { return Err(e); }
        let current_version = self.current_version(defect_id)?;
        let sent_version = match body.get("version") {
            Some(Value::Number(n)) => n.as_i64().unwrap_or(-1),
            _ => return Err(one_field("version", "version is required")),
        };
        if sent_version != current_version {
            return Err(err(409, "version_conflict", format!("{defect_id} changed on another device — reopen to see the latest")));
        }
        let grid = self.store.pen_grid(&pen_id).map_err(internal)?;
        let rows = self.store.pg.exec(
            "SELECT type, bearing_deg, depth_m, chart_x_m, chart_y_m, cell, size, note, private_note, status, area_cm2, patch_area_m2 FROM defects WHERE id = $1",
            vec![Param::Text(defect_id.into())]).map_err(internal)?;
        let defect_type = rows.str_of(0, "type");
        let old_bearing = rows.num_of(0, "bearing_deg");
        let old_depth = rows.num_of(0, "depth_m");
        let old_size: Value = parse_json_col(&rows.get(0, "size"));
        let old_note = rows.str_of(0, "note");
        let old_private = rows.str_of(0, "private_note");

        // New position.
        let (new_bearing, new_depth) = match body.get("wall_point") {
            Some(Value::Object(wp)) => {
                let x = wp.get("x_m").and_then(|v| v.as_f64()).unwrap_or(f64::NAN);
                let y = wp.get("y_m").and_then(|v| v.as_f64()).unwrap_or(f64::NAN);
                let z = wp.get("z_m").and_then(|v| v.as_f64()).unwrap_or(f64::NAN);
                if ![x, y, z].iter().all(|v| v.is_finite()) {
                    return Err(one_field("wall_point", "wall_point must be finite"));
                }
                (domain::wall_point_bearing(x, z), -y)
            }
            Some(_) => return Err(one_field("wall_point", "wall_point must be an object")),
            None => {
                let b = match body.get("bearing_deg") {
                    None | Some(Value::Null) => old_bearing,
                    Some(Value::Number(n)) => {
                        let v = n.as_f64().unwrap_or(f64::NAN);
                        if !v.is_finite() { return Err(one_field("bearing_deg", "bearing_deg must be finite")); }
                        v
                    }
                    Some(_) => return Err(one_field("bearing_deg", "bearing_deg must be a number")),
                };
                let d = match body.get("depth_m") {
                    None | Some(Value::Null) => old_depth,
                    Some(Value::Number(n)) => {
                        let v = n.as_f64().unwrap_or(f64::NAN);
                        if !v.is_finite() { return Err(one_field("depth_m", "depth_m must be finite")); }
                        v
                    }
                    Some(_) => return Err(one_field("depth_m", "depth_m must be a number")),
                };
                (b, d)
            }
        };
        if new_depth < 0.0 || new_depth > grid.net_depth_m {
            return Err(one_field("depth_m", &format!("Depth must be between 0 and {}", format_m(grid.net_depth_m))));
        }
        let pos = domain::position_for(&grid, new_bearing, new_depth);
        let new_size = if body.get("size").is_some() && body["size"] != Value::Null {
            validate::size_for_type(&body, &defect_type)?
        } else { old_size.clone() };
        let new_note = match body.get("note") {
            None | Some(Value::Null) => old_note.clone(),
            Some(_) => validate::note_field(&body, "note")?.unwrap_or_default(),
        };
        let new_private = match body.get("private_note") {
            None | Some(Value::Null) => old_private.clone(),
            Some(_) => validate::note_field(&body, "private_note")?.unwrap_or_default(),
        };
        let area = domain::defect_area_cm2(&defect_type, &new_size);
        let patch_area = if defect_type == "fouling" {
            Some(FoulingPatch {
                chart_x_m: pos.chart_x_m, depth_m: pos.depth_m,
                width_m: new_size.get("width_m").and_then(|v| v.as_f64()).unwrap_or(0.0),
                height_m: new_size.get("height_m").and_then(|v| v.as_f64()).unwrap_or(0.0),
            }.clipped_area_m2(&grid))
        } else { None };

        let at = now_iso();
        let mut changes = json!({});
        if pos.bearing_deg != old_bearing { changes["bearing_deg"] = json!({"before": old_bearing, "after": pos.bearing_deg}); }
        if pos.depth_m != old_depth { changes["depth_m"] = json!({"before": old_depth, "after": pos.depth_m}); }
        if pos.chart_x_m != rows.num_of(0, "chart_x_m") { changes["chart_x_m"] = json!({"before": rows.num_of(0, "chart_x_m"), "after": pos.chart_x_m}); }
        if pos.chart_y_m != rows.num_of(0, "chart_y_m") { changes["chart_y_m"] = json!({"before": rows.num_of(0, "chart_y_m"), "after": pos.chart_y_m}); }
        if pos.cell != rows.str_of(0, "cell") { changes["cell"] = json!({"before": rows.str_of(0, "cell"), "after": pos.cell}); }
        if new_size != old_size {
            for (k, v) in new_size.as_object().into_iter().flatten() {
                let old_v = old_size.get(k).cloned().unwrap_or(Value::Null);
                if *v != old_v {
                    changes[format!("size.{k}")] = json!({"before": old_v, "after": v});
                }
            }
        }
        if new_note != old_note { changes["note"] = json!({"before": old_note, "after": new_note}); }
        if new_private != old_private { changes["private_note"] = json!({"before": old_private, "after": new_private}); }

        self.store.pg.exec(
            "UPDATE defects SET bearing_deg = $2, depth_m = $3, chart_x_m = $4, chart_y_m = $5, cell = $6, size = $7, area_cm2 = $8, patch_area_m2 = $9, note = $10, private_note = $11, version = version + 1, updated_at = now() WHERE id = $1",
            vec![Param::Text(defect_id.into()), Param::Float(pos.bearing_deg), Param::Float(pos.depth_m),
                 Param::Float(pos.chart_x_m), Param::Float(pos.chart_y_m), Param::Text(pos.cell.clone()), Param::Json(new_size.clone()),
                 area.map(Param::Float).unwrap_or(Param::Null),
                 patch_area.map(Param::Float).unwrap_or(Param::Null),
                 Param::Text(new_note), Param::Text(new_private)]).map_err(internal)?;
        let device_name = self.device_name_of(device_id)?;
        self.write_history(defect_id, &at, device_id, &device_name, "updated", &changes, "")?;
        self.broadcast(json!({"kind": "defect_updated", "defect_id": defect_id, "pen_id": pen_id, "device_id": device_id, "device_name": device_name})).await;
        let defect = self.store.defect_json(defect_id, true, None).map_err(internal)?;
        let pen = self.store.pen_json(&pen_id, true).map_err(internal)?;
        Ok(json_response(200, &json!({"defect": defect, "pen": pen})))
    }

    pub fn current_version(&self, defect_id: &str) -> Result<i64, ApiError> {
        let rows = self.store.pg.exec("SELECT version FROM defects WHERE id = $1", vec![Param::Text(defect_id.into())]).map_err(internal)?;
        Ok(rows.int_of(0, "version"))
    }

    // ----- delete -----

    pub async fn delete_defect(&self, defect_id: &str, device_id: &str) -> ApiResult<Response> {
        let pen_id = self.defect_pen(defect_id).ok_or_else(|| err(404, "not_found", "Not found"))?;
        let guard = self.locks.defect(defect_id);
        let _g = guard.lock().await;
        self.check_removed(defect_id)?;
        if let Some(e) = self.lock_refusal_for(defect_id, device_id).await { return Err(e); }
        let at = now_iso();
        self.store.pg.exec("UPDATE defects SET removed = true, updated_at = now() WHERE id = $1",
            vec![Param::Text(defect_id.into())]).map_err(internal)?;
        let device_name = self.device_name_of(device_id)?;
        self.write_history(defect_id, &at, device_id, &device_name, "removed", &json!({}), "")?;
        self.broadcast(json!({"kind": "defect_removed", "defect_id": defect_id, "pen_id": pen_id, "device_id": device_id, "device_name": device_name})).await;
        let placeholder = self.store.placeholder_json(defect_id).map_err(internal)?;
        let pen = self.store.pen_json(&pen_id, true).map_err(internal)?;
        Ok(json_response(200, &json!({"defect": placeholder, "pen": pen})))
    }

    // ----- history -----

    pub async fn defect_history(&self, defect_id: &str) -> ApiResult<Response> {
        if self.defect_pen(defect_id).is_none() {
            return Err(err(404, "not_found", "Not found"));
        }
        let history = self.store.history_json(defect_id).map_err(internal)?;
        Ok(json_response(200, &json!({"history": history})))
    }

    // ----- stills -----

    pub async fn attach_still(&self, defect_id: &str, bytes: Vec<u8>, content_type: &str, file_name: &str, device_id: &str) -> ApiResult<Response> {
        let pen_id = self.defect_pen(defect_id).ok_or_else(|| err(404, "not_found", "Not found"))?;
        if bytes.is_empty() { return Err(one_field("body", "Upload body is empty")); }
        if bytes.len() > 8_000_000 {
            return Err(err(413, "too_large", "Still is larger than 8,000,000 bytes"));
        }
        if content_type != "image/jpeg" && content_type != "image/png" {
            return Err(one_field("content_type", "Stills must be JPEG or PNG"));
        }
        let guard = self.locks.defect(defect_id);
        let _g = guard.lock().await;
        self.check_removed(defect_id)?;
        if let Some(e) = self.lock_refusal_for(defect_id, device_id).await { return Err(e); }
        let farm_id = self.farm_of_pen(&pen_id)?;
        let id = self.next_prefixed_id("S", "stills")?;
        let sha = sha256_hex(&bytes);
        let key = format!("farms/{farm_id}/stills/{id}");
        self.store.s3.put(&key, &bytes, content_type).await.map_err(internal)?;
        let at = now_iso();
        self.store.pg.exec(
            "INSERT INTO stills (id, defect_id, farm_id, content_type, size_bytes, sha256, file_name, uploaded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            vec![Param::Text(id.clone()), Param::Text(defect_id.into()), Param::Text(farm_id), Param::Text(content_type.into()),
                 Param::Int(bytes.len() as i64), Param::Text(sha.clone()), Param::Text(file_name.into()), Param::Timestamp(crate::api::ts_of(&at))]).map_err(internal)?;
        let device_name = self.device_name_of(device_id)?;
        self.write_history(defect_id, &at, device_id, &device_name, "still_attached", &json!({}), &id)?;
        self.broadcast(json!({"kind": "still_attached", "defect_id": defect_id, "pen_id": pen_id, "device_id": device_id, "device_name": device_name})).await;
        let still = json!({"id": id, "content_type": content_type, "size_bytes": bytes.len(), "sha256": sha, "file_name": file_name});
        Ok(json_response(201, &json!({"still": still})))
    }

    pub async fn still_raw(&self, still_id: &str) -> ApiResult<Response> {
        let rows = self.store.pg.exec("SELECT content_type, farm_id, sha256 FROM stills WHERE id = $1", vec![Param::Text(still_id.into())]).map_err(internal)?;
        if rows.is_empty() { return Err(err(404, "not_found", "Not found")); }
        let key = format!("farms/{}/stills/{}", rows.str_of(0, "farm_id"), still_id);
        let bytes = self.store.s3.get(&key).await.map_err(internal)?;
        let sha = rows.str_of(0, "sha256");
        let sha = if sha.is_empty() { sha256_hex(&bytes) } else { sha };
        Ok(raw_response(bytes, &rows.str_of(0, "content_type"), &sha))
    }

    // ----- repairs -----

    pub async fn record_repair(&self, defect_id: &str, body: Value, device_id: &str) -> ApiResult<Response> {
        let pen_id = self.defect_pen(defect_id).ok_or_else(|| err(404, "not_found", "Not found"))?;
        let method = match body.get("method").and_then(|v| v.as_str()) {
            Some(m) if ["patch", "lace", "replace_panel", "clean"].contains(&m) => m.to_string(),
            Some(_) => return Err(one_field("method", "Method must be patch, lace, replace_panel or clean")),
            None => return Err(one_field("method", "Method is required")),
        };
        let note = validate::note_field(&body, "note")?.unwrap_or_default();
        let guard = self.locks.defect(defect_id);
        let _g = guard.lock().await;
        self.check_removed(defect_id)?;
        if let Some(e) = self.lock_refusal_for(defect_id, device_id).await { return Err(e); }
        let rows = self.store.pg.exec("SELECT status FROM defects WHERE id = $1", vec![Param::Text(defect_id.into())]).map_err(internal)?;
        if rows.str_of(0, "status") == "repaired" {
            return Err(err(409, "already_repaired", format!("{defect_id} is already repaired")));
        }
        let at = now_iso();
        let repair_id = self.next_prefixed_id("R", "repairs")?;
        let device_name = self.device_name_of(device_id)?;
        self.store.pg.exec(
            "INSERT INTO repairs (id, defect_id, method, note, source, proposal_id, recorded_at, device_id, device_name) \
             VALUES ($1,$2,$3,$4,'manual',NULL,$5,$6,$7)",
            vec![Param::Text(repair_id.clone()), Param::Text(defect_id.into()), Param::Text(method.clone()),
                 Param::Text(note.clone()), Param::Timestamp(crate::api::ts_of(&at)), Param::Text(device_id.into()), Param::Text(device_name.clone())]).map_err(internal)?;
        self.store.pg.exec("UPDATE defects SET status = 'repaired', version = version + 1, updated_at = now() WHERE id = $1",
            vec![Param::Text(defect_id.into())]).map_err(internal)?;
        self.write_history(defect_id, &at, device_id, &device_name, "repaired", &json!({"status": {"before": "open", "after": "repaired"}}), &method)?;
        self.broadcast(json!({"kind": "defect_repaired", "defect_id": defect_id, "pen_id": pen_id, "device_id": device_id, "device_name": device_name})).await;
        let repair = json!({"id": repair_id, "method": method, "note": note, "source": "manual", "proposal_id": null, "recorded_at": at});
        let defect = self.store.defect_json(defect_id, true, None).map_err(internal)?;
        let pen = self.store.pen_json(&pen_id, true).map_err(internal)?;
        Ok(json_response(201, &json!({"repair": repair, "defect": defect, "pen": pen})))
    }

    pub fn farm_of_pen(&self, pen_id: &str) -> Result<String, ApiError> {
        let rows = self.store.pg.exec("SELECT farm_id FROM pens WHERE id = $1", vec![Param::Text(pen_id.into())]).map_err(internal)?;
        if rows.is_empty() { return Err(err(404, "not_found", "Not found")); }
        Ok(rows.str_of(0, "farm_id"))
    }
}

fn format_m(v: f64) -> String {
    if v.fract() == 0.0 { format!("{}", v as i64) } else { format!("{v}") }
}

fn parse_json_col(v: &Value) -> Value {
    match v {
        Value::String(s) => serde_json::from_str(s).unwrap_or(json!({})),
        other => other.clone(),
    }
}

pub fn raw_response(bytes: Vec<u8>, content_type: &str, sha256: &str) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", content_type)
        .header("x-content-sha256", sha256)
        .header("cache-control", "no-store")
        .body(Body::from(bytes))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

fn created_changes(defect_type: &str, pos: &domain::Position, area: Option<f64>, patch_area: Option<f64>, size: &Value, note: &str, private_note: &str) -> Value {
    let mut changes = json!({
        "bearing_deg": {"before": null, "after": pos.bearing_deg},
        "depth_m": {"before": null, "after": pos.depth_m},
        "chart_x_m": {"before": null, "after": pos.chart_x_m},
        "chart_y_m": {"before": null, "after": pos.chart_y_m},
        "cell": {"before": null, "after": pos.cell},
        "note": {"before": null, "after": note},
        "private_note": {"before": null, "after": private_note},
    });
    for (k, v) in size.as_object().into_iter().flatten() {
        changes[format!("size.{k}")] = json!({"before": null, "after": v});
    }
    if let Some(a) = area { changes["area_cm2"] = json!({"before": null, "after": a}); }
    if let Some(a) = patch_area { changes["patch_area_m2"] = json!({"before": null, "after": a}); }
    let _ = defect_type;
    changes
}


