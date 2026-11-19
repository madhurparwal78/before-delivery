use super::round_to;
use chrono::{DateTime, Duration, DurationRound, Timelike, Utc};
use serde_json::{json, Value};

pub const CURRENT_LIMIT_M_S: f64 = 0.50;
pub const WAVE_LIMIT_M: f64 = 1.5;
pub const STALE_AFTER_HOURS: i64 = 6;

pub const GO_MESSAGE: &str = "GO — every planned hour is within limits";
pub const UNAVAILABLE_MESSAGE: &str = "Forecast unavailable — try again shortly";

#[derive(Clone, Debug)]
pub struct ForecastHour {
    pub time: DateTime<Utc>,
    pub current_m_s: f64,
    pub wave_m: f64,
}

#[derive(Clone, Debug)]
pub struct Decision {
    pub result: &'static str,
    pub message: String,
}

/// Every UTC clock hour from the hour of the planned start through the hour
/// that holds the dive's last minute.
pub fn planned_hours(planned_start: DateTime<Utc>, planned_minutes: i64) -> Vec<DateTime<Utc>> {
    let first = truncate_hour(planned_start);
    let last_minute = planned_start + Duration::minutes(planned_minutes - 1);
    let last = truncate_hour(last_minute.max(planned_start));
    let mut hours = Vec::new();
    let mut hour = first;
    while hour <= last {
        hours.push(hour);
        hour += Duration::hours(1);
    }
    hours
}

fn truncate_hour(at: DateTime<Utc>) -> DateTime<Utc> {
    at.duration_trunc(Duration::hours(1)).unwrap_or(at)
}

pub fn is_stale(issued_at: DateTime<Utc>, now: DateTime<Utc>) -> bool {
    now - issued_at > Duration::hours(STALE_AFTER_HOURS)
}

pub fn within_limits(hour: &ForecastHour) -> bool {
    hour.current_m_s <= CURRENT_LIMIT_M_S && hour.wave_m <= WAVE_LIMIT_M
}

/// The clearance decision: stale first, then the hours in time order, checking
/// the current before the wave within each hour.
pub fn decide(issued_at: DateTime<Utc>, hours: &[ForecastHour], now: DateTime<Utc>) -> Decision {
    if is_stale(issued_at, now) {
        return Decision {
            result: "Forecast stale",
            message: format!(
                "Forecast stale — issued {} UTC {}, more than 6 hours ago",
                issued_at.format("%H:%M"),
                issued_at.format("%Y-%m-%d")
            ),
        };
    }
    for hour in hours {
        if hour.current_m_s > CURRENT_LIMIT_M_S {
            return Decision {
                result: "NO-GO",
                message: format!(
                    "NO-GO — current {:.2} m/s at {} UTC",
                    hour.current_m_s,
                    hour.time.format("%H:%M")
                ),
            };
        }
        if hour.wave_m > WAVE_LIMIT_M {
            return Decision {
                result: "NO-GO",
                message: format!(
                    "NO-GO — wave height {:.2} m at {} UTC",
                    hour.wave_m,
                    hour.time.format("%H:%M")
                ),
            };
        }
    }
    Decision {
        result: "GO",
        message: GO_MESSAGE.to_string(),
    }
}

pub fn hour_label(at: DateTime<Utc>) -> String {
    format!("{}Z", at.format("%Y-%m-%dT%H:00"))
}

pub fn provider_hour_param(at: DateTime<Utc>) -> String {
    at.format("%Y-%m-%dT%H:00").to_string()
}

pub fn hours_json(hours: &[ForecastHour]) -> Value {
    Value::Array(
        hours
            .iter()
            .map(|hour| {
                json!({
                    "time": hour_label(hour.time),
                    "current_m_s": round_to(hour.current_m_s, 2),
                    "wave_m": round_to(hour.wave_m, 2),
                    "within_limits": within_limits(hour),
                })
            })
            .collect(),
    )
}

pub fn clearance_json(
    decision: &Decision,
    checked_at: DateTime<Utc>,
    issued_at: Option<DateTime<Utc>>,
    hours: &[ForecastHour],
) -> Value {
    json!({
        "result": decision.result,
        "message": decision.message,
        "checked_at": checked_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        "issued_at": issued_at.map(|at| at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)),
        "hours": hours_json(hours),
    })
}

pub fn unavailable_json(checked_at: DateTime<Utc>) -> Value {
    json!({
        "result": "Forecast unavailable",
        "message": UNAVAILABLE_MESSAGE,
        "checked_at": checked_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        "issued_at": Value::Null,
        "hours": Value::Array(Vec::new()),
    })
}

/// Reading a planned or cleared dive re-derives the result on the server clock,
/// so a GO whose issue time has since gone stale reads `Forecast stale`.
pub fn rederive(stored: &Value, now: DateTime<Utc>) -> Value {
    let issued_at = stored
        .get("issued_at")
        .and_then(Value::as_str)
        .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
        .map(|at| at.with_timezone(&Utc));
    let Some(issued_at) = issued_at else {
        return stored.clone();
    };
    let hours: Vec<ForecastHour> = stored
        .get("hours")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    Some(ForecastHour {
                        time: parse_hour(row.get("time")?.as_str()?)?,
                        current_m_s: row.get("current_m_s")?.as_f64()?,
                        wave_m: row.get("wave_m")?.as_f64()?,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let decision = decide(issued_at, &hours, now);
    let checked_at = stored.get("checked_at").cloned().unwrap_or(Value::Null);
    json!({
        "result": decision.result,
        "message": decision.message,
        "checked_at": checked_at,
        "issued_at": issued_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        "hours": hours_json(&hours),
    })
}

pub fn parse_hour(raw: &str) -> Option<DateTime<Utc>> {
    let trimmed = raw.trim();
    let candidates = [
        format!("{trimmed}:00"),
        trimmed.to_string(),
        format!("{}:00Z", trimmed.trim_end_matches('Z')),
    ];
    for candidate in candidates {
        if let Ok(at) = DateTime::parse_from_rfc3339(&candidate) {
            return Some(at.with_timezone(&Utc).with_minute(0).and_then(|t| t.with_second(0))?);
        }
        if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(&candidate, "%Y-%m-%dT%H:%M:%S") {
            return Some(naive.and_utc());
        }
    }
    None
}
