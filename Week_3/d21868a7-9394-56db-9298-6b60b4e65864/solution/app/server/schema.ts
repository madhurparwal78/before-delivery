// The database schema. Every ML and ML/day column is bigint thousandths; applying it again changes nothing.
import type { Db } from "./db.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS person (
  id serial PRIMARY KEY,
  name text,
  email text UNIQUE,
  password_hash text,
  role text NOT NULL CHECK (role IN ('grower', 'operator', 'dispatcher', 'clerk', 'reviewer')),
  operator_code text UNIQUE,
  operator_kind text CHECK (operator_kind IN ('district', 'contractor')),
  phone text,
  erased boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS allocation (
  grower_id integer PRIMARY KEY REFERENCES person,
  allocation_milli bigint NOT NULL,
  debited_milli bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS session (
  token_hash text PRIMARY KEY,
  person_id integer NOT NULL REFERENCES person ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS channel (
  id text PRIMARY KEY,
  name text NOT NULL,
  rail_order integer NOT NULL,
  capacity_revision integer NOT NULL
);
CREATE TABLE IF NOT EXISTS turnout (
  code text PRIMARY KEY,
  channel_id text NOT NULL REFERENCES channel,
  grower_id integer NOT NULL REFERENCES person,
  max_rate_milli bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS delivery_window (
  id text PRIMARY KEY,
  channel_id text NOT NULL REFERENCES channel,
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  hours integer NOT NULL,
  table_cap_milli bigint NOT NULL,
  rostered_operator text NOT NULL,
  committed_milli bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS restriction (
  id serial PRIMARY KEY,
  window_id text NOT NULL UNIQUE REFERENCES delivery_window,
  cap_milli bigint NOT NULL,
  reason text NOT NULL,
  effective_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS restriction_move (
  restriction_id integer NOT NULL REFERENCES restriction,
  order_number text NOT NULL,
  PRIMARY KEY (restriction_id, order_number)
);
CREATE TABLE IF NOT EXISTS capacity_revision (
  channel_id text NOT NULL REFERENCES channel,
  revision integer NOT NULL,
  saved_at timestamptz NOT NULL,
  saved_by text NOT NULL,
  restored_from integer,
  PRIMARY KEY (channel_id, revision)
);
CREATE TABLE IF NOT EXISTS capacity_cell (
  channel_id text NOT NULL,
  revision integer NOT NULL,
  window_id text NOT NULL REFERENCES delivery_window,
  cap_milli bigint NOT NULL,
  PRIMARY KEY (channel_id, revision, window_id)
);
CREATE TABLE IF NOT EXISTS water_order (
  number text PRIMARY KEY,
  grower_id integer NOT NULL REFERENCES person,
  turnout text NOT NULL REFERENCES turnout,
  window_id text NOT NULL REFERENCES delivery_window,
  requested_milli bigint NOT NULL,
  volume_milli bigint NOT NULL,
  rate_milli bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('requested', 'scheduled', 'running', 'delivered', 'closed')),
  holder_code text NOT NULL,
  standby_code text,
  conflict text CHECK (conflict IN ('restriction', 'lapsed')),
  closed_after_flow boolean NOT NULL DEFAULT false,
  rationed boolean NOT NULL DEFAULT false,
  scheduled_at timestamptz,
  flow_started_at timestamptz,
  flow_stopped_at timestamptz
);
CREATE TABLE IF NOT EXISTS gate_card (
  id serial PRIMARY KEY,
  order_number text NOT NULL REFERENCES water_order,
  kind text NOT NULL CHECK (kind IN ('start', 'finish')),
  state text NOT NULL CHECK (state IN ('open', 'waiting-for-store', 'spent')),
  holder_code text NOT NULL,
  handed_over boolean NOT NULL DEFAULT false,
  from_milli bigint NOT NULL,
  to_milli bigint NOT NULL,
  stroke_key text,
  stroke_operator_code text,
  committed_at timestamptz,
  confirmed_at timestamptz
);
CREATE TABLE IF NOT EXISTS notice (
  id serial PRIMARY KEY,
  window_id text NOT NULL REFERENCES delivery_window,
  grower_id integer NOT NULL REFERENCES person,
  kind text NOT NULL CHECK (kind IN ('conflict', 'restriction', 'ration', 'lapse')),
  subject text NOT NULL,
  body text NOT NULL,
  state text NOT NULL CHECK (state IN ('queued', 'sent')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pack (
  number text PRIMARY KEY,
  period_from date NOT NULL,
  period_to date NOT NULL,
  signatory text NOT NULL,
  document bytea NOT NULL,
  sha256 text,
  state text NOT NULL CHECK (state IN ('building', 'stored', 'mailed', 'withdrawn')),
  stalled_on text CHECK (stalled_on IN ('store', 'mail')),
  object_may_exist boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  mailed_at timestamptz
);
CREATE TABLE IF NOT EXISTS counter (
  name text PRIMARY KEY,
  value integer NOT NULL
);
`;

export async function applySchema(db: Db): Promise<void> {
  await db.query(SCHEMA);
}

/** The next value of a numbering sequence; transactional, so a refused request leaves no gap. */
export async function nextNumber(db: Db, name: "order" | "pack" | "window"): Promise<number> {
  const result = await db.query<{ value: number }>(
    "UPDATE counter SET value = value + 1 WHERE name = $1 RETURNING value",
    [name],
  );
  return result.rows[0]!.value;
}
