import pg from "pg";

// Applied on every start; harmless when it already exists. Column additions use IF NOT EXISTS.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS couriers (
  id text PRIMARY KEY,
  email text UNIQUE,
  role text NOT NULL CHECK (role IN ('guest','courier','helper','founder')),
  display_name text NOT NULL,
  name_locked boolean NOT NULL DEFAULT false,
  muted boolean NOT NULL DEFAULT false,
  worn_satchel text NOT NULL DEFAULT 'canvas',
  guest_save_claimed boolean NOT NULL DEFAULT false,
  moderation_ref text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  courier_id text NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS satchel_ownership (
  courier_id text NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
  satchel_id text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (courier_id, satchel_id)
);

CREATE TABLE IF NOT EXISTS ledger_movements (
  movement_id text PRIMARY KEY,
  courier_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('delivery','purchase')),
  ref text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_by_courier ON ledger_movements (courier_id, created_at DESC, movement_id DESC);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  movement_id text NOT NULL REFERENCES ledger_movements(movement_id) ON DELETE CASCADE,
  account text NOT NULL CHECK (account IN ('courier','mint','outfitter')),
  amount integer NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_entries_movement ON ledger_entries (movement_id);

CREATE TABLE IF NOT EXISTS postbox_keys (
  token text PRIMARY KEY,
  email text NOT NULL,
  return_to text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS missions (
  mission_id text PRIMARY KEY,
  title text NOT NULL,
  resident_id text NOT NULL,
  reward_stamps integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('standard','rush')),
  rush_slots integer,
  status text NOT NULL CHECK (status IN ('draft','scheduled','live','retired')),
  version integer NOT NULL,
  revision integer NOT NULL,
  live_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mission_versions (
  mission_id text NOT NULL,
  version integer NOT NULL,
  title text NOT NULL,
  resident_id text NOT NULL,
  reward_stamps integer NOT NULL,
  offer jsonb NOT NULL,
  thanks jsonb NOT NULL,
  PRIMARY KEY (mission_id, version)
);

CREATE TABLE IF NOT EXISTS acceptances (
  acceptance_id text PRIMARY KEY,
  courier_id text NOT NULL,
  mission_id text NOT NULL,
  version integer NOT NULL,
  kind text NOT NULL,
  rush_id text,
  route_id text NOT NULL,
  door_lat double precision NOT NULL,
  door_lon double precision NOT NULL,
  total_arc_m double precision NOT NULL,
  initial_bearing_deg integer NOT NULL,
  first_answer text NOT NULL,
  hold_expires_at timestamptz,
  status text NOT NULL CHECK (status IN ('open','delivered','dropped','expired')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acceptances_open ON acceptances (courier_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS deliveries (
  delivery_id text PRIMARY KEY,
  acceptance_id text NOT NULL UNIQUE REFERENCES acceptances(acceptance_id) ON DELETE CASCADE,
  mission_id text NOT NULL,
  version integer NOT NULL,
  stamps_awarded integer NOT NULL,
  movement_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rush_parcels (
  rush_id text PRIMARY KEY,
  mission_id text NOT NULL,
  board_date text NOT NULL,
  slot integer NOT NULL,
  slots integer NOT NULL,
  status text NOT NULL CHECK (status IN ('posted','claimed','delivered','gone')),
  claimed_by text,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rush_by_board ON rush_parcels (board_date, mission_id, slot);

CREATE TABLE IF NOT EXISTS board_days (
  board_date text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  namespace text NOT NULL CHECK (namespace IN ('handover','purchase','mail')),
  courier_id text NOT NULL,
  ticket text NOT NULL,
  bound text NOT NULL DEFAULT '',
  status integer,
  body text,
  pending boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, courier_id, ticket)
);

CREATE TABLE IF NOT EXISTS presence (
  session_id text NOT NULL,
  courier_id text NOT NULL,
  stream text NOT NULL,
  last_seq bigint NOT NULL DEFAULT 0,
  lat double precision,
  lon double precision,
  heading_deg double precision,
  emote text,
  emote_at timestamptz,
  at timestamptz NOT NULL,
  recv bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, stream)
);
CREATE INDEX IF NOT EXISTS presence_courier ON presence (courier_id, at DESC);
CREATE SEQUENCE IF NOT EXISTS presence_recv_seq;

CREATE TABLE IF NOT EXISTS postcards (
  postcard_id text PRIMARY KEY,
  courier_id text NOT NULL,
  share_token text NOT NULL UNIQUE,
  width integer NOT NULL,
  height integer NOT NULL,
  bytes integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS mail_sends (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  courier_id text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_sends_window ON mail_sends (courier_id, at DESC);

CREATE TABLE IF NOT EXISTS moderation_audit (
  entry_id text PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('mute','unmute','rename')),
  actor_role text NOT NULL CHECK (actor_role IN ('helper','founder')),
  actor_display_name text NOT NULL,
  moderation_ref text NOT NULL,
  target_name_before text NOT NULL,
  target_name_after text NOT NULL,
  at timestamptz NOT NULL
);
`;

export type Tx = pg.PoolClient;

export class Db {
  constructor(private readonly pool: pg.Pool) {}

  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    return this.pool.query(text, params as unknown[]);
  }

  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      }
    } finally {
      client.release();
    }
  }

  async migrate(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
