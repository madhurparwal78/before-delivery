import pg from "pg";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL,
  password_hash text NOT NULL,
  member_number text UNIQUE
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES people(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clays (
  id text PRIMARY KEY,
  name text NOT NULL,
  max_cone text NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_sets (
  id serial PRIMARY KEY,
  bisque_rate text NOT NULL,
  glaze_rate text NOT NULL,
  member_discount_percent integer NOT NULL,
  order_minimum_cents integer NOT NULL,
  effective_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (effective_date)
);

CREATE TABLE IF NOT EXISTS kilns (
  id text PRIMARY KEY,
  name text NOT NULL,
  shelf_diameter_in text NOT NULL,
  layers integer NOT NULL,
  post_height_in text NOT NULL,
  usable_cubic_inches integer NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  id serial PRIMARY KEY,
  kiln_id text NOT NULL REFERENCES kilns(id),
  name text NOT NULL,
  stage text NOT NULL,
  cone text NOT NULL,
  segments jsonb NOT NULL,
  cool_down_hours integer NOT NULL,
  firing_hours text NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  photo_id text PRIMARY KEY,
  content_type text NOT NULL,
  bytes integer NOT NULL,
  sha256 text NOT NULL,
  uploaded_by integer NOT NULL REFERENCES people(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  attached_to integer
);

CREATE TABLE IF NOT EXISTS pieces (
  number integer PRIMARY KEY,
  owner_kind text NOT NULL,
  owner_name text NOT NULL,
  owner_member_number text,
  guest_email text,
  shape text NOT NULL,
  length_in text,
  width_in text,
  diameter_in text,
  height_in text NOT NULL,
  cubic_inches text NOT NULL,
  fee_cents integer NOT NULL,
  rate_set_id integer NOT NULL REFERENCES rate_sets(id),
  plan text NOT NULL,
  stage text,
  cone text,
  clay_id text NOT NULL REFERENCES clays(id),
  status text NOT NULL,
  pickup_shelf text,
  intake_photo_id text REFERENCES photos(photo_id),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  reminder_sent_at timestamptz,
  killbill_invoice_id text
);

CREATE TABLE IF NOT EXISTS tracking_tokens (
  piece_number integer PRIMARY KEY REFERENCES pieces(number),
  token text NOT NULL UNIQUE,
  revoked boolean NOT NULL DEFAULT false,
  replaced_at timestamptz
);

CREATE TABLE IF NOT EXISTS piece_history (
  id serial PRIMARY KEY,
  piece_number integer NOT NULL REFERENCES pieces(number),
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL
);

CREATE TABLE IF NOT EXISTS firings (
  id serial PRIMARY KEY,
  kiln_id text NOT NULL REFERENCES kilns(id),
  profile_id integer NOT NULL,
  profile_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'building',
  created_by integer NOT NULL REFERENCES people(id),
  started_at timestamptz,
  firing_ends_at timestamptz,
  cool_until timestamptz
);

CREATE TABLE IF NOT EXISTS placements (
  id serial PRIMARY KEY,
  firing_id integer NOT NULL REFERENCES firings(id),
  piece_number integer NOT NULL REFERENCES pieces(number),
  layer integer NOT NULL,
  x text NOT NULL,
  y text NOT NULL,
  rotation integer NOT NULL,
  UNIQUE (firing_id, piece_number)
);

CREATE TABLE IF NOT EXISTS damage_reports (
  id serial PRIMARY KEY,
  piece_number integer NOT NULL REFERENCES pieces(number),
  kind text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'reported',
  unload_photo_id text NOT NULL REFERENCES photos(photo_id),
  amount_cents integer,
  reported_by text NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT now(),
  charged_at timestamptz
);

CREATE TABLE IF NOT EXISTS idempotency (
  key text NOT NULL,
  user_id integer NOT NULL,
  request_hash text NOT NULL,
  in_progress boolean NOT NULL DEFAULT true,
  status integer,
  body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, user_id)
);

CREATE TABLE IF NOT EXISTS outbox (
  id serial PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  tracking text NOT NULL,
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tracking)
);

CREATE TABLE IF NOT EXISTS counters (
  name text PRIMARY KEY,
  value integer NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pieces_status ON pieces(status);
CREATE INDEX IF NOT EXISTS idx_placements_firing ON placements(firing_id, layer);
`;

const SEED_SQL = `
INSERT INTO clays (id, name, max_cone) VALUES
  ('buff', 'Brickfield Buff Stoneware', '10'),
  ('porcelain', 'Lane Porcelain', '6'),
  ('red', 'Clayhouse Red Earthenware', '02')
ON CONFLICT (id) DO NOTHING;

INSERT INTO kilns (id, name, shelf_diameter_in, layers, post_height_in, usable_cubic_inches) VALUES
  ('annie', 'Big Annie', '23.0', 4, '9.0', 12096),
  ('ned', 'Little Ned', '23.0', 3, '6.0', 6048)
ON CONFLICT (id) DO NOTHING;

INSERT INTO counters (name, value) VALUES ('piece_number', 400)
ON CONFLICT (name) DO NOTHING;
`;

const PEOPLE_SQL = `
INSERT INTO people (email, name, role, password_hash, member_number) VALUES
  ('owner@brickfieldlane.example', 'Marguerite Okafor-Lind', 'owner', $1, NULL),
  ('tech@brickfieldlane.example', 'Tobias Wren', 'tech', $2, NULL),
  ('priya@brickfieldlane.example', 'Priya Halvorsen', 'member', $3, 'M104'),
  ('dash@brickfieldlane.example', 'Dashiell Moreau', 'member', $4, 'M117')
ON CONFLICT (email) DO NOTHING;
`;

const RATE_SQL = `
INSERT INTO rate_sets (bisque_rate, glaze_rate, member_discount_percent, order_minimum_cents, effective_date)
VALUES ('0.0300', '0.0400', 10, 300, '2026-01-01')
ON CONFLICT (effective_date) DO NOTHING;
`;

const PROFILES_SQL = `
INSERT INTO profiles (kiln_id, name, stage, cone, segments, cool_down_hours, firing_hours) VALUES
  ('annie', 'Bisque cone 04', 'bisque', '04', $1::jsonb, 12, '8.1666666667'),
  ('annie', 'Glaze cone 6', 'glaze', '6', $2::jsonb, 14, '11.2500000000'),
  ('ned', 'Bisque cone 04', 'bisque', '04', $1::jsonb, 12, '8.1666666667'),
  ('ned', 'Glaze cone 06', 'glaze', '06', $3::jsonb, 12, '8.1666666667')
ON CONFLICT DO NOTHING;
`;

// Passwords: scrypt-free simple hash for seeded credentials. The brief requires
// seeded people to sign in with email and password; a salted sha256 keeps the
// scheme single and dependency-free.
import { createHash, randomBytes } from "node:crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(salt + password).digest("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const check = createHash("sha256").update(salt + password).digest("hex");
  return check === hash;
}

export async function migrateAndSeed(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialise concurrent schema/seed application across instances.
    await client.query("SELECT pg_advisory_xact_lock(918273645)");
    await client.query(SCHEMA_SQL);
    await client.query(SEED_SQL);
    await client.query(RATE_SQL);
    const people = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM people");
    if (people.rows[0].n === 0) {
      await client.query(PEOPLE_SQL, [
        hashPassword("kiln-owner-2026"),
        hashPassword("kiln-tech-2026"),
        hashPassword("member-priya-2026"),
        hashPassword("member-dash-2026")
      ]);
    }
    const profiles = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM profiles");
    if (profiles.rows[0].n === 0) {
      const bisque04 = JSON.stringify([
        { rate_f_per_hour: 186, target_f: 1000, hold_minutes: 0 },
        { rate_f_per_hour: 315, target_f: 1945, hold_minutes: 10 }
      ]);
      const glaze6 = JSON.stringify([
        { rate_f_per_hour: 186, target_f: 1000, hold_minutes: 0 },
        { rate_f_per_hour: 250, target_f: 2000, hold_minutes: 0 },
        { rate_f_per_hour: 116, target_f: 2232, hold_minutes: 15 }
      ]);
      const glaze06 = JSON.stringify([
        { rate_f_per_hour: 186, target_f: 1000, hold_minutes: 0 },
        { rate_f_per_hour: 276, target_f: 1828, hold_minutes: 10 }
      ]);
      await client.query(PROFILES_SQL, [bisque04, glaze6, glaze06]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
