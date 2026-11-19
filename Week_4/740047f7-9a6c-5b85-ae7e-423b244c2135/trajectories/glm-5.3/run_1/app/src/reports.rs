//! Report revisions, exact restore, report links with their lifecycle,
//! the public share JSON, search and the defect export.

use crate::api::{err, internal, json_response, now_iso, App};
use crate::domain;
use crate::infra::ApiResult;
use crate::pg::Param;
use crate::s3::sha256_hex;
use crate::seed;
use crate::validate::{one_field};
use axum::response::Response;
use serde_json::{json, Value};

impl App {
    // ----- revisions -----

    pub async fn pen_reports(&self, pen_id: &str) -> ApiResult<Response> {
        if !self.store.pen_exists(pen_id).map_err(internal)? {
            return Err(err(404, "not_found", "Not found"));
        }
        let rows = self.store.pg.exec(
            "SELECT number, published_at, sha256, size_bytes, grade_letter, open_defects FROM revisions WHERE pen_id = $1 ORDER BY number DESC",
            vec![Param::Text(pen_id.into())]).map_err(internal)?;
        let revisions: Vec<Value> = (0..rows.len()).map(|i| json!({
            "number": rows.int_of(i, "number"),
            "published_at": fix_iso(rows.get(i, "published_at")),
            "sha256": rows.str_of(i, "sha256"),
            "size_bytes": rows.int_of(i, "size_bytes"),
            "grade": rows.str_of(i, "grade_letter"),
            "open_defects": rows.int_of(i, "open_defects"),
        })).collect();
        Ok(json_response(200, &json!({"revisions": revisions})))
    }

    pub async fn publish_revision(&self, pen_id: &str, device_id: &str) -> ApiResult<Response> {
        if !self.store.pen_exists(pen_id).map_err(internal)? {
            return Err(err(404, "not_found", "Not found"));
        }
        // Refuse while another device holds the lock on any defect of this pen.
        let locked = self.store.pg.exec(
            "SELECT id FROM defects WHERE pen_id = $1 AND removed = false", vec![Param::Text(pen_id.into())]).map_err(internal)?;
        for i in 0..locked.len() {
            let did = locked.str_of(i, "id");
            if let Some(e) = self.lock_refusal_for(&did, device_id).await { return Err(e); }
        }
        let guard = self.locks.defect(&format!("reports:{pen_id}"));
        let _g = guard.lock().await;
        let grid = self.store.pen_grid(pen_id).map_err(internal)?;
        let rows = self.store.pg.exec(
            "SELECT coalesce(max(number), 0)::bigint AS n FROM revisions WHERE pen_id = $1",
            vec![Param::Text(pen_id.into())]).map_err(internal)?;
        let number = rows.int_of(0, "n") + 1;
        let at = now_iso();
        let snapshot = seed::snapshot_of(&self.store, pen_id).map_err(internal)?;
        let pack = seed::build_pack(pen_id, number, crate::dives::parse_now(&at).unwrap_or_default(), &self.store, &grid, &snapshot).map_err(internal)?;
        let sha = sha256_hex(&pack);
        let farm_id = self.farm_of_pen(pen_id)?;
        let key = format!("farms/{farm_id}/reports/{pen_id}/revision-{number}.json");
        self.store.s3.put(&key, &pack, "application/json").await.map_err(internal)?;
        let (letter, label, open_count, _) = self.store.pen_condition(pen_id).map_err(internal)?;
        self.store.pg.exec(
            "INSERT INTO revisions (pen_id, number, published_at, sha256, size_bytes, grade_letter, open_defects, snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            vec![Param::Text(pen_id.into()), Param::Int(number), Param::Timestamp(crate::api::ts_of(&at)), Param::Text(sha.clone()),
                 Param::Int(pack.len() as i64), Param::Text(letter.to_string()), Param::Int(open_count), Param::Json(snapshot.clone())]).map_err(internal)?;
        for d in snapshot["defects"].as_array().cloned().unwrap_or_default() {
            if d["removed"].as_bool() == Some(true) { continue; }
            for s in d["stills"].as_array().cloned().unwrap_or_default() {
                self.store.pg.exec(
                    "INSERT INTO revision_still_links (revision_id, still_id, defect_id) SELECT id, $1, $2 FROM revisions WHERE pen_id = $3 AND number = $4",
                    vec![Param::Text(s["id"].as_str().unwrap_or("").into()), Param::Text(d["id"].as_str().unwrap_or("").into()),
                         Param::Text(pen_id.into()), Param::Int(number)]).map_err(internal)?;
            }
        }
        let device_name = self.device_name_of(device_id)?;
        self.broadcast(json!({"kind": "revision_published", "pen_id": pen_id, "number": number, "device_id": device_id, "device_name": device_name})).await;
        Ok(json_response(201, &json!({"revision": {
            "number": number, "published_at": at, "sha256": sha, "size_bytes": pack.len(),
            "grade": letter.to_string(), "open_defects": open_count, "label": label,
        }})))
    }

    pub async fn revision_pack(&self, pen_id: &str, n: i64) -> ApiResult<Response> {
        let rows = self.store.pg.exec(
            "SELECT sha256 FROM revisions WHERE pen_id = $1 AND number = $2",
            vec![Param::Text(pen_id.into()), Param::Int(n)]).map_err(internal)?;
        if rows.is_empty() { return Err(err(404, "not_found", "Not found")); }
        let farm_id = self.farm_of_pen(pen_id)?;
        let key = format!("farms/{farm_id}/reports/{pen_id}/revision-{n}.json");
        let bytes = self.store.s3.get(&key).await.map_err(internal)?;
        Ok(crate::defects::raw_response(bytes, "application/json", &rows.str_of(0, "sha256")))
    }

    pub async fn restore_revision(&self, pen_id: &str, body: Value, device_id: &str) -> ApiResult<Response> {
        if !self.store.pen_exists(pen_id).map_err(internal)? {
            return Err(err(404, "not_found", "Not found"));
        }
        let revision = match body.get("revision") {
            Some(Value::Number(n)) if n.is_i64() || n.is_u64() => n.as_i64().unwrap_or(0),
            Some(Value::Number(n)) if n.as_f64().map(|f| f.fract() == 0.0).unwrap_or(false) => n.as_f64().unwrap_or(0.0) as i64,
            Some(_) => return Err(one_field("revision", "Revision must be a whole number")),
            None => return Err(one_field("revision", "Revision is required")),
        };
        // Refuse while another device holds the lock on any defect of this pen.
        let locked = self.store.pg.exec(
            "SELECT id FROM defects WHERE pen_id = $1 AND removed = false", vec![Param::Text(pen_id.into())]).map_err(internal)?;
        for i in 0..locked.len() {
            let did = locked.str_of(i, "id");
            if let Some(e) = self.lock_refusal_for(&did, device_id).await { return Err(e); }
        }
        let guard = self.locks.defect(&format!("reports:{pen_id}"));
        let _g = guard.lock().await;
        let rows = self.store.pg.exec(
            "SELECT snapshot FROM revisions WHERE pen_id = $1 AND number = $2",
            vec![Param::Text(pen_id.into()), Param::Int(revision)]).map_err(internal)?;
        if rows.is_empty() { return Err(err(404, "not_found", "Not found")); }
        let snapshot: Value = match rows.get(0, "snapshot") {
            Value::String(s) => serde_json::from_str(&s).unwrap_or(json!({})),
            other => other.clone(),
        };
        let at = now_iso();
        let device_name = self.device_name_of(device_id)?;
        // Bring the pen's defects to exactly the snapshot.
        let wanted: Vec<Value> = snapshot["defects"].as_array().cloned().unwrap_or_default();
        let current = self.store.pg.exec(
            "SELECT id FROM defects WHERE pen_id = $1", vec![Param::Text(pen_id.into())]).map_err(internal)?;
        let wanted_ids: Vec<String> = wanted.iter().filter_map(|d| d["id"].as_str().map(String::from)).collect();
        for i in 0..current.len() {
            let id = current.str_of(i, "id");
            if !wanted_ids.contains(&id) {
                self.store.pg.exec("DELETE FROM defects WHERE id = $1", vec![Param::Text(id.clone())]).map_err(internal)?;
            }
        }
        for d in &wanted {
            let id = d["id"].as_str().unwrap_or("").to_string();
            let removed = d["removed"].as_bool() == Some(true);
            let existing = self.store.pg.exec("SELECT version FROM defects WHERE id = $1", vec![Param::Text(id.clone())]).map_err(internal)?;
            let size = d["size"].clone();
            let mut changes = json!({});
            let existing_rows = if existing.is_empty() { None } else {
                let r = self.store.pg.exec(
                    "SELECT type, bearing_deg, depth_m, chart_x_m, chart_y_m, cell, size, note, private_note, status, version, removed FROM defects WHERE id = $1",
                    vec![Param::Text(id.clone())]).map_err(internal)?;
                Some(r)
            };
            if existing.is_empty() {
                self.store.pg.exec(
                    "INSERT INTO defects (id, pen_id, type, bearing_deg, depth_m, chart_x_m, chart_y_m, cell, size, area_cm2, patch_area_m2, note, private_note, status, removed, version, created_at, updated_at) \
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,1,now(),now())",
                    vec![Param::Text(id.clone()), Param::Text(pen_id.into()), Param::Text(d["type"].as_str().unwrap_or("").into()),
                         Param::Float(d["bearing_deg"].as_f64().unwrap_or(0.0)), Param::Float(d["depth_m"].as_f64().unwrap_or(0.0)),
                         Param::Float(d["chart_x_m"].as_f64().unwrap_or(0.0)), Param::Float(d["chart_y_m"].as_f64().unwrap_or(0.0)),
                         Param::Text(d["cell"].as_str().unwrap_or("").into()), Param::Json(size.clone()),
                         opt_param(&d["area_cm2"]), opt_param(&d["patch_area_m2"]),
                         Param::Text(d["note"].as_str().unwrap_or("").into()), Param::Text(d["private_note"].as_str().unwrap_or("").into()),
                         Param::Text(d["status"].as_str().unwrap_or("open").into()), Param::Bool(removed), Param::Timestamp(crate::api::ts_of(&at))]).map_err(internal)?;
                let _ = changes;
                changes = json!({});
                self.write_history(&id, &at, device_id, &device_name, "restored", &changes, &format!("revision {revision}"))?;
                continue;
            }
            let current_rows = existing_rows.unwrap();
            let current_version = current_rows.int_of(0, "version");
            let snapshot_version = d["version"].as_i64().unwrap_or(1);
            let new_version = current_version.max(snapshot_version) + 1;
            let cur_removed = current_rows.get(0, "removed").as_bool() == Some(true);
            let mut edits = String::new();
            if cur_removed != removed { edits.push_str("R"); }
            self.store.pg.exec(
                "UPDATE defects SET type = $2, bearing_deg = $3, depth_m = $4, chart_x_m = $5, chart_y_m = $6, cell = $7, size = $8, \
                 area_cm2 = $9, patch_area_m2 = $10, note = $11, private_note = $12, status = $13, removed = $14, version = $15, updated_at = now() WHERE id = $1",
                vec![Param::Text(id.clone()), Param::Text(d["type"].as_str().unwrap_or("").into()),
                     Param::Float(d["bearing_deg"].as_f64().unwrap_or(0.0)), Param::Float(d["depth_m"].as_f64().unwrap_or(0.0)),
                     Param::Float(d["chart_x_m"].as_f64().unwrap_or(0.0)), Param::Float(d["chart_y_m"].as_f64().unwrap_or(0.0)),
                     Param::Text(d["cell"].as_str().unwrap_or("").into()), Param::Json(size),
                     opt_param(&d["area_cm2"]), opt_param(&d["patch_area_m2"]),
                     Param::Text(d["note"].as_str().unwrap_or("").into()), Param::Text(d["private_note"].as_str().unwrap_or("").into()),
                     Param::Text(d["status"].as_str().unwrap_or("open").into()), Param::Bool(removed),
                     Param::Int(new_version)]).map_err(internal)?;
            // Re-link the snapshot's repairs and stills, unlinked after the revision.
            self.store.pg.exec("DELETE FROM repairs WHERE defect_id = $1", vec![Param::Text(id.clone())]).map_err(internal)?;
            for r in d["repairs"].as_array().cloned().unwrap_or_default() {
                let recorded = r["recorded_at"].as_str().and_then(crate::dives::parse_now)
                    .unwrap_or_else(chrono::Utc::now);
                let source = r["source"].as_str().unwrap_or("manual");
                self.store.pg.exec(
                    "INSERT INTO repairs (id, defect_id, method, note, source, proposal_id, recorded_at, device_id, device_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
                    vec![Param::Text(r["id"].as_str().unwrap_or("").into()), Param::Text(id.clone()), Param::Text(r["method"].as_str().unwrap_or("").into()),
                         Param::Text(r["note"].as_str().unwrap_or("").into()), Param::Text(source.into()),
                         Param::Null, Param::Timestamp(recorded),
                         Param::Text("DEV-1".into()), Param::Text("Topside laptop".into())]).map_err(internal)?;
            }
            self.store.pg.exec("DELETE FROM stills WHERE defect_id = $1", vec![Param::Text(id.clone())]).map_err(internal)?;
            for s in d["stills"].as_array().cloned().unwrap_or_default() {
                let sid = s["id"].as_str().unwrap_or("").to_string();
                let old = self.store.pg.exec("SELECT content_type, size_bytes, sha256, file_name, farm_id FROM stills WHERE id = $1", vec![Param::Text(sid.clone())]).map_err(internal)?;
                if old.is_empty() { continue; }
                let _ = self.store.pg.exec(
                    "INSERT INTO stills (id, defect_id, farm_id, content_type, size_bytes, sha256, file_name, uploaded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
                    vec![Param::Text(sid.clone()), Param::Text(id.clone()), Param::Text(old.str_of(0, "farm_id")),
                         Param::Text(old.str_of(0, "content_type")), Param::Int(old.int_of(0, "size_bytes")),
                         Param::Text(old.str_of(0, "sha256")), Param::Text(old.str_of(0, "file_name")), Param::Timestamp(crate::api::ts_of(&at))]).map_err(internal);
            }
            self.write_history(&id, &at, device_id, &device_name, "restored", &json!({}), &format!("revision {revision}"))?;
        }
        self.broadcast(json!({"kind": "revision_restored", "pen_id": pen_id, "number": revision, "device_id": device_id, "device_name": device_name})).await;
        let pen = self.store.pen_json(pen_id, true).map_err(internal)?;
        Ok(json_response(200, &json!({"pen": pen})))
    }

    // ----- report links -----

    pub async fn pen_links(&self, pen_id: &str) -> ApiResult<Response> {
        if !self.store.pen_exists(pen_id).map_err(internal)? {
            return Err(err(404, "not_found", "Not found"));
        }
        let rows = self.store.pg.exec(
            "SELECT id FROM report_links WHERE pen_id = $1 ORDER BY created_at DESC, id DESC",
            vec![Param::Text(pen_id.into())]).map_err(internal)?;
        let mut links = Vec::new();
        for i in 0..rows.len() {
            links.push(self.link_json(&rows.str_of(i, "id"), None).map_err(internal)?);
        }
        Ok(json_response(200, &json!({"server_now": now_iso(), "links": links})))
    }

    pub fn link_json(&self, link_id: &str, origin: Option<&str>) -> Result<Value, String> {
        let rows = self.store.pg.exec(
            "SELECT id, pen_id, token, revoked, created_at, expires_at FROM report_links WHERE id = $1",
            vec![Param::Text(link_id.into())])?;
        if rows.is_empty() { return Ok(Value::Null); }
        let expires_raw = fix_iso(rows.get(0, "expires_at"));
        let expires = crate::dives::parse_now(&expires_raw);
        let now = chrono::Utc::now();
        let revoked = rows.get(0, "revoked").as_bool() == Some(true);
        let expired = expires.map(|e| now >= e).unwrap_or(false);
        let status = if revoked { "revoked" } else if expired { "expired" } else { "active" };
        let expires_in_s: i64 = if status == "active" {
            expires.map(|e| (e - now).num_seconds().max(0)).unwrap_or(0)
        } else { 0 };
        let token = rows.str_of(0, "token");
        let path = format!("/r/{token}");
        let base = self.cfg.app_public_url.clone().map(|u| u.trim_end_matches('/').to_string())
            .or_else(|| origin.map(|o| o.trim_end_matches('/').to_string()))
            .unwrap_or_default();
        Ok(json!({
            "id": rows.str_of(0, "id"), "pen_id": rows.str_of(0, "pen_id"),
            "token": token, "path": path,
            "url": format!("{base}{path}"),
            "status": status,
            "created_at": fix_iso(rows.get(0, "created_at")),
            "expires_at": expires_raw,
            "expires_in_s": expires_in_s,
        }))
    }

    pub async fn create_link(&self, pen_id: &str, body: Value) -> ApiResult<Response> {
        if !self.store.pen_exists(pen_id).map_err(internal)? {
            return Err(err(404, "not_found", "Not found"));
        }
        let seconds = match body.get("expires_in_seconds") {
            Some(Value::Number(n)) if n.is_i64() || n.is_u64() => n.as_i64().unwrap_or(0),
            Some(_) => return Err(one_field("expires_in_seconds", "expires_in_seconds must be a whole number")),
            None => return Err(one_field("expires_in_seconds", "expires_in_seconds is required")),
        };
        if seconds < 10 || seconds > 2_592_000 {
            return Err(one_field("expires_in_seconds", "expires_in_seconds must be between 10 and 2,592,000"));
        }
        let guard = self.locks.link(&format!("pen:{pen_id}"));
        let _g = guard.lock().await;
        let id = self.next_prefixed_id("L", "report_links")?;
        let token = new_token();
        let at = now_iso();
        let expires_dt = chrono::Utc::now() + chrono::Duration::seconds(seconds);
        self.store.pg.exec(
            "INSERT INTO report_links (id, pen_id, token, revoked, created_at, expires_at) VALUES ($1,$2,$3,false,$4,$5)",
            vec![Param::Text(id.clone()), Param::Text(pen_id.into()), Param::Text(token.clone()), Param::Timestamp(crate::api::ts_of(&at)), Param::Timestamp(expires_dt)]).map_err(internal)?;
        self.store.pg.exec("INSERT INTO report_link_tokens (token, link_id) VALUES ($1,$2)",
            vec![Param::Text(token), Param::Text(id.clone())]).map_err(internal)?;
        self.broadcast(json!({"kind": "link_created", "pen_id": pen_id})).await;
        let link = self.link_json(&id, None).map_err(internal)?;
        Ok(json_response(201, &json!({"link": link})))
    }

    pub async fn regenerate_link(&self, link_id: &str, body: Value, origin: Option<&str>) -> ApiResult<Response> {
        let exists = self.store.pg.exec("SELECT pen_id FROM report_links WHERE id = $1", vec![Param::Text(link_id.into())]).map_err(internal)?;
        if exists.is_empty() { return Err(err(404, "not_found", "Not found")); }
        let token = match body.get("token") {
            Some(Value::String(s)) => s.clone(),
            Some(_) | None => return Err(one_field("token", "Token is required")),
        };
        let guard = self.locks.link(link_id);
        let _g = guard.lock().await;
        let link = self.link_json(link_id, origin).map_err(internal)?;
        let status = link["status"].as_str().unwrap_or("");
        if status != "active" {
            return Err(err(409, "link_state", "This link is no longer active"));
        }
        let current = self.store.pg.exec("SELECT token FROM report_links WHERE id = $1", vec![Param::Text(link_id.into())]).map_err(internal)?;
        if current.str_of(0, "token") != token {
            return Err(err(409, "link_state", "Link changed on another device — the list has been refreshed"));
        }
        let new_tok = new_token();
        self.store.pg.exec("UPDATE report_links SET token = $2 WHERE id = $1",
            vec![Param::Text(link_id.into()), Param::Text(new_tok.clone())]).map_err(internal)?;
        self.store.pg.exec("INSERT INTO report_link_tokens (token, link_id) VALUES ($1,$2)",
            vec![Param::Text(new_tok), Param::Text(link_id.into())]).map_err(internal)?;
        self.broadcast(json!({"kind": "link_regenerated", "pen_id": exists.str_of(0, "pen_id")})).await;
        let link = self.link_json(link_id, origin).map_err(internal)?;
        Ok(json_response(200, &json!({"link": link})))
    }

    pub async fn revoke_link(&self, link_id: &str, origin: Option<&str>) -> ApiResult<Response> {
        let exists = self.store.pg.exec("SELECT pen_id FROM report_links WHERE id = $1", vec![Param::Text(link_id.into())]).map_err(internal)?;
        if exists.is_empty() { return Err(err(404, "not_found", "Not found")); }
        let guard = self.locks.link(link_id);
        let _g = guard.lock().await;
        self.store.pg.exec("UPDATE report_links SET revoked = true WHERE id = $1", vec![Param::Text(link_id.into())]).map_err(internal)?;
        self.broadcast(json!({"kind": "link_revoked", "pen_id": exists.str_of(0, "pen_id")})).await;
        let link = self.link_json(link_id, origin).map_err(internal)?;
        Ok(json_response(200, &json!({"link": link})))
    }

    // ----- the public share -----

    pub async fn share_json(&self, token: &str) -> ApiResult<Response> {
        let rows = self.store.pg.exec(
            "SELECT l.id, l.pen_id, l.revoked, l.expires_at FROM report_links l WHERE l.token = $1",
            vec![Param::Text(token.into())]).map_err(internal)?;
        if rows.is_empty() {
            // A token this link once had reads as inactive, never as missing.
            let seen = self.store.pg.exec(
                "SELECT 1 AS ok FROM report_link_tokens WHERE token = $1",
                vec![Param::Text(token.into())]).map_err(internal)?;
            if !seen.is_empty() {
                return Err(err(410, "link_inactive", "This report link is no longer active"));
            }
            return Err(err(404, "not_found", "Not found"));
        }
        let expires = fix_iso(rows.get(0, "expires_at"));
        let expired = crate::dives::parse_now(&expires).map(|e| chrono::Utc::now() >= e).unwrap_or(false);
        if rows.get(0, "revoked").as_bool() == Some(true) || expired {
            return Err(err(410, "link_inactive", "This report link is no longer active"));
        }
        let pen_id = rows.str_of(0, "pen_id");
        let pen_full = self.store.pen_json(&pen_id, true).map_err(internal)?;
        let mut defects = Vec::new();
        for d in pen_full["defects"].as_array().cloned().unwrap_or_default() {
            if d["removed"].as_bool() == Some(true) { defects.push(d); continue; }
            let mut public = d.clone();
            for k in ["private_note", "version", "lock", "stills", "updated_at"] {
                if let Some(o) = public.as_object_mut() { o.remove(k); }
            }
            public["repairs"] = Value::Array(d["repairs"].as_array().cloned().unwrap_or_default().into_iter()
                .map(|r| json!({"method": r["method"], "note": r["note"], "recorded_at": r["recorded_at"]})).collect());
            defects.push(public);
        }
        let latest = self.store.latest_revision(&pen_id).map_err(internal)?;
        let now = chrono::Utc::now();
        let expires_dt = crate::dives::parse_now(&expires).unwrap_or(now);
        let expires_in_s = (expires_dt - now).num_seconds().max(0);
        Ok(json_response(200, &json!({
            "pen": {
                "name": pen_full["name"], "site_name": pen_full["site_name"], "farm_name": pen_full["farm_name"],
                "circumference_m": pen_full["circumference_m"], "net_depth_m": pen_full["net_depth_m"], "grid": pen_full["grid"],
            },
            "grade": pen_full["grade"], "open_defects": pen_full["open_defects"],
            "max_fouling_cover_pct": pen_full["max_fouling_cover_pct"], "panels": pen_full["panels"],
            "defects": defects, "latest_revision": latest,
            "link": {"status": "active", "expires_at": expires, "expires_in_s": expires_in_s},
        })))
    }

    // ----- search -----

    pub async fn search(&self, q_raw: &str) -> ApiResult<Response> {
        let q = q_raw.trim();
        if crate::domain::perceived_len(q) > 100 {
            return Err(one_field("q", "Search text is longer than 100 characters"));
        }
        if crate::domain::perceived_len(q) < 2 {
            return Ok(json_response(200, &json!({"results": []})));
        }
        // Escape only the query's own wildcards; the wrapping % stays a wildcard.
        let escaped = format!("%{}%", escape_like(q));
        // Literal substring, case-insensitive. Every character matches itself.
        let farms = self.store.pg.exec(
            "SELECT id, name FROM farms \
             WHERE lower(name) LIKE lower($1) ESCAPE '\\' \
                OR id IN (SELECT farm_id FROM sites WHERE lower(name) LIKE lower($1) ESCAPE '\\' OR lower(code) LIKE lower($1) ESCAPE '\\') \
             ORDER BY id",
            vec![Param::Text(escaped.clone())]).map_err(internal)?;
        let defects = self.store.pg.exec(
            "SELECT d.id, p.name FROM defects d JOIN pens p ON p.id = d.pen_id \
             WHERE d.removed = false AND (lower(d.id) LIKE lower($1) ESCAPE '\\' OR lower(d.note) LIKE lower($1) ESCAPE '\\') \
             ORDER BY d.id",
            vec![Param::Text(escaped.clone())]).map_err(internal)?;
        let pen_order = "CASE id WHEN 'skv-01' THEN 1 WHEN 'skv-02' THEN 2 WHEN 'skv-03' THEN 3 WHEN 'klm-04' THEN 4 ELSE 5 END";
        let pens = self.store.pg.exec(
            &format!("SELECT id, name FROM pens WHERE lower(name) LIKE lower($1) ESCAPE '\\' ORDER BY {pen_order}"),
            vec![Param::Text(escaped.clone())]).map_err(internal)?;
        let _ = pen_order;
        let mut results = Vec::new();
        for i in 0..farms.len() {
            results.push(json!({"kind": "farm", "id": farms.str_of(i, "id"), "label": farms.str_of(i, "name")}));
        }
        for i in 0..pens.len() {
            results.push(json!({"kind": "pen", "id": pens.str_of(i, "id"), "label": pens.str_of(i, "name")}));
        }
        for i in 0..defects.len() {
            results.push(json!({"kind": "defect", "id": defects.str_of(i, "id"), "label": format!("{} — {}", defects.str_of(i, "id"), defects.str_of(i, "name"))}));
        }
        Ok(json_response(200, &json!({"results": results})))
    }

    // ----- export -----

    pub async fn export_csv(&self) -> ApiResult<Response> {
        let rows = self.store.pg.exec(
            "SELECT f.name AS farm_name, s.code AS site_code, p.name AS pen_name, d.id, d.type, d.bearing_deg, d.depth_m, \
                    d.chart_x_m, d.chart_y_m, d.cell, d.area_cm2, d.patch_area_m2, d.status, d.note \
             FROM defects d JOIN pens p ON p.id = d.pen_id JOIN farms f ON f.id = p.farm_id JOIN sites s ON s.id = p.site_id \
             WHERE d.removed = false ORDER BY d.id",
            vec![]).map_err(internal)?;
        let mut out = String::from("farm,site_code,pen,defect_id,type,bearing_deg,depth_m,chart_x_m,chart_y_m,cell,area_cm2,patch_area_m2,status,note\n");
        for i in 0..rows.len() {
            let cells = vec![
                domain::csv_cell(&rows.str_of(i, "farm_name")),
                domain::csv_cell(&rows.str_of(i, "site_code")),
                domain::csv_cell(&rows.str_of(i, "pen_name")),
                domain::csv_cell(&rows.str_of(i, "id")),
                domain::csv_cell(&rows.str_of(i, "type")),
                fmt_dec(rows.num_of(i, "bearing_deg"), 1),
                fmt_dec(rows.num_of(i, "depth_m"), 1),
                fmt_dec(rows.num_of(i, "chart_x_m"), 2),
                fmt_dec(rows.num_of(i, "chart_y_m"), 2),
                domain::csv_cell(&rows.str_of(i, "cell")),
                fmt_opt_dec(&rows.get(i, "area_cm2"), 0),
                fmt_opt_dec(&rows.get(i, "patch_area_m2"), 1),
                domain::csv_cell(&rows.str_of(i, "status")),
                domain::csv_cell(&rows.str_of(i, "note")),
            ];
            out.push_str(&cells.join(","));
            out.push('\n');
        }
        Ok(Response::builder()
            .status(axum::http::StatusCode::OK)
            .header("content-type", "text/csv; charset=utf-8")
            .header("cache-control", "no-store")
            .body(axum::body::Body::from(out))
            .unwrap_or_else(|_| axum::response::Response::new(axum::body::Body::from(String::new()))))
    }
}

fn new_token() -> String {
    use rand::Rng;
    let alphabet = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    let token: String = (0..32).map(|_| alphabet[rng.gen_range(0..alphabet.len())] as char).collect();
    token
}

fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

fn fmt_dec(v: f64, decimals: usize) -> String {
    format!("{:.*}", decimals, v)
}

fn fmt_opt_dec(v: &Value, decimals: usize) -> String {
    match v {
        Value::Null => String::new(),
        Value::Number(n) => fmt_dec(n.as_f64().unwrap_or(0.0), decimals),
        Value::String(s) => match s.parse::<f64>() {
            Ok(f) => fmt_dec(f, decimals),
            Err(_) => String::new(),
        },
        _ => String::new(),
    }
}

fn opt_param(v: &Value) -> Param {
    match v {
        Value::Null => Param::Null,
        Value::Number(n) => Param::Float(n.as_f64().unwrap_or(0.0)),
        Value::String(s) => Param::Float(s.parse().unwrap_or(0.0)),
        _ => Param::Null,
    }
}

fn fix_iso(v: Value) -> String {
    match v { Value::String(s) => { if s.contains('T') { s } else { format!("{s}Z") } }, _ => String::new() }
}
