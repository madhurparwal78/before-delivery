/** Applied idempotently on every start. */
export const SCHEMA_SQL = `
create table if not exists people (
  id text primary key,
  name text not null,
  email text not null,
  key_hash text not null unique,
  killbill_account_id text,
  created_at timestamptz not null default now()
);

create table if not exists campaigns (
  id text primary key,
  creator_id text not null references people(id),
  title text not null,
  story text not null,
  status text not null,
  goal bigint not null,
  min_run_copies integer not null,
  stretch jsonb not null default '[]'::jsonb,
  ships_from text not null,
  time_zone text not null,
  deadline_local text not null,
  deadline_utc timestamptz not null,
  created_at timestamptz not null default now(),
  launched_at timestamptz,
  closed_at timestamptz,
  settled_at timestamptz
);
create index if not exists campaigns_creator_idx on campaigns (creator_id, created_at desc);
create index if not exists campaigns_status_idx on campaigns (status, deadline_utc);

create table if not exists tiers (
  id text primary key,
  campaign_id text not null references campaigns(id) on delete cascade,
  title text not null,
  description text not null,
  price bigint not null,
  quantity integer,
  ship_domestic bigint not null,
  ship_europe bigint not null,
  ship_rest_of_world bigint not null,
  position integer not null,
  created_at timestamptz not null default now()
);
create index if not exists tiers_campaign_idx on tiers (campaign_id, position);

create table if not exists media (
  id text primary key,
  campaign_id text not null references campaigns(id) on delete cascade,
  kind text not null,
  status text not null,
  content_type text not null,
  bytes integer not null,
  object_key text not null,
  filename text,
  position integer not null,
  created_at timestamptz not null default now()
);
create index if not exists media_campaign_idx on media (campaign_id, kind, position);

create table if not exists pledges (
  id text primary key,
  campaign_id text not null references campaigns(id) on delete cascade,
  backer_id text not null references people(id),
  tier_id text not null references tiers(id),
  country text not null,
  zone text not null,
  reward bigint not null,
  shipping bigint not null,
  add_on bigint not null,
  amount bigint not null,
  state text not null,
  card_last4 text,
  replaces text,
  killbill_payment_id text,
  platform_fee bigint,
  processing_fee bigint,
  to_creator bigint,
  fix_code text unique,
  fix_deadline_utc timestamptz,
  fix_attempt integer not null default 0,
  fix_payment_id text,
  card_fixed boolean,
  card_captures boolean not null default true,
  fix_notices_sent integer not null default 0,
  errored_at timestamptz,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A backer holds one confirmed pledge per campaign. A change briefly adds an
-- authorising replacement alongside the hold it is about to release, so that state
-- stays outside the constraint; per-campaign serialisation covers the rest.
create unique index if not exists pledges_one_confirmed_per_backer
  on pledges (campaign_id, backer_id)
  where state in ('authorised', 'captured', 'errored');
create index if not exists pledges_campaign_idx on pledges (campaign_id, state);
create index if not exists pledges_tier_idx on pledges (tier_id, state);
create index if not exists pledges_backer_idx on pledges (backer_id, created_at desc);

create table if not exists pledge_history (
  id bigserial primary key,
  pledge_id text not null references pledges(id) on delete cascade,
  state text not null,
  at timestamptz not null default now()
);
create index if not exists pledge_history_idx on pledge_history (pledge_id, id);

create table if not exists idempotency_records (
  scope text not null,
  route text not null,
  key text not null,
  body_hash text not null,
  in_progress boolean not null,
  status_code integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (scope, route, key)
);

create table if not exists notices (
  id text primary key,
  campaign_id text not null references campaigns(id) on delete cascade,
  person_id text not null references people(id),
  kind text not null,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists notices_campaign_idx on notices (campaign_id, created_at);
create index if not exists notices_queued_idx on notices (status) where status = 'queued';

create table if not exists statements (
  pledge_id text primary key references pledges(id) on delete cascade,
  status text not null,
  object_key text not null,
  created_at timestamptz not null default now(),
  stored_at timestamptz
);
create index if not exists statements_pending_idx on statements (status) where status = 'pending';

create table if not exists settlements (
  campaign_id text primary key references campaigns(id) on delete cascade,
  status text not null,
  object_key text not null,
  created_at timestamptz not null default now(),
  stored_at timestamptz
);
create index if not exists settlements_pending_idx on settlements (status) where status = 'pending';
`;
