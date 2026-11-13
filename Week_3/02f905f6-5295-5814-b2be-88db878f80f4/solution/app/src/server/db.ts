// Postgres: the pool, transactions, and the schema and seed applied at every serve.
import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";
import { config } from "./config";

pg.types.setTypeParser(1082, (value: string) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 5000 });
pool.on("error", (error) => console.error("postgres pool error:", error.message));

export type Db = pg.PoolClient | pg.Pool;

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

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'tech', 'member')),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  member_number text UNIQUE,
  kb_account_id text
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS clays (
  id text PRIMARY KEY,
  name text NOT NULL,
  max_cone text NOT NULL,
  position integer NOT NULL
);
CREATE TABLE IF NOT EXISTS kilns (
  id text PRIMARY KEY,
  name text NOT NULL,
  position integer NOT NULL,
  shelf_diameter_halves integer NOT NULL,
  layers integer NOT NULL,
  post_height_halves integer NOT NULL,
  usable_cubic_inches integer NOT NULL,
  posts jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  id text PRIMARY KEY,
  kiln_id text NOT NULL REFERENCES kilns(id),
  name text NOT NULL,
  stage text NOT NULL,
  cone text NOT NULL,
  segments jsonb NOT NULL,
  cool_down_hours integer NOT NULL,
  position integer NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_sets (
  id serial PRIMARY KEY,
  bisque_rate numeric(6, 4) NOT NULL,
  glaze_rate numeric(6, 4) NOT NULL,
  member_discount_percent integer NOT NULL,
  order_minimum_cents integer NOT NULL,
  effective_date date NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
  id text PRIMARY KEY,
  uploader_id integer NOT NULL REFERENCES users(id),
  content_type text NOT NULL,
  bytes integer NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL,
  attached boolean NOT NULL DEFAULT false
);
CREATE SEQUENCE IF NOT EXISTS piece_numbers START 401;
CREATE TABLE IF NOT EXISTS pieces (
  number integer PRIMARY KEY,
  member_id integer REFERENCES users(id),
  guest_name text,
  guest_email text,
  shape text NOT NULL,
  length_halves integer,
  width_halves integer,
  diameter_halves integer,
  height_halves integer NOT NULL,
  cubic_eighths integer NOT NULL,
  rate_ten_thousandths integer NOT NULL,
  discount_percent integer NOT NULL,
  order_minimum_cents integer NOT NULL,
  minimum_applied boolean NOT NULL,
  fee_cents integer NOT NULL,
  rate_set_id integer NOT NULL REFERENCES rate_sets(id),
  plan text NOT NULL,
  stage text,
  cone text,
  clay_id text NOT NULL REFERENCES clays(id),
  status text NOT NULL,
  pickup_shelf text,
  intake_photo_id text NOT NULL REFERENCES photos(id),
  accepted_at timestamptz NOT NULL,
  ready_at timestamptz,
  reminder_sent boolean NOT NULL DEFAULT false,
  kb_account_id text NOT NULL,
  kb_invoice_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS pieces_status ON pieces(status);
CREATE TABLE IF NOT EXISTS firings (
  id serial PRIMARY KEY,
  kiln_id text NOT NULL REFERENCES kilns(id),
  profile_id text NOT NULL REFERENCES profiles(id),
  stage text NOT NULL,
  cone text NOT NULL,
  status text NOT NULL CHECK (status IN ('building', 'started', 'unloaded')),
  profile_snapshot jsonb,
  started_at timestamptz,
  firing_ends_at timestamptz,
  cool_until timestamptz,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS firings_one_open_per_kiln ON firings(kiln_id) WHERE status <> 'unloaded';
CREATE TABLE IF NOT EXISTS placements (
  firing_id integer NOT NULL REFERENCES firings(id),
  piece_number integer NOT NULL REFERENCES pieces(number),
  layer integer NOT NULL,
  x_halves integer NOT NULL,
  y_halves integer NOT NULL,
  rotation integer NOT NULL,
  PRIMARY KEY (firing_id, piece_number)
);
CREATE TABLE IF NOT EXISTS history (
  id bigserial PRIMARY KEY,
  piece_number integer NOT NULL REFERENCES pieces(number),
  at timestamptz NOT NULL,
  actor text NOT NULL,
  action text NOT NULL
);
CREATE INDEX IF NOT EXISTS history_piece ON history(piece_number);
CREATE TABLE IF NOT EXISTS damage_reports (
  id serial PRIMARY KEY,
  piece_number integer NOT NULL REFERENCES pieces(number),
  firing_id integer NOT NULL REFERENCES firings(id),
  kind text NOT NULL,
  note text NOT NULL,
  status text NOT NULL CHECK (status IN ('reported', 'charged', 'waived')),
  unload_photo_id text NOT NULL REFERENCES photos(id),
  amount_cents integer,
  reported_by text NOT NULL,
  reported_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS tracking_links (
  token text PRIMARY KEY,
  piece_number integer NOT NULL REFERENCES pieces(number),
  active boolean NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  to_address text NOT NULL,
  to_name text NOT NULL,
  subject text NOT NULL,
  text_body text NOT NULL,
  html_body text NOT NULL,
  created_at timestamptz NOT NULL,
  claimed_until timestamptz,
  sent_at timestamptz
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id integer NOT NULL REFERENCES users(id),
  key text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL CHECK (state IN ('running', 'done')),
  status integer,
  body jsonb,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, key)
);
`;

const PEOPLE = [
  ["Marguerite Okafor-Lind", "owner", "owner@brickfieldlane.example", "kiln-owner-2026", null],
  ["Tobias Wren", "tech", "tech@brickfieldlane.example", "kiln-tech-2026", null],
  ["Priya Halvorsen", "member", "priya@brickfieldlane.example", "member-priya-2026", "M104"],
  ["Dashiell Moreau", "member", "dash@brickfieldlane.example", "member-dash-2026", "M117"],
] as const;

const CLAYS = [
  ["buff", "Brickfield Buff Stoneware", "10"],
  ["porcelain", "Lane Porcelain", "6"],
  ["red", "Clayhouse Red Earthenware", "02"],
] as const;

/** posts as top-left corner and side, in halves: (11, 0.5), (2.5, 16.5), (19.5, 16.5), 1 x 1 in */
const POSTS = [
  { x: 22, y: 1, size: 2 },
  { x: 5, y: 33, size: 2 },
  { x: 39, y: 33, size: 2 },
];

const KILNS = [
  ["annie", "Big Annie", 4, 18, 12096],
  ["ned", "Little Ned", 3, 12, 6048],
] as const;

const BISQUE_04 = [
  { rate_f_per_hour: 186, target_f: 1000, hold_minutes: 0 },
  { rate_f_per_hour: 315, target_f: 1945, hold_minutes: 10 },
];

const PROFILES = [
  ["annie-bisque-04", "annie", "Bisque cone 04", "bisque", "04", BISQUE_04, 12],
  [
    "annie-glaze-6",
    "annie",
    "Glaze cone 6",
    "glaze",
    "6",
    [
      { rate_f_per_hour: 186, target_f: 1000, hold_minutes: 0 },
      { rate_f_per_hour: 250, target_f: 2000, hold_minutes: 0 },
      { rate_f_per_hour: 116, target_f: 2232, hold_minutes: 15 },
    ],
    14,
  ],
  ["ned-bisque-04", "ned", "Bisque cone 04", "bisque", "04", BISQUE_04, 12],
  [
    "ned-glaze-06",
    "ned",
    "Glaze cone 06",
    "glaze",
    "06",
    [
      { rate_f_per_hour: 186, target_f: 1000, hold_minutes: 0 },
      { rate_f_per_hour: 276, target_f: 1828, hold_minutes: 10 },
    ],
    12,
  ],
] as const;

const MIGRATION_LOCK = 2_026_401;

/** Applies the schema and seed exactly once at a time across every instance sharing the database. */
export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(SCHEMA);
    for (const [name, role, email, password, memberNumber] of PEOPLE) {
      const existing = await client.query("SELECT 1 FROM users WHERE email = $1", [email]);
      if (existing.rowCount === 0) {
        await client.query(
          "INSERT INTO users (name, role, email, password_hash, member_number) VALUES ($1, $2, $3, $4, $5)",
          [name, role, email, hashPassword(password), memberNumber],
        );
      }
    }
    for (const [index, [id, name, maxCone]] of CLAYS.entries()) {
      await client.query(
        "INSERT INTO clays (id, name, max_cone, position) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
        [id, name, maxCone, index],
      );
    }
    for (const [index, [id, name, layers, postHeight, usable]] of KILNS.entries()) {
      await client.query(
        `INSERT INTO kilns (id, name, position, shelf_diameter_halves, layers, post_height_halves, usable_cubic_inches, posts)
         VALUES ($1, $2, $3, 46, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
        [id, name, index, layers, postHeight, usable, JSON.stringify(POSTS)],
      );
    }
    for (const [index, [id, kiln, name, stage, cone, segments, coolDown]] of PROFILES.entries()) {
      await client.query(
        `INSERT INTO profiles (id, kiln_id, name, stage, cone, segments, cool_down_hours, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
        [id, kiln, name, stage, cone, JSON.stringify(segments), coolDown, index],
      );
    }
    await client.query(
      `INSERT INTO rate_sets (bisque_rate, glaze_rate, member_discount_percent, order_minimum_cents, effective_date, created_at)
       VALUES ('0.0300', '0.0400', 10, 300, '2026-01-01', now()) ON CONFLICT (effective_date) DO NOTHING`,
    );
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}
