pub const HEADER: &str = "farm,site_code,pen,defect_id,type,bearing_deg,depth_m,chart_x_m,chart_y_m,cell,area_cm2,patch_area_m2,status,note";

/// Formula neutralisation, which exists only in the CSV export.
fn neutralise(text: &str) -> String {
    match text.chars().next() {
        Some('=') | Some('+') | Some('-') | Some('@') | Some('\t') | Some('\r') => {
            format!("'{text}")
        }
        _ => text.to_string(),
    }
}

/// Quoting is applied after the prefix.
fn quote(field: &str) -> String {
    if field.contains(',') || field.contains('"') || field.contains('\r') || field.contains('\n') {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

pub fn text_cell(text: &str) -> String {
    quote(&neutralise(text))
}

pub fn numeric_cell(value: Option<f64>, decimals: usize) -> String {
    match value {
        Some(value) => format!("{value:.decimals$}"),
        None => String::new(),
    }
}

pub fn whole_cell(value: Option<i64>) -> String {
    match value {
        Some(value) => value.to_string(),
        None => String::new(),
    }
}

pub fn document(rows: Vec<Vec<String>>) -> String {
    let mut out = String::from(HEADER);
    out.push('\n');
    for row in rows {
        out.push_str(&row.join(","));
        out.push('\n');
    }
    out
}
