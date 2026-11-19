import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { config } from './config.js';

const { Pool, types } = pg;

// `date` columns are office dates, never instants, so they are read as written.
types.setTypeParser(1082, (value: string) => value);

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, values);
  return result.rows;
}

export async function one<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export async function inTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
create table if not exists meta (
  key text primary key,
  value text not null
);

create table if not exists audit_counter (
  id int primary key,
  seq bigint not null
);

create table if not exists people (
  id uuid primary key,
  order_no serial not null,
  full_name text not null,
  email text not null unique,
  handle text not null unique,
  role text not null,
  aliases text[] not null default '{}',
  has_signed_in boolean not null default false,
  left_at timestamptz,
  term_starts_on date,
  term_ends_on date,
  term_started boolean not null default false,
  seat text not null default 'waiting_on_billing',
  seat_change text,
  seat_change_since timestamptz,
  seat_subscription_id text,
  seat_bundle_key text,
  keycloak_id text,
  keycloak_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists vaults (
  id uuid primary key,
  name text not null,
  formerly text,
  off_when_travelling boolean not null default false,
  drawer_order int not null,
  created_at timestamptz not null default now()
);
create unique index if not exists vaults_name_key on vaults (lower(name));

create table if not exists person_vaults (
  person_id uuid not null references people(id),
  vault_id uuid not null references vaults(id),
  primary key (person_id, vault_id)
);

create table if not exists travel_windows (
  id uuid primary key,
  person_id uuid not null references people(id),
  starts_local text not null,
  ends_local text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists vendors (
  id uuid primary key,
  name text not null,
  domain text not null unique,
  formerly text,
  order_no serial not null,
  created_at timestamptz not null default now()
);

create table if not exists renames (
  id uuid primary key,
  subject_kind text not null,
  subject_id uuid not null,
  old_name text not null,
  new_name text not null,
  by_person_id uuid,
  at timestamptz not null
);

create table if not exists credentials (
  id uuid primary key,
  vault_id uuid not null references vaults(id),
  vendor_id uuid not null references vendors(id),
  label text not null,
  username text not null,
  secret_cipher text not null,
  secret_length int not null,
  last_turned_on date not null,
  secret_set_on date not null,
  order_no serial not null,
  created_at timestamptz not null default now()
);
create unique index if not exists credentials_identity_key
  on credentials (vault_id, vendor_id, lower(username));

create table if not exists credential_holders (
  credential_id uuid not null references credentials(id),
  person_id uuid not null references people(id),
  primary key (credential_id, person_id)
);

create table if not exists rules (
  id uuid primary key,
  vault_id uuid not null references vaults(id),
  min_length int not null,
  effective_on date not null,
  state text not null,
  version int not null default 1,
  drafted_by uuid,
  signed_by uuid,
  created_at timestamptz not null default now(),
  took_force_at timestamptz
);

create table if not exists rotations (
  id uuid primary key,
  credential_id uuid not null unique references credentials(id),
  interval_days int not null,
  at_time text not null,
  first_run_on date not null,
  created_at timestamptz not null default now()
);

create table if not exists turns (
  id uuid primary key,
  credential_id uuid not null references credentials(id),
  rotation_id uuid references rotations(id),
  kind text not null,
  run_at timestamptz,
  run_office_date date,
  due_by date not null,
  state text not null,
  created_at timestamptz not null default now(),
  turned_at timestamptz
);
create unique index if not exists turns_run_key on turns (rotation_id, run_at) where rotation_id is not null;

create table if not exists reviews (
  id uuid primary key,
  year int not null,
  quarter int not null,
  opened_on date not null,
  overdue_from date not null,
  status text not null,
  signed_off_by uuid,
  signed_off_at timestamptz,
  unique (year, quarter)
);

create table if not exists review_lines (
  id uuid primary key,
  review_id uuid not null references reviews(id),
  person_id uuid not null references people(id),
  vault_id uuid not null references vaults(id),
  decision text not null,
  decided_by uuid,
  decided_via text,
  order_no serial not null,
  created_at timestamptz not null default now()
);
create unique index if not exists review_lines_open_key
  on review_lines (review_id, person_id, vault_id) where decision = 'undecided';

create table if not exists sessions (
  id text primary key,
  person_id uuid not null references people(id),
  created_at timestamptz not null,
  ends_at timestamptz not null,
  signed_out_at timestamptz,
  end_pushed boolean not null default false,
  route text
);

create table if not exists sign_in_state (
  handle text primary key,
  failed_at timestamptz[] not null default '{}',
  locked_until timestamptz
);

create table if not exists idempotency (
  person_id uuid not null,
  endpoint text not null,
  key text not null,
  body_hash text not null,
  status int,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (person_id, endpoint, key)
);

create table if not exists audit (
  id uuid primary key,
  seq bigint not null unique,
  at timestamptz not null,
  office_day date not null,
  office_time text not null,
  offset_name text not null,
  actor_person_id uuid,
  actor_name text,
  action text not null,
  subject_kind text not null,
  subject_id text,
  subject_name text not null,
  details jsonb not null default '{}'
);
create index if not exists audit_day_seq on audit (office_day, seq);

create table if not exists imports (
  id uuid primary key,
  person_id uuid not null references people(id),
  filename text not null,
  created_at timestamptz not null default now()
);

create table if not exists import_rows (
  import_id uuid not null references imports(id),
  row int not null,
  outcome text not null,
  credential_id uuid,
  reason text,
  names jsonb not null default '[]',
  vault_id uuid,
  vendor_domain text,
  vendor_label text,
  login_label text,
  username text,
  secret_cipher text,
  secret_length int,
  last_changed date,
  primary key (import_id, row)
);

create table if not exists breach_checks (
  id uuid primary key,
  at timestamptz not null,
  office_day date not null,
  ok boolean not null,
  counts jsonb
);

create table if not exists breach_check_health (
  check_id uuid not null references breach_checks(id),
  credential_id uuid not null,
  exposed boolean not null,
  vendor_breached boolean not null,
  health text not null,
  primary key (check_id, credential_id)
);

insert into audit_counter (id, seq) values (1, 0) on conflict (id) do nothing;
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}

export async function withAdvisoryLock<T>(name: string, run: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [name]);
    return await run();
  } finally {
    await client.query('select pg_advisory_unlock(hashtext($1))', [name]);
    client.release();
  }
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: string }).code;
  if (code !== '23505') return false;
  if (constraint === undefined) return true;
  return (error as { constraint?: string }).constraint === constraint;
}
