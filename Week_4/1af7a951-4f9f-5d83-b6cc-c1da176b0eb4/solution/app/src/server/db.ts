import pg from "pg";
import { config } from "./config.js";
import { seed } from "./seed.js";

// Dates stay "YYYY-MM-DD" strings: a night key is a calendar date, never an instant.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", (error) => console.error("postgres pool error:", error.message));

export type Db = pg.Pool | pg.PoolClient;

/** Runs `work` in one transaction on its own connection. */
export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof pg.DatabaseError && error.code === "23505";
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS coaches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  time_zone text NOT NULL,
  access_code_hash text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES coaches(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- The name after Unicode lower-casing, compared for one cohort name per coach.
  name_key text NOT NULL,
  starts_on date NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents BETWEEN 100 AND 100000),
  seats integer NOT NULL CHECK (seats BETWEEN 1 AND 50),
  published boolean NOT NULL DEFAULT false,
  closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (published OR NOT closed)
);
CREATE TABLE IF NOT EXISTS enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL REFERENCES cohorts(id),
  name text NOT NULL,
  email text NOT NULL,
  home_tz text NOT NULL,
  bedtime text NOT NULL CHECK (bedtime ~ '^2[0-3]:[0-5][0-9]$'),
  status text NOT NULL CHECK (status IN ('pending_payment', 'active', 'refunded')),
  first_night date,
  receipt_status text NOT NULL DEFAULT 'none' CHECK (receipt_status IN ('none', 'pending', 'sent')),
  access_code_hash text NOT NULL UNIQUE,
  receipt_access_code text,
  -- Set only when the app charged the seat through Kill Bill; a seat without it is comped.
  killbill_payment_id text,
  amount_paid_cents integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'pending_payment') = (first_night IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS enrollments_one_open_seat_request
  ON enrollments (cohort_id, lower(email)) WHERE status IN ('pending_payment', 'active');
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  coach_id uuid REFERENCES coaches(id),
  enrollment_id uuid REFERENCES enrollments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((coach_id IS NULL) <> (enrollment_id IS NULL))
);
CREATE TABLE IF NOT EXISTS entries (
  id uuid PRIMARY KEY,
  enrollment_id uuid NOT NULL REFERENCES enrollments(id),
  night_key date NOT NULL,
  title text NOT NULL,
  text text NOT NULL,
  dreams_recalled integer NOT NULL CHECK (dreams_recalled BETWEEN 0 AND 20),
  lucid boolean NOT NULL,
  wbtb boolean NOT NULL,
  technique text NOT NULL CHECK (technique IN ('none', 'mild', 'ssild')),
  technique_minutes integer NOT NULL CHECK (technique_minutes BETWEEN 0 AND 180),
  late_recall boolean NOT NULL,
  shared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  memo_content_type text,
  memo_size_bytes integer CHECK (memo_size_bytes BETWEEN 1 AND 5000000),
  memo_duration_ms integer CHECK (memo_duration_ms BETWEEN 1 AND 600000),
  memo_sha256 text,
  CHECK (num_nonnulls(memo_content_type, memo_size_bytes, memo_duration_ms, memo_sha256) IN (0, 4))
);
CREATE INDEX IF NOT EXISTS entries_by_enrollment ON entries (enrollment_id, night_key);
CREATE TABLE IF NOT EXISTS dream_signs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES entries(id),
  start_offset integer NOT NULL,
  end_offset integer NOT NULL,
  phrase text NOT NULL,
  category text NOT NULL CHECK (category IN ('inner_awareness', 'action', 'form', 'context')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (entry_id, start_offset, end_offset),
  CHECK (end_offset - start_offset BETWEEN 1 AND 200)
);
CREATE TABLE IF NOT EXISTS reality_checks (
  id uuid PRIMARY KEY,
  enrollment_id uuid NOT NULL REFERENCES enrollments(id),
  category text NOT NULL CHECK (category IN ('inner_awareness', 'action', 'form', 'context')),
  night_key date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS reality_checks_by_night ON reality_checks (enrollment_id, night_key);
-- One digest per cohort week: the stored answer every later send replays.
CREATE TABLE IF NOT EXISTS digests (
  cohort_id uuid NOT NULL REFERENCES cohorts(id),
  week integer NOT NULL CHECK (week BETWEEN 1 AND 4),
  sent_to text NOT NULL,
  dreamers integer NOT NULL,
  PRIMARY KEY (cohort_id, week)
);
`;

const BOOT_RETRY_MS = 60_000;

async function reachable(): Promise<void> {
  const deadline = Date.now() + BOOT_RETRY_MS;
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/** Waits for Postgres (up to 60 s), then applies the schema and the seed under one advisory lock. */
export async function prepareDatabase(): Promise<void> {
  await reachable();
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(4173)");
    await client.query(SCHEMA);
    await seed(client);
  });
}
