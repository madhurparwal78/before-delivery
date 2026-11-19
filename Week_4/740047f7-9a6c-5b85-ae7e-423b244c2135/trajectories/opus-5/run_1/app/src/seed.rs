use crate::db;
use crate::domain::position;
use crate::domain::size::{DefectType, Size};
use crate::error::{ApiError, ApiResult};
use crate::history::{self, Device};
use crate::model::{require_pen, DefectRecord};
use crate::report;
use crate::store::s3::ObjectStore;
use chrono::{DateTime, Utc};
use deadpool_postgres::{GenericClient, Pool};
use serde_json::json;

const CREATED_AT: &str = "2026-11-02T08:30:00Z";
const REPAIRED_AT: &str = "2026-11-02T09:05:00Z";
const PUBLISHED_AT: &str = "2026-11-02T10:15:00Z";

struct SeedDefect {
    id: &'static str,
    pen_id: &'static str,
    defect_type: DefectType,
    bearing_deg: f64,
    depth_m: f64,
    size_a: f64,
    size_b: f64,
    note: &'static str,
    private_note: &'static str,
}

fn seed_defects() -> Vec<SeedDefect> {
    vec![
        SeedDefect {
            id: "D-0001",
            pen_id: "skv-01",
            defect_type: DefectType::Hole,
            bearing_deg: 112.5,
            depth_m: 12.4,
            size_a: 30.0,
            size_b: 24.0,
            note: "Hole beside seam, edges frayed",
            private_note: "Farm saw a seal near this pen on 28 October",
        },
        SeedDefect {
            id: "D-0002",
            pen_id: "skv-01",
            defect_type: DefectType::Tear,
            bearing_deg: 236.7,
            depth_m: 4.8,
            size_a: 45.0,
            size_b: 6.0,
            note: "Seam tear along vertical rope",
            private_note: "",
        },
        SeedDefect {
            id: "D-0003",
            pen_id: "skv-01",
            defect_type: DefectType::Chafe,
            bearing_deg: 300.0,
            depth_m: 18.2,
            size_a: 120.0,
            size_b: 15.0,
            note: "Chafe where the sinker tube rubs",
            private_note: "Bill this re-check at half rate",
        },
        SeedDefect {
            id: "D-0004",
            pen_id: "skv-01",
            defect_type: DefectType::Fouling,
            bearing_deg: 0.9,
            depth_m: 2.0,
            size_a: 6.0,
            size_b: 3.0,
            note: "Mussel and kelp growth near surface",
            private_note: "",
        },
        SeedDefect {
            id: "D-0005",
            pen_id: "skv-01",
            defect_type: DefectType::Fouling,
            bearing_deg: 202.5,
            depth_m: 5.0,
            size_a: 4.0,
            size_b: 4.0,
            note: "Hydroid fouling on panel join",
            private_note: "",
        },
        SeedDefect {
            id: "D-0006",
            pen_id: "skv-01",
            defect_type: DefectType::Hole,
            bearing_deg: 45.0,
            depth_m: 8.0,
            size_a: 10.0,
            size_b: 10.0,
            note: "Small hole, laced on last visit",
            private_note: "",
        },
        SeedDefect {
            id: "D-0007",
            pen_id: "skv-02",
            defect_type: DefectType::Chafe,
            bearing_deg: 90.0,
            depth_m: 10.0,
            size_a: 40.0,
            size_b: 5.0,
            note: "Light chafe at mooring bridle",
            private_note: "",
        },
        SeedDefect {
            id: "D-0008",
            pen_id: "klm-04",
            defect_type: DefectType::Fouling,
            bearing_deg: 180.0,
            depth_m: 6.0,
            size_a: 5.0,
            size_b: 2.0,
            note: "Algal film on lower panels",
            private_note: "",
        },
    ]
}

fn parse(stamp: &str) -> ApiResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(stamp)
        .map(|at| at.with_timezone(&Utc))
        .map_err(|_| ApiError::internal("seed timestamp is not usable"))
}

/// The schema and seed are applied idempotently on every start: the seed is
/// written once and never re-applied, so erased farms do not come back.
pub async fn apply(pool: &Pool, store: &ObjectStore) -> ApiResult<()> {
    let mut client = pool.get().await?;
    let already = client
        .query("select 1 from app_meta where key = 'seed'", &[])
        .await?;
    if !already.is_empty() {
        return Ok(());
    }
    let transaction = client.transaction().await?;
    let laptop = Device {
        id: "DEV-1".to_string(),
        name: "Topside laptop".to_string(),
    };
    let created_at = parse(CREATED_AT)?;
    let repaired_at = parse(REPAIRED_AT)?;
    let published_at = parse(PUBLISHED_AT)?;

    for (id, name, ord) in [("DEV-1", "Topside laptop", 1), ("DEV-2", "Deck tablet", 2)] {
        transaction
            .execute(
                "insert into devices(id, name, ord) values ($1,$2,$3) on conflict (id) do nothing",
                &[&id, &name, &ord],
            )
            .await?;
    }
    for (id, name, amount, currency, ord) in [
        ("skarvholmen", "Skarvholmen Laks", 14500i64, "NOK", 1),
        ("kalamos", "Kalamos Marine", 950i64, "EUR", 2),
    ] {
        transaction
            .execute(
                "insert into farms(id, name, day_rate_amount, day_rate_currency, ord) \
                 values ($1,$2,$3,$4,$5) on conflict (id) do nothing",
                &[&id, &name, &amount, &currency, &ord],
            )
            .await?;
    }
    for (code, farm_id, name, latitude, longitude) in [
        ("SKV", "skarvholmen", "Skarvholmen North", 63.4512, 8.7321),
        ("KLM", "kalamos", "Kalamos Bay", 38.6215, 20.9013),
    ] {
        transaction
            .execute(
                "insert into sites(code, farm_id, name, latitude, longitude, ord) \
                 values ($1,$2,$3,$4,$5,1) on conflict (code) do nothing",
                &[&code, &farm_id, &name, &latitude, &longitude],
            )
            .await?;
    }
    for (id, farm_id, site_code, pen_no, name, circumference, depth, columns, rows, ord) in [
        ("skv-01", "skarvholmen", "SKV", 1, "Skarvholmen 01", 160.0, 20.0, 16, 4, 1),
        ("skv-02", "skarvholmen", "SKV", 2, "Skarvholmen 02", 160.0, 20.0, 16, 4, 2),
        ("skv-03", "skarvholmen", "SKV", 3, "Skarvholmen 03", 120.0, 15.0, 12, 3, 3),
        ("klm-04", "kalamos", "KLM", 4, "Kalamos 04", 90.0, 12.0, 9, 3, 4),
    ] {
        transaction
            .execute(
                "insert into pens(id, farm_id, site_code, pen_no, name, circumference_m, \
                 net_depth_m, grid_columns, grid_rows, ord) \
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (id) do nothing",
                &[
                    &id, &farm_id, &site_code, &pen_no, &name, &circumference, &depth, &columns,
                    &rows, &ord,
                ],
            )
            .await?;
    }

    for seed in seed_defects() {
        let pen = require_pen(&transaction, seed.pen_id).await?;
        let grid = pen.grid();
        let placed = position::resolve(Some(seed.bearing_deg), None, Some(seed.depth_m), grid)?;
        let size = Size {
            defect_type: seed.defect_type,
            a: seed.size_a,
            b: seed.size_b,
        };
        let record = DefectRecord {
            id: seed.id.to_string(),
            pen_id: pen.id.clone(),
            farm_id: pen.farm_id.clone(),
            defect_type: seed.defect_type,
            bearing_deg: placed.bearing_deg,
            depth_m: placed.depth_m,
            chart_x_m: placed.chart_x_m,
            chart_y_m: placed.chart_y_m,
            cell: placed.cell.clone(),
            size,
            note: seed.note.to_string(),
            private_note: seed.private_note.to_string(),
            status: "open".to_string(),
            removed: false,
            version: 1,
            updated_at: created_at,
        };
        transaction
            .execute(
                "insert into defects(id, pen_id, farm_id, type, bearing_deg, depth_m, chart_x_m, \
                 chart_y_m, cell, size, note, private_note, status, removed, version, created_at, updated_at) \
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'open',false,1,$13,$13)",
                &[
                    &record.id,
                    &record.pen_id,
                    &record.farm_id,
                    &record.defect_type.as_str(),
                    &record.bearing_deg,
                    &record.depth_m,
                    &record.chart_x_m,
                    &record.chart_y_m,
                    &record.cell,
                    &record.size.to_json(),
                    &record.note,
                    &record.private_note,
                    &created_at,
                ],
            )
            .await?;
        history::write(
            &transaction,
            &record.id,
            &laptop,
            "created",
            &history::created_changes(&record),
            "new defect",
            created_at,
        )
        .await?;
    }

    transaction
        .execute(
            "insert into repairs(id, defect_id, method, note, source, proposal_id, recorded_at) \
             values ('R-0001','D-0006','lace','Laced with 3 mm twine','manual',null,$1)",
            &[&repaired_at],
        )
        .await?;
    transaction
        .execute(
            "update defects set status = 'repaired', version = 2, updated_at = $1 where id = 'D-0006'",
            &[&repaired_at],
        )
        .await?;
    history::write(
        &transaction,
        "D-0006",
        &laptop,
        "repaired",
        &history::status_change("open", "repaired"),
        "lace",
        repaired_at,
    )
    .await?;

    let clearance = json!({
        "result": "GO",
        "message": crate::domain::clearance::GO_MESSAGE,
        "checked_at": "2026-11-02T07:40:00Z",
        "issued_at": "2026-11-02T06:00:00Z",
        "hours": [
            {"time": "2026-11-02T08:00Z", "current_m_s": 0.24, "wave_m": 0.7, "within_limits": true},
            {"time": "2026-11-02T09:00Z", "current_m_s": 0.26, "wave_m": 0.8, "within_limits": true}
        ]
    });
    let track = json!([
        {"t_s": 0, "bearing_deg": 0.0, "depth_m": 1.0},
        {"t_s": 600, "bearing_deg": 45.0, "depth_m": 8.0},
        {"t_s": 1500, "bearing_deg": 112.5, "depth_m": 12.0},
        {"t_s": 2700, "bearing_deg": 202.5, "depth_m": 5.0},
        {"t_s": 3600, "bearing_deg": 300.0, "depth_m": 17.5},
        {"t_s": 4620, "bearing_deg": 355.0, "depth_m": 2.0}
    ]);
    transaction
        .execute(
            "insert into dives(id, pen_id, farm_id, status, planned_start, planned_minutes, \
             diver_certificate_no, clearance, clearance_started_at, started_at, finished_at, track, created_at) \
             values ('DIVE-0001','skv-01','skarvholmen','recorded',$1,90,'NO-ROV-48213',$2,$3,$4,$5,$6,$1)",
            &[
                &parse("2026-11-02T08:00:00Z")?,
                &clearance,
                &parse("2026-11-02T07:40:00Z")?,
                &parse("2026-11-02T08:04:00Z")?,
                &parse("2026-11-02T09:21:00Z")?,
                &track,
            ],
        )
        .await?;

    let pen = require_pen(&transaction, "skv-01").await?;
    let published = report::build(&transaction, &pen, 1, published_at).await?;
    transaction
        .execute(
            "insert into report_revisions(pen_id, number, published_at, sha256, size_bytes, \
             grade_letter, grade_label, open_defects, snapshot) values ($1,1,$2,$3,$4,$5,$6,$7,$8)",
            &[
                &pen.id,
                &published_at,
                &published.sha256,
                &(published.bytes.len() as i64),
                &published.grade_letter,
                &published.grade_label,
                &(published.open_defects as i32),
                &published.snapshot,
            ],
        )
        .await?;
    store
        .put(
            &report::object_key(&pen.farm_id, &pen.id, 1),
            published.bytes.clone(),
            "application/json",
        )
        .await?;

    db::set_counter(&transaction, "defect", 9).await?;
    db::set_counter(&transaction, "repair", 2).await?;
    db::set_counter(&transaction, "dive", 2).await?;
    transaction
        .execute(
            "insert into app_meta(key, value) values ('seed','1') on conflict (key) do nothing",
            &[],
        )
        .await?;
    transaction.commit().await?;
    Ok(())
}
