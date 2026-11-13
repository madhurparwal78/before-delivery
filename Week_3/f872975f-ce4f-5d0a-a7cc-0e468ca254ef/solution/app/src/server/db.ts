// PostgreSQL: the pool, transactions, the schema and the idempotent seed applied on every start.
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import { config } from "./config";
import type { DefectZone } from "../shared/domain";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

pg.types.setTypeParser(20, (v) => Number(v)); // bigint volumes stay well inside 2^53
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric sums

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 40 });
pool.on("error", (error) => console.error("postgres pool error", error.message));

export type Db = pg.Pool | pg.PoolClient;
type Row = pg.QueryResultRow;

export async function query<R extends Row>(db: Db, sql: string, params: unknown[] = []): Promise<R[]> {
  const result = await db.query<R>(sql, params);
  return result.rows;
}

export async function one<R extends Row>(db: Db, sql: string, params: unknown[] = []): Promise<R | undefined> {
  const rows = await query<R>(db, sql, params);
  return rows[0];
}

export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** A connection kept for the duration of `work`, for session-level advisory locks. */
export async function withClient<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

async function hashPassword(password: string, salt: Buffer = randomBytes(16)): Promise<string> {
  const derived = await scrypt(password, salt, 32);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (saltHex === undefined || hashHex === undefined) return false;
  return (await hashPassword(password, Buffer.from(saltHex, "hex"))) === stored;
}

const SCHEMA = `
CREATE SEQUENCE IF NOT EXISTS board_tag_seq START 11;
CREATE SEQUENCE IF NOT EXISTS lot_seq START 4;
CREATE SEQUENCE IF NOT EXISTS hold_seq START 1;
CREATE SEQUENCE IF NOT EXISTS ticket_seq START 1;
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1;
CREATE SEQUENCE IF NOT EXISTS photo_seq START 1;
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','hand','maker')));
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS lots (
  id text PRIMARY KEY, name text NOT NULL, origin text NOT NULL, built_year integer NOT NULL,
  created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS boards (
  tag text PRIMARY KEY, species text NOT NULL, grade text, status text NOT NULL, lot_id text NOT NULL REFERENCES lots(id),
  length_mm integer NOT NULL, width_mm integer NOT NULL, thickness_mm integer NOT NULL, defects json NOT NULL,
  parent_tag text REFERENCES boards(tag), cut_ticket text, created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS boards_parent ON boards(parent_tag);
CREATE TABLE IF NOT EXISTS photos (
  id text PRIMARY KEY, board_tag text NOT NULL REFERENCES boards(tag), ext text NOT NULL, content_type text NOT NULL,
  width integer NOT NULL, height integer NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS rates (
  id serial PRIMARY KEY, species text NOT NULL, grade text NOT NULL, rate_cents integer NOT NULL,
  effective_at timestamptz NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS holds (
  id text PRIMARY KEY, board_tag text NOT NULL REFERENCES boards(tag), maker_id integer NOT NULL REFERENCES users(id),
  status text NOT NULL, release_reason text, pieces json NOT NULL, cuts_mm json NOT NULL, take_mm integer NOT NULL,
  sale text NOT NULL, offcut_mm integer, price_cents integer NOT NULL, deposit_cents integer NOT NULL,
  created_at timestamptz NOT NULL, held_at timestamptz, expires_at timestamptz, killbill_payment_id text);
CREATE INDEX IF NOT EXISTS holds_board ON holds(board_tag);
CREATE INDEX IF NOT EXISTS holds_maker ON holds(maker_id);
CREATE TABLE IF NOT EXISTS tickets (
  id text PRIMARY KEY, board_tag text NOT NULL REFERENCES boards(tag), maker_id integer NOT NULL REFERENCES users(id),
  hold_id text NOT NULL REFERENCES holds(id), pieces json NOT NULL, cuts_mm json NOT NULL, take_mm integer NOT NULL,
  sale text NOT NULL, offcut_tag text, planned_mm integer, measured_mm integer, status text NOT NULL,
  pdf_key text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS ticket_events (
  id serial PRIMARY KEY, ticket_id text NOT NULL REFERENCES tickets(id), kind text NOT NULL,
  by_user integer NOT NULL REFERENCES users(id), at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY, ticket_id text NOT NULL REFERENCES tickets(id), board_tag text NOT NULL,
  maker_id integer NOT NULL REFERENCES users(id), price_cents integer NOT NULL, deposit_cents integer NOT NULL,
  amount_cents integer NOT NULL, lines json NOT NULL, paid_at timestamptz NOT NULL, killbill_payment_id text NOT NULL);
CREATE TABLE IF NOT EXISTS movements (
  id serial PRIMARY KEY, kind text NOT NULL, created_at timestamptz NOT NULL, ticket_id text, by_user integer REFERENCES users(id));
CREATE TABLE IF NOT EXISTS entries (
  id serial PRIMARY KEY, movement_id integer NOT NULL REFERENCES movements(id), account text NOT NULL,
  volume_mm3 bigint NOT NULL);
CREATE INDEX IF NOT EXISTS entries_account ON entries(account);
CREATE INDEX IF NOT EXISTS entries_movement ON entries(movement_id);
CREATE TABLE IF NOT EXISTS layouts (
  maker_id integer NOT NULL REFERENCES users(id), board_tag text NOT NULL REFERENCES boards(tag), body text NOT NULL,
  PRIMARY KEY (maker_id, board_tag));
CREATE TABLE IF NOT EXISTS idempotency (
  maker_id integer NOT NULL REFERENCES users(id), key text NOT NULL, fingerprint text NOT NULL, status integer NOT NULL,
  body text NOT NULL, created_at timestamptz NOT NULL, PRIMARY KEY (maker_id, key));
`;

const SEED_USERS = [
  { name: "Dana Whitlock", email: "owner@kerfwell.test", password: "rack-owner-2026", role: "owner" },
  { name: "Teo Varga", email: "hand@kerfwell.test", password: "rack-hand-2026", role: "hand" },
  { name: "Ines Albrecht", email: "ines@makers.test", password: "rack-maker-2026", role: "maker" },
  { name: "Joel Mbeki", email: "joel@makers.test", password: "rack-maker-2026", role: "maker" },
  { name: "Ruth Calloway", email: "ruth@makers.test", password: "rack-maker-2026", role: "maker" },
] as const;

const SEED_LOTS = [
  ["LOT-01", "Hollis Road dairy barn", "Timber-frame dairy barn, taken down August 2026", 1911],
  ["LOT-02", "Pell Street shoe factory", "Four-storey mill floor and joists", 1924],
  ["LOT-03", "Marsh Lane farmhouse", "Farmhouse floorboards and mantel stock", 1880],
] as const;

const SEED_RATES: Record<string, [number, number, number]> = {
  "White oak": [1450, 1100, 800],
  "Black walnut": [2400, 1850, 1300],
  "Douglas fir": [900, 700, 500],
  "Heart pine": [1600, 1250, 900],
  Chestnut: [2800, 2200, 1600],
};

const zone = (kind: DefectZone["kind"], start_mm: number, end_mm: number): DefectZone => ({ kind, start_mm, end_mm });

const SEED_BOARDS: [string, string, string | null, string, number, number, number, string, DefectZone[]][] = [
  ["KW-0001", "White oak", "Character", "LOT-01", 2440, 190, 32, "available",
    [zone("nail hole", 610, 640), zone("check", 1500, 1720), zone("nail hole", 2200, 2230)]],
  ["KW-0002", "Black walnut", "Select", "LOT-03", 2100, 305, 45, "available", [zone("check", 0, 120), zone("bolt hole", 1340, 1380)]],
  ["KW-0003", "Black walnut", "Character", "LOT-03", 1830, 210, 25, "available", [zone("nail hole", 400, 420), zone("nail hole", 900, 920)]],
  ["KW-0004", "Douglas fir", "Rustic", "LOT-02", 4880, 235, 70, "available",
    [zone("bolt hole", 1200, 1260), zone("bolt hole", 3600, 3660), zone("check", 4500, 4880)]],
  ["KW-0005", "Heart pine", "Select", "LOT-02", 3050, 140, 38, "available", []],
  ["KW-0006", "Chestnut", "Character", "LOT-03", 2740, 250, 28, "available", [zone("nail hole", 300, 330), zone("check", 2000, 2300)]],
  ["KW-0007", "White oak", "Rustic", "LOT-01", 3660, 200, 50, "available",
    [zone("nail hole", 900, 930), zone("nail hole", 1800, 1830), zone("bolt hole", 2700, 2760)]],
  ["KW-0008", "Heart pine", null, "LOT-02", 2400, 180, 38, "tagged", [zone("nail hole", 1000, 1020)]],
  ["KW-0009", "Douglas fir", "Character", "LOT-02", 3000, 185, 45, "graded", []],
  ["KW-0010", "Black walnut", "Select", "LOT-03", 1220, 330, 50, "available", []],
];

const SEED_TIME = "2026-01-01T00:00:00Z";
const MIGRATION_LOCK = 7_331_001;

/** Applies the schema and writes whatever seed rows are missing; a second run changes nothing. */
export async function migrateAndSeed(): Promise<void> {
  const present = await query<{ email: string }>(pool, "SELECT email FROM users").catch(() => []);
  const hashes = new Map<string, string>();
  for (const user of SEED_USERS) {
    if (!present.some((p) => p.email === user.email)) hashes.set(user.email, await hashPassword(user.password));
  }
  await withClient(async (client) => {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    try {
      await client.query(SCHEMA);
      await client.query("BEGIN");
      await client.query("INSERT INTO settings (key, value) VALUES ('yard_id', $1) ON CONFLICT (key) DO NOTHING",
        [randomBytes(6).toString("hex")]);
      for (const user of SEED_USERS) {
        const hash = hashes.get(user.email);
        if (hash === undefined) continue;
        await client.query(
          "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING",
          [user.name, user.email, hash, user.role]);
      }
      for (const [id, name, origin, built] of SEED_LOTS) {
        await client.query(
          "INSERT INTO lots (id, name, origin, built_year, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING",
          [id, name, origin, built, SEED_TIME]);
      }
      const rateCount = await one<{ n: number }>(client, "SELECT count(*)::int AS n FROM rates");
      if (rateCount?.n === 0) {
        for (const [species, cents] of Object.entries(SEED_RATES)) {
          for (const [i, grade] of (["Select", "Character", "Rustic"] as const).entries()) {
            await client.query(
              "INSERT INTO rates (species, grade, rate_cents, effective_at, created_at) VALUES ($1, $2, $3, $4, $4)",
              [species, grade, cents[i], SEED_TIME]);
          }
        }
      }
      for (const [tag, species, grade, lot, length, width, thickness, status, defects] of SEED_BOARDS) {
        const inserted = await query(client,
          `INSERT INTO boards (tag, species, grade, status, lot_id, length_mm, width_mm, thickness_mm, defects, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (tag) DO NOTHING RETURNING tag`,
          [tag, species, grade, status, lot, length, width, thickness, JSON.stringify(defects), SEED_TIME]);
        if (inserted.length === 0) continue;
        const volume = length * width * thickness;
        const movement = await one<{ id: number }>(client,
          "INSERT INTO movements (kind, created_at, ticket_id, by_user) VALUES ('intake', $1, NULL, NULL) RETURNING id",
          [SEED_TIME]);
        await client.query("INSERT INTO entries (movement_id, account, volume_mm3) VALUES ($1, 'intake', $2), ($1, $3, $4)",
          [movement?.id, -volume, `board:${tag}`, volume]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]);
    }
  });
}

export async function yardId(): Promise<string> {
  const row = await one<{ value: string }>(pool, "SELECT value FROM settings WHERE key = 'yard_id'");
  if (row === undefined) throw new Error("yard id missing");
  return row.value;
}

/** Waits for PostgreSQL to accept connections; the app serves nothing until it does. */
export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      console.error("waiting for postgres:", error instanceof Error ? error.message : String(error));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
