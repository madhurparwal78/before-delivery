import pg from "pg";
import { config } from "./config";

// Return dates and numerics as text; the domain converts them exactly.
pg.types.setTypeParser(1082, (value: string) => value);
pg.types.setTypeParser(1700, (value: string) => value);
pg.types.setTypeParser(20, (value: string) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

export type Db = pg.Pool | pg.PoolClient;

export async function rows<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

export async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await db.query(sql, params)).rows[0] as T | undefined;
}

/** Runs `work` in one transaction; any throw rolls it back. */
export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

export async function waitForDatabase(): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (attempt % 10 === 1) console.log(`waiting for Postgres: ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  slug text PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS yachts (
  id uuid PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  slug text NOT NULL,
  name text NOT NULL,
  base text NOT NULL,
  status text NOT NULL,
  cabins integer NOT NULL,
  length_cm integer NOT NULL,
  beam_cm integer NOT NULL,
  draft_cm integer NOT NULL,
  battery_kwh numeric NOT NULL,
  hotel_kw numeric NOT NULL,
  solar_kw numeric NOT NULL,
  drag_kw_per_kn_cubed numeric NOT NULL,
  shore_power_kw integer NOT NULL,
  rate_low_minor bigint NOT NULL,
  rate_shoulder_minor bigint NOT NULL,
  rate_high_minor bigint NOT NULL,
  UNIQUE (workspace_slug, slug)
);
CREATE TABLE IF NOT EXISTS crew (
  id uuid PRIMARY KEY,
  yacht_id uuid NOT NULL REFERENCES yachts(id),
  name text NOT NULL,
  position text NOT NULL,
  sort integer NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL,
  yacht_id uuid REFERENCES yachts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS members_email_active ON members (lower(email)) WHERE removed_at IS NULL;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  ended_at timestamptz
);
CREATE TABLE IF NOT EXISTS brokers (
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  id text NOT NULL,
  name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL,
  notes text NOT NULL,
  PRIMARY KEY (workspace_slug, id)
);
CREATE TABLE IF NOT EXISTS holds (
  id uuid PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  yacht_id uuid NOT NULL REFERENCES yachts(id),
  week_start date NOT NULL,
  client_name text NOT NULL,
  placed_by_kind text NOT NULL,
  placed_by_name text NOT NULL,
  broker_id text,
  status text NOT NULL,
  line_seq bigserial,
  placed_at timestamptz NOT NULL,
  live_since timestamptz,
  lapses_at timestamptz,
  charter_id uuid
);
CREATE INDEX IF NOT EXISTS holds_week ON holds (yacht_id, week_start);
CREATE INDEX IF NOT EXISTS holds_live ON holds (lapses_at) WHERE status = 'live';
CREATE TABLE IF NOT EXISTS exchange_tables (
  id uuid PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  effective_date date NOT NULL,
  gbp text NOT NULL,
  usd text NOT NULL,
  UNIQUE (workspace_slug, effective_date)
);
CREATE TABLE IF NOT EXISTS charters (
  id uuid PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  hold_id uuid,
  yacht_id uuid NOT NULL REFERENCES yachts(id),
  week_start date NOT NULL,
  client_name text NOT NULL,
  client_email text NOT NULL,
  currency text NOT NULL,
  season text NOT NULL,
  deposit_date date,
  exchange_table_id uuid NOT NULL REFERENCES exchange_tables(id),
  rate text NOT NULL,
  lines jsonb NOT NULL,
  total_eur_minor bigint NOT NULL,
  total_minor bigint NOT NULL,
  invoice_status text NOT NULL,
  killbill_invoice_id text,
  invoiced_at timestamptz,
  status text NOT NULL,
  closed_at timestamptz,
  erases_at timestamptz,
  erased boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  UNIQUE (yacht_id, week_start)
);
CREATE TABLE IF NOT EXISTS guests (
  id uuid PRIMARY KEY,
  charter_id uuid NOT NULL REFERENCES charters(id),
  full_name text NOT NULL,
  nationality text,
  date_of_birth date,
  passport_number text,
  photo_key text,
  photo_type text,
  created_at timestamptz NOT NULL,
  sort bigserial
);
CREATE TABLE IF NOT EXISTS private_pages (
  token text PRIMARY KEY,
  kind text NOT NULL,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  charter_id uuid REFERENCES charters(id),
  broker_id text,
  issued_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS private_pages_owner ON private_pages (workspace_slug, kind, charter_id, broker_id);
CREATE TABLE IF NOT EXISTS broker_hold_requests (
  token text NOT NULL,
  requested_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS broker_hold_requests_token ON broker_hold_requests (token, requested_at);
CREATE TABLE IF NOT EXISTS anchorages (
  id text PRIMARY KEY,
  name text NOT NULL,
  base text NOT NULL,
  latitude numeric NOT NULL,
  longitude numeric NOT NULL,
  sort integer NOT NULL
);
CREATE TABLE IF NOT EXISTS passages (
  id uuid PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  yacht_id uuid NOT NULL REFERENCES yachts(id),
  name text NOT NULL,
  status text NOT NULL,
  start_anchorage_id text NOT NULL REFERENCES anchorages(id),
  departure_date date NOT NULL,
  departure_time text NOT NULL,
  departs_at timestamptz NOT NULL,
  start_charge_pct integer NOT NULL,
  legs jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS rotas (
  yacht_id uuid NOT NULL REFERENCES yachts(id),
  week_start date NOT NULL,
  version integer NOT NULL,
  saved_by text,
  saved_at timestamptz,
  PRIMARY KEY (yacht_id, week_start)
);
CREATE TABLE IF NOT EXISTS rota_work (
  yacht_id uuid NOT NULL,
  week_start date NOT NULL,
  crew_id uuid NOT NULL REFERENCES crew(id),
  slot_start timestamptz NOT NULL,
  PRIMARY KEY (yacht_id, week_start, crew_id, slot_start)
);
CREATE TABLE IF NOT EXISTS marinas (
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  id text NOT NULL,
  name text NOT NULL,
  base text NOT NULL,
  PRIMARY KEY (workspace_slug, id)
);
CREATE TABLE IF NOT EXISTS berths (
  workspace_slug text NOT NULL,
  marina_id text NOT NULL,
  code text NOT NULL,
  length_cm integer NOT NULL,
  width_cm integer NOT NULL,
  depth_cm integer NOT NULL,
  PRIMARY KEY (workspace_slug, marina_id, code)
);
CREATE TABLE IF NOT EXISTS pontoons (
  workspace_slug text NOT NULL,
  marina_id text NOT NULL,
  code text NOT NULL,
  limit_kw integer NOT NULL,
  PRIMARY KEY (workspace_slug, marina_id, code)
);
CREATE TABLE IF NOT EXISTS tariffs (
  id uuid PRIMARY KEY,
  workspace_slug text NOT NULL,
  marina_id text NOT NULL,
  effective_date date NOT NULL,
  rate_per_metre_minor integer NOT NULL,
  UNIQUE (workspace_slug, marina_id, effective_date)
);
CREATE TABLE IF NOT EXISTS berth_bookings (
  id uuid PRIMARY KEY,
  workspace_slug text NOT NULL,
  yacht_id uuid NOT NULL REFERENCES yachts(id),
  marina_id text NOT NULL,
  berth_code text NOT NULL,
  arrival_date date NOT NULL,
  departure_date date NOT NULL,
  nights jsonb NOT NULL,
  total_minor bigint NOT NULL,
  booked_by text NOT NULL,
  booked_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS berth_nights (
  workspace_slug text NOT NULL,
  marina_id text NOT NULL,
  berth_code text NOT NULL,
  night date NOT NULL,
  booking_id uuid NOT NULL REFERENCES berth_bookings(id),
  PRIMARY KEY (workspace_slug, marina_id, berth_code, night)
);
CREATE TABLE IF NOT EXISTS shore_power_bookings (
  id uuid PRIMARY KEY,
  workspace_slug text NOT NULL,
  yacht_id uuid NOT NULL REFERENCES yachts(id),
  marina_id text NOT NULL,
  pontoon_code text NOT NULL,
  slot_start timestamptz NOT NULL,
  kw integer NOT NULL,
  booked_by text NOT NULL,
  booked_at timestamptz NOT NULL,
  UNIQUE (workspace_slug, marina_id, pontoon_code, slot_start, yacht_id)
);
CREATE TABLE IF NOT EXISTS store_items (
  id uuid PRIMARY KEY,
  yacht_id uuid NOT NULL REFERENCES yachts(id),
  name text NOT NULL,
  unit text NOT NULL,
  category text NOT NULL,
  received_qty integer NOT NULL DEFAULT 0,
  used_qty integer NOT NULL DEFAULT 0,
  spoiled_qty integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS store_items_name ON store_items (yacht_id, lower(name));
CREATE TABLE IF NOT EXISTS store_movements (
  id uuid PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES store_items(id) ON DELETE CASCADE,
  kind text NOT NULL,
  quantity integer NOT NULL,
  logged_by text,
  logged_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS energy_logs (
  id uuid PRIMARY KEY,
  yacht_id uuid NOT NULL REFERENCES yachts(id),
  file_name text NOT NULL,
  size_bytes integer NOT NULL,
  uploaded_at timestamptz NOT NULL,
  uploaded_by text NOT NULL,
  object_key text NOT NULL,
  day_count integer NOT NULL,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS energy_entries (
  log_id uuid NOT NULL REFERENCES energy_logs(id),
  line_no integer NOT NULL,
  day date NOT NULL,
  at timestamptz NOT NULL,
  charge_pct numeric NOT NULL,
  solar_wh bigint NOT NULL,
  PRIMARY KEY (log_id, line_no)
);
`;

export async function migrate(): Promise<void> {
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(7413)");
    await client.query(SCHEMA);
  });
}
