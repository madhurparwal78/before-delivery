pub mod clearance;
pub mod copilot;
pub mod export;
pub mod grade;
pub mod legacy;
pub mod link;
pub mod position;
pub mod search;
pub mod size;
pub mod text;

/// Rounding for every derived value: half away from zero.
pub fn round_to(value: f64, decimals: i32) -> f64 {
    let factor = 10f64.powi(decimals);
    let scaled = value * factor;
    let rounded = if scaled >= 0.0 {
        (scaled + 0.5).floor()
    } else {
        (scaled - 0.5).ceil()
    };
    rounded / factor
}

pub fn round_half_away(value: f64) -> f64 {
    round_to(value, 0)
}
