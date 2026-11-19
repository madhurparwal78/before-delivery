use super::size::{DefectType, Size};

#[derive(Clone, Copy, Debug)]
pub struct Grade {
    pub letter: &'static str,
    pub label: &'static str,
}

pub struct OpenDefect {
    pub defect_type: DefectType,
    pub size: Size,
    pub area_cm2: Option<i64>,
}

/// The pen condition grade, from open, non-removed defects and fouling cover.
/// The first row that applies wins.
pub fn grade(open: &[OpenDefect], max_fouling_cover_pct: f64) -> Grade {
    let severe = open.iter().any(|defect| match defect.defect_type {
        DefectType::Hole => defect.area_cm2.unwrap_or(0) >= 300,
        DefectType::Tear => defect.size.a >= 50.0,
        _ => false,
    });
    if severe {
        return Grade {
            letter: "D",
            label: "Repair before stocking",
        };
    }
    let hole_or_tear = open.iter().any(|defect| {
        matches!(defect.defect_type, DefectType::Hole | DefectType::Tear)
    });
    if hole_or_tear || max_fouling_cover_pct >= 40.0 {
        return Grade {
            letter: "C",
            label: "Repair within 7 days",
        };
    }
    let chafe = open
        .iter()
        .any(|defect| defect.defect_type == DefectType::Chafe);
    if chafe || max_fouling_cover_pct >= 20.0 {
        return Grade {
            letter: "B",
            label: "Monitor",
        };
    }
    Grade {
        letter: "A",
        label: "Sound",
    }
}
