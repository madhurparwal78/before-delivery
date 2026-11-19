import pg from "pg";
import { config } from "./config.js";

// bigint columns hold pence and counts that stay far below 2^53.
pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));

export type Db = pg.Pool | pg.PoolClient;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24 });
pool.on("error", (error: Error & { code?: string }) => console.error(`postgres pool error (${error.code ?? "unknown"})`));

export async function rows<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

export async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(db, sql, params))[0];
}

/** Runs `work` in one transaction; any throw rolls it back. */
export async function tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  kb_account_id text,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS campaigns (
  id text PRIMARY KEY,
  creator_id text NOT NULL REFERENCES people(id),
  title text NOT NULL,
  story text NOT NULL,
  status text NOT NULL,
  goal bigint NOT NULL,
  min_run_copies integer NOT NULL,
  stretch jsonb NOT NULL,
  ships_from text NOT NULL,
  time_zone text NOT NULL,
  deadline_local text NOT NULL,
  deadline_utc timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS tiers (
  id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES campaigns(id),
  title text NOT NULL,
  description text NOT NULL,
  price bigint NOT NULL,
  quantity integer,
  ship_domestic bigint NOT NULL,
  ship_europe bigint NOT NULL,
  ship_rest_of_world bigint NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES campaigns(id),
  kind text NOT NULL,
  status text NOT NULL,
  content_type text NOT NULL,
  bytes integer NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS pledges (
  id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES campaigns(id),
  backer_id text NOT NULL REFERENCES people(id),
  tier_id text NOT NULL REFERENCES tiers(id),
  country text NOT NULL,
  zone text NOT NULL,
  reward bigint NOT NULL,
  shipping bigint NOT NULL,
  add_on bigint NOT NULL,
  amount bigint NOT NULL,
  state text NOT NULL,
  card_last4 text NOT NULL,
  kb_payment_method_id text,
  kb_payment_id text,
  replaces text,
  history jsonb NOT NULL,
  fix_code text UNIQUE,
  fix_deadline_utc timestamptz,
  next_fix_notice_at timestamptz,
  fix_count integer NOT NULL DEFAULT 0,
  fix_payment_id text,
  fix_card_last4 text,
  card_fixed boolean,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS pledges_campaign ON pledges (campaign_id, state);
CREATE INDEX IF NOT EXISTS pledges_backer ON pledges (backer_id, created_at);
CREATE TABLE IF NOT EXISTS idempotency (
  scope text NOT NULL,
  route text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer,
  body jsonb,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (scope, route, key)
);
CREATE TABLE IF NOT EXISTS notices (
  id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES campaigns(id),
  kind text NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS notices_queued ON notices (status, created_at);
CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY,
  kind text NOT NULL,
  pledge_id text REFERENCES pledges(id),
  campaign_id text NOT NULL REFERENCES campaigns(id),
  status text NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL,
  ready_at timestamptz
);
`;

/** Waits for Postgres (retrying every 2 s) and applies the schema idempotently. */
export async function connect(): Promise<void> {
  for (;;) {
    try {
      await pool.query(SCHEMA);
      return;
    } catch (error) {
      console.error(`postgres not ready (${(error as { code?: string }).code ?? "unavailable"}); retrying in 2 s`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
