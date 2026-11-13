import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";
import { config } from "./config";
import { ApiError } from "./errors";

pg.types.setTypeParser(20, (value) => Number(value));
pg.types.setTypeParser(1082, (value) => value);

const pool = new pg.Pool({
  connectionString: config.databaseUrl || undefined,
  max: 20,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30_000,
});
pool.on("error", () => undefined);

export type Db = Pick<pg.PoolClient, "query">;

/** True for a failure to reach or keep talking to Postgres, as opposed to a query that Postgres refused. */
function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") return /connection|timeout|terminated/i.test(error.message);
  return code.startsWith("08") || code.startsWith("57") || /^E[A-Z]+$/.test(code);
}

export function asDatabaseError(error: unknown): unknown {
  return error instanceof ApiError || !isConnectionFailure(error) ? error : new ApiError("database_unavailable");
}

export async function rows<T>(db: Db, sql: string, params: readonly unknown[] = []): Promise<T[]> {
  try {
    const result = await db.query(sql, params as unknown[]);
    return result.rows as T[];
  } catch (error) {
    throw asDatabaseError(error);
  }
}

export async function one<T>(db: Db, sql: string, params: readonly unknown[] = []): Promise<T | null> {
  return (await rows<T>(db, sql, params))[0] ?? null;
}

export async function transaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
  await ensureSchema();
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw asDatabaseError(error);
  }
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw asDatabaseError(error);
  } finally {
    client.release();
  }
}

/** A read or write outside an explicit transaction. */
export async function database(): Promise<Db> {
  await ensureSchema();
  return pool;
}

// ---- schema --------------------------------------------------------------------------------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS models (
  slug text PRIMARY KEY, name text NOT NULL, axis text, retired_names text[] NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS parts (
  model_slug text NOT NULL REFERENCES models(slug), booklet_number int NOT NULL, part_number text NOT NULL,
  name text NOT NULL, price_minor int NOT NULL, weight_g int NOT NULL, longest_side_mm int NOT NULL,
  status text NOT NULL, bin_count int NOT NULL DEFAULT 0, PRIMARY KEY (model_slug, booklet_number));
CREATE TABLE IF NOT EXISTS editions (
  code text PRIMARY KEY, title text NOT NULL, starts_on date NOT NULL UNIQUE, standard_months int NOT NULL,
  club_months int NOT NULL, owner_contribution_percent int NOT NULL);
CREATE TABLE IF NOT EXISTS club_roster (email text PRIMARY KEY, joined_on date NOT NULL);
CREATE TABLE IF NOT EXISTS bank_holidays (day date PRIMARY KEY);
CREATE TABLE IF NOT EXISTS operator_account (email text PRIMARY KEY, password_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS decided_counts (
  id int PRIMARY KEY CHECK (id = 1), decided int NOT NULL, inside int NOT NULL, outside int NOT NULL);
CREATE TABLE IF NOT EXISTS claims (
  reference text PRIMARY KEY, state text NOT NULL, language text, name text, email text, postcode text,
  purchase_date date, model_slug text, booklet_number int, quantity int, description text,
  started_at timestamptz, confirm_by timestamptz, confirm_token text UNIQUE, confirmed_at timestamptz,
  ruling_inside boolean, ruling_edition text, ruling_cover_ends_at timestamptz, ruling_cover_ends_on date,
  ruling_term_months int, ruling_decided_at timestamptz,
  paid_minor int, paid_at timestamptz, decline_reason text, decline_charged_minor int, decline_refunded_minor int,
  dispatched_at timestamptz, closed_at timestamptz, erased_at timestamptz, billing_account text);
CREATE INDEX IF NOT EXISTS claims_email_idx ON claims (lower(email));
CREATE TABLE IF NOT EXISTS claim_history (
  claim_reference text NOT NULL REFERENCES claims(reference), seq int NOT NULL, state text NOT NULL,
  at timestamptz NOT NULL, PRIMARY KEY (claim_reference, seq));
CREATE TABLE IF NOT EXISTS claim_photos (
  claim_reference text NOT NULL REFERENCES claims(reference), idx int NOT NULL, content_type text NOT NULL,
  bytes int NOT NULL, PRIMARY KEY (claim_reference, idx));
CREATE TABLE IF NOT EXISTS quote_revisions (
  claim_reference text NOT NULL REFERENCES claims(reference), revision int NOT NULL, status text NOT NULL,
  source text NOT NULL, quantity int NOT NULL, part_line_minor int NOT NULL, carriage_minor int NOT NULL,
  total_minor int NOT NULL, band text NOT NULL, carriage_valid_until timestamptz NOT NULL,
  promise_kind text NOT NULL, promise_date date NOT NULL, quoted_at timestamptz NOT NULL,
  billing_invoice text NOT NULL, bin_returned boolean NOT NULL DEFAULT false,
  PRIMARY KEY (claim_reference, revision));
CREATE TABLE IF NOT EXISTS share_tokens (
  token text PRIMARY KEY, claim_reference text NOT NULL REFERENCES claims(reference), state text NOT NULL,
  created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS share_tokens_claim_idx ON share_tokens (claim_reference);
CREATE TABLE IF NOT EXISTS idempotency_records (
  claim_reference text NOT NULL REFERENCES claims(reference), key text NOT NULL, action text NOT NULL,
  fingerprint text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY (claim_reference, key));
CREATE TABLE IF NOT EXISTS reference_attempts (
  reference text PRIMARY KEY REFERENCES claims(reference), wrong_count int NOT NULL, locked_until timestamptz);
CREATE TABLE IF NOT EXISTS rate_hits (caller text NOT NULL, at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS rate_hits_idx ON rate_hits (caller, at);
CREATE TABLE IF NOT EXISTS operator_sessions (token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS notice_queue (
  id bigserial PRIMARY KEY, claim_reference text NOT NULL REFERENCES claims(reference), recipient text NOT NULL,
  subject text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL);
`;

interface SeedPart {
  booklet: number;
  number: string;
  name: string;
  price: number;
  weight: number;
  side: number;
  bin: number;
  status?: "withdrawn";
}

interface SeedModel {
  slug: string;
  name: string;
  axis: "x" | "y" | "iso" | null;
  retired: string[];
  parts: SeedPart[];
}

const SEED_MODELS: SeedModel[] = [
  {
    slug: "aldra-wardrobe",
    name: "Aldra Wardrobe",
    axis: "y",
    retired: ["Aldra Robe", "Aldra 2-Door", "Holm Classic"],
    parts: [
      { booklet: 1, number: "40218831", name: "Side panel", price: 4800, weight: 14200, side: 1990, bin: 0 },
      { booklet: 2, number: "40218848", name: "Top panel", price: 3600, weight: 6800, side: 980, bin: 0 },
      { booklet: 3, number: "102944", name: "Shelf", price: 1450, weight: 2100, side: 940, bin: 3 },
      { booklet: 4, number: "118320", name: "Hanging rail", price: 950, weight: 600, side: 900, bin: 6 },
      { booklet: 5, number: "100823", name: "Cam lock", price: 45, weight: 12, side: 15, bin: 400 },
      { booklet: 6, number: "100824", name: "Cam bolt", price: 35, weight: 9, side: 34, bin: 400 },
    ],
  },
  {
    slug: "bramwell-sofa-frame",
    name: "Bramwell Sofa Frame",
    axis: "x",
    retired: ["Bramwell 3-Seater", "Holm Classic"],
    parts: [
      { booklet: 1, number: "50331207", name: "Back rail", price: 2250, weight: 3100, side: 1820, bin: 0 },
      { booklet: 2, number: "503319", name: "Seat slat", price: 690, weight: 700, side: 760, bin: 12 },
      { booklet: 3, number: "112903", name: "Front leg", price: 1125, weight: 450, side: 140, bin: 8 },
      { booklet: 4, number: "112911", name: "Corner block", price: 365, weight: 120, side: 90, bin: 30 },
      { booklet: 5, number: "100190", name: "Bolt M8 × 80", price: 85, weight: 40, side: 80, bin: 200 },
    ],
  },
  {
    slug: "kestle-shelving-unit",
    name: "Kestle Shelving Unit",
    axis: "iso",
    retired: ["Kestle Tall Shelf", "Kestle 5-Tier"],
    parts: [
      { booklet: 1, number: "60770016", name: "Upright", price: 2900, weight: 3900, side: 1810, bin: 0 },
      { booklet: 2, number: "607701", name: "Shelf board", price: 1675, weight: 2600, side: 790, bin: 4 },
      { booklet: 3, number: "101345", name: "Shelf pin", price: 15, weight: 3, side: 16, bin: 1000 },
      { booklet: 4, number: "120456", name: "Wall bracket", price: 255, weight: 60, side: 70, bin: 25 },
      { booklet: 5, number: "607744", name: "Back brace", price: 740, weight: 800, side: 760, bin: 2, status: "withdrawn" },
    ],
  },
  {
    slug: "fenwick-bed-frame",
    name: "Fenwick Bed Frame",
    axis: null,
    retired: ["Fenwick Double"],
    parts: [
      { booklet: 1, number: "70110025", name: "Headboard", price: 5400, weight: 9800, side: 1420, bin: 0 },
      { booklet: 2, number: "701102", name: "Side rail", price: 1990, weight: 3300, side: 1960, bin: 2 },
      { booklet: 3, number: "701109", name: "Slat", price: 320, weight: 400, side: 1380, bin: 40 },
      { booklet: 4, number: "120870", name: "Centre leg", price: 410, weight: 300, side: 250, bin: 10 },
    ],
  },
];

const BANK_HOLIDAYS = [
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28",
  "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30", "2027-12-27", "2027-12-28",
];

const OPERATOR_EMAIL = "operator@holmgarth.example";
const OPERATOR_PASSWORD = "fan-out-2026-desk";

function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}

async function seed(client: pg.PoolClient): Promise<void> {
  const existing = await client.query("SELECT count(*)::int AS n FROM models");
  if ((existing.rows[0] as { n: number }).n > 0) return;
  for (const model of SEED_MODELS) {
    await client.query("INSERT INTO models (slug, name, axis, retired_names) VALUES ($1, $2, $3, $4)", [model.slug, model.name, model.axis, model.retired]);
    for (const part of model.parts) {
      await client.query(
        "INSERT INTO parts (model_slug, booklet_number, part_number, name, price_minor, weight_g, longest_side_mm, status, bin_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [model.slug, part.booklet, part.number, part.name, part.price, part.weight, part.side, part.status ?? "active", part.bin],
      );
    }
  }
  const { standardMonths, clubMonths } = config.desk;
  await client.query("INSERT INTO editions VALUES ('AC-2025', 'Aftercare 2025', '2025-01-01', $1, $2, 0), ('AC-2026', 'Aftercare 2026', '2026-07-15', $1, $2, 25)", [standardMonths, clubMonths]);
  await client.query("INSERT INTO club_roster VALUES ('ines.kowalczyk@example.org', '2023-04-02'), ('tom.ashby@example.net', '2025-09-10')");
  for (const day of BANK_HOLIDAYS) await client.query("INSERT INTO bank_holidays VALUES ($1)", [day]);
  await client.query("INSERT INTO operator_account VALUES ($1, $2)", [OPERATOR_EMAIL, hashPassword(OPERATOR_PASSWORD)]);
  await client.query("INSERT INTO decided_counts VALUES (1, 0, 0, 0) ON CONFLICT DO NOTHING");
}

let schemaReady = false;
let schemaInFlight: Promise<void> | null = null;

async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(727001)");
    await client.query(SCHEMA);
    await seed(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Applies the schema (safe to repeat) the first time Postgres answers; refused with 503 until then. */
export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  schemaInFlight ??= applySchema()
    .then(() => {
      schemaReady = true;
    })
    .finally(() => {
      schemaInFlight = null;
    });
  try {
    await schemaInFlight;
  } catch (error) {
    throw asDatabaseError(error);
  }
}

