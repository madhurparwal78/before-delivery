import { pool } from './pool.js';

const statements = [
  `create table if not exists orgs (
    id uuid primary key,
    name text not null,
    slug text not null unique,
    plan text not null,
    kb_account_id uuid,
    kb_subscription_id uuid,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists projects (
    id uuid primary key,
    org_id uuid not null references orgs(id),
    name text not null,
    name_folded text not null,
    monthly_quota_minutes integer not null,
    created_at timestamptz not null default now()
  )`,
  `create unique index if not exists projects_org_name_folded_key on projects (org_id, name_folded)`,
  `create table if not exists members (
    id uuid primary key,
    org_id uuid not null references orgs(id),
    name text not null,
    email text not null,
    role text not null,
    password_hash text not null,
    joined_at timestamptz not null default now()
  )`,
  `create unique index if not exists members_email_key on members (lower(email))`,
  `create table if not exists member_projects (
    member_id uuid not null references members(id) on delete cascade,
    project_id uuid not null references projects(id) on delete cascade,
    primary key (member_id, project_id)
  )`,
  `create table if not exists invitations (
    id uuid primary key,
    org_id uuid not null references orgs(id),
    name text not null,
    email text not null,
    role text not null,
    project_ids uuid[] not null,
    token text not null unique,
    used boolean not null default false,
    created_at timestamptz not null default now()
  )`,
  `create unique index if not exists invitations_open_email_key on invitations (lower(email)) where used = false`,
  `create table if not exists auth_sessions (
    token text primary key,
    member_id uuid not null references members(id) on delete cascade,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists api_keys (
    id uuid primary key,
    project_id uuid not null references projects(id),
    name text not null,
    prefix text not null,
    key_hash text not null unique,
    created_at timestamptz not null default now(),
    revoked_at timestamptz
  )`,
  `create table if not exists sessions (
    id uuid primary key,
    project_id uuid not null references projects(id),
    org_id uuid not null references orgs(id),
    kind text not null,
    source text not null,
    label text not null default '',
    state text not null,
    close_reason text,
    channels integer not null,
    audio_ms integer not null default 0,
    frame integer not null default 0,
    peak_bin integer not null default 0,
    plan text not null,
    key_id uuid,
    started_at timestamptz not null default now(),
    live_at timestamptz,
    ended_at timestamptz,
    billable_seconds integer,
    billing_state text not null default 'open',
    received_samples bigint not null default 0,
    spectrum_rows jsonb not null default '[]'::jsonb,
    spectrum_sum jsonb not null default '[]'::jsonb,
    spectrum_count integer not null default 0,
    machine_text text not null default '',
    has_sidecar boolean not null default false,
    transcript_written boolean not null default false,
    wer double precision
  )`,
  `create index if not exists sessions_project_started_key on sessions (project_id, started_at desc)`,
  `create index if not exists sessions_open_key on sessions (project_id) where state in ('connecting','live')`,
  `create table if not exists segments (
    id uuid primary key,
    session_id uuid not null references sessions(id) on delete cascade,
    seg_index integer not null,
    start_ms integer not null,
    end_ms integer not null,
    flagged boolean not null,
    machine jsonb not null,
    unique (session_id, seg_index)
  )`,
  `create table if not exists corrections (
    id uuid primary key,
    session_id uuid not null references sessions(id) on delete cascade,
    segment_id uuid not null references segments(id) on delete cascade,
    author_id uuid not null references members(id),
    state text not null,
    text text not null,
    note text,
    created_at timestamptz not null default now(),
    submitted_at timestamptz,
    decided_at timestamptz,
    decided_by uuid
  )`,
  `create unique index if not exists corrections_single_open_key on corrections (segment_id)
    where state in ('draft','submitted','returned')`,
  `create index if not exists corrections_segment_approved_key on corrections (segment_id, decided_at desc)
    where state = 'approved'`,
  `create table if not exists idempotency_records (
    member_id uuid not null,
    key text not null,
    fingerprint text not null,
    status integer,
    body text,
    done boolean not null default false,
    created_at timestamptz not null default now(),
    primary key (member_id, key)
  )`,
  `create table if not exists plan_changes (
    id uuid primary key,
    org_id uuid not null references orgs(id),
    target text not null,
    state text not null,
    requested_at timestamptz not null default now(),
    decided_at timestamptz
  )`,
  `create unique index if not exists plan_changes_single_open_key on plan_changes (org_id) where state = 'requested'`,
  `create table if not exists synthesis_jobs (
    id uuid primary key,
    project_id uuid not null references projects(id) on delete cascade,
    voice text not null,
    characters integer not null,
    duration_ms integer not null,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists trial_requests (
    id uuid primary key,
    name text not null,
    email text not null,
    company text not null,
    team text not null,
    received_at timestamptz not null default now()
  )`,
  `create unique index if not exists trial_requests_email_key on trial_requests (lower(email))`,
];

export const applySchema = async (): Promise<void> => {
  for (const statement of statements) await pool.query(statement);
};
