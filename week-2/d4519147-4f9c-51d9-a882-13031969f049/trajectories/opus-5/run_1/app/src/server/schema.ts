import { query } from './db';

const DDL = `
create table if not exists users (
  id uuid primary key,
  email text not null unique,
  display_name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  csrf_token text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists diagrams (
  id uuid primary key,
  title text not null,
  owner_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pages (
  id uuid primary key,
  diagram_id uuid not null references diagrams(id) on delete cascade,
  name text not null,
  version integer not null,
  doc jsonb not null,
  derived jsonb not null,
  seq bigserial not null,
  created_at timestamptz not null default now()
);
create index if not exists pages_diagram on pages(diagram_id, seq);

create table if not exists shares (
  id uuid primary key,
  diagram_id uuid not null references diagrams(id) on delete cascade,
  email text not null,
  role text not null,
  status text not null,
  token_hash text,
  token_hash_issued boolean not null default false,
  expires_at timestamptz,
  delivery text not null default 'sent',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists shares_one_live_per_email
  on shares(diagram_id, email) where status in ('invited', 'active');
create index if not exists shares_token on shares(token_hash);

create table if not exists mail_queue (
  id uuid primary key,
  diagram_id uuid references diagrams(id) on delete cascade,
  share_id uuid references shares(id) on delete cascade,
  kind text not null,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending',
  claimed_until timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists mail_queue_pending on mail_queue(status, created_at);

create table if not exists imports (
  id uuid primary key,
  diagram_id uuid not null references diagrams(id) on delete cascade,
  page_id uuid not null references pages(id) on delete cascade,
  file_name text not null,
  size_bytes integer not null,
  sha256 text not null,
  object_key text not null,
  created_by uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  seq bigserial not null
);
create index if not exists imports_diagram on imports(diagram_id, seq desc);

create table if not exists exports (
  id uuid primary key,
  diagram_id uuid not null references diagrams(id) on delete cascade,
  status text not null,
  page_ids jsonb not null,
  files jsonb not null default '[]'::jsonb,
  created_by uuid not null references users(id) on delete cascade,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  seq bigserial not null
);
create index if not exists exports_diagram on exports(diagram_id, seq desc);

create table if not exists idempotency_keys (
  user_id uuid not null references users(id) on delete cascade,
  diagram_id uuid not null references diagrams(id) on delete cascade,
  key text not null,
  state text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, diagram_id, key)
);

create table if not exists download_links (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  diagram_id uuid not null references diagrams(id) on delete cascade,
  object_key text not null,
  file_name text not null,
  content_type text not null,
  sha256 text,
  created_at timestamptz not null default now()
);

create table if not exists audit_events (
  id uuid primary key,
  diagram_id uuid references diagrams(id) on delete cascade,
  account_user_id uuid references users(id) on delete cascade,
  actor text not null,
  action text not null,
  detail jsonb not null,
  at timestamptz not null default now(),
  seq bigserial not null
);
create index if not exists audit_diagram on audit_events(diagram_id, seq desc);
create index if not exists audit_account on audit_events(account_user_id, seq desc);

create table if not exists signin_failures (
  id bigserial primary key,
  email text not null,
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists signin_failures_lookup on signin_failures(email, ip, at desc);
create index if not exists signin_failures_ip on signin_failures(ip, at desc);

create table if not exists invite_lookup_failures (
  id bigserial primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists invite_lookup_ip on invite_lookup_failures(ip, at desc);
`;

export async function applySchema(): Promise<void> {
  for (const statement of DDL.split(';')) {
    const trimmed = statement.trim();
    if (trimmed) await query(trimmed);
  }
}
