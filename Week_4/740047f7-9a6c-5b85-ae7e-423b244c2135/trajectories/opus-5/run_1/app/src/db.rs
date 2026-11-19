use crate::error::{ApiError, ApiResult};
use deadpool_postgres::{Config as PoolConfig, GenericClient, Pool, Runtime};
use tokio_postgres::NoTls;

pub const SCHEMA: &str = r#"
create table if not exists app_meta (
    key text primary key,
    value text not null
);
create table if not exists devices (
    id text primary key,
    name text not null,
    ord int not null
);
create table if not exists farms (
    id text primary key,
    name text not null,
    day_rate_amount bigint not null,
    day_rate_currency text not null,
    ord int not null
);
create table if not exists sites (
    code text primary key,
    farm_id text not null references farms(id) on delete cascade,
    name text not null,
    latitude double precision not null,
    longitude double precision not null,
    ord int not null
);
create table if not exists pens (
    id text primary key,
    farm_id text not null references farms(id) on delete cascade,
    site_code text not null,
    pen_no int not null,
    name text not null,
    circumference_m double precision not null,
    net_depth_m double precision not null,
    grid_columns int not null,
    grid_rows int not null,
    ord int not null
);
create table if not exists defects (
    id text primary key,
    pen_id text not null references pens(id) on delete cascade,
    farm_id text not null,
    type text not null,
    bearing_deg double precision not null,
    depth_m double precision not null,
    chart_x_m double precision not null,
    chart_y_m double precision not null,
    cell text not null,
    size jsonb not null,
    note text not null,
    private_note text not null,
    status text not null,
    removed boolean not null,
    version int not null,
    created_at timestamptz not null,
    updated_at timestamptz not null
);
create table if not exists repairs (
    id text primary key,
    defect_id text not null references defects(id) on delete cascade,
    method text not null,
    note text not null,
    source text not null,
    proposal_id text,
    recorded_at timestamptz not null,
    ord bigserial
);
create table if not exists stills (
    id text primary key,
    farm_id text not null,
    defect_id text references defects(id) on delete set null,
    content_type text not null,
    size_bytes bigint not null,
    sha256 text not null,
    file_name text not null,
    created_at timestamptz not null
);
create table if not exists defect_history (
    seq bigserial primary key,
    defect_id text not null references defects(id) on delete cascade,
    at timestamptz not null,
    device_id text not null,
    device_name text not null,
    action text not null,
    changes jsonb not null,
    detail text not null
);
create table if not exists dives (
    id text primary key,
    pen_id text not null references pens(id) on delete cascade,
    farm_id text not null,
    status text not null,
    planned_start timestamptz not null,
    planned_minutes int not null,
    diver_certificate_no text not null,
    clearance jsonb,
    clearance_started_at timestamptz,
    started_at timestamptz,
    finished_at timestamptz,
    track jsonb not null,
    created_at timestamptz not null
);
create table if not exists sonar_captures (
    id text primary key,
    dive_id text not null references dives(id) on delete cascade,
    farm_id text not null,
    content_type text not null,
    size_bytes bigint not null,
    sha256 text not null,
    file_name text not null,
    created_at timestamptz not null
);
create table if not exists imports (
    id text primary key,
    farm_id text not null references farms(id) on delete cascade,
    file_name text not null,
    sha256 text not null,
    size_bytes bigint not null,
    imported_at timestamptz not null,
    data_rows int not null,
    created jsonb not null,
    merged jsonb not null,
    already_imported jsonb not null,
    orphans jsonb not null,
    invalid jsonb not null
);
create table if not exists import_ledger (
    farm_id text not null references farms(id) on delete cascade,
    fingerprint text not null,
    defect_id text not null,
    import_id text not null,
    primary key (farm_id, fingerprint)
);
create table if not exists report_revisions (
    pen_id text not null references pens(id) on delete cascade,
    number int not null,
    published_at timestamptz not null,
    sha256 text not null,
    size_bytes bigint not null,
    grade_letter text not null,
    grade_label text not null,
    open_defects int not null,
    snapshot jsonb not null,
    primary key (pen_id, number)
);
create table if not exists report_links (
    id text primary key,
    pen_id text not null references pens(id) on delete cascade,
    farm_id text not null,
    token text not null unique,
    created_at timestamptz not null,
    expires_at timestamptz not null,
    revoked boolean not null
);
create table if not exists report_link_tokens (
    token text primary key,
    link_id text not null references report_links(id) on delete cascade
);
create table if not exists copilot_answers (
    id text primary key,
    pen_id text not null references pens(id) on delete cascade,
    question text not null,
    text text,
    focus jsonb not null,
    dropped_ids jsonb not null,
    rejected_calls jsonb not null,
    created_at timestamptz not null
);
create table if not exists proposals (
    id text primary key,
    answer_id text not null references copilot_answers(id) on delete cascade,
    pen_id text not null,
    defect_id text not null,
    method text not null,
    note text not null,
    status text not null,
    repair_id text,
    applied jsonb
);
create table if not exists id_counters (
    name text primary key,
    next bigint not null
);
insert into id_counters(name, next) values
    ('defect', 1), ('repair', 1), ('dive', 1), ('still', 1), ('sonar', 1),
    ('import', 1), ('proposal', 1), ('answer', 1), ('link', 1)
on conflict (name) do nothing;
"#;

pub fn pool(database_url: &str) -> ApiResult<Pool> {
    let mut config = PoolConfig::new();
    config.url = Some(database_url.to_string());
    config
        .create_pool(Some(Runtime::Tokio1), NoTls)
        .map_err(|error| ApiError::internal(format!("database pool: {error}")))
}

pub async fn apply_schema(pool: &Pool) -> ApiResult<()> {
    let client = pool.get().await?;
    client.batch_execute(SCHEMA).await?;
    Ok(())
}

/// Ids continue from the next free number, allocated inside the caller's
/// transaction.
pub async fn next_id<C: GenericClient>(client: &C, counter: &str, prefix: &str) -> ApiResult<String> {
    let row = client
        .query_one(
            "update id_counters set next = next + 1 where name = $1 returning next - 1",
            &[&counter],
        )
        .await?;
    let value: i64 = row.get(0);
    Ok(format!("{prefix}-{value:04}"))
}

pub async fn set_counter<C: GenericClient>(client: &C, counter: &str, next: i64) -> ApiResult<()> {
    client
        .execute(
            "update id_counters set next = $2 where name = $1",
            &[&counter, &next],
        )
        .await?;
    Ok(())
}

/// Imports of one farm are applied one at a time, in arrival order.
pub async fn lock_farm_imports<C: GenericClient>(client: &C, farm_id: &str) -> ApiResult<()> {
    client
        .execute(
            "select pg_advisory_xact_lock(hashtext($1 || ':imports'))",
            &[&farm_id],
        )
        .await?;
    Ok(())
}
