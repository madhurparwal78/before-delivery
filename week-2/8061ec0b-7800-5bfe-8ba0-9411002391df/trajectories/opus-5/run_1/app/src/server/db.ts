import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config';

const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value) => value);

export const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

export type Sql = {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
};

export async function query<R extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<R[]> {
  const result = await pool.query<R>(text, values);
  return result.rows;
}

/** Runs a function inside one Postgres transaction. */
export async function tx<T>(fn: (sql: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const value = await fn(client);
    await client.query('commit');
    return value;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      /* the connection is being discarded anyway */
    }
    throw error;
  } finally {
    client.release();
  }
}

function lockKey(name: string): string {
  let hash = 0n;
  for (const char of name) hash = (hash * 131n + BigInt(char.codePointAt(0) ?? 0)) % 9223372036854775783n;
  return (hash - 4611686018427387904n).toString();
}

/**
 * Holds a Postgres advisory lock for the length of fn, so actions on one contract
 * are taken strictly one at a time across every instance sharing the database.
 */
export async function withAdvisoryLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const key = lockKey(name);
  try {
    await client.query('select pg_advisory_lock($1::bigint)', [key]);
    return await fn();
  } finally {
    try {
      await client.query('select pg_advisory_unlock($1::bigint)', [key]);
    } finally {
      client.release();
    }
  }
}

const SCHEMA = `
create table if not exists meta (
  key text primary key,
  value text not null
);

create table if not exists families (
  id text primary key,
  parent_name text not null,
  email text not null,
  phone text not null,
  address text not null,
  seed_order int not null default 0
);

create table if not exists schools (
  id text primary key,
  name text not null,
  delivery_weekday int not null,
  seed_order int not null default 0
);

create table if not exists users (
  id text primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null,
  family_id text references families(id),
  school_id text references schools(id)
);

create table if not exists students (
  id text primary key,
  name text not null,
  grade int not null,
  school_id text not null references schools(id),
  family_id text not null references families(id),
  created_at timestamptz not null default now()
);

create table if not exists instruments (
  serial text primary key,
  instrument_type text not null,
  size text not null,
  model text not null,
  status text not null
);

create table if not exists price_lists (
  id text primary key,
  effective_date date not null,
  created_at timestamptz not null,
  withdrawn_at timestamptz,
  tax_rate_bp int not null,
  items jsonb not null,
  tiers jsonb not null,
  seq bigserial
);

create sequence if not exists contract_id_seq start with 1004 increment by 1;

create table if not exists contracts (
  id text primary key,
  status text not null,
  student_id text not null references students(id),
  serial text not null references instruments(serial),
  waiver boolean not null,
  price_list_id text not null references price_lists(id),
  bound boolean not null,
  delivery_date date,
  hold_expires_at timestamptz,
  signed_at timestamptz,
  activated_at timestamptz,
  closed_at timestamptz,
  billing_anchor_date date,
  predecessor_id text,
  successor_id text,
  subscription_state text,
  agreement_stored boolean not null default false,
  bill_of_sale_stored boolean not null default false,
  kb_account_id text,
  kb_subscription_id text,
  created_at timestamptz not null,
  seq bigserial
);

create index if not exists contracts_student_idx on contracts(student_id);
create index if not exists contracts_serial_idx on contracts(serial);

create table if not exists contract_history (
  id bigserial primary key,
  contract_id text not null references contracts(id),
  from_status text,
  to_status text not null,
  at timestamptz not null,
  actor text not null,
  actor_name text
);

create index if not exists contract_history_contract_idx on contract_history(contract_id);

create table if not exists signing_links (
  token text primary key,
  contract_id text not null references contracts(id),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null,
  seq bigserial
);

create index if not exists signing_links_contract_idx on signing_links(contract_id);

create table if not exists equity_entries (
  id text primary key,
  contract_id text not null references contracts(id),
  kind text not null,
  amount_cents bigint not null,
  transfer_id text,
  payment_id text,
  created_at timestamptz not null,
  seq bigserial
);

create index if not exists equity_entries_contract_idx on equity_entries(contract_id);

create table if not exists payments (
  id text primary key,
  contract_id text not null references contracts(id),
  amount_cents int not null,
  base_rent_cents int not null,
  waiver_cents int not null,
  tax_cents int not null,
  killbill_payment_id text not null,
  kb_payment_external_key text not null,
  reversed boolean not null default false,
  created_at timestamptz not null,
  seq bigserial
);

create index if not exists payments_contract_idx on payments(contract_id);

create table if not exists reversals (
  id text primary key,
  payment_id text not null references payments(id),
  contract_id text not null references contracts(id),
  reason text not null,
  amount_cents int not null,
  base_rent_cents int not null,
  waiver_cents int not null,
  tax_cents int not null,
  killbill_refund_id text not null,
  created_at timestamptz not null
);

create table if not exists condition_events (
  id text primary key,
  contract_id text not null references contracts(id),
  kind text not null,
  notes text,
  recorded_by text not null,
  created_at timestamptz not null
);

create table if not exists condition_photos (
  id text primary key,
  event_id text not null references condition_events(id),
  contract_id text not null references contracts(id),
  position int not null
);

create table if not exists idempotency_keys (
  contract_id text not null,
  endpoint text not null,
  key text not null,
  request_hash text not null,
  state text not null,
  status int,
  body text,
  created_at timestamptz not null,
  primary key (contract_id, endpoint, key)
);

create table if not exists outbox (
  id bigserial primary key,
  dedupe_key text not null unique,
  recipient text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null,
  sent_at timestamptz
);

create table if not exists sessions (
  token text primary key,
  user_id text not null references users(id),
  created_at timestamptz not null
);
`;

export async function ensureSchema(): Promise<void> {
  await withAdvisoryLock('bellroll-schema', async () => {
    await query(SCHEMA);
    const { seedDatabase } = await import('./seed');
    await seedDatabase();
  });
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await query('select 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
