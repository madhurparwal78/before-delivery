"""The sky engine's own schema, applied idempotently at every start."""

SCHEMA_SQL = """
create schema if not exists sky_engine;

create table if not exists sky_engine.sites (
    imager_id text primary key,
    label text not null,
    latitude double precision not null,
    longitude double precision not null,
    elevation_m double precision not null,
    time_zone text not null,
    min_altitude_deg integer not null default 20,
    push_topic text,
    horizon_altitudes integer[] not null
);

create table if not exists sky_engine.plan_targets (
    imager_id text not null,
    observing_date date not null,
    project_id text not null,
    added_at timestamptz not null default now(),
    primary key (imager_id, observing_date, project_id)
);

create table if not exists sky_engine.plan_conditions (
    imager_id text not null,
    observing_date date not null,
    entered_at timestamptz not null,
    hours jsonb not null,
    primary key (imager_id, observing_date)
);

create table if not exists sky_engine.verdict_history (
    imager_id text not null,
    observing_date date not null,
    verdict text not null,
    recorded_at timestamptz not null,
    primary key (imager_id, observing_date)
);

create table if not exists sky_engine.verdict_outbox (
    id bigserial primary key,
    imager_id text not null,
    kind text not null,
    observing_date date,
    topic text not null,
    title text not null,
    message text not null,
    created_at timestamptz not null default now(),
    claimed_at timestamptz
);

create table if not exists sky_engine.reminders (
    imager_id text primary key,
    enabled boolean not null default false,
    local_time time not null default '18:00',
    enabled_at timestamptz,
    last_queued_utc timestamptz
);

create table if not exists sky_engine.pending_evaluation (
    imager_id text primary key,
    requested_at timestamptz not null
);

create table if not exists sky_engine.seeded (
    marker text primary key,
    applied_at timestamptz not null default now()
);
"""
