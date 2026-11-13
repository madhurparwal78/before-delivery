import pg from 'pg'
import { config } from './config'

pg.types.setTypeParser(1082, (value: string) => value)
pg.types.setTypeParser(20, (value: string) => Number(value))

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24 })
pool.on('error', () => undefined)

export type Db = Pick<pg.PoolClient, 'query'>

export async function rows<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[]
}

export async function one<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(db, sql, params))[0]
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS visitors (id text PRIMARY KEY, lang text NOT NULL DEFAULT 'en', cur text NOT NULL DEFAULT 'EUR');
CREATE TABLE IF NOT EXISTS users (id serial PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL, role text NOT NULL);
CREATE TABLE IF NOT EXISTS manages (user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE, property text NOT NULL, PRIMARY KEY (user_id, property));
CREATE TABLE IF NOT EXISTS sessions (id text PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE, lang text NOT NULL DEFAULT 'en', cur text NOT NULL DEFAULT 'EUR');
CREATE TABLE IF NOT EXISTS destinations (code text PRIMARY KEY, name text NOT NULL, zone text NOT NULL, cx double precision NOT NULL, cy double precision NOT NULL);
CREATE TABLE IF NOT EXISTS properties (
  code text PRIMARY KEY, name text NOT NULL, destination text NOT NULL REFERENCES destinations(code),
  x double precision NOT NULL, y double precision NOT NULL, stars int NOT NULL, amenities text[] NOT NULL DEFAULT '{}',
  policy jsonb NOT NULL DEFAULT '[]', vat_pct int NOT NULL, city_minor int NOT NULL, levy_pct int NOT NULL,
  breakfast_minor int NOT NULL, single_pct int NOT NULL);
CREATE TABLE IF NOT EXISTS room_types (
  code text PRIMARY KEY, property text NOT NULL REFERENCES properties(code), name text NOT NULL, included_adults int NOT NULL,
  max_adults int NOT NULL, max_guests int NOT NULL, extra_adult_minor int NOT NULL, child_minor int NOT NULL,
  rooms int NOT NULL, base_rate_minor int NOT NULL);
CREATE INDEX IF NOT EXISTS room_types_property ON room_types (property);
CREATE TABLE IF NOT EXISTS nights (
  room_type text NOT NULL REFERENCES room_types(code), date date NOT NULL, rate_minor int NOT NULL, allotment int NOT NULL,
  min_stay int NOT NULL, max_stay int NOT NULL, closed_to_arrival boolean NOT NULL, closed_to_departure boolean NOT NULL,
  stop_sell boolean NOT NULL, release_days int NOT NULL, PRIMARY KEY (room_type, date));
CREATE TABLE IF NOT EXISTS seasons (
  id serial PRIMARY KEY, property text NOT NULL, name text NOT NULL, room_types text[] NOT NULL, from_date date NOT NULL,
  to_date date NOT NULL, weekdays int[] NOT NULL);
CREATE INDEX IF NOT EXISTS seasons_property ON seasons (property);
CREATE TABLE IF NOT EXISTS quotes (
  id text PRIMARY KEY, visitor text NOT NULL, user_id int, property text NOT NULL, in_date date NOT NULL, out_date date NOT NULL,
  currency text NOT NULL, tier text NOT NULL, tier_pct int NOT NULL, rates jsonb NOT NULL, rooms jsonb NOT NULL,
  total_minor int NOT NULL, taxable_minor int NOT NULL, expires_at timestamptz NOT NULL, hold_id text,
  created_at timestamptz NOT NULL, stale boolean NOT NULL DEFAULT false, expiry_sent boolean NOT NULL DEFAULT false,
  stale_sent boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS quotes_property ON quotes (property);
CREATE INDEX IF NOT EXISTS quotes_due ON quotes (expires_at) WHERE NOT expiry_sent;
CREATE TABLE IF NOT EXISTS holds (
  id text PRIMARY KEY, quote_id text NOT NULL, visitor text NOT NULL, user_id int, property text NOT NULL,
  expires_at timestamptz NOT NULL, state text NOT NULL, booking_code text, created_at timestamptz NOT NULL,
  expiry_sent boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS holds_due ON holds (expires_at) WHERE state = 'live';
CREATE TABLE IF NOT EXISTS occupancy (
  room_type text NOT NULL, date date NOT NULL, hold_id text, booking_code text, room_n int NOT NULL);
CREATE INDEX IF NOT EXISTS occupancy_night ON occupancy (room_type, date);
CREATE INDEX IF NOT EXISTS occupancy_hold ON occupancy (hold_id) WHERE hold_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS occupancy_booking ON occupancy (booking_code) WHERE booking_code IS NOT NULL;
CREATE TABLE IF NOT EXISTS bookings (
  code text PRIMARY KEY, version int NOT NULL DEFAULT 1, owner_visitor text, owner_user int, property text NOT NULL,
  in_date date NOT NULL, out_date date NOT NULL, given_name text NOT NULL, surname text NOT NULL, card_last4 text NOT NULL,
  currency text NOT NULL, tier text NOT NULL, tier_pct int NOT NULL, rates jsonb NOT NULL, hold_id text,
  created_at timestamptz NOT NULL, completes_at timestamptz NOT NULL, ledger_seq int NOT NULL DEFAULT 0,
  invoice_seq int NOT NULL DEFAULT -1, review_token text NOT NULL UNIQUE, completion_sent boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS bookings_property ON bookings (property);
CREATE INDEX IF NOT EXISTS bookings_owner_user ON bookings (owner_user);
CREATE INDEX IF NOT EXISTS bookings_owner_visitor ON bookings (owner_visitor);
CREATE TABLE IF NOT EXISTS booking_rooms (
  booking text NOT NULL REFERENCES bookings(code) ON DELETE CASCADE, n int NOT NULL, room_type text NOT NULL, plan text NOT NULL,
  breakfast boolean NOT NULL, adults int NOT NULL, ages int[] NOT NULL DEFAULT '{}', state text NOT NULL, nights jsonb NOT NULL,
  total_minor int NOT NULL, paid_minor int NOT NULL DEFAULT 0, refunded_minor int NOT NULL DEFAULT 0, PRIMARY KEY (booking, n));
CREATE TABLE IF NOT EXISTS booking_access (booking text NOT NULL, visitor text NOT NULL, PRIMARY KEY (booking, visitor));
CREATE TABLE IF NOT EXISTS ledger (
  id serial PRIMARY KEY, booking text NOT NULL REFERENCES bookings(code) ON DELETE CASCADE, pair int NOT NULL, kind text NOT NULL,
  account text NOT NULL, debit_minor int NOT NULL, credit_minor int NOT NULL, at timestamptz NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_pair ON ledger (booking, pair, account);
CREATE TABLE IF NOT EXISTS cancellations (
  id serial PRIMARY KEY, booking text NOT NULL REFERENCES bookings(code) ON DELETE CASCADE, property text NOT NULL,
  retained_minor int NOT NULL, at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS cancellations_property ON cancellations (property);
CREATE TABLE IF NOT EXISTS idempotency (
  scope text NOT NULL, key text NOT NULL, body_hash text NOT NULL, status int NOT NULL, body jsonb NOT NULL,
  at timestamptz NOT NULL, PRIMARY KEY (scope, key));
CREATE TABLE IF NOT EXISTS reviews (
  id text PRIMARY KEY, seq serial, property text NOT NULL, booking text UNIQUE, guest_user int, scores int[] NOT NULL,
  comment text NOT NULL, created_at timestamptz NOT NULL, state text NOT NULL);
CREATE INDEX IF NOT EXISTS reviews_property ON reviews (property, state);
CREATE TABLE IF NOT EXISTS inbox (
  id serial PRIMARY KEY, visitor text, user_id int, at timestamptz NOT NULL, kind text NOT NULL, property text NOT NULL, link text NOT NULL);
CREATE INDEX IF NOT EXISTS inbox_owner ON inbox (user_id, visitor);
`

export async function applySchema(): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock(727301)')
    await client.query(SCHEMA)
  } finally {
    await client.query('SELECT pg_advisory_unlock(727301)').catch(() => undefined)
    client.release()
  }
}

export async function withSeedLock<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock(727302)')
    return await fn(client)
  } finally {
    await client.query('SELECT pg_advisory_unlock(727302)').catch(() => undefined)
    client.release()
  }
}

export async function reachable(): Promise<boolean> {
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  }
}
