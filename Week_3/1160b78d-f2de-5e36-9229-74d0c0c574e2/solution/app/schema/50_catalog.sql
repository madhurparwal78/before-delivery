-- Status updates and their subscribers (status*.go). Policies, services and maintenance windows live in 20_incidents.sql.
--
-- status_updates: seq orders them by creation; published_at is null while the update is a draft. service_ids are the
--   services the update names.
-- subscribers: an address is a current subscriber while unsubscribed_at is null; the token is the unsubscribe link.
create table if not exists status_updates (
  id text primary key,
  seq bigserial,
  title text not null,
  body text not null,
  state text not null check (state in ('investigating', 'identified', 'monitoring', 'resolved')),
  service_ids text[] not null default '{}',
  published_at timestamptz,
  created_at timestamptz not null
);
create index if not exists status_updates_published on status_updates (published_at desc, seq desc);

create table if not exists subscribers (
  id text primary key,
  email text not null,
  token text not null unique,
  unsubscribed_at timestamptz,
  created_at timestamptz not null
);
create unique index if not exists subscribers_email on subscribers (lower(email));
