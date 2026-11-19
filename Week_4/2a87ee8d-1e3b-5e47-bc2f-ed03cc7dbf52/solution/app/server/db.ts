import crypto from "node:crypto";
import { config } from "./config.js";
import { Connection, Pool, type Row, type SqlValue } from "./pg.js";

export type { Row, SqlValue } from "./pg.js";

const pool = new Pool(config.databaseUrl, 8);

export interface Db {
  rows<T = Row>(text: string, values?: readonly SqlValue[]): Promise<T[]>;
  one<T = Row>(text: string, values?: readonly SqlValue[]): Promise<T | undefined>;
  run(text: string, values?: readonly SqlValue[]): Promise<number>;
}

function wrap(connection: Connection): Db {
  return {
    async rows<T>(text: string, values: readonly SqlValue[] = []) {
      return (await connection.query(text, values)).rows as T[];
    },
    async one<T>(text: string, values: readonly SqlValue[] = []) {
      return (await connection.query(text, values)).rows[0] as T | undefined;
    },
    async run(text: string, values: readonly SqlValue[] = []) {
      return (await connection.query(text, values)).count;
    },
  };
}

export const db: Db = {
  rows: (text, values) => pool.with((c) => wrap(c).rows(text, values)),
  one: (text, values) => pool.with((c) => wrap(c).one(text, values)),
  run: (text, values) => pool.with((c) => wrap(c).run(text, values)),
};

export function newId(): string {
  return crypto.randomBytes(12).toString("base64url");
}

/** Runs work in one transaction. The callback may throw to roll back. */
export function tx<T>(work: (t: Db) => Promise<T>): Promise<T> {
  return pool.with(async (connection) => {
    await connection.query("BEGIN");
    try {
      const result = await work(wrap(connection));
      await connection.query("COMMIT");
      return result;
    } catch (error) {
      if (!connection.isClosed()) await connection.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

/** Savepoint inside a transaction: work that throws is undone, the transaction lives on. */
export async function savepoint<T>(t: Db, work: () => Promise<T>): Promise<T> {
  await t.run("SAVEPOINT op");
  try {
    const result = await work();
    await t.run("RELEASE SAVEPOINT op");
    return result;
  } catch (error) {
    await t.run("ROLLBACK TO SAVEPOINT op");
    throw error;
  }
}

export type LiveEvent =
  | { t: "board"; w: string; v: number }
  | { t: "presence"; w: string; from: string; cursorId: string; hue: number; x: number; y: number; name: string }
  | { t: "ended"; w: string };

export async function notify(t: Db, event: LiveEvent): Promise<void> {
  await t.run("SELECT pg_notify('lanternfold', $1)", [JSON.stringify(event)]);
}

/** Keeps one LISTEN connection open, reconnecting after a drop. */
export function listen(onEvent: (event: LiveEvent) => void, onReconnect: () => void): void {
  const open = async () => {
    try {
      const connection = await pool.connect();
      connection.onNotification = (_channel, payload) => onEvent(JSON.parse(payload) as LiveEvent);
      connection.onClose = () => setTimeout(() => void open(), 1000);
      await connection.simple("LISTEN lanternfold");
      onReconnect();
    } catch {
      setTimeout(() => void open(), 1000);
    }
  };
  void open();
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS facilitators (
  id text PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL, password_hash text NOT NULL,
  time_zone text NOT NULL, seed_plan text NOT NULL, seed_term text NOT NULL);
CREATE TABLE IF NOT EXISTS facilitator_sessions (
  token_hash text PRIMARY KEY, facilitator_id text NOT NULL REFERENCES facilitators, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS workshops (
  id text PRIMARY KEY, facilitator_id text NOT NULL REFERENCES facilitators, seed_key text UNIQUE,
  title text NOT NULL, template text NOT NULL, status text NOT NULL,
  scheduled_start text NOT NULL, scheduled_end text NOT NULL, start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
  sponsor_email text NOT NULL, fee_cents bigint NOT NULL, round_number int NOT NULL DEFAULT 0, round_ends_at timestamptz,
  dot_budget int, voting_ends_at timestamptz, version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS join_links (
  id text PRIMARY KEY, workshop_id text NOT NULL REFERENCES workshops, token text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz);
CREATE INDEX IF NOT EXISTS join_links_workshop ON join_links (workshop_id);
CREATE TABLE IF NOT EXISTS participants (
  id text PRIMARY KEY, workshop_id text NOT NULL REFERENCES workshops, link_id text NOT NULL REFERENCES join_links,
  display_name text NOT NULL, session_hash text UNIQUE NOT NULL, cursor_id text NOT NULL, hue int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS participants_workshop ON participants (workshop_id);
CREATE TABLE IF NOT EXISTS trash_items (
  id text PRIMARY KEY, workshop_id text NOT NULL, frame_id text NOT NULL, title text NOT NULL,
  deleted_at timestamptz NOT NULL, purge_at timestamptz NOT NULL, restored_at timestamptz, purged_at timestamptz);
CREATE TABLE IF NOT EXISTS frames (
  id text PRIMARY KEY, workshop_id text NOT NULL REFERENCES workshops, title text NOT NULL,
  x double precision NOT NULL, y double precision NOT NULL, width double precision NOT NULL, height double precision NOT NULL,
  position int NOT NULL, trash_id text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS frames_workshop ON frames (workshop_id);
CREATE TABLE IF NOT EXISTS clusters (
  id text PRIMARY KEY, workshop_id text NOT NULL, frame_id text NOT NULL, title text NOT NULL,
  x double precision NOT NULL, y double precision NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), seq bigserial);
CREATE INDEX IF NOT EXISTS clusters_workshop ON clusters (workshop_id);
CREATE TABLE IF NOT EXISTS notes (
  id text PRIMARY KEY, workshop_id text NOT NULL, frame_id text NOT NULL, cluster_id text, cluster_index int,
  kind text NOT NULL, text text, image_id text, x double precision NOT NULL, y double precision NOT NULL,
  revealed boolean NOT NULL, facilitator_only boolean NOT NULL DEFAULT false, author_participant_id text,
  round int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), seq bigserial);
CREATE INDEX IF NOT EXISTS notes_workshop ON notes (workshop_id);
CREATE INDEX IF NOT EXISTS notes_search ON notes USING gin (to_tsvector('simple', coalesce(text, '')));
CREATE TABLE IF NOT EXISTS connectors (
  id text PRIMARY KEY, workshop_id text NOT NULL, from_note text NOT NULL, to_note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), seq bigserial);
CREATE INDEX IF NOT EXISTS connectors_workshop ON connectors (workshop_id);
CREATE TABLE IF NOT EXISTS dot_ledger (
  id text PRIMARY KEY, workshop_id text NOT NULL, participant_id text NOT NULL, cluster_id text NOT NULL,
  kind text NOT NULL, cancels text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), seq bigserial);
CREATE INDEX IF NOT EXISTS dot_ledger_workshop ON dot_ledger (workshop_id);
CREATE TABLE IF NOT EXISTS images (
  id text PRIMARY KEY, workshop_id text NOT NULL, uploader text NOT NULL, content_type text NOT NULL,
  width int NOT NULL, height int NOT NULL, note_id text UNIQUE, gone boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS image_deletions (
  image_id text PRIMARY KEY, workshop_id text NOT NULL, attempts int NOT NULL DEFAULT 0, lease_until timestamptz);
CREATE TABLE IF NOT EXISTS versions (
  id text PRIMARY KEY, workshop_id text NOT NULL, version bigint NOT NULL, reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), snapshot jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS versions_workshop ON versions (workshop_id);
CREATE TABLE IF NOT EXISTS ops (
  actor text NOT NULL, client_op_id text NOT NULL, fingerprint text NOT NULL, status int, body text,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (actor, client_op_id));
CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY, workshop_id text NOT NULL, email text NOT NULL, status text NOT NULL,
  attempts int NOT NULL DEFAULT 0, lease_until timestamptz, sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), seq bigserial);
CREATE INDEX IF NOT EXISTS invites_workshop ON invites (workshop_id);
CREATE TABLE IF NOT EXISTS invite_counts (
  facilitator_id text NOT NULL, day text NOT NULL, count int NOT NULL, PRIMARY KEY (facilitator_id, day));
CREATE TABLE IF NOT EXISTS rate_counters (
  class text NOT NULL, key text NOT NULL, window_start bigint NOT NULL, count int NOT NULL,
  PRIMARY KEY (class, key, window_start));
CREATE TABLE IF NOT EXISTS activity (
  seq bigserial PRIMARY KEY, id text UNIQUE NOT NULL, facilitator_id text NOT NULL, at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL, action text NOT NULL, workshop_id text);
CREATE INDEX IF NOT EXISTS activity_facilitator ON activity (facilitator_id, seq DESC);
CREATE TABLE IF NOT EXISTS recaps (
  workshop_id text PRIMARY KEY REFERENCES workshops, token text UNIQUE NOT NULL, status text NOT NULL, reason text,
  attempts int NOT NULL DEFAULT 0, files_stored_at timestamptz, email_sent_at timestamptz, scale int NOT NULL,
  invoice_id text, invoice_number text, invoice_amount_cents bigint, lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS recap_mails (
  workshop_id text NOT NULL, email text NOT NULL, sent_at timestamptz, PRIMARY KEY (workshop_id, email));
CREATE TABLE IF NOT EXISTS billing (
  facilitator_id text PRIMARY KEY REFERENCES facilitators, kb_account_id text, subscription_id text,
  plan text NOT NULL, term text NOT NULL, renews_on text, pending_plan text, pending_term text, pending_date text,
  past_due_since timestamptz, synced_at timestamptz, lease_until timestamptz);
CREATE TABLE IF NOT EXISTS facilitator_invoices (
  id text PRIMARY KEY, facilitator_id text NOT NULL, number text NOT NULL, date text NOT NULL,
  amount_cents bigint NOT NULL, balance_cents bigint NOT NULL);
CREATE TABLE IF NOT EXISTS setup (key text PRIMARY KEY, value text NOT NULL);
`;

/** Applies the schema; retries until Postgres answers. */
export async function migrate(): Promise<void> {
  for (;;) {
    try {
      await tx(async (t) => {
        await t.run("SELECT pg_advisory_xact_lock(4173001)");
        for (const statement of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await t.run(statement);
      });
      return;
    } catch (error) {
      console.error(`database not ready: ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
