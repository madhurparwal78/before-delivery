-- Event intake, the integration event log and dead letters. The incident engine only sees events through applyMonitoringEvent.

-- One row per outcome shown in an integration's event log, newest id last.
create table if not exists integration_events (
  id bigserial primary key,
  integration_id text not null references integrations (id),
  event_id text,
  at timestamptz not null,
  action text,
  dedup_key text,
  outcome text not null check (outcome in ('Applied', 'Dropped', 'Suppressed', 'Refused', 'Dead-lettered', 'Replayed')),
  reason text,
  incident_number int
);
create index if not exists integration_events_page on integration_events (integration_id, id desc);

-- The highest key_seq intake confirmed per routing key and dedup key.
create table if not exists event_sequences (
  routing_key text not null,
  dedup_key text not null,
  last_seq int not null,
  primary key (routing_key, dedup_key)
);

-- Ids of the events the worker applied: a second copy has no effect.
create table if not exists applied_events (
  event_id text primary key
);

-- The key_seq numbers that are settled for a routing key and dedup key, whether applied or dead-lettered.
create table if not exists event_numbers (
  routing_key text not null,
  dedup_key text not null,
  key_seq int not null,
  primary key (routing_key, dedup_key, key_seq)
);

-- Messages that arrived before an earlier key_seq. received_at is real time: the wait is 60 real seconds.
create table if not exists waiting_events (
  event_id text primary key,
  routing_key text not null,
  dedup_key text not null,
  key_seq int not null,
  body bytea not null,
  received_at timestamptz not null
);
create index if not exists waiting_events_key on waiting_events (routing_key, dedup_key, key_seq);
create index if not exists waiting_events_age on waiting_events (received_at);

-- state: pending (not yet in the dead-letter queue), queued (listed), replayed (applied, still to leave the queue), removed.
create table if not exists dead_letters (
  id text primary key,
  seq bigserial,
  integration_id text references integrations (id),
  routing_key text,
  event_id text,
  reason text not null,
  raw bytea not null,
  attempts int not null,
  dead_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending', 'queued', 'replayed', 'removed'))
);
create index if not exists dead_letters_state on dead_letters (state, seq);
