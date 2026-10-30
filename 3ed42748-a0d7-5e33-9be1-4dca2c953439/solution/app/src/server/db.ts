// Postgres: the pool, transactions, the schema applied on every start and the one-time seed.
import pg from "pg";
import { config } from "./config";
import { randomId, secretToken } from "./ids";
import { SEED_COURIERS, SEED_MISSIONS, SEED_TIME_ZONE } from "./seed";

pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => Number(v));
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 5000 });
pool.on("error", () => {
  // An idle client lost its connection; the pool replaces it on the next checkout.
});

export type Db = pg.PoolClient | pg.Pool;

let ready = false;
export const databaseReady = (): boolean => ready;

const RETRYABLE = new Set(["40001", "40P01"]);

export async function tx<T>(work: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const code = (error as { code?: string }).code;
      if (code && RETRYABLE.has(code) && attempt < 4) continue;
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const result = await db.query(sql, params);
  return result.rows[0] as T | undefined;
}

export async function all<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(sql, params);
  return result.rows as T[];
}

/** Serialises work on one key until the surrounding transaction ends. */
export async function lockKey(db: pg.PoolClient, key: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_settings (
  id int PRIMARY KEY,
  time_zone text NOT NULL,
  cursor_secret text NOT NULL
);
CREATE TABLE IF NOT EXISTS couriers (
  id text PRIMARY KEY,
  role text NOT NULL,
  email text UNIQUE,
  display_name text NOT NULL,
  name_locked boolean NOT NULL DEFAULT false,
  muted boolean NOT NULL DEFAULT false,
  satchel_id text NOT NULL DEFAULT 'canvas',
  moderation_ref text NOT NULL UNIQUE,
  merged_into text REFERENCES couriers(id),
  emote text,
  emote_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS couriers_merged_into ON couriers(merged_into) WHERE merged_into IS NOT NULL;
CREATE TABLE IF NOT EXISTS owned_satchels (
  courier_id text NOT NULL REFERENCES couriers(id),
  satchel_id text NOT NULL,
  PRIMARY KEY (courier_id, satchel_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  courier_id text NOT NULL REFERENCES couriers(id),
  created_at timestamptz NOT NULL,
  ended_at timestamptz
);
CREATE TABLE IF NOT EXISTS postbox_keys (
  id text PRIMARY KEY,
  email text NOT NULL,
  return_to text NOT NULL,
  created_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS missions (
  id text PRIMARY KEY,
  kind text NOT NULL,
  status text NOT NULL,
  version int NOT NULL,
  revision int NOT NULL,
  live_at timestamptz,
  created_seq bigserial
);
CREATE TABLE IF NOT EXISTS mission_versions (
  mission_id text NOT NULL REFERENCES missions(id),
  version int NOT NULL,
  title text NOT NULL,
  resident_id text NOT NULL,
  reward_stamps int NOT NULL,
  rush_slots int,
  offer jsonb NOT NULL,
  thanks jsonb NOT NULL,
  PRIMARY KEY (mission_id, version)
);
CREATE TABLE IF NOT EXISTS board_days (
  board_date date PRIMARY KEY,
  posted_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS rush_parcels (
  id text PRIMARY KEY,
  board_date date NOT NULL,
  mission_id text NOT NULL REFERENCES missions(id),
  slot int NOT NULL,
  slots int NOT NULL,
  state text NOT NULL,
  acceptance_id text,
  UNIQUE (board_date, mission_id, slot)
);
CREATE TABLE IF NOT EXISTS acceptances (
  id text PRIMARY KEY,
  courier_id text NOT NULL REFERENCES couriers(id),
  mission_id text NOT NULL REFERENCES missions(id),
  version int NOT NULL,
  rush_id text,
  hold_expires_at timestamptz,
  status text NOT NULL,
  first_answer text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS acceptances_open ON acceptances(courier_id) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS movements (
  id text PRIMARY KEY,
  courier_id text NOT NULL REFERENCES couriers(id),
  kind text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS movements_by_owner ON movements(courier_id, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigserial PRIMARY KEY,
  movement_id text NOT NULL REFERENCES movements(id),
  account text NOT NULL,
  amount int NOT NULL,
  ref text NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_entries_movement ON ledger_entries(movement_id);
CREATE TABLE IF NOT EXISTS deliveries (
  id text PRIMARY KEY,
  acceptance_id text NOT NULL UNIQUE REFERENCES acceptances(id),
  movement_id text NOT NULL REFERENCES movements(id),
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  courier_id text NOT NULL REFERENCES couriers(id),
  namespace text NOT NULL,
  ticket text NOT NULL,
  binding text NOT NULL,
  status int NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (courier_id, namespace, ticket)
);
CREATE SEQUENCE IF NOT EXISTS presence_order;
CREATE TABLE IF NOT EXISTS presence_streams (
  session_id text NOT NULL REFERENCES sessions(id),
  stream text NOT NULL,
  last_seq bigint NOT NULL,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  heading_deg double precision NOT NULL,
  received_at timestamptz NOT NULL,
  recv_order bigint NOT NULL,
  PRIMARY KEY (session_id, stream)
);
CREATE TABLE IF NOT EXISTS postcards (
  id text PRIMARY KEY,
  courier_id text NOT NULL REFERENCES couriers(id),
  share_token text NOT NULL UNIQUE,
  width int NOT NULL,
  height int NOT NULL,
  bytes int NOT NULL,
  created_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS mail_slots (
  id bigserial PRIMARY KEY,
  courier_id text NOT NULL REFERENCES couriers(id),
  reserved_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_slots_courier ON mail_slots(courier_id, reserved_at);
CREATE TABLE IF NOT EXISTS moderation_audit (
  seq bigserial PRIMARY KEY,
  entry_id text NOT NULL UNIQUE,
  action text NOT NULL,
  actor_role text NOT NULL,
  actor_display_name text NOT NULL,
  moderation_ref text NOT NULL,
  target_name_before text NOT NULL,
  target_name_after text NOT NULL,
  at timestamptz NOT NULL
);
CREATE OR REPLACE FUNCTION append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table';
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['movements', 'ledger_entries', 'moderation_audit'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_append_only') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION append_only()',
                     t || '_append_only', t);
    END IF;
  END LOOP;
END $$;
`;

async function seed(db: pg.PoolClient): Promise<void> {
  const inserted = await db.query(
    "INSERT INTO app_settings (id, time_zone, cursor_secret) VALUES (1, $1, $2) ON CONFLICT DO NOTHING",
    [SEED_TIME_ZONE, secretToken()],
  );
  if (inserted.rowCount === 0) return;
  const now = Date.now();
  for (const m of SEED_MISSIONS) {
    await db.query(
      "INSERT INTO missions (id, kind, status, version, revision, live_at) VALUES ($1, $2, $3, 1, 1, $4)",
      [m.id, m.kind, m.status, m.status === "live" ? new Date(now) : null],
    );
    await db.query(
      `INSERT INTO mission_versions (mission_id, version, title, resident_id, reward_stamps, rush_slots, offer, thanks)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
      [m.id, m.title, m.resident, m.reward, m.rushSlots, JSON.stringify(m.offer), JSON.stringify(m.thanks)],
    );
  }
  for (const c of SEED_COURIERS) {
    const id = randomId("cr_");
    await db.query(
      "INSERT INTO couriers (id, role, email, display_name, moderation_ref, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, c.role, c.email, c.name, randomId("mr_"), new Date(now)],
    );
    await db.query("INSERT INTO owned_satchels (courier_id, satchel_id) VALUES ($1, 'canvas')", [id]);
    for (const [index, d] of c.deliveries.entries()) {
      const movementId = randomId("mv_");
      const at = new Date(now - (c.deliveries.length - 1 - index) * 1000);
      await db.query("INSERT INTO movements (id, courier_id, kind, created_at) VALUES ($1, $2, 'delivery', $3)", [
        movementId,
        id,
        at,
      ]);
      await db.query(
        "INSERT INTO ledger_entries (movement_id, account, amount, ref) VALUES ($1, 'courier', $2, $3), ($1, 'mint', $4, $3)",
        [movementId, d.reward, d.missionId, -d.reward],
      );
    }
  }
}

async function prepare(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('parcel-moon-schema', 0))");
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

/** Connects, retrying every 2 seconds until Postgres answers, then applies the schema and seed. */
export function connectDatabase(onReady: () => void): void {
  const attempt = (): void => {
    prepare().then(
      () => {
        ready = true;
        onReady();
      },
      (error: unknown) => {
        console.error("database not ready yet:", (error as Error).message);
        setTimeout(attempt, 2000);
      },
    );
  };
  attempt();
}

