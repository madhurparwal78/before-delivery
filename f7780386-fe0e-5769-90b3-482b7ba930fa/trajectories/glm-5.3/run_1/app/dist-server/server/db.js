import { Pool } from 'pg';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { loadConfig } from './config.js';
import { STATIONS, PACKS, SEED_PASSWORD, KITCHEN_NAME, KITCHEN_TIME_ZONE } from '../shared/seed.js';
import { nowEpochMillis, instantInZone, KITCHEN_TZ } from './clock.js';
export const pool = new Pool({ connectionString: loadConfig().databaseUrl, max: 10 });
let dbUp = false;
export function markDbUp() {
    dbUp = true;
}
export function markDbDown() {
    dbUp = false;
}
export function isDbUp() {
    return dbUp;
}
const SCHEMA = `
CREATE TABLE IF NOT EXISTS kitchen (
  id text PRIMARY KEY,
  name text NOT NULL,
  time_zone text NOT NULL
);
CREATE TABLE IF NOT EXISTS stations (
  id text PRIMARY KEY,
  name text NOT NULL,
  hourly_rate_cents integer NOT NULL,
  cleaning_minutes integer NOT NULL
);
CREATE TABLE IF NOT EXISTS packs (
  id text PRIMARY KEY,
  name text NOT NULL,
  minutes integer NOT NULL,
  price_cents integer NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY,
  business_name text NOT NULL,
  contact_email text NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL,
  member_id text REFERENCES members(id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS holds (
  id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id),
  station_id text NOT NULL REFERENCES stations(id),
  date text NOT NULL,
  start_min integer NOT NULL,
  end_min integer NOT NULL,
  tail_end_min integer NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS holds_station_date ON holds (station_id, date);
CREATE TABLE IF NOT EXISTS bookings (
  id text PRIMARY KEY,
  hold_id text NOT NULL REFERENCES holds(id),
  member_id text NOT NULL REFERENCES members(id),
  station_id text NOT NULL REFERENCES stations(id),
  date text NOT NULL,
  start_min integer NOT NULL,
  end_min integer NOT NULL,
  tail_end_min integer NOT NULL,
  status text NOT NULL,
  payment text NOT NULL,
  prepaid_minutes integer NOT NULL,
  overage_minutes integer NOT NULL,
  overage_amount_cents integer NOT NULL,
  list_amount_cents integer NOT NULL,
  fee_amount_cents integer,
  fee_status text,
  free_cancel_until timestamptz NOT NULL,
  confirmed_at timestamptz NOT NULL,
  cancelled_at timestamptz
);
CREATE INDEX IF NOT EXISTS bookings_station_date ON bookings (station_id, date);
CREATE INDEX IF NOT EXISTS bookings_member ON bookings (member_id);
CREATE TABLE IF NOT EXISTS check_ins (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES bookings(id),
  crew_cook_id text NOT NULL REFERENCES users(id),
  at timestamptz NOT NULL,
  card_document_id text NOT NULL,
  UNIQUE (booking_id, crew_cook_id)
);
CREATE TABLE IF NOT EXISTS transactions (
  id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id),
  kind text NOT NULL,
  created_at timestamptz NOT NULL,
  member_minutes integer NOT NULL,
  booking_id text,
  reason text,
  reverses text,
  reversed_by text
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id text PRIMARY KEY,
  transaction_id text NOT NULL REFERENCES transactions(id),
  account text NOT NULL,
  minutes integer NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_entries_account ON ledger_entries (account);
CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id),
  kind text NOT NULL,
  crew_cook_id text,
  expires_on text NOT NULL,
  status text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  uploaded_at timestamptz NOT NULL,
  reviewed_at timestamptz,
  rejection_reason text
);
CREATE TABLE IF NOT EXISTS packets (
  id text PRIMARY KEY,
  "from" text NOT NULL,
  "to" text NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL,
  token text,
  created_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency (
  key text NOT NULL,
  user_id text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  body_hash text NOT NULL,
  status integer NOT NULL,
  response_body jsonb,
  in_progress boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (key, user_id)
);
CREATE TABLE IF NOT EXISTS outbound_billing (
  id text PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS outbound_email (
  id text PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS document_warnings (
  document_id text NOT NULL,
  threshold integer NOT NULL,
  PRIMARY KEY (document_id, threshold)
);
CREATE TABLE IF NOT EXISTS kb_accounts (
  member_id text PRIMARY KEY,
  account_id text NOT NULL
);
`;
export async function applySchemaAndSeed() {
    const client = await pool.connect();
    try {
        await client.query(SCHEMA);
        await seed(client);
        markDbUp();
    }
    finally {
        client.release();
    }
}
async function seed(client) {
    await client.query('INSERT INTO kitchen (id, name, time_zone) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING', ['kitchen', KITCHEN_NAME, KITCHEN_TIME_ZONE]);
    for (const s of STATIONS) {
        await client.query('INSERT INTO stations (id, name, hourly_rate_cents, cleaning_minutes) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING', [s.id, s.name, Math.round(Number(s.hourly_rate) * 100), s.cleaning_minutes]);
    }
    for (const p of PACKS) {
        await client.query('INSERT INTO packs (id, name, minutes, price_cents) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING', [p.id, p.name, p.minutes, Math.round(Number(p.price) * 100)]);
    }
    await client.query(`INSERT INTO members (id, business_name, contact_email) VALUES
      ('mbr-rosa', 'Rosa''s Tamal Cart', 'rosa@tamalcart.test'),
      ('mbr-crumb', 'Northside Crumb Co.', 'owen@crumbco.test'),
      ('mbr-lake', 'Lakefront Meal Prep', 'priya@lakefrontprep.test')
     ON CONFLICT (id) DO NOTHING`);
    const hash = hashPassword(SEED_PASSWORD);
    await client.query(`INSERT INTO users (id, name, email, password_hash, role, member_id) VALUES
      ('usr-ines', 'Ines Albrecht', 'ines@halsted-kitchen.test', $1, 'operator', NULL),
      ('usr-rosa', 'Rosa Delgado', 'rosa@tamalcart.test', $1, 'member', 'mbr-rosa'),
      ('usr-owen', 'Owen Mbeki', 'owen@crumbco.test', $1, 'member', 'mbr-crumb'),
      ('usr-priya', 'Priya Natarajan', 'priya@lakefrontprep.test', $1, 'member', 'mbr-lake'),
      ('usr-tomas', 'Tomás Reyes', 'tomas@tamalcart.test', $1, 'crew_cook', 'mbr-rosa'),
      ('usr-lena', 'Lena Park', 'lena@tamalcart.test', $1, 'crew_cook', 'mbr-rosa'),
      ('usr-abe', 'Abe Lindqvist', 'abe@crumbco.test', $1, 'crew_cook', 'mbr-crumb')
     ON CONFLICT (id) DO NOTHING`, [hash]);
    const now = instantInZone(nowEpochMillis(), KITCHEN_TZ);
    await client.query(`INSERT INTO documents (id, member_id, kind, crew_cook_id, expires_on, status, filename, content_type, size_bytes, uploaded_at, reviewed_at)
     VALUES
      ('doc-rosa-coi', 'mbr-rosa', 'liability_insurance', NULL, '2030-12-31', 'approved', 'rosa-coi.pdf', 'application/pdf', 1024, $1, $1),
      ('doc-crumb-coi', 'mbr-crumb', 'liability_insurance', NULL, '2030-12-31', 'approved', 'crumb-coi.pdf', 'application/pdf', 1024, $1, $1),
      ('doc-lake-coi', 'mbr-lake', 'liability_insurance', NULL, '2026-09-30', 'approved', 'lake-coi.pdf', 'application/pdf', 1024, $1, $1),
      ('doc-tomas-card', 'mbr-rosa', 'food_handler_card', 'usr-tomas', '2030-06-30', 'approved', 'tomas-card.pdf', 'application/pdf', 1024, $1, $1),
      ('doc-lena-card', 'mbr-rosa', 'food_handler_card', 'usr-lena', '2026-08-31', 'approved', 'lena-card.pdf', 'application/pdf', 1024, $1, $1),
      ('doc-abe-card', 'mbr-crumb', 'food_handler_card', 'usr-abe', '2030-06-30', 'approved', 'abe-card.pdf', 'application/pdf', 1024, $1, $1)
     ON CONFLICT (id) DO NOTHING`, [now]);
    await client.query(`INSERT INTO transactions (id, member_id, kind, created_at, member_minutes, reason)
     VALUES ('txn-open-rosa', 'mbr-rosa', 'opening', $1, 360, 'Opening balance'),
            ('txn-open-lake', 'mbr-lake', 'opening', $1, 600, 'Opening balance')
     ON CONFLICT (id) DO NOTHING`, [now]);
    await client.query(`INSERT INTO ledger_entries (id, transaction_id, account, minutes) VALUES
      ('ent-open-rosa-a', 'txn-open-rosa', 'member:mbr-rosa', 360),
      ('ent-open-rosa-b', 'txn-open-rosa', 'kitchen:issued', -360),
      ('ent-open-lake-a', 'txn-open-lake', 'member:mbr-lake', 600),
      ('ent-open-lake-b', 'txn-open-lake', 'kitchen:issued', -600)
     ON CONFLICT (id) DO NOTHING`);
}
// ---------------------------------------------------------------------------
// Passwords: scrypt with a per-user salt.
// ---------------------------------------------------------------------------
export function hashPassword(password) {
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
    return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function verifyPassword(password, stored) {
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt')
        return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const hash = scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
    return hash.length === expected.length && timingSafeEqual(hash, expected);
}
// ---------------------------------------------------------------------------
// Ids and tokens: globally unique for every record the app creates.
// ---------------------------------------------------------------------------
export function newId(prefix) {
    return `${prefix}-${randomBytes(9).toString('base64url')}`;
}
export function newToken() {
    return randomBytes(32).toString('base64url');
}
// ---------------------------------------------------------------------------
// The station-cell collision, decided in exactly one place. Every placement,
// resize and confirmation takes this advisory lock on the station and date,
// then checks live holds and non-cancelled bookings, tails included.
// ---------------------------------------------------------------------------
export async function lockStationDate(client, stationId, date) {
    const key = Buffer.from(`${stationId}|${date}`, 'utf8');
    let h = 0;
    for (const b of key)
        h = (h * 31 + b) | 0;
    await client.query('SELECT pg_advisory_xact_lock($1)', [h]);
}
/** True when no live hold or non-cancelled booking covers any shared cell. */
export async function cellsAreFree(client, stationId, date, startMin, tailEndMin, nowEpoch, excludeHoldId) {
    const holds = await client.query(`SELECT id FROM holds
     WHERE station_id = $1 AND date = $2 AND status = 'live' AND expires_at > $5
       AND start_min < $4 AND tail_end_min > $3
       AND id <> $6`, [stationId, date, startMin, tailEndMin, new Date(nowEpoch), excludeHoldId ?? '']);
    if (holds.rowCount && holds.rowCount > 0)
        return false;
    const bookings = await client.query(`SELECT id FROM bookings
     WHERE station_id = $1 AND date = $2
       AND status IN ('confirmed', 'checked_in', 'completed')
       AND start_min < $4 AND tail_end_min > $3`, [stationId, date, startMin, tailEndMin]);
    return !(bookings.rowCount && bookings.rowCount > 0);
}
