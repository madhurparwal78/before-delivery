//! The schema, the idempotent seed and id sequences.

use crate::error::{ApiError, ApiResult};
use crate::model::{self, PenRow, Repair};
use crate::reports;
use crate::rules::Kind;
use crate::s3::S3;
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use deadpool_postgres::GenericClient;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS devices (id text PRIMARY KEY, name text NOT NULL, ord int NOT NULL);
CREATE TABLE IF NOT EXISTS farms (id text PRIMARY KEY, name text NOT NULL, day_rate_amount bigint NOT NULL,
  day_rate_currency text NOT NULL, ord int NOT NULL);
CREATE TABLE IF NOT EXISTS sites (code text PRIMARY KEY, farm_id text NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name text NOT NULL, latitude double precision NOT NULL, longitude double precision NOT NULL);
CREATE TABLE IF NOT EXISTS pens (id text PRIMARY KEY, farm_id text NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  site_code text NOT NULL REFERENCES sites(code) ON DELETE CASCADE, pen_no int NOT NULL, name text NOT NULL,
  circumference_m int NOT NULL, net_depth_m int NOT NULL, grid_columns int NOT NULL, grid_rows int NOT NULL, ord int NOT NULL);
CREATE TABLE IF NOT EXISTS defects (id text PRIMARY KEY, seq int NOT NULL, pen_id text NOT NULL REFERENCES pens(id) ON DELETE CASCADE,
  type text NOT NULL, bearing_t int NOT NULL, depth_t int NOT NULL, size jsonb NOT NULL, note text NOT NULL,
  private_note text NOT NULL, status text NOT NULL, removed boolean NOT NULL DEFAULT false, version int NOT NULL,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS defects_by_pen ON defects (pen_id, seq);
CREATE TABLE IF NOT EXISTS defect_history (id bigserial PRIMARY KEY, defect_id text NOT NULL REFERENCES defects(id) ON DELETE CASCADE,
  at timestamptz NOT NULL, device_id text NOT NULL, device_name text NOT NULL, action text NOT NULL,
  changes jsonb NOT NULL, detail text NOT NULL);
CREATE INDEX IF NOT EXISTS history_by_defect ON defect_history (defect_id, id);
CREATE TABLE IF NOT EXISTS repairs (id text PRIMARY KEY, seq int NOT NULL, defect_id text NOT NULL REFERENCES defects(id) ON DELETE CASCADE,
  method text NOT NULL, note text NOT NULL, source text NOT NULL, proposal_id text, recorded_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS stills (id text PRIMARY KEY, seq int NOT NULL, farm_id text NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  defect_id text REFERENCES defects(id) ON DELETE SET NULL, content_type text NOT NULL, size_bytes bigint NOT NULL,
  sha256 text NOT NULL, file_name text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS dives (id text PRIMARY KEY, seq int NOT NULL, pen_id text NOT NULL REFERENCES pens(id) ON DELETE CASCADE,
  status text NOT NULL, planned_start timestamptz NOT NULL, planned_minutes int NOT NULL, diver_certificate_no text NOT NULL,
  clearance jsonb, check_seq bigint NOT NULL DEFAULT 0, started_at timestamptz, finished_at timestamptz, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS dive_track (dive_id text NOT NULL REFERENCES dives(id) ON DELETE CASCADE, idx int NOT NULL,
  t_s int NOT NULL, bearing_t int NOT NULL, depth_t int NOT NULL, PRIMARY KEY (dive_id, idx));
CREATE TABLE IF NOT EXISTS sonar (id text PRIMARY KEY, seq int NOT NULL, farm_id text NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  dive_id text NOT NULL REFERENCES dives(id) ON DELETE CASCADE, content_type text NOT NULL, size_bytes bigint NOT NULL,
  sha256 text NOT NULL, file_name text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS imports (id text PRIMARY KEY, seq int NOT NULL, farm_id text NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  file_name text NOT NULL, sha256 text NOT NULL, size_bytes bigint NOT NULL, imported_at timestamptz NOT NULL, rows int NOT NULL, result jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS import_ledger (farm_id text NOT NULL REFERENCES farms(id) ON DELETE CASCADE, fingerprint text NOT NULL,
  defect_id text NOT NULL, import_id text NOT NULL, PRIMARY KEY (farm_id, fingerprint));
CREATE TABLE IF NOT EXISTS report_revisions (pen_id text NOT NULL REFERENCES pens(id) ON DELETE CASCADE, number int NOT NULL,
  published_at timestamptz NOT NULL, sha256 text NOT NULL, size_bytes bigint NOT NULL, grade_letter text NOT NULL,
  grade_label text NOT NULL, open_defects int NOT NULL, snapshot jsonb NOT NULL, PRIMARY KEY (pen_id, number));
CREATE TABLE IF NOT EXISTS report_links (id text PRIMARY KEY, seq int NOT NULL, pen_id text NOT NULL REFERENCES pens(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE, revoked boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS link_tokens (token text PRIMARY KEY, link_id text NOT NULL REFERENCES report_links(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS copilot_answers (id text PRIMARY KEY, pen_id text NOT NULL REFERENCES pens(id) ON DELETE CASCADE,
  question text NOT NULL, text text NOT NULL, focus jsonb NOT NULL, dropped jsonb NOT NULL, rejected jsonb NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS proposals (id text PRIMARY KEY, answer_id text NOT NULL REFERENCES copilot_answers(id) ON DELETE CASCADE,
  defect_id text NOT NULL, method text NOT NULL, note text NOT NULL, status text NOT NULL, repair_id text, applied_response jsonb);
CREATE SEQUENCE IF NOT EXISTS defect_seq START 9;
CREATE SEQUENCE IF NOT EXISTS repair_seq START 2;
CREATE SEQUENCE IF NOT EXISTS dive_seq START 2;
CREATE SEQUENCE IF NOT EXISTS still_seq START 1;
CREATE SEQUENCE IF NOT EXISTS sonar_seq START 1;
CREATE SEQUENCE IF NOT EXISTS import_seq START 1;
CREATE SEQUENCE IF NOT EXISTS proposal_seq START 1;
CREATE SEQUENCE IF NOT EXISTS answer_seq START 1;
CREATE SEQUENCE IF NOT EXISTS link_seq START 1;
CREATE SEQUENCE IF NOT EXISTS check_seq START 1;
"#;

pub async fn next_number(db: &impl GenericClient, sequence: &str) -> ApiResult<i32> {
    let row = db.query_one(&format!("SELECT nextval('{sequence}')::int"), &[]).await?;
    Ok(row.get(0))
}

pub fn make_id(prefix: &str, number: i32) -> String {
    format!("{prefix}{number:04}")
}

pub async fn migrate(db: &impl GenericClient) -> Result<(), String> {
    db.batch_execute(SCHEMA).await.map_err(|e| e.to_string())
}

fn at(text: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(text).map(|d| d.with_timezone(&Utc)).unwrap_or_default()
}

struct SeedDefect {
    id: &'static str,
    pen: &'static str,
    kind: Kind,
    bearing_t: i64,
    depth_t: i64,
    size: Value,
    note: &'static str,
    private_note: &'static str,
    repaired: bool,
}

fn seed_defects() -> Vec<SeedDefect> {
    let d = |id, pen, kind, bearing_t, depth_t, size, note, private_note, repaired| SeedDefect {
        id, pen, kind, bearing_t, depth_t, size, note, private_note, repaired,
    };
    vec![
        d("D-0001", "skv-01", Kind::Hole, 1125, 124, json!({"width_cm": 30, "height_cm": 24}), "Hole beside seam, edges frayed", "Farm saw a seal near this pen on 28 October", false),
        d("D-0002", "skv-01", Kind::Tear, 2367, 48, json!({"length_cm": 45, "gap_cm": 6}), "Seam tear along vertical rope", "", false),
        d("D-0003", "skv-01", Kind::Chafe, 3000, 182, json!({"length_cm": 120, "width_cm": 15}), "Chafe where the sinker tube rubs", "Bill this re-check at half rate", false),
        d("D-0004", "skv-01", Kind::Fouling, 9, 20, json!({"width_m": 6.0, "height_m": 3.0}), "Mussel and kelp growth near surface", "", false),
        d("D-0005", "skv-01", Kind::Fouling, 2025, 50, json!({"width_m": 4.0, "height_m": 4.0}), "Hydroid fouling on panel join", "", false),
        d("D-0006", "skv-01", Kind::Hole, 450, 80, json!({"width_cm": 10, "height_cm": 10}), "Small hole, laced on last visit", "", true),
        d("D-0007", "skv-02", Kind::Chafe, 900, 100, json!({"length_cm": 40, "width_cm": 5}), "Light chafe at mooring bridle", "", false),
        d("D-0008", "klm-04", Kind::Fouling, 1800, 60, json!({"width_m": 5.0, "height_m": 2.0}), "Algal film on lower panels", "", false),
    ]
}

/// Applies the seed once. Guarded by an advisory lock so two starting copies never race.
pub async fn seed(pool: &deadpool_postgres::Pool, s3: &S3) -> Result<(), String> {
    let mut client = pool.get().await.map_err(|e| e.to_string())?;
    let tx = client.transaction().await.map_err(|e| e.to_string())?;
    tx.execute("SELECT pg_advisory_xact_lock(7340001)", &[]).await.map_err(|e| e.to_string())?;
    let done = tx.query("SELECT 1 FROM meta WHERE key = 'seeded'", &[]).await.map_err(|e| e.to_string())?;
    if !done.is_empty() {
        return Ok(());
    }
    seed_rows(&tx, s3).await.map_err(|e| format!("seed failed: {} {}", e.code, e.message))?;
    tx.execute("INSERT INTO meta (key, value) VALUES ('seeded', 'yes')", &[]).await.map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())
}

async fn seed_rows(tx: &impl GenericClient, s3: &S3) -> ApiResult<()> {
    for (i, (id, name)) in [("DEV-1", "Topside laptop"), ("DEV-2", "Deck tablet")].iter().enumerate() {
        tx.execute("INSERT INTO devices (id, name, ord) VALUES ($1, $2, $3)", &[id, name, &(i as i32)]).await?;
    }
    for (i, (id, name, amount, currency)) in
        [("skarvholmen", "Skarvholmen Laks", 14500i64, "NOK"), ("kalamos", "Kalamos Marine", 950, "EUR")].iter().enumerate()
    {
        tx.execute("INSERT INTO farms (id, name, day_rate_amount, day_rate_currency, ord) VALUES ($1, $2, $3, $4, $5)", &[id, name, amount, currency, &(i as i32)]).await?;
    }
    for (code, farm, name, lat, lon) in [("SKV", "skarvholmen", "Skarvholmen North", 63.4512f64, 8.7321f64), ("KLM", "kalamos", "Kalamos Bay", 38.6215, 20.9013)] {
        tx.execute("INSERT INTO sites (code, farm_id, name, latitude, longitude) VALUES ($1, $2, $3, $4, $5)", &[&code, &farm, &name, &lat, &lon]).await?;
    }
    for (i, (id, farm, code, no, name, circ, depth, cols, rows)) in [
        ("skv-01", "skarvholmen", "SKV", 1i32, "Skarvholmen 01", 160i32, 20i32, 16i32, 4i32),
        ("skv-02", "skarvholmen", "SKV", 2, "Skarvholmen 02", 160, 20, 16, 4),
        ("skv-03", "skarvholmen", "SKV", 3, "Skarvholmen 03", 120, 15, 12, 3),
        ("klm-04", "kalamos", "KLM", 4, "Kalamos 04", 90, 12, 9, 3),
    ]
    .iter()
    .enumerate()
    {
        tx.execute(
            "INSERT INTO pens (id, farm_id, site_code, pen_no, name, circumference_m, net_depth_m, grid_columns, grid_rows, ord) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            &[id, farm, code, no, name, circ, depth, cols, rows, &(i as i32)],
        )
        .await?;
    }
    let created = at("2026-11-02T08:30:00Z");
    let repaired_at = at("2026-11-02T09:05:00Z");
    let mut pen_rows = std::collections::HashMap::new();
    for pen in model::all_pen_rows(tx).await? {
        pen_rows.insert(pen.id.clone(), pen);
    }
    for seed in seed_defects() {
        let pen: &PenRow = &pen_rows[seed.pen];
        let status = if seed.repaired { "repaired" } else { "open" };
        let version: i32 = if seed.repaired { 2 } else { 1 };
        let number: i32 = seed.id[2..].parse().unwrap_or(0);
        let updated = if seed.repaired { repaired_at } else { created };
        tx.execute(
            "INSERT INTO defects (id, seq, pen_id, type, bearing_t, depth_t, size, note, private_note, status, removed, version, created_at, updated_at) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11,$12,$13)",
            &[&seed.id, &number, &seed.pen, &seed.kind.name(), &(seed.bearing_t as i32), &(seed.depth_t as i32), &seed.size, &seed.note, &seed.private_note, &"open", &1i32, &created, &created],
        )
        .await?;
        let mut defect = model::defect_by_id(tx, seed.id, false).await?.ok_or_else(ApiError::not_found)?;
        let fields = model::history_fields(&defect, &pen.geometry);
        insert_history(tx, &defect.id, created, "DEV-1", "Topside laptop", "created", &model::diff(None, &fields), "new defect").await?;
        if seed.repaired {
            tx.execute("INSERT INTO repairs (id, seq, defect_id, method, note, source, proposal_id, recorded_at) VALUES ('R-0001', 1, $1, 'lace', 'Laced with 3 mm twine', 'manual', NULL, $2)", &[&seed.id, &repaired_at]).await?;
            let before = fields;
            tx.execute("UPDATE defects SET status = $2, version = $3, updated_at = $4 WHERE id = $1", &[&seed.id, &status, &version, &updated]).await?;
            defect.status = status.to_string();
            let after = model::history_fields(&defect, &pen.geometry);
            insert_history(tx, &defect.id, repaired_at, "DEV-1", "Topside laptop", "repaired", &model::diff(Some(&before), &after), "lace").await?;
        }
    }
    seed_dive(tx).await?;
    let pen = &pen_rows["skv-01"];
    let defects = model::defects_of_pen(tx, "skv-01", false).await?;
    let published = at("2026-11-02T10:15:00Z");
    reports::store_revision(tx, s3, pen, &defects, 1, published).await?;
    Ok(())
}

async fn seed_dive(tx: &impl GenericClient) -> ApiResult<()> {
    let clearance = json!({
        "result": "GO", "message": "GO — every planned hour is within limits",
        "checked_at": "2026-11-02T07:40:00Z", "issued_at": "2026-11-02T06:00:00Z",
        "hours": [
            {"time": "2026-11-02T08:00:00Z", "current_m_s": 0.24, "wave_m": 0.6, "within_limits": true},
            {"time": "2026-11-02T09:00:00Z", "current_m_s": 0.26, "wave_m": 0.7, "within_limits": true}
        ]
    });
    tx.execute(
        "INSERT INTO dives (id, seq, pen_id, status, planned_start, planned_minutes, diver_certificate_no, clearance, check_seq, started_at, finished_at, created_at) \
         VALUES ('DIVE-0001', 1, 'skv-01', 'recorded', $1, 90, 'NO-ROV-48213', $2, 0, $3, $4, $5)",
        &[&at("2026-11-02T08:00:00Z"), &clearance, &at("2026-11-02T08:04:00Z"), &at("2026-11-02T09:21:00Z"), &at("2026-11-02T07:30:00Z")],
    )
    .await?;
    for (i, (t, bearing_t, depth_t)) in [(0i32, 0i32, 10i32), (600, 450, 80), (1500, 1125, 120), (2700, 2025, 50), (3600, 3000, 175), (4620, 3550, 20)].iter().enumerate() {
        tx.execute("INSERT INTO dive_track (dive_id, idx, t_s, bearing_t, depth_t) VALUES ('DIVE-0001', $1, $2, $3, $4)", &[&(i as i32), t, bearing_t, depth_t]).await?;
    }
    Ok(())
}

pub async fn insert_history(
    db: &impl GenericClient,
    defect_id: &str,
    when: DateTime<Utc>,
    device_id: &str,
    device_name: &str,
    action: &str,
    changes: &Value,
    detail: &str,
) -> ApiResult<()> {
    db.execute(
        "INSERT INTO defect_history (defect_id, at, device_id, device_name, action, changes, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        &[&defect_id, &when, &device_id, &device_name, &action, changes, &detail],
    )
    .await?;
    Ok(())
}

pub fn repair_of(id: String, method: &str, note: &str, source: &str, proposal: Option<String>, at: DateTime<Utc>) -> Repair {
    Repair { id, method: method.into(), note: note.into(), source: source.into(), proposal_id: proposal, recorded_at: at }
}
