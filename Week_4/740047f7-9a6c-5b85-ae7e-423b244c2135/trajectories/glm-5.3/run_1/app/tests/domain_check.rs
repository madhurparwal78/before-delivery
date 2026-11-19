#[path = "../src/domain.rs"]
mod domain;
use domain::*;

#[test]
fn domain_rules() {
    let g = Grid { columns: 16, rows: 4, circumference_m: 160.0, net_depth_m: 20.0 };
    let p = position_for(&g, 112.5, 12.4);
    assert_eq!((p.bearing_deg, p.depth_m, p.chart_x_m, p.chart_y_m, p.cell.as_str()), (112.5, 12.4, 50.0, 12.4, "F3"));
    let p2 = position_for(&g, 236.7, 4.8);
    assert_eq!((p2.chart_x_m, p2.cell.clone().as_str()), (105.2, "K1"), "{:?}", (p2.chart_x_m, p2.cell.clone()));
    let p3 = position_for(&g, 300.0, 18.2);
    assert_eq!((p3.chart_x_m, p3.cell.as_str()), (133.33, "N4"));
    let p4 = position_for(&g, 0.9, 2.0);
    assert_eq!((p4.chart_x_m, p4.cell.as_str()), (0.4, "A1"));
    let p5 = position_for(&g, 202.5, 5.0);
    assert_eq!((p5.chart_x_m, p5.cell.as_str()), (90.0, "J2"));
    let p6 = position_for(&g, 45.0, 8.0);
    assert_eq!((p6.chart_x_m, p6.cell.as_str()), (20.0, "C2"));
    // wall points
    assert_eq!(wall_point_bearing(1.0, 0.0), 90.0);
    assert_eq!(wall_point_bearing(0.0, -1.0), 180.0);
    // negative bearing wrap
    let pn = position_for(&g, -10.0, 5.0);
    assert_eq!(pn.bearing_deg, 350.0);
    let pn2 = position_for(&g, 365.0, 5.0);
    assert_eq!(pn2.bearing_deg, 5.0);
    // areas
    let hole = serde_json::json!({"width_cm": 30, "height_cm": 24});
    assert_eq!(defect_area_cm2("hole", &hole), Some(565.0));
    let tear = serde_json::json!({"length_cm": 45, "gap_cm": 6});
    assert_eq!(defect_area_cm2("tear", &tear), Some(135.0));
    let chafe = serde_json::json!({"length_cm": 120, "width_cm": 15});
    assert_eq!(defect_area_cm2("chafe", &chafe), Some(1800.0));
    let h2 = serde_json::json!({"width_cm": 10, "height_cm": 10});
    assert_eq!(defect_area_cm2("hole", &h2), Some(79.0));
    // fouling: D-0004 6.0x3.0 at (0.4, 2.0)
    let patch = FoulingPatch { chart_x_m: 0.4, depth_m: 2.0, width_m: 6.0, height_m: 3.0 };
    assert_eq!(patch.clipped_area_m2(&g), 18.0, "patch area {:?}", patch.clipped_area_m2(&g));
    assert_eq!(panel_fouling_cover_pct(&g, "A1", &[patch.clone()]), 20.4, "A1");
    assert_eq!(panel_fouling_cover_pct(&g, "P1", &[patch]), 15.6, "P1");
    // D-0005: 4x4 at (90, 5)
    let patch2 = FoulingPatch { chart_x_m: 90.0, depth_m: 5.0, width_m: 4.0, height_m: 4.0 };
    assert_eq!(panel_fouling_cover_pct(&g, "I1", &[patch2.clone()]), 8.0, "I1");
    assert_eq!(panel_fouling_cover_pct(&g, "I2", &[patch2.clone()]), 8.0, "I2");
    assert_eq!(panel_fouling_cover_pct(&g, "J1", &[patch2.clone()]), 8.0, "J1");
    assert_eq!(panel_fouling_cover_pct(&g, "J2", &[patch2]), 8.0, "J2");
    // klm-04: 90m circ, 12m depth, 9x3 grid; E2 cell for (45,6): col 45/10=4=E, row 6/4=1(+1)=2 ✓; 5x2 patch => 25% of 40
    let g2 = Grid { columns: 9, rows: 3, circumference_m: 90.0, net_depth_m: 12.0 };
    let patch3 = FoulingPatch { chart_x_m: 45.0, depth_m: 6.0, width_m: 5.0, height_m: 2.0 };
    assert_eq!(patch3.clipped_area_m2(&g2), 10.0);
    assert_eq!(panel_fouling_cover_pct(&g2, "E2", &[patch3]), 25.0);
    // grade
    let sum = |t: &str, size: serde_json::Value, x: f64, d: f64| DefectSummary { defect_type: t.to_string(), size, chart_x_m: x, depth_m: d };
    assert_eq!(pen_grade(&[sum("hole", serde_json::json!({"width_cm":30,"height_cm":24}), 50.0, 12.4)], 0.0), ('D', "Repair before stocking"));
    assert_eq!(pen_grade(&[sum("chafe", serde_json::json!({"length_cm":120,"width_cm":15}), 133.0, 18.2)], 0.0), ('B', "Monitor"));
    assert_eq!(pen_grade(&[], 0.0), ('A', "Sound"));
    // csv
    assert_eq!(csv_cell("=HYPERLINK(\"http://x\",\"y\")"), "\"'==HYPERLINK(\"\"http://x\"\",\"\"y\"\")\"".replace("'==","'="));
    assert_eq!(csv_cell("-frayed edge"), "'-frayed edge");
    assert_eq!(csv_cell("plain"), "plain");
    assert_eq!(csv_cell("with,comma"), "\"with,comma\"");
    // grapheme counting
    assert_eq!(perceived_len("Hole beside seam"), 16);
    assert_eq!(perceived_len("🇳🇴"), 1);
    assert_eq!(perceived_len("e\u{0301}"), 1);
    assert_eq!(perceived_len("👍🏽"), 1);
    assert_eq!(perceived_len("👩‍👩‍👧‍👦"), 1);
    println!("ALL DOMAIN TESTS PASS");
}
