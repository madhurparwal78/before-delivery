//! Dive endpoints: planning, clearance via the marine forecast provider,
//! start, finish with track samples, and sonar captures.

use crate::api::{err, internal, json_response, now_iso, App};
use crate::infra::{ApiError, ApiResult};
use crate::pg::Param;
use crate::validate::{one_field, fields_error, required_int};
use axum::response::Response;
use chrono::{DateTime, Duration, SecondsFormat, TimeZone, Utc};
use serde_json::{json, Value};
use std::time::Duration as StdDuration;

pub fn parse_now(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
}

fn parse_utc_minute(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
}

impl App {
    pub async fn dives(&self) -> ApiResult<Response> {
        let rows = self.store.pg.exec(
            "SELECT id FROM dives ORDER BY created_at DESC, id DESC", vec![]).map_err(internal)?;
        let mut dives = Vec::new();
        for i in 0..rows.len() {
            dives.push(self.dive_json(&rows.str_of(i, "id")).map_err(internal)?);
        }
        Ok(json_response(200, &json!({"server_now": now_iso(), "dives": dives})))
    }

    pub fn dive_json(&self, dive_id: &str) -> Result<Value, String> {
        let rows = self.store.pg.exec(
            "SELECT id, pen_id, status, planned_start, planned_minutes, diver_certificate_no, clearance, clearance_checked_at, clearance_issued_at, started_at, finished_at FROM dives WHERE id = $1",
            vec![Param::Text(dive_id.into())])?;
        if rows.is_empty() { return Ok(Value::Null); }
        let status = rows.str_of(0, "status");
        let mut clearance: Value = match rows.get(0, "clearance") {
            Value::String(s) => serde_json::from_str(&s).unwrap_or(Value::Null),
            other => other,
        };
        // Re-derive staleness for planned and cleared dives on the server clock.
        if (status == "planned" || status == "cleared") && clearance.is_object() {
            let issued = clearance.get("issued_at").and_then(|v| v.as_str()).and_then(parse_utc_minute);
            let result = clearance.get("result").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if result == "GO" {
                if let Some(issued) = issued {
                    if Utc::now() - issued > Duration::hours(6) {
                        clearance["result"] = json!("Forecast stale");
                    }
                }
            }
        }
        let track_rows = self.store.pg.exec(
            "SELECT t_s, bearing_deg, depth_m FROM dive_track WHERE dive_id = $1 ORDER BY t_s", vec![Param::Text(dive_id.into())])?;
        let track: Vec<Value> = (0..track_rows.len()).map(|i| json!({
            "t_s": track_rows.int_of(i, "t_s"),
            "bearing_deg": track_rows.num_of(i, "bearing_deg"),
            "depth_m": track_rows.num_of(i, "depth_m"),
        })).collect();
        let sonar_rows = self.store.pg.exec(
            "SELECT id, content_type, size_bytes, sha256, file_name FROM sonar_captures WHERE dive_id = $1 ORDER BY id", vec![Param::Text(dive_id.into())])?;
        let sonar: Vec<Value> = (0..sonar_rows.len()).map(|i| json!({
            "id": sonar_rows.str_of(i, "id"), "content_type": sonar_rows.str_of(i, "content_type"),
            "size_bytes": sonar_rows.int_of(i, "size_bytes"), "sha256": sonar_rows.str_of(i, "sha256"),
            "file_name": sonar_rows.str_of(i, "file_name"),
        })).collect();
        let started_at = rows.text_opt(0, "started_at");
        let elapsed_s: Option<i64> = if status == "started" {
            started_at.as_deref().and_then(parse_utc_minute)
                .map(|t| (Utc::now() - t).num_seconds())
        } else { None };
        Ok(json!({
            "id": rows.str_of(0, "id"),
            "pen_id": rows.str_of(0, "pen_id"),
            "status": status,
            "planned_start": iso_or(rows.get(0, "planned_start")),
            "planned_minutes": rows.int_of(0, "planned_minutes"),
            "diver_certificate_no": rows.str_of(0, "diver_certificate_no"),
            "clearance": clearance,
            "started_at": opt_iso(rows.get(0, "started_at")),
            "finished_at": opt_iso(rows.get(0, "finished_at")),
            "elapsed_s": elapsed_s,
            "track": track,
            "sonar": sonar,
        }))
    }

    pub async fn dive(&self, dive_id: &str) -> ApiResult<Response> {
        let rows = self.store.pg.exec("SELECT 1 AS ok FROM dives WHERE id = $1", vec![Param::Text(dive_id.into())]).map_err(internal)?;
        if rows.is_empty() { return Err(err(404, "not_found", "Not found")); }
        let dive = self.dive_json(dive_id).map_err(internal)?;
        Ok(json_response(200, &json!({"server_now": now_iso(), "dive": dive})))
    }

    pub async fn plan_dive(&self, body: Value) -> ApiResult<Response> {
        let pen_id = match body.get("pen_id").and_then(|v| v.as_str()) {
            Some(p) => p.to_string(),
            None => return Err(one_field("pen_id", "Pen is required")),
        };
        if !self.store.pen_exists(&pen_id).map_err(internal)? {
            return Err(one_field("pen_id", "Unknown pen"));
        }
        let planned_start = match body.get("planned_start").and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => return Err(one_field("planned_start", "Planned start is required")),
        };
        let parsed = match DateTime::parse_from_rfc3339(&planned_start) {
            Ok(d) if planned_start.ends_with('Z') && planned_start.len() == 20 && planned_start.ends_with(":00Z") => d.with_timezone(&Utc),
            _ => return Err(one_field("planned_start", "Planned start must be YYYY-MM-DDTHH:MM:SSZ")),
        };
        let now = Utc::now();
        if parsed < now - Duration::minutes(30) || parsed > now + Duration::hours(48) {
            return Err(one_field("planned_start", "Planned start must be between 30 minutes before and 48 hours after now"));
        }
        let planned_minutes = required_int(&body, "planned_minutes")?;
        if planned_minutes < 15 || planned_minutes > 240 {
            return Err(one_field("planned_minutes", "Planned minutes must be between 15 and 240"));
        }
        let cert = body.get("diver_certificate_no").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        if cert.is_empty() || crate::domain::perceived_len(&cert) > 40 {
            return Err(one_field("diver_certificate_no", "Diver certificate number is required"));
        }
        let guard = self.locks.dive("new");
        let _g = guard.lock().await;
        let id = self.next_prefixed_id("DIVE", "dives")?;
        self.store.pg.exec(
            "INSERT INTO dives (id, pen_id, status, planned_start, planned_minutes, diver_certificate_no) VALUES ($1,$2,'planned',$3,$4,$5)",
            vec![Param::Text(id.clone()), Param::Text(pen_id), Param::Timestamp(parsed), Param::Int(planned_minutes), Param::Text(cert)]).map_err(internal)?;
        let dive = self.dive_json(&id).map_err(internal)?;
        Ok(json_response(201, &json!({"dive": dive})))
    }

    pub async fn check_forecast(&self, dive_id: &str) -> ApiResult<Response> {
        let guard = self.locks.dive(dive_id);
        let _g = guard.lock().await;
        let dive = self.dive_json(dive_id).map_err(internal)?;
        let status = dive["status"].as_str().unwrap_or("").to_string();
        if status != "planned" && status != "cleared" {
            return Err(err(409, "dive_state", "Dive has already started"));
        }
        if status == "started" { return Err(err(409, "dive_state", "Dive has already started")); }
        if status == "recorded" { return Err(err(409, "dive_state", "Dive is already recorded")); }
        let site = self.site_of_pen(dive["pen_id"].as_str().unwrap_or(""))?;
        let planned_start = dive["planned_start"].as_str().unwrap_or("").to_string();
        let start = parse_utc_minute(&planned_start).ok_or_else(|| err(422, "validation", "bad planned start"))?;
        let minutes = dive["planned_minutes"].as_i64().unwrap_or(90);
        let hours = planned_hours(start, minutes);

        let (outcome, clearance) = self.fetch_clearance(&site, &planned_start, &hours).await?;
        let at = now_iso();
        let issued = clearance.get("issued_at").and_then(|v| v.as_str()).and_then(crate::dives::parse_now);
        let issued_param = match issued {
            Some(t) => Param::Timestamp(t),
            None => Param::Null,
        };
        self.store.pg.exec(
            "UPDATE dives SET status = 'cleared', clearance = $2, clearance_checked_at = $3, clearance_issued_at = $4 WHERE id = $1",
            vec![Param::Text(dive_id.into()), Param::Json(clearance.clone()), Param::Timestamp(crate::api::ts_of(&at)), issued_param]).map_err(internal)?;
        if outcome != "unavailable" {
            self.broadcast(json!({"kind": "dive_cleared", "dive_id": dive_id})).await;
        }
        let dive = self.dive_json(dive_id).map_err(internal)?;
        Ok(json_response(200, &json!({"dive": dive})))
    }

    async fn fetch_clearance(&self, site: &Value, planned_start: &str, hours: &[String]) -> Result<(String, Value), ApiError> {
        let lat = site["latitude"].as_f64().unwrap_or(0.0);
        let lon = site["longitude"].as_f64().unwrap_or(0.0);
        let start_hour = hours.first().cloned().unwrap_or_default();
        let end_hour = hours.last().cloned().unwrap_or_default();
        let url = format!(
            "{}/v1/marine?latitude={:.4}&longitude={:.4}&hourly=ocean_current_velocity,wave_height&start_hour={}&end_hour={}",
            self.wiremock_url.trim_end_matches('/'), lat, lon,
            urlenc(&start_hour), urlenc(&end_hour));
        let result = tokio::time::timeout(StdDuration::from_secs(10),
            self.http.request_raw("GET", &url, None, "application/json", &[], StdDuration::from_secs(9))).await;
        let (status, _headers, body) = match result {
            Ok(Ok((s, _h, b))) => (s, _h, b),
            Ok(Err(e)) if e.code == "copilot_unavailable" || e.code == "forecast_unavailable" => {
                let unavailable = unavailable_clearance(planned_start, hours);
                return Ok(("unavailable".into(), unavailable));
            }
            Ok(Err(e)) => {
                let _ = e;
                let unavailable = unavailable_clearance(planned_start, hours);
                return Ok(("unavailable".into(), unavailable));
            }
            Err(_) => {
                let unavailable = unavailable_clearance(planned_start, hours);
                return Ok(("unavailable".into(), unavailable));
            }
        };
        if status != 200 {
            return Ok(("unavailable".into(), unavailable_clearance(planned_start, hours)));
        }
        let parsed: Value = match serde_json::from_slice(&body) { Ok(v) => v, Err(_) => {
            return Ok(("unavailable".into(), unavailable_clearance(planned_start, hours)));
        }};
        let issued = parsed.get("issued_at").and_then(|v| v.as_str()).and_then(parse_utc_minute);
        let issued = match issued { Some(i) => i, None => return Ok(("unavailable".into(), unavailable_clearance(planned_start, hours))) };
        let hourly = parsed.get("hourly").cloned().unwrap_or(Value::Null);
        let times = hourly.get("time").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let currents = hourly.get("ocean_current_velocity").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let waves = hourly.get("wave_height").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        if times.len() != currents.len() || times.len() != waves.len() {
            return Ok(("unavailable".into(), unavailable_clearance(planned_start, hours)));
        }
        // Build the hourly table for the planned hours.
        let mut table = Vec::new();
        let mut missing = false;
        for h in hours {
            let idx = times.iter().position(|t| t.as_str() == Some(h));
            match idx {
                Some(i) => {
                    let cur = currents.get(i).and_then(|v| v.as_f64());
                    let wav = waves.get(i).and_then(|v| v.as_f64());
                    match (cur, wav) {
                        (Some(c), Some(w)) => {
                            let within = c <= 0.50 && w <= 1.5;
                            table.push(json!({"time": h, "current_m_s": c, "wave_m": w, "within_limits": within}));
                        }
                        _ => { missing = true; }
                    }
                }
                None => { missing = true; }
            }
        }
        if missing || table.len() != hours.len() {
            return Ok(("unavailable".into(), unavailable_clearance(planned_start, hours)));
        }
        let now = Utc::now();
        let stale = now - issued > Duration::hours(6);
        let message;
        let result_word;
        if stale {
            result_word = "Forecast stale";
            message = format!("Forecast stale — issued {} UTC {}, more than 6 hours ago",
                issued.format("%H:%M"), issued.format("%Y-%m-%d"));
        } else {
            let mut failing: Option<(String, f64, bool)> = None;
            for row in &table {
                let c = row["current_m_s"].as_f64().unwrap_or(0.0);
                let w = row["wave_m"].as_f64().unwrap_or(0.0);
                let t = row["time"].as_str().unwrap_or("").to_string();
                if c > 0.50 { failing = Some((t, c, true)); break; }
                if w > 1.5 { failing = Some((t, w, false)); break; }
            }
            match failing {
                Some((t, v, is_current)) => {
                    result_word = "NO-GO";
                    let hhmm = t.trim_end_matches('Z');
                    let hm = hhmm.split('T').nth(1).unwrap_or("00:00").to_string();
                    if is_current {
                        message = format!("NO-GO — current {:.2} m/s at {} UTC", v, hm);
                    } else {
                        message = format!("NO-GO — wave height {:.2} m at {} UTC", v, hm);
                    }
                }
                None => {
                    result_word = "GO";
                    message = "GO — every planned hour is within limits".to_string();
                }
            }
        }
        let clearance = json!({
            "result": result_word,
            "message": message,
            "checked_at": now_iso(),
            "issued_at": issued.to_rfc3339_opts(SecondsFormat::Secs, true),
            "hours": table,
        });
        Ok((result_word.to_string(), clearance))
    }

    pub fn site_of_pen(&self, pen_id: &str) -> ApiResult<Value> {
        let rows = self.store.pg.exec(
            "SELECT s.latitude, s.longitude FROM pens p JOIN sites s ON s.id = p.site_id WHERE p.id = $1",
            vec![Param::Text(pen_id.into())]).map_err(internal)?;
        if rows.is_empty() { return Err(err(404, "not_found", "Not found")); }
        Ok(json!({"latitude": rows.num_of(0, "latitude"), "longitude": rows.num_of(0, "longitude")}))
    }

    pub async fn start_dive(&self, dive_id: &str) -> ApiResult<Response> {
        let guard = self.locks.dive(dive_id);
        let _g = guard.lock().await;
        let dive = self.dive_json(dive_id).map_err(internal)?;
        let status = dive["status"].as_str().unwrap_or("").to_string();
        if status == "started" { return Err(err(409, "dive_state", "Dive has already started")); }
        if status == "recorded" { return Err(err(409, "dive_state", "Dive is already recorded")); }
        let clearance = dive["clearance"].clone();
        let result = clearance.get("result").and_then(|v| v.as_str()).unwrap_or("");
        let issued = clearance.get("issued_at").and_then(|v| v.as_str()).and_then(parse_utc_minute);
        let fresh_go = result == "GO" && issued.map(|i| Utc::now() - i <= Duration::hours(6)).unwrap_or(false);
        if !fresh_go {
            return Err(err(409, "dive_not_cleared", "Dive needs a fresh GO before it can start"));
        }
        self.store.pg.exec("UPDATE dives SET status = 'started', started_at = now() WHERE id = $1",
            vec![Param::Text(dive_id.into())]).map_err(internal)?;
        self.broadcast(json!({"kind": "dive_started", "dive_id": dive_id})).await;
        let dive = self.dive_json(dive_id).map_err(internal)?;
        Ok(json_response(200, &json!({"dive": dive})))
    }

    pub async fn finish_dive(&self, dive_id: &str, body: Value) -> ApiResult<Response> {
        let guard = self.locks.dive(dive_id);
        let _g = guard.lock().await;
        let dive = self.dive_json(dive_id).map_err(internal)?;
        let status = dive["status"].as_str().unwrap_or("").to_string();
        if status != "started" { return Err(err(409, "dive_state", "Dive is not running")); }
        let track = match body.get("track") {
            Some(Value::Array(a)) => a.clone(),
            Some(_) => return Err(one_field("track", "Track must be a list")),
            None => return Err(one_field("track", "Track is required")),
        };
        if track.is_empty() || track.len() > 1000 {
            return Err(one_field("track", "Track must hold between 1 and 1,000 samples"));
        }
        let grid = {
            let pen_id = dive["pen_id"].as_str().unwrap_or("").to_string();
            self.store.pen_grid(&pen_id).map_err(internal)?
        };
        let mut samples: Vec<(i64, f64, f64)> = Vec::new();
        let mut field_errors: Vec<(String, String)> = Vec::new();
        for (i, s) in track.iter().enumerate() {
            let key = format!("track[{i}]");
            let t = s.get("t_s").and_then(|v| v.as_i64());
            let b = s.get("bearing_deg").and_then(|v| v.as_f64());
            let d = s.get("depth_m").and_then(|v| v.as_f64());
            let (t, b, d) = match (t, b, d) {
                (Some(t), Some(b), Some(d)) if b.is_finite() && d.is_finite() => (t, b, d),
                _ => {
                    field_errors.push((key, "Track sample is invalid".to_string()));
                    continue;
                }
            };
            if !i0(samples.last()).map(|prev| t >= prev.0).unwrap_or(t >= 0) {
                field_errors.push((key, "t_s must be nondecreasing from 0".to_string()));
                continue;
            }
            if t < 0 {
                field_errors.push((key, "t_s must start from 0".to_string()));
                continue;
            }
            if d < 0.0 || d > grid.net_depth_m {
                field_errors.push((key, format!("Depth must be between 0 and {}", grid.net_depth_m)));
                continue;
            }
            let wrapped = domain_wrap(b);
            samples.push((t, wrapped, d));
        }
        if !field_errors.is_empty() {
            return Err(fields_error(field_errors));
        }
        self.store.pg.exec("DELETE FROM dive_track WHERE dive_id = $1", vec![Param::Text(dive_id.into())]).map_err(internal)?;
        for (t, b, d) in &samples {
            self.store.pg.exec("INSERT INTO dive_track (dive_id, t_s, bearing_deg, depth_m) VALUES ($1,$2,$3,$4)",
                vec![Param::Text(dive_id.into()), Param::Int(*t), Param::Float(*b), Param::Float(*d)]).map_err(internal)?;
        }
        self.store.pg.exec("UPDATE dives SET status = 'recorded', finished_at = now() WHERE id = $1",
            vec![Param::Text(dive_id.into())]).map_err(internal)?;
        self.broadcast(json!({"kind": "dive_recorded", "dive_id": dive_id})).await;
        let dive = self.dive_json(dive_id).map_err(internal)?;
        Ok(json_response(200, &json!({"dive": dive})))
    }

    pub async fn attach_sonar(&self, dive_id: &str, bytes: Vec<u8>, content_type: &str, file_name: &str) -> ApiResult<Response> {
        let dive = self.dive_json(dive_id).map_err(internal)?;
        if dive.is_null() { return Err(err(404, "not_found", "Not found")); }
        let status = dive["status"].as_str().unwrap_or("").to_string();
        if status == "planned" || status == "cleared" {
            return Err(err(409, "dive_state", "Dive is not running"));
        }
        if bytes.is_empty() { return Err(one_field("body", "Upload body is empty")); }
        if bytes.len() > 20_000_000 {
            return Err(err(413, "too_large", "Sonar capture is larger than 20,000,000 bytes"));
        }
        let id = self.next_prefixed_id("SC", "sonar_captures")?;
        let farm_id = self.farm_of_pen(dive["pen_id"].as_str().unwrap_or(""))?;
        let sha = crate::s3::sha256_hex(&bytes);
        let key = format!("farms/{farm_id}/sonar/{id}");
        self.store.s3.put(&key, &bytes, content_type).await.map_err(internal)?;
        self.store.pg.exec(
            "INSERT INTO sonar_captures (id, dive_id, farm_id, content_type, size_bytes, sha256, file_name) VALUES ($1,$2,$3,$4,$5,$6,$7)",
            vec![Param::Text(id.clone()), Param::Text(dive_id.into()), Param::Text(farm_id), Param::Text(content_type.into()),
                 Param::Int(bytes.len() as i64), Param::Text(sha.clone()), Param::Text(file_name.into())]).map_err(internal)?;
        Ok(json_response(201, &json!({"capture": {
            "id": id, "content_type": content_type, "size_bytes": bytes.len(), "sha256": sha, "file_name": file_name,
        }})))
    }

    pub async fn sonar_raw(&self, capture_id: &str) -> ApiResult<Response> {
        let rows = self.store.pg.exec("SELECT content_type, farm_id FROM sonar_captures WHERE id = $1", vec![Param::Text(capture_id.into())]).map_err(internal)?;
        if rows.is_empty() { return Err(err(404, "not_found", "Not found")); }
        let key = format!("farms/{}/sonar/{}", rows.str_of(0, "farm_id"), capture_id);
        let bytes = self.store.s3.get(&key).await.map_err(internal)?;
        let sha = sha_col(&self.store.pg, "SELECT sha256 AS s FROM sonar_captures WHERE id = $1", capture_id).unwrap_or_else(|| crate::s3::sha256_hex(&bytes));
        Ok(crate::defects::raw_response(bytes, &rows.str_of(0, "content_type"), &sha))
    }
}

fn i0(v: Option<&(i64, f64, f64)>) -> Option<&(i64, f64, f64)> { v }

fn domain_wrap(b: f64) -> f64 { crate::domain::wrap_bearing(b) }

fn sha_col(pg: &crate::pg::Pg, sql: &str, id: &str) -> Option<String> {
    let rows = pg.exec(sql, vec![Param::Text(id.into())]).ok()?;
    rows.text_opt(0, "s")
}

fn urlenc(s: &str) -> String {
    s.replace(':', "%3A")
}

fn floor_hour(t: DateTime<Utc>) -> DateTime<Utc> {
    Utc.timestamp_opt(t.timestamp() - t.timestamp().rem_euclid(3600), 0).single().unwrap_or(t)
}

/// The planned hours: every UTC clock hour from the hour of the start through the hour
/// holding the last minute, in the provider's `YYYY-MM-DDTHH:00Z` form.
pub fn planned_hours(start: DateTime<Utc>, minutes: i64) -> Vec<String> {
    let first = floor_hour(start);
    let last_minute = start + Duration::minutes(minutes);
    let last_hour = floor_hour(last_minute);
    let mut out = Vec::new();
    let mut h = first;
    while h <= last_hour {
        out.push(h.format("%Y-%m-%dT%H:00Z").to_string());
        h += Duration::hours(1);
    }
    out
}

fn unavailable_clearance(planned_start: &str, _hours: &[String]) -> Value {
    json!({
        "result": "Forecast unavailable",
        "message": "Forecast unavailable — try again shortly",
        "checked_at": now_iso(),
        "issued_at": null,
        "hours": [],
    })
    .tap(|v| { let _ = (planned_start, v); })
}

trait Tap { fn tap<F: FnOnce(&Value)>(self, f: F) -> Self; }
impl Tap for Value {
    fn tap<F: FnOnce(&Value)>(self, f: F) -> Self { f(&self); self }
}

fn iso_or(v: Value) -> String {
    match v { Value::String(s) => { if s.contains('T') { s } else { format!("{s}Z") } }, _ => String::new() }
}

fn opt_iso(v: Value) -> Value {
    match v { Value::Null => Value::Null, Value::String(s) => json!(iso_or(Value::String(s))), _ => Value::Null }
}
