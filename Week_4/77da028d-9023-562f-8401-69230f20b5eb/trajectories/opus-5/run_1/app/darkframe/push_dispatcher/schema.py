"""The push dispatcher's own schema, applied idempotently at every start."""

SCHEMA_SQL = """
create schema if not exists push_dispatcher;

create table if not exists push_dispatcher.pushes (
    id text primary key,
    imager_id text not null,
    outbox_id bigint not null unique,
    kind text not null,
    observing_date date,
    topic text not null,
    title text not null,
    message text not null,
    status text not null,
    attempts integer not null default 0,
    last_attempt_at timestamptz,
    sent_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists pushes_by_imager on push_dispatcher.pushes (imager_id);
"""
