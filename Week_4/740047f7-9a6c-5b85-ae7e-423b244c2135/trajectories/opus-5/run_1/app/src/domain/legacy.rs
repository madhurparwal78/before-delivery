use super::position::{self, PenGrid};
use super::round_to;
use super::size::{self, DefectType, Size};
use serde_json::json;

pub const COLUMNS: [&str; 9] = [
    "site_code",
    "pen_no",
    "observed_at",
    "kind",
    "bearing",
    "depth_m",
    "size_a_cm",
    "size_b_cm",
    "note",
];

pub const MERGE_CHART_X_M: f64 = 1.00;
pub const MERGE_DEPTH_M: f64 = 1.0;

pub struct ParsedFile {
    pub rows: Vec<ParsedRow>,
}

pub struct ParsedRow {
    /// The file's row number, with the header as row 1.
    pub row: i64,
    pub site_code_raw: String,
    pub pen_no_raw: String,
    pub kind: String,
    pub bearing: String,
    pub depth_m: String,
    pub size_a_cm: String,
    pub size_b_cm: String,
    pub note: String,
}

/// Reads the older tool's CSV: comma or semicolon separated, quoted fields with
/// doubled quotes, a leading byte-order mark and CRLF endings all accepted.
pub fn parse(bytes: &[u8]) -> Option<ParsedFile> {
    let text = String::from_utf8_lossy(bytes);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let first_line: String = text.chars().take_while(|c| *c != '\n' && *c != '\r').collect();
    let delimiter = if first_line.contains(';') { ';' } else { ',' };
    let decimal_comma = delimiter == ';';
    let records = split_records(text, delimiter);
    let header = records.first()?;
    let mut indexes = [usize::MAX; 9];
    for (position, name) in header.iter().enumerate() {
        let normalised = name.trim().trim_start_matches('\u{feff}').to_lowercase();
        if let Some(slot) = COLUMNS.iter().position(|column| *column == normalised) {
            indexes[slot] = position;
        }
    }
    if indexes.iter().any(|index| *index == usize::MAX) {
        return None;
    }
    let cell = |record: &Vec<String>, slot: usize| -> String {
        record.get(indexes[slot]).cloned().unwrap_or_default()
    };
    let mut rows = Vec::new();
    for (offset, record) in records.iter().enumerate().skip(1) {
        if record.len() == 1 && record[0].trim().is_empty() {
            continue;
        }
        rows.push(ParsedRow {
            row: offset as i64 + 1,
            site_code_raw: cell(record, 0),
            pen_no_raw: cell(record, 1),
            kind: cell(record, 3).trim().to_string(),
            bearing: numeric(&cell(record, 4), decimal_comma),
            depth_m: numeric(&cell(record, 5), decimal_comma),
            size_a_cm: numeric(&cell(record, 6), decimal_comma),
            size_b_cm: numeric(&cell(record, 7), decimal_comma),
            note: cell(record, 8),
        });
    }
    Some(ParsedFile { rows })
}

fn numeric(raw: &str, decimal_comma: bool) -> String {
    let trimmed = raw.trim().to_string();
    if decimal_comma {
        trimmed.replace(',', ".")
    } else {
        trimmed
    }
}

fn split_records(text: &str, delimiter: char) -> Vec<Vec<String>> {
    let mut records = Vec::new();
    let mut record = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if quoted {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    quoted = false;
                }
            } else {
                field.push(ch);
            }
            continue;
        }
        match ch {
            '"' if field.is_empty() => quoted = true,
            c if c == delimiter => record.push(std::mem::take(&mut field)),
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                record.push(std::mem::take(&mut field));
                records.push(std::mem::take(&mut record));
            }
            '\n' => {
                record.push(std::mem::take(&mut field));
                records.push(std::mem::take(&mut record));
            }
            c => field.push(c),
        }
    }
    if !field.is_empty() || !record.is_empty() {
        record.push(field);
        records.push(record);
    }
    records
}

pub fn normalise_site_code(raw: &str) -> String {
    raw.trim().to_lowercase()
}

/// `pen_no`, with leading zeros ignored.
pub fn normalise_pen_no(raw: &str) -> Option<i32> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    trimmed.parse::<i32>().ok()
}

pub fn parse_kind(raw: &str) -> Option<DefectType> {
    DefectType::parse(&raw.trim().to_lowercase())
}

#[derive(Clone, Debug)]
pub struct RowDefect {
    pub defect_type: DefectType,
    pub bearing_deg: f64,
    pub depth_m: f64,
    pub chart_x_m: f64,
    pub chart_y_m: f64,
    pub cell: String,
    pub size: Size,
    pub note: String,
}

/// Validates one data row against the defect rules of its matched pen.
pub fn row_defect(row: &ParsedRow, grid: PenGrid) -> Result<RowDefect, String> {
    let defect_type = parse_kind(&row.kind).ok_or_else(|| "kind is not a defect type".to_string())?;
    let bearing: f64 = row
        .bearing
        .parse()
        .map_err(|_| "bearing is not a number".to_string())?;
    let depth: f64 = row
        .depth_m
        .parse()
        .map_err(|_| "depth_m is not a number".to_string())?;
    let size_a: f64 = row
        .size_a_cm
        .parse()
        .map_err(|_| "size_a_cm is not a number".to_string())?;
    let size_b: f64 = row
        .size_b_cm
        .parse()
        .map_err(|_| "size_b_cm is not a number".to_string())?;
    let keys = defect_type.size_keys();
    let (value_a, value_b) = if defect_type == DefectType::Fouling {
        (round_to(size_a / 100.0, 1), round_to(size_b / 100.0, 1))
    } else {
        (size_a, size_b)
    };
    let size = size::parse_size(
        defect_type,
        Some(&json!({ keys[0]: value_a, keys[1]: value_b })),
    )
    .map_err(|error| error.message)?;
    let placed = position::resolve(Some(bearing), None, Some(depth), grid)
        .map_err(|error| error.message)?;
    Ok(RowDefect {
        defect_type,
        bearing_deg: placed.bearing_deg,
        depth_m: placed.depth_m,
        chart_x_m: placed.chart_x_m,
        chart_y_m: placed.chart_y_m,
        cell: placed.cell,
        size,
        note: row.note.clone(),
    })
}

/// Farm, normalised site code and pen number, kind, normalised bearing, depth,
/// both sizes and note.
pub fn fingerprint(farm_id: &str, site_code: &str, pen_no: i32, defect: &RowDefect) -> String {
    let keys = defect.defect_type.size_keys();
    let size = defect.size.to_json();
    let cell = |key: &str| {
        size.get(key)
            .map(std::string::ToString::to_string)
            .unwrap_or_default()
    };
    format!(
        "{}|{}|{}|{}|{:.1}|{:.1}|{}|{}|{}",
        farm_id,
        site_code,
        pen_no,
        defect.defect_type.as_str(),
        defect.bearing_deg,
        defect.depth_m,
        cell(keys[0]),
        cell(keys[1]),
        defect.note,
    )
}

pub fn wrap_aware_distance(a: f64, b: f64, circumference_m: f64) -> f64 {
    let direct = (a - b).abs();
    direct.min(circumference_m - direct)
}

pub struct MergeCandidate {
    pub id: String,
    pub defect_type: DefectType,
    pub chart_x_m: f64,
    pub depth_m: f64,
}

/// The nearest existing defect of the same pen and type within both limits.
pub fn nearest_merge<'a>(
    candidates: &'a [MergeCandidate],
    defect: &RowDefect,
    grid: PenGrid,
) -> Option<&'a MergeCandidate> {
    let mut best: Option<(&MergeCandidate, f64, f64)> = None;
    for candidate in candidates {
        if candidate.defect_type != defect.defect_type {
            continue;
        }
        let dx = wrap_aware_distance(candidate.chart_x_m, defect.chart_x_m, grid.circumference_m);
        let dy = (candidate.depth_m - defect.depth_m).abs();
        if dx > MERGE_CHART_X_M + 1e-9 || dy > MERGE_DEPTH_M + 1e-9 {
            continue;
        }
        let better = match best {
            None => true,
            Some((current, best_dx, best_dy)) => {
                if (dx - best_dx).abs() > 1e-9 {
                    dx < best_dx
                } else if (dy - best_dy).abs() > 1e-9 {
                    dy < best_dy
                } else {
                    candidate.id < current.id
                }
            }
        };
        if better {
            best = Some((candidate, dx, dy));
        }
    }
    best.map(|(candidate, _, _)| candidate)
}
