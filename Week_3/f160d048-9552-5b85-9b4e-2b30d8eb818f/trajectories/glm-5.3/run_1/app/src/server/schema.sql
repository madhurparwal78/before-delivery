-- Schema applied idempotently on every serve.
create table if not exists app_clock (
  id int primary key check (id = 1),
  clock_offset_ms bigint not null default 0
);
insert into app_clock (id, clock_offset_ms) values (1, 0) on conflict do nothing;

create table if not exists users (
  id text primary key,
  display_name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('member','moderator','recruiter','employer_admin','founder')),
  company_id text,
  unlocked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists tokens (
  token text primary key,
  kind text not null check (kind in ('join','reset','set_password')),
  email text not null,
  user_id text,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists companies (
  id text primary key,
  slug text not null unique,
  name text not null unique,
  city text not null,
  size text not null,
  verified boolean not null default false,
  email_domain text not null default '',
  mark_file_id text,
  sample boolean not null default false,
  sort_order int not null default 1000
);

create table if not exists verification_codes (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  code text not null,
  email text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists posts (
  id text primary key,
  kind text not null check (kind in ('review','pay_report','interview_note')),
  company_id text not null references companies(id) on delete cascade,
  author_id text not null references users(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','claimed','approved','rejected','deleted')),
  title text,
  overall int,
  work_life int,
  pay int,
  management int,
  pros text,
  cons text,
  role_family text,
  city text,
  annual_pay int,
  years_experience int,
  difficulty int,
  outcome text,
  text_field text,
  reason text,
  posted_month text,
  claimed_by text,
  last_claimant text,
  claimed_at timestamptz,
  lease_ends_at timestamptz,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists posts_company_kind on posts (company_id, kind, state);
create index if not exists posts_author on posts (author_id);

create table if not exists post_history (
  id bigserial primary key,
  post_id text not null references posts(id) on delete cascade,
  type text not null check (type in ('claimed','renewed','expired','approved','rejected')),
  by_name text,
  reason text,
  at timestamptz not null default now()
);

create table if not exists replies (
  review_id text primary key references posts(id) on delete cascade,
  company_id text not null references companies(id) on delete cascade,
  body text not null,
  posted_month text not null
);

create table if not exists jobs (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  title text not null,
  role_family text not null,
  city text not null,
  remote text not null,
  pay_low int not null,
  pay_high int not null,
  description text not null,
  status text not null default 'draft' check (status in ('draft','listed','closed')),
  listed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists saved_jobs (
  user_id text not null references users(id) on delete cascade,
  job_id text not null references jobs(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

create table if not exists alerts (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  q text not null default '',
  cities text[] not null default '{}',
  roles text[] not null default '{}',
  remotes text[] not null default '{}',
  bands text[] not null default '{}',
  new_count int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists alert_batches (
  id text primary key,
  alert_id text not null references alerts(id) on delete cascade,
  first_matched_at timestamptz not null,
  due_at timestamptz not null,
  sent_at timestamptz,
  job_ids text[] not null default '{}'
);

create table if not exists applications (
  id text primary key,
  job_id text not null references jobs(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  candidate_name text not null,
  contact_email text not null,
  phone text not null default '',
  cover_note text not null default '',
  stage text not null default 'submitted' check (stage in ('submitted','screening','interview','offer','declined')),
  applied_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resume_file_id text not null,
  unique (job_id, user_id)
);

create table if not exists stage_history (
  id bigserial primary key,
  application_id text not null references applications(id) on delete cascade,
  stage text not null,
  moved_at timestamptz not null default now()
);

create table if not exists apply_keys (
  key text primary key,
  user_id text not null,
  job_id text not null,
  answer_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists files (
  id text primary key,
  kind text not null check (kind in ('resume','mark')),
  company_id text,
  content_type text not null,
  size_bytes int not null,
  created_at timestamptz not null default now()
);

create table if not exists channels (
  id text primary key,
  slug text not null unique,
  name text not null,
  seeded boolean not null default false
);

create table if not exists channel_posts (
  id text primary key,
  channel_id text not null references channels(id) on delete cascade,
  author_id text not null references users(id) on delete cascade,
  body text not null,
  posted_month text not null,
  created_at timestamptz not null default now()
);

create table if not exists outbox (
  id bigserial primary key,
  kind text not null,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending','sending','sent')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists search_sync (
  id text primary key,
  kind text not null check (kind in ('job','company')),
  record_id text not null,
  action text not null check (action in ('upsert','delete')),
  payload jsonb not null default '{}',
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigserial primary key,
  kind text not null,
  record_id text not null,
  by_user text not null,
  detail jsonb not null default '{}',
  at timestamptz not null default now()
);

create table if not exists upload_log (
  user_id text not null,
  kind text not null,
  at timestamptz not null default now()
);
