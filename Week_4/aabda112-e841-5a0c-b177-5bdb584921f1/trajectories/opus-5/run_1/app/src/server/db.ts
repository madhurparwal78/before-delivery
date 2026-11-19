import { Pool, type PoolClient } from 'pg';
import { config } from './config';
import { AppError } from './errors';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 4_000,
});

pool.on('error', () => {
  /* a dropped idle connection is replaced on the next request */
});

let databaseReady = false;

export function isDatabaseReady(): boolean {
  return databaseReady;
}

export function markDatabaseReady(ready: boolean): void {
  databaseReady = ready;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const result = await pool.query(text, params as never[]);
    return result.rows as T[];
  } catch (error) {
    throw asDatabaseError(error);
  }
}

export async function one<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function transaction<T>(run: (client: Tx) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw asDatabaseError(error);
  }
  const tx: Tx = {
    query: async <R>(text: string, params: unknown[] = []) => {
      try {
        const result = await client.query(text, params as never[]);
        return result.rows as R[];
      } catch (error) {
        throw asDatabaseError(error);
      }
    },
    one: async <R>(text: string, params: unknown[] = []) => {
      const rows = await tx.query<R>(text, params);
      return rows[0] ?? null;
    },
  };
  try {
    await client.query('begin');
    const value = await run(tx);
    await client.query('commit');
    return value;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      /* the connection is being released anyway */
    }
    throw error instanceof AppError ? error : asDatabaseError(error);
  } finally {
    client.release();
  }
}

export type Tx = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | null>;
};

const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ECONNRESET',
  '57P01',
  '57P03',
  '08006',
  '08003',
  '08001',
  '53300',
]);

function asDatabaseError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const code = (error as { code?: string } | null)?.code;
  const message = (error as { message?: string } | null)?.message ?? '';
  if ((code && CONNECTION_CODES.has(code)) || /timeout|terminat/i.test(message)) {
    databaseReady = false;
    return new AppError('database_unavailable');
  }
  return error;
}

const SCHEMA = `
create table if not exists server_clock (
  id int primary key,
  base_ms bigint,
  set_at_ms bigint not null
);
create table if not exists clinics (
  id text primary key,
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);
create table if not exists clinic_counters (
  clinic_id text primary key references clinics(id),
  next_invoice int not null default 1
);
create table if not exists users (
  id text primary key,
  clinic_id text not null references clinics(id),
  name text not null,
  email text not null,
  role text not null,
  password_hash text,
  status text not null default 'Active',
  created_at timestamptz not null default now()
);
create index if not exists users_email_idx on users (lower(email));
create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id),
  created_at timestamptz not null default now()
);
create table if not exists login_tokens (
  token text primary key,
  user_id text not null references users(id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists invitations (
  token text primary key,
  user_id text not null references users(id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists rooms (
  id text primary key,
  clinic_id text not null references clinics(id),
  name text not null,
  sort int not null default 0
);
create table if not exists clients (
  id text primary key,
  clinic_id text not null references clinics(id),
  name text not null,
  email text not null
);
create table if not exists patients (
  id text primary key,
  clinic_id text not null references clinics(id),
  client_id text not null references clients(id),
  name text not null,
  species text not null,
  weight_grams int,
  photo_file_id text,
  created_at timestamptz not null default now()
);
create table if not exists patient_weights (
  id text primary key,
  patient_id text not null references patients(id),
  recorded_on date not null,
  grams int not null
);
create table if not exists vaccinations (
  id text primary key,
  patient_id text not null references patients(id),
  vaccine text not null,
  due_date date not null,
  reminder_status text not null default 'Scheduled',
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists appointments (
  id text primary key,
  clinic_id text not null references clinics(id),
  patient_id text not null references patients(id),
  vet_id text not null references users(id),
  room_id text not null references rooms(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text not null,
  status text not null,
  checked_in_at timestamptz,
  checked_in_late_minutes int,
  previous_status text,
  cancelled_at timestamptz,
  seq bigserial
);
create index if not exists appointments_clinic_start_idx on appointments (clinic_id, start_at);
create table if not exists note_paragraphs (
  id text primary key,
  appointment_id text not null references appointments(id),
  n int not null,
  text text not null default '',
  version int not null default 1,
  edited_by text,
  unique (appointment_id, n)
);
create table if not exists note_operations (
  id bigserial primary key,
  appointment_id text not null,
  n int not null,
  text text not null,
  version int not null,
  by_user text,
  at timestamptz not null default now()
);
create table if not exists admissions (
  id text primary key,
  clinic_id text not null references clinics(id),
  patient_id text not null references patients(id),
  kennel text not null,
  created_at timestamptz not null default now()
);
create table if not exists treatment_schedules (
  id text primary key,
  admission_id text not null references admissions(id),
  name text not null,
  first_at timestamptz not null,
  interval_hours int not null,
  dose_count int not null
);
create table if not exists treatment_doses (
  id text primary key,
  schedule_id text not null references treatment_schedules(id),
  dose_index int not null,
  scheduled_at timestamptz not null,
  status text not null default 'open',
  given_at timestamptz,
  given_by text,
  skip_reason text,
  closed_at timestamptz,
  overdue_announced boolean not null default false
);
create index if not exists treatment_doses_schedule_idx on treatment_doses (schedule_id);
create table if not exists treatment_notes (
  id text primary key,
  dose_id text not null references treatment_doses(id),
  text text not null,
  author_id text,
  created_at timestamptz not null default now()
);
create table if not exists stock_items (
  id text primary key,
  clinic_id text not null references clinics(id),
  name text not null,
  reorder_point int not null default 0,
  unit_price_pence int not null default 0,
  low_alerted boolean not null default false,
  sort bigserial
);
create table if not exists stock_batches (
  id text primary key,
  item_id text not null references stock_items(id),
  batch text not null,
  expires_on date not null,
  received_seq bigserial,
  unique (item_id, batch)
);
create table if not exists stock_movements (
  id text primary key,
  item_id text not null references stock_items(id),
  batch_id text not null references stock_batches(id),
  delta int not null,
  reason text not null,
  invoice_line_id text,
  paired_movement_id text,
  balance_after int not null,
  by_user text,
  at timestamptz not null,
  seq bigserial
);
create index if not exists stock_movements_item_idx on stock_movements (item_id, seq);
create table if not exists invoices (
  id text primary key,
  clinic_id text not null references clinics(id),
  number text not null,
  patient_id text not null references patients(id),
  appointment_id text,
  status text not null default 'draft',
  discount_percent int not null default 0,
  voided_by text,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now()
);
create table if not exists invoice_lines (
  id text primary key,
  invoice_id text not null references invoices(id),
  stock_item_id text not null references stock_items(id),
  description text not null,
  quantity int not null,
  unit_price_pence int not null,
  seq bigserial
);
create table if not exists payments (
  id text primary key,
  invoice_id text not null references invoices(id),
  pence int not null,
  at timestamptz not null,
  taken_by text not null
);
create table if not exists idempotency_records (
  clinic_id text not null,
  key text not null,
  method text not null,
  path text not null,
  body_hash text not null,
  status int not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (clinic_id, key)
);
create table if not exists files (
  id text primary key,
  clinic_id text not null references clinics(id),
  patient_id text not null references patients(id),
  appointment_id text,
  name text not null,
  kind text not null,
  content_type text not null,
  size_bytes int not null,
  sha256 text not null,
  object_key text not null,
  created_at timestamptz not null default now(),
  seq bigserial
);
create table if not exists public_bookings (
  code text primary key,
  clinic_id text not null references clinics(id),
  appointment_id text not null references appointments(id)
);
create table if not exists pet_tokens (
  token text primary key,
  clinic_id text not null references clinics(id),
  patient_id text not null references patients(id),
  due_date date not null,
  created_at timestamptz not null default now()
);
create table if not exists booking_attempts (
  id bigserial primary key,
  ip text not null,
  at timestamptz not null
);
create index if not exists booking_attempts_idx on booking_attempts (ip, at);
create table if not exists mail_queue (
  id text primary key,
  to_address text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending',
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create table if not exists reminder_sends (
  vaccination_id text primary key references vaccinations(id),
  sent_at timestamptz not null
);
`;

export async function createSchema(): Promise<void> {
  await query(SCHEMA);
  await query(
    `insert into server_clock (id, base_ms, set_at_ms) values (1, null, $1)
     on conflict (id) do nothing`,
    [Date.now()],
  );
  databaseReady = true;
}

/** Runs work while holding a Postgres advisory lock, so two processes never both seed. */
export async function withAdvisoryLock<T>(key: number, run: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [key]);
    return await run();
  } finally {
    await client.query('select pg_advisory_unlock($1)', [key]).catch(() => undefined);
    client.release();
  }
}

export function newId(): string {
  return crypto.randomUUID();
}
