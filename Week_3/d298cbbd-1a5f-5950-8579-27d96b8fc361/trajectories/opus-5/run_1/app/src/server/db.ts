import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config.js';

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export async function query<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, values as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
create table if not exists typists (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  password_hash text not null,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists settings (
  typist_id uuid primary key references typists(id) on delete cascade,
  theme text not null,
  caret text not null,
  smooth_caret boolean not null,
  font_size numeric not null,
  blind_mode boolean not null,
  quick_restart text not null
);

create table if not exists sessions (
  token text primary key,
  typist_id uuid not null references typists(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists email_tokens (
  token text primary key,
  typist_id uuid not null references typists(id) on delete cascade,
  kind text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists sign_in_failures (
  id bigserial primary key,
  email text not null,
  at timestamptz not null default now()
);
create index if not exists sign_in_failures_email_at on sign_in_failures (email, at desc);

create sequence if not exists ticket_sequence;

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  typist_id uuid references typists(id) on delete cascade,
  mode text not null,
  length text,
  punctuation boolean not null,
  numbers boolean not null,
  seed bigint,
  quote_id text,
  words jsonb not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid unique references tickets(id) on delete cascade,
  typist_id uuid not null references typists(id) on delete cascade,
  mode text not null,
  length text,
  punctuation boolean not null,
  numbers boolean not null,
  quote_id text,
  words jsonb not null,
  log text,
  duration numeric,
  speed numeric,
  raw numeric,
  accuracy numeric,
  consistency numeric,
  characters json,
  errors_by_key json,
  per_second json,
  verdict text not null,
  reason text,
  finished_at timestamptz not null default now(),
  proof_key text,
  body bytea,
  response_status integer,
  response_body text
);
create index if not exists runs_typist_finished on runs (typist_id, finished_at desc);
create index if not exists runs_board on runs (verdict, mode, length, punctuation, numbers, finished_at);

create table if not exists pending_mail (
  id bigserial primary key,
  recipient text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0
);

create table if not exists fixed_texts (
  target text primary key,
  words jsonb not null,
  quote_id text,
  created_at timestamptz not null default now()
);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}

export async function waitForDatabase(onWait: () => void): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch {
      onWait();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
