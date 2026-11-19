use crate::domain::clearance::{self, ForecastHour};
use chrono::{DateTime, Utc};
use serde_json::Value;
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(10);

pub enum ForecastOutcome {
    Hours {
        issued_at: DateTime<Utc>,
        hours: Vec<ForecastHour>,
    },
    /// The provider errored, sent unusable data, or did not answer in time.
    Unavailable {
        timed_out: bool,
    },
}

/// `GET <WIREMOCK_URL>/v1/marine` with the site position and the planned hours.
pub async fn fetch(
    client: &reqwest::Client,
    base_url: &str,
    latitude: f64,
    longitude: f64,
    planned: &[DateTime<Utc>],
) -> ForecastOutcome {
    let Some(first) = planned.first() else {
        return ForecastOutcome::Unavailable { timed_out: false };
    };
    let last = planned.last().unwrap_or(first);
    let url = format!(
        "{base_url}/v1/marine?latitude={latitude:.4}&longitude={longitude:.4}&hourly=ocean_current_velocity,wave_height&start_hour={}&end_hour={}",
        clearance::provider_hour_param(*first),
        clearance::provider_hour_param(*last),
    );
    let response = match tokio::time::timeout(TIMEOUT, client.get(url).send()).await {
        Err(_) => return ForecastOutcome::Unavailable { timed_out: true },
        Ok(Err(error)) if error.is_timeout() => {
            return ForecastOutcome::Unavailable { timed_out: true }
        }
        Ok(Err(_)) => return ForecastOutcome::Unavailable { timed_out: false },
        Ok(Ok(response)) => response,
    };
    if !response.status().is_success() {
        return ForecastOutcome::Unavailable { timed_out: false };
    }
    let body = match tokio::time::timeout(TIMEOUT, response.json::<Value>()).await {
        Err(_) => return ForecastOutcome::Unavailable { timed_out: true },
        Ok(Err(_)) => return ForecastOutcome::Unavailable { timed_out: false },
        Ok(Ok(body)) => body,
    };
    match read(&body, planned) {
        Some(outcome) => outcome,
        None => ForecastOutcome::Unavailable { timed_out: false },
    }
}

fn read(body: &Value, planned: &[DateTime<Utc>]) -> Option<ForecastOutcome> {
    let issued_at = DateTime::parse_from_rfc3339(body.get("issued_at")?.as_str()?)
        .ok()?
        .with_timezone(&Utc);
    let hourly = body.get("hourly")?.as_object()?;
    let times = hourly.get("time")?.as_array()?;
    let currents = hourly.get("ocean_current_velocity")?.as_array()?;
    let waves = hourly.get("wave_height")?.as_array()?;
    let mut hours = Vec::new();
    for planned_hour in planned {
        let index = times.iter().position(|raw| {
            raw.as_str()
                .and_then(clearance::parse_hour)
                .is_some_and(|at| at == *planned_hour)
        })?;
        hours.push(ForecastHour {
            time: *planned_hour,
            current_m_s: currents.get(index)?.as_f64()?,
            wave_m: waves.get(index)?.as_f64()?,
        });
    }
    Some(ForecastOutcome::Hours { issued_at, hours })
}
