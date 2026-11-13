-- Shared catalog and incident tables. The incident engine (incidents*.go) owns every write to incidents, alerts,
-- timeline, incident_responders, responder_requests and note_drafts; other domains read them.

create table if not exists policies (
  id text primary key,
  name text not null,
  repeats int not null default 0,
  -- [{"timeout_minutes":30,"targets":[{"type":"person"|"schedule","id":"<id>"}]}]
  levels jsonb not null,
  version int not null default 1,
  created_at timestamptz not null
);

create table if not exists services (
  id text primary key,
  name text not null unique,
  team text not null,
  policy_id text not null references policies (id),
  depends_on text[] not null default '{}',
  grouping_mode text not null check (grouping_mode in ('none', 'window', 'until_resolved')),
  grouping_minutes int,
  ack_timeout_minutes int,
  auto_resolve_minutes int,
  version int not null default 1,
  created_at timestamptz not null
);

create table if not exists integrations (
  id text primary key,
  service_id text not null references services (id),
  name text not null,
  routing_key text not null unique,
  created_at timestamptz not null
);

create sequence if not exists incident_number_seq start 5;

create table if not exists incidents (
  id text primary key,
  number int not null unique,
  service_id text not null references services (id),
  title text not null,
  status text not null check (status in ('triggered', 'acknowledged', 'snoozed', 'resolved')),
  urgency text not null check (urgency in ('high', 'low')),
  holders text[] not null default '{}',          -- user ids, in display order
  level int not null default 1,
  cycle int not null default 0,
  escalation_finished boolean not null default false,
  policy_snapshot jsonb not null,                -- the policy as it stood when opened, with target names
  opened_at timestamptz not null,
  snoozed_until timestamptz,
  snoozed_by text,                               -- name of the snoozer
  ack_deadline timestamptz,                      -- acknowledge timeout deadline while acknowledged
  auto_resolve_minutes int,                      -- copied from the service when opened
  auto_resolve_at timestamptz,
  resolve_reason text,                           -- Resolved | Merged | Auto-resolved
  merged_into int,
  resolved_at timestamptz,
  decided_by text,                               -- actor name of the entry that resolved it
  window_ends_at timestamptz,                    -- end of the grouping window while it runs
  impacted_services text[] not null default '{}',-- service ids the incident used to be on
  assignment int not null default 1,             -- rises whenever the holders change; acknowledge links are signed per assignment
  version int not null default 1
);
create index if not exists incidents_open on incidents (service_id, status);
create index if not exists incidents_paging on incidents (opened_at desc, number desc);

create table if not exists alerts (
  id text primary key,
  incident_id text not null references incidents (id),
  routing_key text,                              -- null for a drill
  dedup_key text not null,
  status text not null check (status in ('triggered', 'acknowledged', 'resolved')),
  summary text not null,
  source text not null,
  severity text not null,
  custom_details jsonb not null default '{}',
  event_count int not null default 1,
  opened_at timestamptz not null,
  resolved_at timestamptz,
  order_no bigserial
);
create index if not exists alerts_key on alerts (routing_key, dedup_key);
create index if not exists alerts_incident on alerts (incident_id);

create table if not exists timeline (
  id bigserial primary key,
  incident_id text not null references incidents (id),
  at timestamptz not null,
  kind text not null,
  actor text not null,
  text text not null,
  from_number int
);
create index if not exists timeline_incident on timeline (incident_id, at, id);

create table if not exists incident_responders (
  incident_id text not null references incidents (id),
  user_id text not null references users (id),
  joined_at timestamptz not null,
  primary key (incident_id, user_id)
);

create table if not exists responder_requests (
  id text primary key,
  incident_id text not null references incidents (id),
  person_id text not null references users (id),
  requested_by text not null,
  state text not null check (state in ('requested', 'accepted', 'declined')),
  created_at timestamptz not null
);

create table if not exists note_drafts (
  incident_id text not null references incidents (id),
  user_id text not null references users (id),
  body text not null,
  saved_at timestamptz not null,
  primary key (incident_id, user_id)
);

create table if not exists saved_filters (
  id text primary key,
  user_id text not null references users (id),
  name text not null,
  status text not null,
  service_id text,
  created_at timestamptz not null
);

create table if not exists maintenance_windows (
  id text primary key,
  service_id text not null references services (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  ended_at timestamptz,                          -- set when an admin ends it with DELETE
  created_at timestamptz not null
);
