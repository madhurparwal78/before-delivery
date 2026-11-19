//! Domain rules of the console. Each rule is decided in exactly one place: here.

pub fn base26(mut n: usize) -> String {
    let mut s = Vec::new();
    loop {
        s.push(b'A' + (n % 26) as u8);
        n /= 26;
        if n == 0 { break; }
    }
    s.reverse();
    String::from_utf8(s).unwrap_or_default()
}

/// Half away from zero, to a fixed number of decimals.
pub fn round_to(value: f64, decimals: u32) -> f64 {
    let factor = 10f64.powi(decimals as i32);
    let scaled = value * factor;
    let v = if scaled < 0.0 {
        -((-scaled + 0.5).floor())
    } else {
        (scaled + 0.5).floor()
    };
    v / factor
}

pub fn wrap_bearing(bearing: f64) -> f64 {
    let mut b = bearing % 360.0;
    if b < 0.0 { b += 360.0; }
    if b >= 360.0 { b -= 360.0; }
    b
}

/// The stored position of a mark on a pen's net wall.
pub struct Position {
    pub bearing_deg: f64,
    pub depth_m: f64,
    pub chart_x_m: f64,
    pub chart_y_m: f64,
    pub cell: String,
}

pub struct Grid {
    pub columns: usize,
    pub rows: usize,
    pub circumference_m: f64,
    pub net_depth_m: f64,
}

impl Grid {
    pub fn panel_width_m(&self) -> f64 { self.circumference_m / self.columns as f64 }
    pub fn panel_height_m(&self) -> f64 { self.net_depth_m / self.rows as f64 }
}

/// The one place that turns a bearing and depth into the stored position.
pub fn position_for(grid: &Grid, bearing_deg: f64, depth_m: f64) -> Position {
    let mut b = round_to(wrap_bearing(bearing_deg), 1);
    if b >= 360.0 { b = 0.0; }
    let d = round_to(depth_m, 1);
    let x = round_to(b * grid.circumference_m / 360.0, 2);
    let y = d;
    let col = base26((x / grid.panel_width_m()).floor() as usize % grid.columns);
    let row = ((d / grid.panel_height_m()).floor() as usize + 1).min(grid.rows);
    Position { bearing_deg: b, depth_m: d, chart_x_m: x, chart_y_m: y, cell: format!("{col}{row}") }
}

/// The bearing of a tapped net-wall point, per the pen frame rules.
pub fn wall_point_bearing(x_m: f64, z_m: f64) -> f64 {
    let b = x_m.atan2(z_m).to_degrees();
    wrap_bearing(b)
}

/// Area of a defect by its type, in cm² (fouling has none).
pub fn defect_area_cm2(defect_type: &str, size: &serde_json::Value) -> Option<f64> {
    let f = |k: &str| size.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
    let area = match defect_type {
        "hole" => std::f64::consts::PI * f("width_cm") * f("height_cm") / 4.0,
        "tear" => f("length_cm") * f("gap_cm") / 2.0,
        "chafe" => f("length_cm") * f("width_cm"),
        _ => return None,
    };
    Some(round_to(area, 0))
}

#[derive(Clone)]
pub struct FoulingPatch {
    pub chart_x_m: f64,
    pub depth_m: f64,
    pub width_m: f64,
    pub height_m: f64,
}

impl FoulingPatch {
    /// The clipped patch area, split across the 0° seam and clipped to the net depth, in m².
    pub fn clipped_area_m2(&self, grid: &Grid) -> f64 {
        let circ = grid.circumference_m;
        let mut area = 0.0;
        let half_w = self.width_m / 2.0;
        let left = self.chart_x_m - half_w;
        let right = self.chart_x_m + half_w;
        let spans: Vec<(f64, f64)> = vec![(left, right), (left + circ, right + circ), (left - circ, right - circ)];
        let top = (self.depth_m - self.height_m / 2.0).max(0.0);
        let bottom = (self.depth_m + self.height_m / 2.0).min(grid.net_depth_m);
        let h = (bottom - top).max(0.0);
        for (a, b) in spans {
            let lo = a.max(0.0);
            let hi = b.min(circ);
            if hi > lo { area += (hi - lo) * h; }
        }
        round_to(area, 1)
    }
}

/// A fouling cover of one panel, from the open fouling patches of the pen.
pub fn panel_fouling_cover_pct(grid: &Grid, cell: &str, patches: &[FoulingPatch]) -> f64 {
    let panel_area = grid.panel_width_m() * grid.panel_height_m();
    if panel_area <= 0.0 || patches.is_empty() { return 0.0; }
    let circ = grid.circumference_m;
    let col = cell[0..1].to_string();
    // column index from letter
    let col_idx: usize = col.chars().next().map(|c| c as usize - 'A' as usize).unwrap_or(0);
    let row_idx: usize = cell[1..].parse().unwrap_or(1) - 1;
    let x0 = col_idx as f64 * grid.panel_width_m();
    let x1 = x0 + grid.panel_width_m();
    let y0 = row_idx as f64 * grid.panel_height_m();
    let y1 = y0 + grid.panel_height_m();
    let mut covered = 0.0f64;
    for p in patches {
        let half_w = p.width_m / 2.0;
        let left = p.chart_x_m - half_w;
        let right = p.chart_x_m + half_w;
        let spans: Vec<(f64, f64)> = vec![(left, right), (left + circ, right + circ), (left - circ, right - circ)];
        let top = (p.depth_m - p.height_m / 2.0).max(0.0);
        let bottom = (p.depth_m + p.height_m / 2.0).min(grid.net_depth_m);
        for (a, b) in spans {
            let lo = a.max(x0);
            let hi = b.min(x1);
            if hi > lo { covered += (hi - lo) * ((bottom.max(y0).min(y1)) - (top.max(y0).min(y1))).max(0.0); }
        }
    }
    round_to((covered / panel_area) * 100.0, 1).min(100.0)
}

pub struct DefectSummary {
    pub defect_type: String,
    pub size: serde_json::Value,
}

/// The pen condition grade. The first row that applies wins.
pub fn pen_grade(open_defects: &[DefectSummary], max_fouling_cover_pct: f64) -> (char, &'static str) {
    let hole_big = open_defects.iter().any(|d| {
        d.defect_type == "hole" && defect_area_cm2("hole", &d.size).map(|a| a >= 300.0).unwrap_or(false)
    });
    let tear_big = open_defects.iter().any(|d| {
        d.defect_type == "tear" && d.size.get("length_cm").and_then(|v| v.as_f64()).unwrap_or(0.0) >= 50.0
    });
    if hole_big || tear_big { return ('D', "Repair before stocking"); }
    let hole_or_tear = open_defects.iter().any(|d| d.defect_type == "hole" || d.defect_type == "tear");
    if hole_or_tear || max_fouling_cover_pct >= 40.0 { return ('C', "Repair within 7 days"); }
    let chafe = open_defects.iter().any(|d| d.defect_type == "chafe");
    if chafe || max_fouling_cover_pct >= 20.0 { return ('B', "Monitor"); }
    ('A', "Sound")
}

/// The export CSV prefix rule.
pub fn neutralise_text_cell(value: &str) -> String {
    let first = value.chars().next();
    if matches!(first, Some('=') | Some('+') | Some('-') | Some('@') | Some('\t') | Some('\r')) {
        format!("'{}", value)
    } else {
        value.to_string()
    }
}

pub fn csv_cell(value: &str) -> String {
    let prefixed = neutralise_text_cell(value);
    if prefixed.contains(',') || prefixed.contains('"') || prefixed.contains('\r') || prefixed.contains('\n') {
        format!("\"{}\"", prefixed.replace('"', "\"\""))
    } else {
        prefixed
    }
}

/// Number of user-perceived characters. Rust chars approximate extended grapheme clusters
/// for the counting the brief needs: an emoji with a skin tone, a flag, a family emoji and a
/// letter with a combining accent each count as one.
pub fn perceived_len(value: &str) -> usize {
    grapheme_clusters(value).count()
}

pub fn grapheme_clusters(value: &str) -> impl Iterator<Item = String> {
    Graphemes::new(value.to_string())
}

struct Graphemes {
    s: Vec<char>,
    i: usize,
}

impl Graphemes {
    fn new(s: String) -> Self { Graphemes { s: s.chars().collect(), i: 0 } }
}

impl Iterator for Graphemes {
    type Item = String;
    fn next(&mut self) -> Option<String> {
        if self.i >= self.s.len() { return None; }
        let start = self.i;
        self.i += 1;
        // Regional indicators pair into flags.
        if is_regional(self.s[start]) && self.i < self.s.len() && is_regional(self.s[self.i]) {
            self.i += 1;
        }
        // ZWJ sequences (family emoji) stay together.
        while self.i < self.s.len() {
            let c = self.s[self.i];
            if c == '\u{200D}' {
                self.i += 1;
                if self.i < self.s.len() { self.i += 1; }
                while self.i < self.s.len() && self.s[self.i].combining_mark() {
                    self.i += 1;
                }
            } else if self.s[self.i] == '\u{FE0F}' {
                self.i += 1;
            } else if self.s[self.i].combining_mark() {
                self.i += 1;
            } else if self.s[start] == '\u{200D}' {
                self.i += 1;
            } else {
                break;
            }
        }
        Some(self.s[start..self.i].iter().collect())
    }
}

fn is_regional(c: char) -> bool {
    ('\u{1F1E6}'..='\u{1F1FF}').contains(&c)
}

trait CombiningMark {
    fn combining_mark(&self) -> bool;
}

impl CombiningMark for char {
    fn combining_mark(&self) -> bool {
        matches!(*self as u32,
            0x0300..=0x036F | 0x1AB0..=0x1AFF | 0x1DC0..=0x1DFF | 0x20D0..=0x20FF | 0xFE20..=0xFE2F | 0x093C | 0x09BC | 0x0E33)
            || matches!(*self as u32, 0x1F3FB..=0x1F3FF)
    }
}

