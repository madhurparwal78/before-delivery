import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { config } from "./config.js";
import { errors } from "./errors.js";

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 12,
  connectionTimeoutMillis: 4000,
  idleTimeoutMillis: 10_000,
});

pool.on("error", () => {
  /* a broken idle connection is dropped; the next query opens a fresh one */
});

function isConnectionFailure(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "EHOSTUNREACH" ||
    code === "ECONNRESET" ||
    code === "57P01" ||
    code === "57P03" ||
    code === "08006" ||
    code === "08001" ||
    code === "08003" ||
    code === "3D000" ||
    code === "53300"
  );
}

export function asDatabaseOutage(error: unknown): never {
  if (isConnectionFailure(error)) throw errors.databaseUnavailable();
  throw error;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  try {
    const result = await pool.query<T>(text, values);
    return result.rows;
  } catch (error) {
    return asDatabaseOutage(error);
  }
}

export async function queryOne<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    return asDatabaseOutage(error);
  }
  try {
    await client.query("begin");
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      /* the connection is already gone */
    }
    return asDatabaseOutage(error);
  } finally {
    client.release();
  }
}

/** Every route but health and clock needs the ledger, so each request proves it is there. */
export async function requireLedger(): Promise<void> {
  await query("select 1");
}

export async function databaseReachable(): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}

const SCHEMA = `
create table if not exists client_accounts (
  id uuid primary key,
  business_name text not null,
  currency text,
  killbill_account_id text,
  card_last4 text,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key,
  account_id uuid references client_accounts(id),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id uuid primary key,
  user_id uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists prices (
  id uuid primary key,
  plan text not null,
  currency text not null,
  amount_minor bigint not null,
  effective_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists prices_lookup on prices (plan, currency, effective_at);

create sequence if not exists order_number_seq start 7;

create table if not exists orders (
  id uuid primary key,
  number text not null unique,
  session_id uuid,
  account_id uuid references client_accounts(id),
  plan text not null,
  currency text not null,
  state text not null,
  total_minor bigint not null,
  deposit_minor bigint not null,
  balance_minor bigint not null,
  price_row_id uuid,
  price_effective_at timestamptz,
  accepted_at timestamptz,
  deposit_invoice_id text,
  balance_invoice_id text,
  care_subscription_id text,
  care_bundle_id text,
  care_tier text,
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key,
  order_id uuid not null references orders(id),
  kind text not null,
  amount_minor bigint not null,
  currency text not null,
  killbill_payment_id text not null,
  killbill_invoice_id text,
  captured_at timestamptz not null default now()
);
create unique index if not exists payments_build_kind on payments (order_id, kind)
  where kind in ('deposit', 'balance', 'care');

create table if not exists refunds (
  id uuid primary key,
  payment_id uuid not null references payments(id),
  amount_minor bigint not null,
  reason text not null,
  killbill_transaction_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists account_credits (
  id uuid primary key,
  account_id uuid not null references client_accounts(id),
  amount_minor bigint not null,
  currency text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key,
  order_id uuid not null unique references orders(id),
  account_id uuid not null references client_accounts(id),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists project_assignments (
  project_id uuid not null references projects(id),
  contractor_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  primary key (project_id, contractor_id)
);

create table if not exists files (
  id uuid primary key,
  project_id uuid not null references projects(id),
  kind text not null,
  name text not null,
  content_type text not null,
  size_bytes bigint not null,
  uploaded_by uuid not null references users(id),
  uploaded_at timestamptz not null default now(),
  object_key text not null
);

create table if not exists invites (
  id uuid primary key,
  project_id uuid not null references projects(id),
  account_id uuid not null references client_accounts(id),
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists download_links (
  id uuid primary key,
  token_hash text not null unique,
  user_id uuid not null references users(id),
  file_id uuid references files(id),
  invoice_id text,
  order_id uuid references orders(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists idempotency_records (
  scope text not null,
  key text not null,
  request_hash text not null,
  status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (scope, key)
);

create table if not exists plan_previews (
  id uuid primary key,
  account_id uuid not null references client_accounts(id),
  order_id uuid not null references orders(id),
  from_tier text not null,
  to_tier text not null,
  currency text not null,
  credit_minor bigint not null,
  charge_minor bigint not null,
  total_minor bigint not null,
  days_left integer not null,
  days_in_period integer not null,
  business_date date not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create table if not exists invoice_tasks (
  killbill_invoice_id text primary key,
  account_id uuid not null references client_accounts(id),
  order_id uuid references orders(id),
  kind text not null,
  invoice_number text,
  notice_sent_at timestamptz,
  pdf_stored_at timestamptz,
  discovered_at timestamptz not null default now()
);

create table if not exists dunning_attempts (
  id uuid primary key,
  order_id uuid not null references orders(id),
  killbill_invoice_id text not null,
  attempt_no integer not null,
  due_at timestamptz not null,
  ran_at timestamptz,
  outcome text,
  unique (killbill_invoice_id, attempt_no)
);

create table if not exists mail_queue (
  id uuid primary key,
  dedupe_key text not null unique,
  to_email text not null,
  subject text not null,
  body text not null,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  last_attempt_at timestamptz
);

alter table invoice_tasks add column if not exists invoice_number text;

create table if not exists setup_steps (
  name text primary key,
  completed_at timestamptz not null default now()
);
`;

export async function applySchema(): Promise<void> {
  await query(SCHEMA);
}

/** Runs work while holding a named advisory lock, so one process at a time does it. */
export async function withAdvisoryLock<T>(key: bigint, run: () => Promise<T>): Promise<T | null> {
  const rows = await query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [key.toString()]);
  if (!rows[0]?.locked) return null;
  try {
    return await run();
  } finally {
    await query("select pg_advisory_unlock($1)", [key.toString()]);
  }
}

export function lockKey(text: string): bigint {
  let hash = 0n;
  for (const char of text) {
    hash = (hash * 131n + BigInt(char.codePointAt(0) ?? 0)) % 9_223_372_036_854_775_807n;
  }
  return hash;
}
