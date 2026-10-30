import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

const SCHEMA = `
create table if not exists hours (
  id uuid primary key,
  email text not null unique,
  bedtime text not null,
  time_zone text not null,
  rituals jsonb not null,
  note text not null,
  reminders text not null,
  version integer not null,
  confirmed_at timestamptz not null,
  reminders_start_at timestamptz not null
);
create table if not exists drafts (
  id uuid primary key,
  email text not null,
  bedtime text not null,
  time_zone text not null,
  rituals jsonb not null,
  note text not null,
  created_at timestamptz not null
);
create index if not exists drafts_email_idx on drafts (email);
create table if not exists links (
  token text primary key,
  email text not null,
  kind text not null,
  draft_id uuid references drafts (id) on delete cascade,
  issued_at timestamptz not null,
  sent_at timestamptz,
  used_at timestamptz
);
create index if not exists links_email_idx on links (email);
create table if not exists sessions (
  token text primary key,
  email text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null
);
create index if not exists sessions_email_idx on sessions (email);
create table if not exists share_links (
  email text primary key,
  token text not null unique,
  created_at timestamptz not null
);
create table if not exists idempotency_keys (
  key text primary key,
  request jsonb not null,
  status integer,
  response jsonb,
  created_at timestamptz not null
);
create table if not exists request_counts (
  id bigserial primary key,
  email text not null,
  kind text not null,
  counted_at timestamptz not null
);
create index if not exists request_counts_lookup_idx on request_counts (email, kind, counted_at);
create table if not exists outbox (
  id uuid primary key,
  recipient text not null,
  subject text not null,
  body text not null,
  link_token text,
  created_at timestamptz not null,
  claimed_at timestamptz,
  sent_at timestamptz
);
create index if not exists outbox_pending_idx on outbox (sent_at, claimed_at);
create table if not exists reminder_records (
  hour_id uuid not null references hours (id) on delete cascade,
  night date not null,
  status text not null,
  due_at timestamptz not null,
  created_at timestamptz not null,
  primary key (hour_id, night)
);
create table if not exists app_clock (
  id boolean primary key default true,
  frozen_at timestamptz
);
`;

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 1200,
  idleTimeoutMillis: 30_000,
  query_timeout: 1500,
  statement_timeout: 1500,
  application_name: 'stillhour',
});

pool.on('error', () => {
  // A pooled connection dropped; the next query reconnects or answers unavailable.
});

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);

function isUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code && NETWORK_CODES.has(code)) return true;
  if (code && /^08|^57P0|^53300$/.test(code)) return true;
  return (
    error.message.includes('timeout exceeded when trying to connect') ||
    error.message.includes('Connection terminated') ||
    error.message.includes('terminating connection') ||
    error.message.includes('Client has encountered a connection error') ||
    error.message.includes('Query read timeout')
  );
}

let schemaReady = false;

export class Unavailable extends Error {}

async function connect(): Promise<pg.PoolClient> {
  try {
    return await pool.connect();
  } catch (error) {
    if (isUnavailable(error)) throw new Unavailable();
    throw error;
  }
}

async function run<T extends pg.QueryResultRow>(
  client: pg.PoolClient,
  text: string,
  values: unknown[],
): Promise<pg.QueryResult<T>> {
  try {
    return await client.query<T>(text, values as never[]);
  } catch (error) {
    if (isUnavailable(error)) throw new Unavailable();
    throw error;
  }
}

/** Creates the tables if they are missing, so an empty database works on every serve. */
export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const client = await connect();
  try {
    await run(client, SCHEMA, []);
    schemaReady = true;
  } finally {
    client.release();
  }
}

export async function query<T extends pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  await ensureSchema();
  const client = await connect();
  try {
    return await run<T>(client, text, values);
  } finally {
    client.release();
  }
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  await ensureSchema();
  const client = await connect();
  try {
    await run(client, 'begin', []);
    const result = await work(client);
    await run(client, 'commit', []);
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // The connection is already gone; nothing was committed.
    }
    if (isUnavailable(error)) throw new Unavailable();
    throw error;
  } finally {
    client.release();
  }
}

export async function clientQuery<T extends pg.QueryResultRow>(
  client: pg.PoolClient,
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return run<T>(client, text, values);
}
