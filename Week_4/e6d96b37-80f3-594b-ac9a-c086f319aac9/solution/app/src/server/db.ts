// Postgres: the system of record. One pool, an idempotent schema applied on serve, and
// transactions that lock one namespace so every command decides against a stable desk.

import pg from "pg";
import { config } from "./config.js";
import { serviceUnavailable } from "./errors.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS desks (
  ns text PRIMARY KEY,
  grading boolean NOT NULL,
  clock_at timestamptz,
  tray_version integer NOT NULL DEFAULT 1,
  album_version integer NOT NULL DEFAULT 1,
  keeper_version integer NOT NULL DEFAULT 1,
  keeper_order jsonb NOT NULL DEFAULT '[]',
  keeper_previous jsonb,
  album jsonb,
  last_sequence bigint NOT NULL DEFAULT 0,
  next_creation bigint NOT NULL DEFAULT 1,
  next_dispute integer NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS specimens (
  ns text NOT NULL REFERENCES desks(ns) ON DELETE CASCADE,
  key text NOT NULL,
  creation bigint NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (ns, key)
);
CREATE TABLE IF NOT EXISTS tray_cells (
  ns text NOT NULL REFERENCES desks(ns) ON DELETE CASCADE,
  cell text NOT NULL,
  specimen text,
  audit_mark text,
  audit_version integer NOT NULL DEFAULT 0,
  PRIMARY KEY (ns, cell)
);
CREATE TABLE IF NOT EXISTS register_records (
  ns text NOT NULL REFERENCES desks(ns) ON DELETE CASCADE,
  reference text NOT NULL,
  revision integer NOT NULL,
  issue text NOT NULL,
  mintmark text NOT NULL,
  image_path text NOT NULL,
  image_object_key text NOT NULL,
  PRIMARY KEY (ns, reference, revision)
);
CREATE TABLE IF NOT EXISTS offers (
  ns text NOT NULL REFERENCES desks(ns) ON DELETE CASCADE,
  key text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (ns, key)
);
CREATE TABLE IF NOT EXISTS manifests (
  ns text NOT NULL REFERENCES desks(ns) ON DELETE CASCADE,
  offer text NOT NULL,
  party text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (ns, offer, party)
);
CREATE TABLE IF NOT EXISTS receipts (
  ns text NOT NULL REFERENCES desks(ns) ON DELETE CASCADE,
  offer text NOT NULL,
  party text NOT NULL,
  matches boolean NOT NULL,
  PRIMARY KEY (ns, offer, party)
);
CREATE TABLE IF NOT EXISTS disputes (
  ns text NOT NULL REFERENCES desks(ns) ON DELETE CASCADE,
  key text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (ns, key)
);
CREATE TABLE IF NOT EXISTS evidence_links (
  token text PRIMARY KEY,
  ns text NOT NULL REFERENCES desks(ns) ON DELETE CASCADE,
  dispute text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS desk_events (
  ns text NOT NULL REFERENCES desks(ns) ON DELETE CASCADE,
  sequence bigint NOT NULL,
  command_id text NOT NULL,
  actor text NOT NULL,
  type text NOT NULL,
  at timestamptz NOT NULL,
  offers text[] NOT NULL DEFAULT '{}',
  detail jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (ns, sequence)
);
CREATE TABLE IF NOT EXISTS audit_marks (
  ns text NOT NULL REFERENCES desks(ns) ON DELETE CASCADE,
  sequence bigint NOT NULL,
  cell text NOT NULL,
  mark text NOT NULL,
  actor text NOT NULL,
  command_id text NOT NULL,
  PRIMARY KEY (ns, sequence)
);
CREATE TABLE IF NOT EXISTS command_replies (
  ns text NOT NULL REFERENCES desks(ns) ON DELETE CASCADE,
  command_id text NOT NULL,
  payload_hash text NOT NULL,
  status integer NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (ns, command_id)
);
CREATE TABLE IF NOT EXISTS identities (
  ns text NOT NULL,
  role text NOT NULL,
  username text NOT NULL UNIQUE,
  totp_secret text NOT NULL,
  PRIMARY KEY (ns, role)
);
CREATE TABLE IF NOT EXISTS app_sessions (
  id text PRIMARY KEY,
  ns text NOT NULL,
  subject text NOT NULL,
  username text NOT NULL,
  role text NOT NULL,
  keycloak_session text,
  started_at timestamptz NOT NULL,
  step_up_at timestamptz,
  ended boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS app_sessions_subject ON app_sessions (subject);
CREATE TABLE IF NOT EXISTS sign_in_requests (
  state text PRIMARY KEY,
  kind text NOT NULL,
  return_to text NOT NULL,
  verifier text NOT NULL,
  session_id text,
  requested_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS stream_presence (
  stream text PRIMARY KEY,
  ns text NOT NULL,
  subject text NOT NULL,
  heartbeat_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS stream_departures (
  ns text NOT NULL,
  subject text NOT NULL,
  left_at timestamptz NOT NULL,
  PRIMARY KEY (ns, subject)
);
`;

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 16,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
});
pool.on("error", () => undefined);

let ready: Promise<void> | null = null;

/** Applies the schema once per process; a failure is retried on the next request that needs it. */
export function ensureSchema(): Promise<void> {
  ready ??= (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('flan-schema'))");
      await client.query(SCHEMA);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  })().catch((error: unknown) => {
    ready = null;
    throw error;
  });
  return ready;
}

/** Runs a read against the pool, mapping an unreachable database to 503. */
export async function query<R extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<R[]> {
  try {
    await ensureSchema();
    const result = await pool.query<R>(text, values);
    return result.rows;
  } catch (error) {
    throw asServiceError(error);
  }
}

/** Reads through the pool (no held connection), mapping an unreachable database to 503. */
export async function reading<T>(work: (sql: pg.Pool) => Promise<T>): Promise<T> {
  try {
    await ensureSchema();
    return await work(pool);
  } catch (error) {
    throw asServiceError(error);
  }
}

/** A transaction; the callback's own HttpErrors pass through, database failures become 503. */
export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  let client: pg.PoolClient;
  try {
    await ensureSchema();
    client = await pool.connect();
  } catch (error) {
    throw asServiceError(error);
  }
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw asServiceError(error);
  } finally {
    client.release();
  }
}

/** Serialises work that several app instances might start together (realm setup, default desk). */
export async function exclusively<T>(name: string, work: () => Promise<T>): Promise<T> {
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [name]);
    return work();
  });
}

export async function notify(ns: string): Promise<void> {
  await pool.query("SELECT pg_notify('flan_events', $1)", [ns]).catch(() => undefined);
}

function asServiceError(error: unknown): unknown {
  if (error instanceof Error && "status" in error) return error;
  return serviceUnavailable();
}

/** A dedicated LISTEN connection; reconnects after a failure. */
export function listen(onNotify: (ns: string) => void): void {
  const connect = () => {
    const client = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000 });
    let retried = false;
    const retry = () => {
      if (retried) return;
      retried = true;
      client.end().catch(() => undefined);
      setTimeout(connect, 1000);
    };
    client.on("error", retry);
    client.on("end", retry);
    client.on("notification", (message) => {
      if (message.payload) onNotify(message.payload);
    });
    client
      .connect()
      .then(() => client.query("LISTEN flan_events"))
      .catch(retry);
  };
  connect();
}
