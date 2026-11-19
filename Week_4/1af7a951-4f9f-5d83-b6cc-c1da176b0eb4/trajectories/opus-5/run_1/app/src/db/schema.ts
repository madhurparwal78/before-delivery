import { pool } from './pool.js';

const STATEMENTS = [
  `create table if not exists coaches (
    id uuid primary key,
    name text not null,
    email text not null,
    time_zone text not null,
    access_code text not null unique
  )`,
  `create table if not exists cohorts (
    id uuid primary key,
    coach_id uuid not null references coaches(id),
    name text not null,
    starts_on date not null,
    published_at timestamptz,
    closed_at timestamptz,
    price_cents integer not null,
    seats integer not null,
    created_at timestamptz not null default now()
  )`,
  `create unique index if not exists cohorts_coach_name_key on cohorts (coach_id, lower(name))`,
  `create table if not exists enrollments (
    id uuid primary key,
    cohort_id uuid not null references cohorts(id),
    name text not null,
    email text not null,
    status text not null check (status in ('pending_payment', 'active', 'refunded')),
    home_tz text not null,
    bedtime text not null,
    first_night date,
    access_code text not null unique,
    comped boolean not null default false,
    receipt_status text not null default 'none' check (receipt_status in ('none', 'pending', 'sent')),
    paid_amount_cents integer,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists enrollments_cohort_idx on enrollments (cohort_id)`,
  `create index if not exists enrollments_email_idx on enrollments (cohort_id, lower(email))`,
  `create table if not exists sessions (
    token text primary key,
    role text not null check (role in ('dreamer', 'coach')),
    coach_id uuid references coaches(id),
    enrollment_id uuid references enrollments(id),
    created_at timestamptz not null default now()
  )`,
  `create table if not exists entries (
    id uuid primary key,
    enrollment_id uuid not null references enrollments(id),
    night_key date not null,
    title text not null,
    text text not null,
    dreams_recalled integer not null,
    lucid boolean not null,
    wbtb boolean not null,
    technique text not null,
    technique_minutes integer not null,
    late_recall boolean not null,
    shared boolean not null default false,
    created_at timestamptz not null default now(),
    memo_state text not null default 'empty' check (memo_state in ('empty', 'claimed', 'stored')),
    memo_content_type text,
    memo_size_bytes integer,
    memo_duration_ms integer,
    memo_digest text
  )`,
  `create index if not exists entries_enrollment_idx on entries (enrollment_id, night_key)`,
  `create table if not exists signs (
    id uuid primary key,
    entry_id uuid not null references entries(id),
    enrollment_id uuid not null references enrollments(id),
    start_offset integer not null,
    end_offset integer not null,
    phrase text not null,
    category text not null,
    night_key date not null,
    created_at timestamptz not null default now()
  )`,
  `create unique index if not exists signs_entry_range_key on signs (entry_id, start_offset, end_offset)`,
  `create table if not exists reality_checks (
    id uuid primary key,
    enrollment_id uuid not null references enrollments(id),
    category text not null,
    night_key date not null,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists digests (
    cohort_id uuid not null references cohorts(id),
    week integer not null,
    to_email text not null,
    dreamers integer not null,
    sent_at timestamptz not null default now(),
    primary key (cohort_id, week)
  )`,
];

export async function applySchema(): Promise<void> {
  for (const statement of STATEMENTS) {
    await pool.query(statement);
  }
}
