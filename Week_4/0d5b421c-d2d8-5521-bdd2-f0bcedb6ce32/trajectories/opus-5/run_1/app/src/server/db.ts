import { randomBytes, scryptSync } from 'node:crypto';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { config } from './config';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});

export type Db = Pool | PoolClient;

export async function query<R extends QueryResultRow>(
  db: Db,
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<QueryResult<R>> {
  return db.query<R>(sql, params as unknown[]);
}

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function waitForPostgres(timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(
          `Postgres did not answer within ${timeoutMs} ms: ${(error as Error).message}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

const SCHEMA = `
create extension if not exists btree_gist;

create table if not exists rooms (
  room_id text primary key,
  name text not null,
  position integer not null
);

create table if not exists restaurant_tables (
  table_id text primary key,
  room_id text not null references rooms(room_id),
  min_seats integer not null,
  max_seats integer not null,
  position integer not null
);

create table if not exists joinable_pairs (
  pair_id text primary key,
  room_id text not null references rooms(room_id),
  table_a text not null references restaurant_tables(table_id),
  table_b text not null references restaurant_tables(table_id),
  min_seats integer not null,
  max_seats integer not null,
  position integer not null
);

create table if not exists host_accounts (
  email text primary key,
  name text not null,
  password_hash text not null
);

create table if not exists host_sessions (
  token text primary key,
  email text not null references host_accounts(email),
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create table if not exists app_clock (
  id integer primary key,
  offset_ms bigint not null,
  updated_at timestamptz not null,
  constraint app_clock_single_row check (id = 1)
);

create table if not exists holds (
  hold_id text primary key,
  date date not null,
  time text not null,
  starts_at timestamptz not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  party_size integer not null,
  unit_id text not null,
  pair_id text references joinable_pairs(pair_id),
  deposit_cents integer not null,
  status text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  reserved_reference text
);
create index if not exists holds_live on holds(status, expires_at);
create index if not exists holds_date on holds(date);

create table if not exists hold_tables (
  hold_id text not null references holds(hold_id) on delete cascade,
  table_id text not null references restaurant_tables(table_id),
  primary key (hold_id, table_id)
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  seq bigserial not null,
  reference text not null unique,
  status text not null,
  source text not null,
  date date not null,
  time text not null,
  starts_at timestamptz not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  party_size integer not null,
  unit_id text not null,
  pair_id text references joinable_pairs(pair_id),
  room_id text not null references rooms(room_id),
  name text not null,
  email text,
  phone text,
  deposit_cents integer not null,
  deposit_state text not null,
  manage_token text unique,
  killbill_payment_id text,
  killbill_transaction_id text,
  killbill_refund_id text,
  created_at timestamptz not null
);
create index if not exists bookings_date on bookings(date);

create table if not exists booking_tables (
  booking_id uuid not null references bookings(id) on delete cascade,
  table_id text not null references restaurant_tables(table_id),
  during tstzrange not null,
  active boolean not null default true,
  primary key (booking_id, table_id),
  exclude using gist (table_id with =, during with &&) where (active)
);

create table if not exists waitlist_entries (
  entry_id text primary key,
  seq bigserial not null,
  date date not null,
  email text not null,
  email_lower text not null,
  name text not null,
  party_size integer not null,
  earliest text not null,
  latest text not null,
  status text not null,
  created_at timestamptz not null
);
create unique index if not exists waitlist_live_email_per_date
  on waitlist_entries(date, email_lower)
  where status in ('waiting', 'offered');

create table if not exists offers (
  offer_id text primary key,
  entry_id text not null references waitlist_entries(entry_id),
  token text not null unique,
  date date not null,
  time text not null,
  starts_at timestamptz not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  party_size integer not null,
  unit_id text not null,
  pair_id text references joinable_pairs(pair_id),
  deposit_cents integer not null,
  status text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  reserved_reference text
);
create index if not exists offers_live on offers(status, expires_at);

create table if not exists offer_tables (
  offer_id text not null references offers(offer_id) on delete cascade,
  table_id text not null references restaurant_tables(table_id),
  primary key (offer_id, table_id)
);

create table if not exists idempotency_records (
  key text primary key,
  method text not null,
  path text not null,
  body jsonb not null,
  status integer,
  response jsonb,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists outbound_emails (
  id bigserial primary key,
  dedupe_key text not null unique,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists outbound_emails_pending on outbound_emails(next_attempt_at)
  where status = 'queued';

create table if not exists freed_tables (
  id bigserial primary key,
  date date not null,
  table_id text not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists freed_tables_pending on freed_tables(id) where processed_at is null;

`;

interface SeedRoom {
  roomId: string;
  name: string;
  tables: { tableId: string; min: number; max: number }[];
}

export const SEED_ROOMS: SeedRoom[] = [
  {
    roomId: 'window-row',
    name: 'Window Row',
    tables: [
      { tableId: 'T1', min: 1, max: 2 },
      { tableId: 'T2', min: 1, max: 2 },
      { tableId: 'T3', min: 1, max: 2 },
      { tableId: 'T4', min: 2, max: 4 },
    ],
  },
  {
    roomId: 'hearth',
    name: 'Hearth',
    tables: [
      { tableId: 'T5', min: 2, max: 4 },
      { tableId: 'T6', min: 2, max: 4 },
      { tableId: 'T7', min: 3, max: 4 },
      { tableId: 'T8', min: 3, max: 4 },
    ],
  },
  {
    roomId: 'slate-room',
    name: 'Slate Room',
    tables: [
      { tableId: 'T9', min: 4, max: 6 },
      { tableId: 'T10', min: 5, max: 6 },
      { tableId: 'T11', min: 2, max: 4 },
      { tableId: 'T12', min: 2, max: 4 },
    ],
  },
  {
    roomId: 'bar-rail',
    name: 'Bar Rail',
    tables: [
      { tableId: 'T13', min: 1, max: 2 },
      { tableId: 'T14', min: 1, max: 2 },
    ],
  },
  {
    roomId: 'courtyard',
    name: 'Courtyard',
    tables: [
      { tableId: 'T15', min: 2, max: 4 },
      { tableId: 'T16', min: 2, max: 4 },
    ],
  },
  {
    roomId: 'chefs-counter',
    name: "Chef's Counter",
    tables: [
      { tableId: 'C1', min: 1, max: 2 },
      { tableId: 'C2', min: 1, max: 2 },
      { tableId: 'C3', min: 1, max: 2 },
    ],
  },
];

export const SEED_PAIRS = [
  { pairId: 'T7+T8', roomId: 'hearth', a: 'T7', b: 'T8', min: 7, max: 8 },
  {
    pairId: 'T11+T12',
    roomId: 'slate-room',
    a: 'T11',
    b: 'T12',
    min: 7,
    max: 8,
  },
];

const SEED_HOST = {
  email: 'host@saffronslate.example',
  name: 'Inês Duarte',
  password: 'Hearth-and-Slate-2026',
};

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, digest] = stored.split('$');
  if (scheme !== 'scrypt' || salt === undefined || digest === undefined) return false;
  return scryptSync(password, salt, 64).toString('hex') === digest;
}

export async function migrateAndSeed(): Promise<void> {
  await pool.query(SCHEMA);
  await withTransaction(async (client) => {
    let tablePosition = 0;
    for (const [roomIndex, room] of SEED_ROOMS.entries()) {
      await client.query(
        `insert into rooms(room_id, name, position) values ($1, $2, $3)
         on conflict (room_id) do update set name = excluded.name, position = excluded.position`,
        [room.roomId, room.name, roomIndex],
      );
      for (const table of room.tables) {
        tablePosition += 1;
        await client.query(
          `insert into restaurant_tables(table_id, room_id, min_seats, max_seats, position)
           values ($1, $2, $3, $4, $5)
           on conflict (table_id) do update set room_id = excluded.room_id,
             min_seats = excluded.min_seats, max_seats = excluded.max_seats,
             position = excluded.position`,
          [table.tableId, room.roomId, table.min, table.max, tablePosition],
        );
      }
    }
    for (const [index, pair] of SEED_PAIRS.entries()) {
      await client.query(
        `insert into joinable_pairs(pair_id, room_id, table_a, table_b, min_seats, max_seats, position)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (pair_id) do update set room_id = excluded.room_id,
           table_a = excluded.table_a, table_b = excluded.table_b,
           min_seats = excluded.min_seats, max_seats = excluded.max_seats,
           position = excluded.position`,
        [pair.pairId, pair.roomId, pair.a, pair.b, pair.min, pair.max, index],
      );
    }
    await client.query(
      `insert into host_accounts(email, name, password_hash) values ($1, $2, $3)
       on conflict (email) do nothing`,
      [SEED_HOST.email, SEED_HOST.name, hashPassword(SEED_HOST.password)],
    );
    await client.query(
      `insert into app_clock(id, offset_ms, updated_at) values (1, 0, now())
       on conflict (id) do nothing`,
    );
  });
}
