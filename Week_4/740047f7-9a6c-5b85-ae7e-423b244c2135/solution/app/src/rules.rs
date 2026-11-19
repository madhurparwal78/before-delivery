//! Every pure domain rule of Pensight lives here, decided exactly once: positions and cells, sizes and
//! areas, fouling cover, the pen grade, grapheme limits, the clearance decision, link status, the CSV
//! neutralisation and literal search. The browser only displays what these functions decide.

use chrono::{DateTime, Duration, DurationRound, Timelike, Utc};
use serde_json::{json, Map, Value};
use unicode_segmentation::UnicodeSegmentation;

pub const NOTE_LIMIT: usize = 500;
pub const SEARCH_LIMIT: usize = 100;
pub const NOTE_TOO_LONG: &str = "Note is longer than 500 characters";
pub const SEARCH_TOO_LONG: &str = "Search text is longer than 100 characters";
pub const STALE_AFTER_HOURS: i64 = 6;
pub const CURRENT_LIMIT_M_S: f64 = 0.50;
pub const WAVE_LIMIT_M: f64 = 1.5;

pub fn graphemes(text: &str) -> usize {
    text.graphemes(true).count()
}

/// Integer division of a non-negative numerator, rounding half away from zero.
pub fn round_div(numerator: i64, denominator: i64) -> i64 {
    (2 * numerator + denominator) / (2 * denominator)
}

#[derive(Clone, Copy, Debug)]
pub struct Geometry {
    pub circumference_m: i64,
    pub net_depth_m: i64,
    pub columns: i64,
    pub rows: i64,
}

impl Geometry {
    pub fn panel_width_h(&self) -> i64 {
        self.circumference_m * 100 / self.columns
    }
    pub fn panel_height_h(&self) -> i64 {
        self.net_depth_m * 100 / self.rows
    }
}

/// A typed bearing, any finite number, brought into 0 up to 360 and rounded to 0.1 degrees (in tenths).
pub fn bearing_tenths(degrees: f64) -> i64 {
    let wrapped = degrees.rem_euclid(360.0);
    let tenths = (wrapped * 10.0).round() as i64;
    if tenths >= 3600 {
        0
    } else {
        tenths
    }
}

/// The bearing of a net-wall point: the angle of (x, z) clockwise from the z axis.
pub fn wall_point_bearing(x_m: f64, z_m: f64) -> f64 {
    x_m.atan2(z_m).to_degrees()
}

pub fn depth_tenths(metres: f64) -> i64 {
    (metres * 10.0).round() as i64
}

pub fn depth_in_range(g: &Geometry, depth_t: i64) -> bool {
    (0..=g.net_depth_m * 10).contains(&depth_t)
}

/// Chart x in hundredths of a metre.
pub fn chart_x_h(g: &Geometry, bearing_t: i64) -> i64 {
    round_div(bearing_t * g.circumference_m, 36)
}

pub fn cell(g: &Geometry, bearing_t: i64, depth_t: i64) -> String {
    let column = (chart_x_h(g, bearing_t) * g.columns / (g.circumference_m * 100)).min(g.columns - 1);
    let row = (depth_t * g.rows / (g.net_depth_m * 10)).min(g.rows - 1);
    format!("{}{}", (b'A' + column as u8) as char, row + 1)
}

pub fn cell_name(column: i64, row: i64) -> String {
    format!("{}{}", (b'A' + column as u8) as char, row + 1)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Hole,
    Tear,
    Chafe,
    Fouling,
}

impl Kind {
    pub fn parse(text: &str) -> Option<Kind> {
        match text {
            "hole" => Some(Kind::Hole),
            "tear" => Some(Kind::Tear),
            "chafe" => Some(Kind::Chafe),
            "fouling" => Some(Kind::Fouling),
            _ => None,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Kind::Hole => "hole",
            Kind::Tear => "tear",
            Kind::Chafe => "chafe",
            Kind::Fouling => "fouling",
        }
    }
    pub fn size_keys(self) -> [&'static str; 2] {
        match self {
            Kind::Hole => ["width_cm", "height_cm"],
            Kind::Tear => ["length_cm", "gap_cm"],
            Kind::Chafe => ["length_cm", "width_cm"],
            Kind::Fouling => ["width_m", "height_m"],
        }
    }
    /// Inclusive range of a size key in its own unit (whole centimetres, or metres with one decimal).
    fn range(self, key: &str) -> (f64, f64) {
        match (self, key) {
            (Kind::Hole, _) => (1.0, 2000.0),
            (Kind::Tear, "gap_cm") => (0.0, 200.0),
            (Kind::Tear, _) => (1.0, 2000.0),
            (Kind::Chafe, "width_cm") => (1.0, 200.0),
            (Kind::Chafe, _) => (1.0, 2000.0),
            (Kind::Fouling, _) => (0.1, 100.0),
        }
    }
}

/// Validates and normalises a `size` object; errors are keyed `size.<key>` (or `size`).
pub fn validate_size(kind: Kind, size: Option<&Value>) -> Result<Map<String, Value>, Vec<(String, String)>> {
    let Some(Value::Object(given)) = size else {
        return Err(vec![("size".into(), "Size must be an object".into())]);
    };
    let mut clean = Map::new();
    let mut errors = vec![];
    for key in kind.size_keys() {
        let field = format!("size.{key}");
        let Some(value) = given.get(key).and_then(Value::as_f64).filter(|v| v.is_finite()) else {
            errors.push((field, format!("{key} must be a number")));
            continue;
        };
        let (low, high) = kind.range(key);
        if value < low || value > high {
            errors.push((field, format!("{key} must be between {low} and {high}")));
        } else if kind == Kind::Fouling {
            clean.insert(key.into(), json!((value * 10.0).round() / 10.0));
        } else if value.fract() != 0.0 {
            errors.push((field, format!("{key} must be a whole number")));
        } else {
            clean.insert(key.into(), json!(value as i64));
        }
    }
    if errors.is_empty() {
        Ok(clean)
    } else {
        Err(errors)
    }
}

fn whole(size: &Value, key: &str) -> i64 {
    size.get(key).and_then(Value::as_f64).unwrap_or(0.0).round() as i64
}

fn size_tenths(size: &Value, key: &str) -> i64 {
    (size.get(key).and_then(Value::as_f64).unwrap_or(0.0) * 10.0).round() as i64
}

pub fn area_cm2(kind: Kind, size: &Value) -> Option<i64> {
    match kind {
        Kind::Hole => {
            let (w, h) = (whole(size, "width_cm") as f64, whole(size, "height_cm") as f64);
            Some((std::f64::consts::PI * w * h / 4.0).round() as i64)
        }
        Kind::Tear => Some(round_div(whole(size, "length_cm") * whole(size, "gap_cm"), 2)),
        Kind::Chafe => Some(whole(size, "length_cm") * whole(size, "width_cm")),
        Kind::Fouling => None,
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Patch {
    pub chart_x_h: i64,
    pub depth_t: i64,
    pub width_t: i64,
    pub height_t: i64,
}

impl Patch {
    pub fn of(g: &Geometry, bearing_t: i64, depth_t: i64, size: &Value) -> Patch {
        Patch {
            chart_x_h: chart_x_h(g, bearing_t),
            depth_t,
            width_t: size_tenths(size, "width_m"),
            height_t: size_tenths(size, "height_m"),
        }
    }
    /// The patch's vertical extent in hundredths of a metre, clipped to the net.
    fn vertical(&self, g: &Geometry) -> (i64, i64) {
        let centre = self.depth_t * 10;
        ((centre - self.height_t * 5).max(0), (centre + self.height_t * 5).min(g.net_depth_m * 100))
    }
    /// Clipped patch area in 0.0001 m².
    fn area_h2(&self, g: &Geometry) -> i64 {
        let (top, bottom) = self.vertical(g);
        self.width_t * 10 * (bottom - top).max(0)
    }
    pub fn area_m2(&self, g: &Geometry) -> f64 {
        round_div(self.area_h2(g), 1000) as f64 / 10.0
    }
}

/// Fouling cover of every panel, row by row, in tenths of a percent.
pub fn panel_cover_tenths(g: &Geometry, patches: &[Patch]) -> Vec<i64> {
    let (circumference, panel_w, panel_h) = (g.circumference_m * 100, g.panel_width_h(), g.panel_height_h());
    let mut area = vec![0i64; (g.columns * g.rows) as usize];
    for patch in patches {
        let (top, bottom) = patch.vertical(g);
        let left = patch.chart_x_h - patch.width_t * 5;
        let right = patch.chart_x_h + patch.width_t * 5;
        for shift in -2..=2 {
            let (from, to) = ((left + shift * circumference).max(0), (right + shift * circumference).min(circumference));
            if to <= from {
                continue;
            }
            for column in (from / panel_w)..=((to - 1) / panel_w) {
                let across = to.min((column + 1) * panel_w) - from.max(column * panel_w);
                for row in (top / panel_h)..=(((bottom - 1) / panel_h).min(g.rows - 1)) {
                    let down = bottom.min((row + 1) * panel_h) - top.max(row * panel_h);
                    if across > 0 && down > 0 {
                        area[(row * g.columns + column) as usize] += across * down;
                    }
                }
            }
        }
    }
    area.into_iter().map(|a| round_div(a * 1000, panel_w * panel_h).min(1000)).collect()
}

pub struct OpenDefect {
    pub kind: Kind,
    pub area_cm2: Option<i64>,
    pub length_cm: i64,
}

pub fn grade(open: &[OpenDefect], max_cover_tenths: i64) -> (&'static str, &'static str) {
    let worst = open.iter().any(|d| {
        (d.kind == Kind::Hole && d.area_cm2.unwrap_or(0) >= 300) || (d.kind == Kind::Tear && d.length_cm >= 50)
    });
    if worst {
        ("D", "Repair before stocking")
    } else if open.iter().any(|d| matches!(d.kind, Kind::Hole | Kind::Tear)) || max_cover_tenths >= 400 {
        ("C", "Repair within 7 days")
    } else if open.iter().any(|d| d.kind == Kind::Chafe) || max_cover_tenths >= 200 {
        ("B", "Monitor")
    } else {
        ("A", "Sound")
    }
}

pub fn pct(tenths: i64) -> f64 {
    tenths as f64 / 10.0
}

// ---------------------------------------------------------------- clearance

#[derive(Clone, Debug)]
pub struct HourReading {
    pub time: DateTime<Utc>,
    pub current_m_s: f64,
    pub wave_m: f64,
}

/// Every UTC clock hour from the hour of the planned start through the hour holding the last minute.
pub fn planned_hours(start: DateTime<Utc>, minutes: i64) -> Vec<DateTime<Utc>> {
    let first = start.duration_trunc(Duration::hours(1)).unwrap_or(start);
    let last = (start + Duration::minutes(minutes - 1)).duration_trunc(Duration::hours(1)).unwrap_or(start);
    let mut hours = vec![];
    let mut at = first;
    while at <= last {
        hours.push(at);
        at += Duration::hours(1);
    }
    hours
}

pub fn is_stale(issued_at: DateTime<Utc>, now: DateTime<Utc>) -> bool {
    now - issued_at > Duration::hours(STALE_AFTER_HOURS)
}

pub fn hhmm(at: DateTime<Utc>) -> String {
    format!("{:02}:{:02}", at.hour(), at.minute())
}

pub fn within_limits(hour: &HourReading) -> bool {
    hour.current_m_s <= CURRENT_LIMIT_M_S && hour.wave_m <= WAVE_LIMIT_M
}

/// The clearance decision for readings that are all present: stale first, then the first failing hour.
pub fn decide(issued_at: DateTime<Utc>, now: DateTime<Utc>, hours: &[HourReading]) -> (&'static str, String) {
    if is_stale(issued_at, now) {
        let message = format!(
            "Forecast stale — issued {} UTC {}, more than 6 hours ago",
            hhmm(issued_at),
            issued_at.format("%Y-%m-%d")
        );
        return ("Forecast stale", message);
    }
    for hour in hours {
        if hour.current_m_s > CURRENT_LIMIT_M_S {
            return ("NO-GO", format!("NO-GO — current {:.2} m/s at {} UTC", hour.current_m_s, hhmm(hour.time)));
        }
        if hour.wave_m > WAVE_LIMIT_M {
            return ("NO-GO", format!("NO-GO — wave height {:.2} m at {} UTC", hour.wave_m, hhmm(hour.time)));
        }
    }
    ("GO", "GO — every planned hour is within limits".into())
}

pub fn iso(at: DateTime<Utc>) -> String {
    at.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

// ---------------------------------------------------------------- report links

pub fn link_state(revoked: bool, expires_at: DateTime<Utc>, now: DateTime<Utc>) -> (&'static str, i64) {
    if revoked {
        ("revoked", 0)
    } else if now >= expires_at {
        ("expired", 0)
    } else {
        ("active", (expires_at - now).num_seconds())
    }
}

// ---------------------------------------------------------------- export and search

fn csv_quote(field: &str) -> String {
    if field.contains([',', '"', '\r', '\n']) {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

/// A text cell of the defect export: a leading apostrophe before a formula character, then quoting.
pub fn csv_text(field: &str) -> String {
    let neutral = if field.starts_with(['=', '+', '-', '@', '\t', '\r']) { format!("'{field}") } else { field.to_string() };
    csv_quote(&neutral)
}

/// The trimmed query, or `None` when it is under two characters.
pub fn search_query(raw: &str) -> Result<Option<String>, &'static str> {
    let trimmed = raw.trim();
    let length = graphemes(trimmed);
    if length > SEARCH_LIMIT {
        Err(SEARCH_TOO_LONG)
    } else if length < 2 {
        Ok(None)
    } else {
        Ok(Some(trimmed.to_lowercase()))
    }
}

pub fn contains_literal(haystack: &str, needle_lower: &str) -> bool {
    haystack.to_lowercase().contains(needle_lower)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PEN: Geometry = Geometry { circumference_m: 160, net_depth_m: 20, columns: 16, rows: 4 };

    #[test]
    fn positions_and_cells() {
        assert_eq!(bearing_tenths(-10.0), 3500);
        assert_eq!(bearing_tenths(359.96), 0);
        assert_eq!(chart_x_h(&PEN, 1125), 5000);
        assert_eq!(cell(&PEN, 1125, 124), "F3");
        assert_eq!(cell(&PEN, 225, 100), "B3");
        assert_eq!(cell(&PEN, 1800, 200), "I4");
        assert_eq!(bearing_tenths(wall_point_bearing(1.0, 0.0)), 900);
    }

    #[test]
    fn fouling_cover_splits_at_the_seam() {
        let patch = Patch::of(&PEN, 9, 20, &json!({"width_m": 6.0, "height_m": 3.0}));
        assert_eq!(patch.area_m2(&PEN), 18.0);
        let cover = panel_cover_tenths(&PEN, &[patch]);
        assert_eq!((cover[0], cover[15]), (204, 156));
    }

    #[test]
    fn areas() {
        assert_eq!(area_cm2(Kind::Hole, &json!({"width_cm": 30, "height_cm": 24})), Some(565));
        assert_eq!(area_cm2(Kind::Tear, &json!({"length_cm": 45, "gap_cm": 5})), Some(113));
    }
}
