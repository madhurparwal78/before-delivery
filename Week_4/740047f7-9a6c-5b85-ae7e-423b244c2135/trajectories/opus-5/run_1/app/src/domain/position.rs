use super::round_to;
use crate::error::{ApiError, ApiResult};

/// The pen's own frame and panel grid. Every position and panel cell in
/// Pensight is decided here.
#[derive(Clone, Copy, Debug)]
pub struct PenGrid {
    pub circumference_m: f64,
    pub net_depth_m: f64,
    pub columns: i32,
    pub rows: i32,
}

#[derive(Clone, Copy, Debug)]
pub struct WallPoint {
    pub x_m: f64,
    pub y_m: f64,
    pub z_m: f64,
}

#[derive(Clone, Debug)]
pub struct Position {
    pub bearing_deg: f64,
    pub depth_m: f64,
    pub chart_x_m: f64,
    pub chart_y_m: f64,
    pub cell: String,
}

impl PenGrid {
    pub fn panel_width_m(&self) -> f64 {
        self.circumference_m / f64::from(self.columns)
    }

    pub fn panel_height_m(&self) -> f64 {
        self.net_depth_m / f64::from(self.rows)
    }

    pub fn panel_area_m2(&self) -> f64 {
        self.panel_width_m() * self.panel_height_m()
    }

    pub fn cell_bounds(&self, column: i32, row: i32) -> (f64, f64, f64, f64) {
        let pw = self.panel_width_m();
        let ph = self.panel_height_m();
        (
            f64::from(column) * pw,
            f64::from(column + 1) * pw,
            f64::from(row) * ph,
            f64::from(row + 1) * ph,
        )
    }
}

pub fn column_letter(index: i32) -> String {
    let mut remaining = index;
    let mut letters = Vec::new();
    loop {
        letters.push((b'A' + (remaining % 26) as u8) as char);
        remaining = remaining / 26 - 1;
        if remaining < 0 {
            break;
        }
    }
    letters.iter().rev().collect()
}

/// A typed bearing may be any finite number and is brought into [0, 360).
pub fn normalise_bearing(raw: f64) -> f64 {
    let wrapped = raw.rem_euclid(360.0);
    let rounded = round_to(wrapped, 1);
    if rounded >= 360.0 {
        0.0
    } else {
        rounded
    }
}

/// The bearing of a wall point is the angle of (x, z) clockwise from the z axis.
pub fn bearing_of_wall_point(point: WallPoint) -> f64 {
    normalise_bearing(point.x_m.atan2(point.z_m).to_degrees())
}

pub fn depth_of_wall_point(point: WallPoint) -> f64 {
    round_to(-point.y_m, 1)
}

pub fn chart_x_m(bearing_deg: f64, grid: PenGrid) -> f64 {
    round_to(bearing_deg * grid.circumference_m / 360.0, 2)
}

pub fn cell_of(chart_x_m: f64, depth_m: f64, grid: PenGrid) -> String {
    let column = (chart_x_m / grid.panel_width_m()).floor() as i32;
    let column = column.clamp(0, grid.columns - 1);
    let row = (depth_m / grid.panel_height_m()).floor() as i32;
    let row = row.clamp(0, grid.rows - 1);
    format!("{}{}", column_letter(column), row + 1)
}

/// Turns a typed bearing or a tapped net-wall point, with the depth, into the
/// stored bearing, depth, chart x, chart y and panel cell.
pub fn resolve(
    bearing_deg: Option<f64>,
    wall_point: Option<WallPoint>,
    depth_m: Option<f64>,
    grid: PenGrid,
) -> ApiResult<Position> {
    let (bearing, depth) = match (bearing_deg, wall_point) {
        (_, Some(point)) => (
            bearing_of_wall_point(point),
            depth_of_wall_point(point),
        ),
        (Some(bearing), None) => {
            let depth = depth_m.ok_or_else(|| ApiError::validation("depth_m", "Depth is required"))?;
            (normalise_bearing(bearing), round_to(depth, 1))
        }
        (None, None) => {
            return Err(ApiError::validation(
                "bearing_deg",
                "A bearing or a net-wall point is required",
            ))
        }
    };
    if !depth.is_finite() || depth < 0.0 || depth > grid.net_depth_m {
        return Err(ApiError::validation(
            if wall_point.is_some() { "wall_point" } else { "depth_m" },
            format!("Depth must be between 0 and {} m", grid.net_depth_m),
        ));
    }
    let chart_x = chart_x_m(bearing, grid);
    Ok(Position {
        bearing_deg: bearing,
        depth_m: depth,
        chart_x_m: chart_x,
        chart_y_m: depth,
        cell: cell_of(chart_x, depth, grid),
    })
}
