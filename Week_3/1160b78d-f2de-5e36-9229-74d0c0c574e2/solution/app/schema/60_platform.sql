-- Platform tables: webhook endpoints with their deliveries and attempts, and analytics jobs.
-- API keys live in 00_core.sql, people in 00_core.sql.

create table if not exists webhooks (
  id text primary key,
  name text not null,
  path text not null,
  secret text not null,
  event_types text[] not null,
  service_ids text[] not null default '{}',      -- empty: every service
  created_at timestamptz not null
);

create table if not exists webhook_deliveries (
  id text primary key,
  webhook_id text not null references webhooks (id) on delete cascade,
  event_id text not null,
  type text not null,
  body text not null,                            -- the exact bytes posted and signed
  status text not null check (status in ('pending', 'retrying', 'delivered', 'rejected', 'failed')),
  next_attempt_at timestamptz,                   -- when the next attempt is due; null once the series ended
  series_started_at timestamptz,                 -- server second of the first attempt of the running series
  series_attempts int not null default 0,        -- attempts made in the running series (a Replay starts a new one)
  created_at timestamptz not null,
  seq bigserial
);
create index if not exists webhook_deliveries_due on webhook_deliveries (next_attempt_at) where status in ('pending', 'retrying');
create index if not exists webhook_deliveries_listing on webhook_deliveries (webhook_id, seq desc);

create table if not exists webhook_attempts (
  id bigserial primary key,
  delivery_id text not null references webhook_deliveries (id) on delete cascade,
  attempt int not null,                          -- continues across Replays
  at timestamptz not null,
  status_code int,                               -- null when the receiver gave no answer
  body text not null default '',
  outcome text not null
);
create index if not exists webhook_attempts_delivery on webhook_attempts (delivery_id, attempt);

create table if not exists analytics_jobs (
  id text primary key,
  from_date text not null,                       -- YYYY-MM-DD in the firm's zone
  to_date text not null,
  state text not null check (state in ('running', 'done')),
  done int not null default 0,
  total int not null,
  cached boolean not null default false,
  plan jsonb not null,                           -- the services to measure, in order, fixed when the job starts
  measured jsonb not null default '[]',          -- the services measured so far
  fingerprint text not null,                     -- what the range's incidents looked like when the job started
  rows jsonb,
  overall jsonb,
  created_at timestamptz not null
);
create unique index if not exists analytics_jobs_running on analytics_jobs (from_date, to_date) where state = 'running';
