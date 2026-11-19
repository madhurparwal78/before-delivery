use super::{position::PenGrid, round_to};
use crate::error::{ApiError, ApiResult};
use serde_json::{Map, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DefectType {
    Hole,
    Tear,
    Chafe,
    Fouling,
}

impl DefectType {
    pub fn as_str(self) -> &'static str {
        match self {
            DefectType::Hole => "hole",
            DefectType::Tear => "tear",
            DefectType::Chafe => "chafe",
            DefectType::Fouling => "fouling",
        }
    }

    pub fn parse(raw: &str) -> Option<DefectType> {
        match raw {
            "hole" => Some(DefectType::Hole),
            "tear" => Some(DefectType::Tear),
            "chafe" => Some(DefectType::Chafe),
            "fouling" => Some(DefectType::Fouling),
            _ => None,
        }
    }

    /// The size keys for this type, in their published order.
    pub fn size_keys(self) -> [&'static str; 2] {
        match self {
            DefectType::Hole => ["width_cm", "height_cm"],
            DefectType::Tear => ["length_cm", "gap_cm"],
            DefectType::Chafe => ["length_cm", "width_cm"],
            DefectType::Fouling => ["width_m", "height_m"],
        }
    }

    fn ranges(self) -> [(f64, f64); 2] {
        match self {
            DefectType::Hole => [(1.0, 2000.0), (1.0, 2000.0)],
            DefectType::Tear => [(1.0, 2000.0), (0.0, 200.0)],
            DefectType::Chafe => [(1.0, 2000.0), (1.0, 200.0)],
            DefectType::Fouling => [(0.1, 100.0), (0.1, 100.0)],
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Size {
    pub defect_type: DefectType,
    pub a: f64,
    pub b: f64,
}

impl Size {
    pub fn to_json(self) -> Value {
        let keys = self.defect_type.size_keys();
        let mut map = Map::new();
        for (key, value) in keys.iter().zip([self.a, self.b]) {
            map.insert((*key).to_string(), number(value, self.defect_type));
        }
        Value::Object(map)
    }

    pub fn from_json(defect_type: DefectType, value: &Value) -> Option<Size> {
        let object = value.as_object()?;
        let keys = defect_type.size_keys();
        Some(Size {
            defect_type,
            a: object.get(keys[0])?.as_f64()?,
            b: object.get(keys[1])?.as_f64()?,
        })
    }
}

fn number(value: f64, defect_type: DefectType) -> Value {
    if defect_type == DefectType::Fouling {
        Value::from(round_to(value, 1))
    } else {
        Value::from(value.round() as i64)
    }
}

/// Validates a request `size` object against the type's fields and ranges.
pub fn parse_size(defect_type: DefectType, raw: Option<&Value>) -> ApiResult<Size> {
    let keys = defect_type.size_keys();
    let ranges = defect_type.ranges();
    let object = match raw {
        Some(Value::Object(object)) => object,
        _ => {
            return Err(ApiError::validation(
                &format!("size.{}", keys[0]),
                "A size is required",
            ))
        }
    };
    let mut values = [0.0f64; 2];
    for index in 0..2 {
        let field = format!("size.{}", keys[index]);
        let value = object
            .get(keys[index])
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite())
            .ok_or_else(|| ApiError::validation(&field, "A number is required"))?;
        let (low, high) = ranges[index];
        if defect_type == DefectType::Fouling {
            let rounded = round_to(value, 1);
            if rounded < low || rounded > high {
                return Err(ApiError::validation(
                    &field,
                    format!("Must be between {low} and {high} m"),
                ));
            }
            values[index] = rounded;
        } else {
            if value.fract() != 0.0 {
                return Err(ApiError::validation(&field, "Must be whole centimetres"));
            }
            if value < low || value > high {
                return Err(ApiError::validation(
                    &field,
                    format!("Must be between {low} and {high} cm"),
                ));
            }
            values[index] = value;
        }
    }
    Ok(Size {
        defect_type,
        a: values[0],
        b: values[1],
    })
}

/// Hole, tear and chafe areas in whole cm². Null for fouling.
pub fn area_cm2(size: Size) -> Option<i64> {
    match size.defect_type {
        DefectType::Hole => {
            Some(super::round_half_away(std::f64::consts::PI * size.a * size.b / 4.0) as i64)
        }
        DefectType::Tear => Some(super::round_half_away(size.a * size.b / 2.0) as i64),
        DefectType::Chafe => Some(super::round_half_away(size.a * size.b) as i64),
        DefectType::Fouling => None,
    }
}

/// A fouling patch as it lies on the chart: horizontal segments after wrapping
/// across the 0° reference seam, and the vertical span clipped to the net.
pub struct Patch {
    pub segments: Vec<(f64, f64)>,
    pub y0: f64,
    pub y1: f64,
}

pub fn patch(chart_x_m: f64, depth_m: f64, size: Size, grid: PenGrid) -> Patch {
    let circumference = grid.circumference_m;
    let mut segments = Vec::new();
    let mut start = (chart_x_m - size.a / 2.0).rem_euclid(circumference);
    let mut remaining = size.a;
    while remaining > 1e-9 {
        let take = (circumference - start).min(remaining);
        segments.push((start, start + take));
        remaining -= take;
        start = 0.0;
    }
    let y0 = (depth_m - size.b / 2.0).max(0.0);
    let y1 = (depth_m + size.b / 2.0).min(grid.net_depth_m);
    Patch {
        segments,
        y0,
        y1: y1.max(y0),
    }
}

/// The clipped patch area, rounded to 0.1 m². Null for the other types.
pub fn patch_area_m2(chart_x_m: f64, depth_m: f64, size: Size, grid: PenGrid) -> Option<f64> {
    if size.defect_type != DefectType::Fouling {
        return None;
    }
    let patch = patch(chart_x_m, depth_m, size, grid);
    Some(round_to(size.a * (patch.y1 - patch.y0), 1))
}

pub struct FoulingPatchInput {
    pub chart_x_m: f64,
    pub depth_m: f64,
    pub size: Size,
}

/// Each panel's fouling cover, split exactly at panel boundaries, overlapping
/// patches adding up, rounded to 0.1 and capped at 100.0.
pub fn panel_cover_pct(patches: &[FoulingPatchInput], grid: PenGrid) -> Vec<(String, f64)> {
    let panel_area = grid.panel_area_m2();
    let prepared: Vec<Patch> = patches
        .iter()
        .map(|input| patch(input.chart_x_m, input.depth_m, input.size, grid))
        .collect();
    let mut covers = Vec::new();
    for row in 0..grid.rows {
        for column in 0..grid.columns {
            let (px0, px1, py0, py1) = grid.cell_bounds(column, row);
            let mut covered = 0.0f64;
            for patch in &prepared {
                let dy = (patch.y1.min(py1) - patch.y0.max(py0)).max(0.0);
                if dy <= 0.0 {
                    continue;
                }
                let dx: f64 = patch
                    .segments
                    .iter()
                    .map(|(s0, s1)| (s1.min(px1) - s0.max(px0)).max(0.0))
                    .sum();
                covered += dx * dy;
            }
            let pct = round_to(100.0 * covered / panel_area, 1).min(100.0);
            covers.push((
                format!("{}{}", super::position::column_letter(column), row + 1),
                pct,
            ));
        }
    }
    covers
}
