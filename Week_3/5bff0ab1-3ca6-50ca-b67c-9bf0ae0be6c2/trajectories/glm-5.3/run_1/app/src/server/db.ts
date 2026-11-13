// Postgres is the source of truth: riders, sessions, price steps, road-tax steps,
// closed days, on-hand counts, price locks, ride slots, delivery days, wait lines,
// the app clock, the sequence counter, staleness, the sheet bytes and notice sends.
import { Pool, PoolClient } from "pg";
import { config } from "./config";
import {
  CHAPTERS,
  EARLIER_SALES,
  
  HUBS,
  MODELS,
  ON_HAND,
  SEED_HOSTS,
  SEED_RIDES,
  SEED_RIDERS} from "./seed";
import { seedClockMs } from "./clock";

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000});

// A boot-time marker so a provider down at boot never stops the server.
let dbReady = false;

export function isDbReady(): boolean {
  return dbReady;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_state (
  key text PRIMARY KEY,
  value text NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  role text NOT NULL,
  name text NOT NULL,
  mobile text NOT NULL UNIQUE,
  password_hash text,
  hub text,
  licence_number text,
  licence_valid_until date,
  reminders_on boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at_ms bigint NOT NULL,
  ended boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS on_hand (
  hub text NOT NULL,
  model text NOT NULL,
  finish text NOT NULL,
  on_hand integer NOT NULL,
  PRIMARY KEY (hub, model, finish)
);
CREATE TABLE IF NOT EXISTS hub_state (
  hub text PRIMARY KEY,
  seq bigint NOT NULL DEFAULT 1,
  counting boolean NOT NULL DEFAULT false,
  stock_as_of_ms bigint NOT NULL,
  stale_reason text,
  stale_since_ms bigint
);
CREATE TABLE IF NOT EXISTS locks (
  id text PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  rider_id text NOT NULL REFERENCES users(id),
  hub text NOT NULL,
  model text NOT NULL,
  finish text NOT NULL,
  state text NOT NULL,
  issued_at_ms bigint NOT NULL,
  expires_at_ms bigint,
  step_effective_from date NOT NULL,
  ex_showroom_paise bigint NOT NULL,
  road_tax_paise bigint NOT NULL,
  insurance_paise bigint NOT NULL,
  on_road_paise bigint NOT NULL,
  delivery_date date,
  waiting_for date,
  wait_position integer,
  joined_line_ms bigint,
  sheet_ready boolean NOT NULL DEFAULT false,
  sheet_rendering boolean NOT NULL DEFAULT false,
  sheet_pdf bytea,
  sheet_kind text
);
CREATE INDEX IF NOT EXISTS locks_rider ON locks(rider_id);
ALTER TABLE locks ADD COLUMN IF NOT EXISTS sheet_rendering boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS rides (
  id text PRIMARY KEY,
  rider_id text NOT NULL REFERENCES users(id),
  hub text NOT NULL,
  model text NOT NULL,
  starts_at_ms bigint NOT NULL,
  state text NOT NULL,
  moved_from_ms bigint,
  licence_last4 text,
  created_at_ms bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS rides_rider ON rides(rider_id);
CREATE TABLE IF NOT EXISTS notices (
  id text PRIMARY KEY,
  rider_id text NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  state text NOT NULL,
  due_at_ms bigint NOT NULL,
  sent_at_ms bigint,
  lock_id text,
  ride_id text,
  topic text,
  dedupe_key text UNIQUE
);
CREATE TABLE IF NOT EXISTS ledger_watch (
  key text PRIMARY KEY,
  updated_ms bigint NOT NULL
);
`;

// Applied idempotently each time a server copy starts; starting a copy resets nothing.
export async function applySchema(): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query(SCHEMA);
    await seedRows(c);
    dbReady = true;
  } finally {
    c.release();
  }
}

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  return timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
}

export function newId(prefix: string): string {
  return `${prefix}_${cryptoRandom()}`;
}

export function newRef(): string {
  // a unique reference of letters, digits and hyphens, created once per lock
  return `ref-${cryptoRandom(20)}`;
}

function cryptoRandom(len = 16): string {
  return randomBytes(len).toString("hex");
}

async function seedRows(c: PoolClient): Promise<void> {
  // app clock: seed only when absent
  const clockRow = await c.query(`SELECT value FROM app_state WHERE key = 'clock_bias_ms'`);
  if (clockRow.rowCount === 0) {
    await c.query(`INSERT INTO app_state (key, value) VALUES ('clock_bias_ms', $1)`, [
      String(seedClockMs() - Date.now()),
    ]);
  }

  // catalogue rows are static seed data; upsert keeps them true
  for (const m of MODELS) {
    for (const step of m.steps) {
      await c.query(
        `INSERT INTO app_state (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING`,
        [`model-step:${m.id}:${step.effectiveFrom}`, String(step.exFactoryPaise)]
      );
    }
  }
  for (const h of HUBS) {
    for (const step of h.roadTaxSteps) {
      await c.query(
        `INSERT INTO app_state (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING`,
        [`tax-step:${h.id}:${step.effectiveFrom}`, String(step.percent)]
      );
    }
  }

  // hub state
  for (const h of HUBS) {
    await c.query(
      `INSERT INTO hub_state (hub, seq, counting, stock_as_of_ms, stale_reason, stale_since_ms)
       VALUES ($1, 1, false, $2::bigint, NULL, NULL)
       ON CONFLICT (hub) DO NOTHING`,
      [h.id, String(seedClockMs())]
    );
  }

  // baseline on-hand
  for (const hub of Object.keys(ON_HAND)) {
    for (const [modelFinish, count] of Object.entries(ON_HAND[hub])) {
      const [model, finish] = modelFinish.split(":");
      await c.query(
        `INSERT INTO on_hand (hub, model, finish, on_hand) VALUES ($1, $2, $3, $4)
         ON CONFLICT (hub, model, finish) DO NOTHING`,
        [hub, model, finish, count]
      );
    }
  }

  // people. When a seed password variable is unset, the seeded people of that role
  // exist but cannot sign in.
  for (const host of SEED_HOSTS) {
    await c.query(
      `INSERT INTO users (id, role, name, mobile, password_hash, hub)
       VALUES ($1, 'hub_host', $2, $3, $4, $5)
       ON CONFLICT (mobile) DO NOTHING`,
      [`host_${host.mobile}`, host.name, host.mobile, config.seedHostPassword ? hashPassword(config.seedHostPassword) : null, host.hub]
    );
  }
  for (const rider of SEED_RIDERS) {
    await c.query(
      `INSERT INTO users (id, role, name, mobile, password_hash, licence_number, licence_valid_until, reminders_on)
       VALUES ($1, 'rider', $2, $3, $4, $5, $6, false)
       ON CONFLICT (mobile) DO NOTHING`,
      [
        `rider_${rider.mobile}`,
        rider.name,
        rider.mobile,
        config.seedRiderPassword ? hashPassword(config.seedRiderPassword) : null,
        rider.licenceNumber,
        rider.licenceValidUntil,
      ]
    );
  }

  // seeded rides
  for (const r of SEED_RIDES) {
    const riderId = `rider_${r.riderMobile}`;
    const id = `ride_seed_${r.riderMobile}`;
    const licence = SEED_RIDERS.find((x) => x.mobile === r.riderMobile)?.licenceNumber ?? null;
    await c.query(
      `INSERT INTO rides (id, rider_id, hub, model, starts_at_ms, state, moved_from_ms, licence_last4, created_at_ms)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [id, riderId, r.hub, r.model, r.startsAtMs, r.state, licence ? licence.slice(-4) : null, seedClockMs()]
    );
  }

  // seeded earlier sales marker rows (the ledger holds the members themselves)
  for (const sale of EARLIER_SALES) {
    await c.query(
      `INSERT INTO app_state (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      [`earlier-sales:${sale.hub}:${sale.date}`, String(sale.count)]
    );
  }

  // chapters marker (unused but keeps the seed honest)
  for (const ch of CHAPTERS) {
    await c.query(`INSERT INTO app_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [
      `chapters:${ch.id}`,
      String(ch.parts.length),
    ]);
  }
}

export interface UserRow {
  id: string;
  role: "rider" | "hub_host";
  name: string;
  mobile: string;
  hub: string | null;
  licence_number: string | null;
  licence_valid_until: string | null;
  reminders_on: boolean;
}

export interface LockRow {
  id: string;
  ref: string;
  rider_id: string;
  hub: string;
  model: string;
  finish: string;
  state: string;
  issued_at_ms: number;
  expires_at_ms: number | null;
  step_effective_from: string;
  ex_showroom_paise: number;
  road_tax_paise: number;
  insurance_paise: number;
  on_road_paise: number;
  delivery_date: string | null;
  waiting_for: string | null;
  wait_position: number | null;
  joined_line_ms: number | null;
  sheet_ready: boolean;
}

// Postgres returns bigint columns as strings and date columns as Date objects;
// normalise once at the row boundary.
function dateToStr(v: unknown): string {
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  return String(v).slice(0, 10);
}

function dateOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return dateToStr(v);
}

export function normaliseLockRow(row: Record<string, unknown>): LockRow {
  return {
    id: String(row.id),
    ref: String(row.ref),
    rider_id: String(row.rider_id),
    hub: String(row.hub),
    model: String(row.model),
    finish: String(row.finish),
    state: String(row.state),
    issued_at_ms: n(row.issued_at_ms as string | number),
    expires_at_ms: row.expires_at_ms === null || row.expires_at_ms === undefined ? null : n(row.expires_at_ms as string | number),
    step_effective_from: dateToStr(row.step_effective_from),
    ex_showroom_paise: n(row.ex_showroom_paise as string | number),
    road_tax_paise: n(row.road_tax_paise as string | number),
    insurance_paise: n(row.insurance_paise as string | number),
    on_road_paise: n(row.on_road_paise as string | number),
    delivery_date: dateOrNull(row.delivery_date),
    waiting_for: dateOrNull(row.waiting_for),
    wait_position: row.wait_position === null || row.wait_position === undefined ? null : n(row.wait_position as string | number),
    joined_line_ms: row.joined_line_ms === null || row.joined_line_ms === undefined ? null : n(row.joined_line_ms as string | number),
    sheet_ready: Boolean(row.sheet_ready)};
}

export interface RideRow {
  id: string;
  rider_id: string;
  hub: string;
  model: string;
  starts_at_ms: number;
  state: string;
  moved_from_ms: number | null;
  licence_last4: string | null;
}

export function normaliseRideRow(row: Record<string, unknown>): RideRow {
  return {
    id: String(row.id),
    rider_id: String(row.rider_id),
    hub: String(row.hub),
    model: String(row.model),
    starts_at_ms: n(row.starts_at_ms as string | number),
    state: String(row.state),
    moved_from_ms: row.moved_from_ms === null || row.moved_from_ms === undefined ? null : n(row.moved_from_ms as string | number),
    licence_last4: row.licence_last4 === null || row.licence_last4 === undefined ? null : String(row.licence_last4)};
}

export function n(v: string | number | null): number {
  if (v === null) return 0;
  return typeof v === "number" ? v : Number(v);
}

export interface RideRow {
  id: string;
  rider_id: string;
  hub: string;
  model: string;
  starts_at_ms: number;
  state: string;
  moved_from_ms: number | null;
  licence_last4: string | null;
}
