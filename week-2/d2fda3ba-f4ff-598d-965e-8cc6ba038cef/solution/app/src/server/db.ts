// PostgreSQL: the pool, the idempotent schema and the seed accounts.
import postgres from "postgres";
import { config } from "./config.ts";
import { hashPassword } from "./passwords.ts";

const sql = postgres(config.databaseUrl, { max: 20, onnotice: () => undefined });

/** The one query shape every caller uses: positional parameters, rows and the affected count. */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

function queryable(target: postgres.Sql | postgres.TransactionSql | postgres.ReservedSql): Queryable {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const result = await target.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
      return { rows: [...result] as T[], rowCount: result.count };
    },
  };
}

export const pool = queryable(sql);

/** Runs `work` in a transaction, rolling back on any throw. */
export async function transaction<T>(work: (db: Queryable) => Promise<T>): Promise<T> {
  return await sql.begin((tx) => work(queryable(tx))) as T;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Holds a session-level advisory lock for `work`, waiting up to `waitMs` for it; null when another holder keeps it. */
export async function exclusive<T>(lockKey: string, work: () => Promise<T>, waitMs = 0): Promise<T | null> {
  const reserved = await sql.reserve();
  const db = queryable(reserved);
  const deadline = Date.now() + waitMs;
  try {
    for (;;) {
      const { rows } = await db.query<{ ok: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [lockKey]);
      if (rows[0].ok) break;
      if (Date.now() >= deadline) return null;
      await pause(200);
    }
    try {
      return await work();
    } finally {
      await db.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
    }
  } finally {
    reserved.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  time_zone text NOT NULL,
  operator boolean NOT NULL DEFAULT false,
  kb_account_id text,
  kb_seed_addons text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email ON accounts (lower(email));
CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  name text NOT NULL,
  approved boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS devices_account ON devices (account_id);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS device_approvals (
  token_hash text PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES devices(id),
  created_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS vaults (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  owner_id uuid NOT NULL REFERENCES accounts(id),
  key_envelope jsonb NOT NULL,
  head integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vault_members (
  vault_id uuid NOT NULL REFERENCES vaults(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  role text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vault_id, account_id)
);
CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  vault_id uuid NOT NULL REFERENCES vaults(id),
  email text NOT NULL,
  inviter_id uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS revisions (
  vault_id uuid NOT NULL REFERENCES vaults(id),
  rev integer NOT NULL,
  note_id uuid NOT NULL,
  base_revision integer,
  ciphertext_sha256 text NOT NULL,
  byte_length integer NOT NULL,
  device_id uuid NOT NULL REFERENCES devices(id),
  restored_from integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vault_id, rev)
);
CREATE INDEX IF NOT EXISTS revisions_note ON revisions (vault_id, note_id, rev);
CREATE TABLE IF NOT EXISTS cursors (
  device_id uuid NOT NULL REFERENCES devices(id),
  vault_id uuid NOT NULL REFERENCES vaults(id),
  cursor integer NOT NULL,
  PRIMARY KEY (device_id, vault_id)
);
CREATE TABLE IF NOT EXISTS repeated_requests (
  device_id uuid NOT NULL,
  endpoint text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, endpoint, key)
);
CREATE TABLE IF NOT EXISTS dossiers (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  slug text NOT NULL UNIQUE,
  root_note_id uuid NOT NULL,
  state text NOT NULL,
  radius integer,
  public_count integer,
  severed_count integer,
  published_at timestamptz,
  live_publish_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS publishes (
  id uuid PRIMARY KEY,
  dossier_id uuid NOT NULL REFERENCES dossiers(id),
  prefix text NOT NULL,
  status text NOT NULL,
  manifest jsonb NOT NULL,
  objects_cleared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS preview_links (
  id uuid PRIMARY KEY,
  dossier_id uuid NOT NULL REFERENCES dossiers(id),
  token_hash text NOT NULL UNIQUE,
  state text NOT NULL,
  manifest jsonb NOT NULL,
  objects_cleared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS entitlement_cache (
  account_id uuid NOT NULL REFERENCES accounts(id),
  addon text NOT NULL,
  subscribed boolean NOT NULL,
  billing_end timestamptz,
  checked_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, addon)
);
CREATE TABLE IF NOT EXISTS email_outbox (
  id bigserial PRIMARY KEY,
  to_address text NOT NULL,
  subject text NOT NULL,
  text_body text NOT NULL,
  html_body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sweeps (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS publish_warnings (
  account_id uuid NOT NULL REFERENCES accounts(id),
  period_end timestamptz NOT NULL,
  sweep_id bigint NOT NULL,
  PRIMARY KEY (account_id, period_end)
);
`;

interface SeedAccount {
  email: string;
  password: string;
  displayName: string;
  timeZone: string;
  operator: boolean;
  addons: ("sync" | "publish")[];
}

const SEED: SeedAccount[] = [
  { email: "ops@tidewrack.example", password: "cairn-ops-7731-dev", displayName: "Tidewrack Ops", timeZone: "Europe/Lisbon", operator: true, addons: [] },
  { email: "ines.marlow@casefile.example", password: "field-notes-4418", displayName: "Ines Marlow", timeZone: "Europe/Lisbon", operator: false, addons: ["sync", "publish"] },
  { email: "tomasz.reyes@casefile.example", password: "co-edit-2290", displayName: "Tomasz Reyes", timeZone: "America/Bogota", operator: false, addons: [] },
  { email: "hana.okoye@ledgerdesk.example", password: "other-case-6603", displayName: "Hana Okoye", timeZone: "Asia/Singapore", operator: false, addons: ["sync"] },
];


/** Connects (retrying every 2 s), applies the schema and creates missing seed accounts. */
export async function prepareDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch (error) {
      console.error("PostgreSQL unreachable, retrying in 2 s:", (error as Error).message);
      await pause(2000);
    }
  }
  const reserved = await sql.reserve();
  const client = queryable(reserved);
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('cairn:schema'))");
    await reserved.unsafe(SCHEMA);
    for (const seed of SEED) {
      const exists = await client.query("SELECT 1 FROM accounts WHERE lower(email) = lower($1)", [seed.email]);
      if (exists.rowCount) continue;
      await client.query(
        `INSERT INTO accounts (id, email, password_hash, display_name, time_zone, operator, kb_seed_addons)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [seed.email, await hashPassword(seed.password), seed.displayName, seed.timeZone, seed.operator, seed.addons],
      );
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('cairn:schema'))");
    reserved.release();
  }
}
