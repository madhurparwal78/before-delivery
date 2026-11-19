"""The ledger service's own schema, applied idempotently at every start."""

SCHEMA_SQL = """
create schema if not exists ledger;

create table if not exists ledger.projects (
    id text primary key,
    imager_id text not null,
    name text not null,
    target_name text not null,
    ra_deg double precision not null,
    dec_deg double precision not null,
    state text not null,
    created_at timestamptz not null default now()
);
create index if not exists projects_by_imager on ledger.projects (imager_id);

create table if not exists ledger.entries (
    id text primary key,
    sequence bigserial,
    movement_id text not null,
    movement_kind text not null,
    imager_id text not null,
    project_id text not null,
    filter text not null,
    account text not null,
    seconds bigint not null,
    session_id text,
    batch_id text,
    reverses_movement_id text,
    created_at timestamptz not null default now()
);
create index if not exists entries_by_project on ledger.entries (project_id);
create index if not exists entries_by_movement on ledger.entries (movement_id);

create table if not exists ledger.sessions (
    id text primary key,
    imager_id text not null,
    project_id text not null,
    state text not null,
    previous_state text,
    observing_date date not null,
    started_at timestamptz,
    logged_at timestamptz,
    notes text not null default '',
    created_at timestamptz not null default now()
);
create index if not exists sessions_by_imager on ledger.sessions (imager_id);

create table if not exists ledger.batches (
    id text primary key,
    imager_id text not null,
    session_id text not null,
    position integer not null,
    filter text not null,
    sub_count integer not null,
    exposure_s integer not null,
    camera text not null,
    gain integer not null,
    offset_value integer not null,
    temperature_c numeric(4,1) not null,
    binning integer not null,
    dark_set_id text,
    flat_set_id text,
    bias_set_id text,
    created_at timestamptz not null default now()
);
create index if not exists batches_by_session on ledger.batches (session_id);

create table if not exists ledger.frames (
    id text primary key,
    imager_id text not null,
    session_id text not null,
    batch_id text not null,
    name text not null,
    size_bytes bigint not null,
    content_type text not null,
    sha256 text not null,
    object_key text not null,
    created_at timestamptz not null default now(),
    unique (batch_id, name)
);

create table if not exists ledger.session_locks (
    session_id text primary key,
    imager_id text not null,
    lock_token text not null,
    expires_at timestamptz not null
);

create table if not exists ledger.idempotency (
    imager_id text not null,
    key text not null,
    body_hash text not null,
    status integer not null,
    response jsonb,
    created_at timestamptz not null default now(),
    primary key (imager_id, key)
);

create table if not exists ledger.calibration_sets (
    id text primary key,
    imager_id text not null,
    kind text not null,
    status text not null,
    version integer not null,
    created_at timestamptz not null default now()
);
create index if not exists sets_by_imager on ledger.calibration_sets (imager_id);

create table if not exists ledger.calibration_versions (
    set_id text not null,
    version integer not null,
    created_at timestamptz not null default now(),
    name text not null,
    camera text not null,
    gain integer not null,
    offset_value integer not null,
    exposure_s integer,
    temperature_c numeric(4,1) not null,
    binning integer not null,
    filter text,
    frame_count integer not null,
    captured_on date not null,
    master jsonb,
    primary key (set_id, version)
);

create table if not exists ledger.share_links (
    token text primary key,
    imager_id text not null,
    project_id text not null,
    expires_at timestamptz,
    live boolean not null default true,
    created_at timestamptz not null default now()
);
create index if not exists shares_by_project on ledger.share_links (project_id);

create table if not exists ledger.seeded (
    marker text primary key,
    applied_at timestamptz not null default now()
);
"""
