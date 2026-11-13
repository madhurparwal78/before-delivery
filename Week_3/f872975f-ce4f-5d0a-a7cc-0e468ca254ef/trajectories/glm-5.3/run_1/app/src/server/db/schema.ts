import type { Pool, PoolClient } from 'pg';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS species (
  name text PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS grades (
  name text PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS users (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lots (
  id text PRIMARY KEY,
  name text NOT NULL,
  origin text NOT NULL,
  built_year integer NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_versions (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  species text NOT NULL REFERENCES species(name),
  grade text NOT NULL REFERENCES grades(name),
  rate_cents integer NOT NULL,
  effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tag_counter (
  id integer PRIMARY KEY DEFAULT 1,
  next_value integer NOT NULL
);
INSERT INTO tag_counter (id, next_value) VALUES (1, 1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS boards (
  tag text PRIMARY KEY,
  species text NOT NULL REFERENCES species(name),
  grade text,
  status text NOT NULL,
  lot_id text NOT NULL REFERENCES lots(id),
  length_mm integer NOT NULL,
  width_mm integer NOT NULL,
  thickness_mm integer NOT NULL,
  parent_tag text REFERENCES boards(tag),
  from_intake boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  graded_at timestamptz
);
CREATE INDEX IF NOT EXISTS boards_status_idx ON boards(status);
CREATE INDEX IF NOT EXISTS boards_species_idx ON boards(species);
CREATE INDEX IF NOT EXISTS boards_lot_idx ON boards(lot_id);

CREATE TABLE IF NOT EXISTS defect_zones (
  board_tag text NOT NULL REFERENCES boards(tag),
  kind text NOT NULL,
  start_mm integer NOT NULL,
  end_mm integer NOT NULL,
  position integer NOT NULL
);
CREATE INDEX IF NOT EXISTS defect_zones_board_idx ON defect_zones(board_tag);

CREATE TABLE IF NOT EXISTS photos (
  id text PRIMARY KEY,
  board_tag text NOT NULL REFERENCES boards(tag),
  content_type text NOT NULL,
  key text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_board_idx ON photos(board_tag);

CREATE TABLE IF NOT EXISTS id_counters (
  kind text PRIMARY KEY,
  next_value integer NOT NULL
);
INSERT INTO id_counters (kind, next_value) VALUES
  ('hold', 1), ('ticket', 1), ('invoice', 1), ('photo', 1)
ON CONFLICT (kind) DO NOTHING;

CREATE TABLE IF NOT EXISTS ledger_movements (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  kind text NOT NULL,
  ticket text,
  by_user_id integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  movement_id integer NOT NULL REFERENCES ledger_movements(id),
  account text NOT NULL,
  volume_mm3 bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_entries_account_idx ON ledger_entries(account);

CREATE TABLE IF NOT EXISTS holds (
  id text PRIMARY KEY,
  board_tag text NOT NULL REFERENCES boards(tag),
  maker_id integer NOT NULL REFERENCES users(id),
  status text NOT NULL,
  release_reason text,
  pieces jsonb NOT NULL,
  cuts_mm jsonb NOT NULL,
  take_mm integer,
  sale text,
  offcut_mm integer,
  price_cents integer NOT NULL,
  deposit_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  held_at timestamptz,
  expires_at timestamptz,
  killbill_payment_id text
);
CREATE INDEX IF NOT EXISTS holds_board_idx ON holds(board_tag);
CREATE INDEX IF NOT EXISTS holds_maker_idx ON holds(maker_id);

CREATE TABLE IF NOT EXISTS tickets (
  id text PRIMARY KEY,
  board_tag text NOT NULL REFERENCES boards(tag),
  maker_id integer NOT NULL REFERENCES users(id),
  status text NOT NULL,
  pieces jsonb NOT NULL,
  cuts_mm jsonb NOT NULL,
  take_mm integer NOT NULL,
  sale text NOT NULL,
  offcut_tag text,
  offcut_planned_mm integer,
  offcut_measured_mm integer,
  pdf_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tickets_board_idx ON tickets(board_tag);

CREATE TABLE IF NOT EXISTS ticket_events (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  ticket_id text NOT NULL REFERENCES tickets(id),
  kind text NOT NULL,
  by_user_id integer NOT NULL REFERENCES users(id),
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY,
  ticket_id text NOT NULL REFERENCES tickets(id),
  board_tag text NOT NULL,
  maker_id integer NOT NULL REFERENCES users(id),
  price_cents integer NOT NULL,
  deposit_cents integer NOT NULL,
  amount_cents integer NOT NULL,
  lines jsonb NOT NULL,
  killbill_payment_id text NOT NULL,
  paid_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stored_layouts (
  maker_id integer NOT NULL REFERENCES users(id),
  board_tag text NOT NULL REFERENCES boards(tag),
  file jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (maker_id, board_tag)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  maker_id integer NOT NULL,
  key text NOT NULL,
  status integer NOT NULL,
  body text NOT NULL,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (maker_id, key)
);
`;

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

const SEED_USERS: Array<{ name: string; email: string; password: string; role: string }> = [
  { name: 'Dana Whitlock', email: 'owner@kerfwell.test', password: 'rack-owner-2026', role: 'owner' },
  { name: 'Teo Varga', email: 'hand@kerfwell.test', password: 'rack-hand-2026', role: 'hand' },
  { name: 'Ines Albrecht', email: 'ines@makers.test', password: 'rack-maker-2026', role: 'maker' },
  { name: 'Joel Mbeki', email: 'joel@makers.test', password: 'rack-maker-2026', role: 'maker' },
  { name: 'Ruth Calloway', email: 'ruth@makers.test', password: 'rack-maker-2026', role: 'maker' },
];

const SEED_LOTS: Array<{ id: string; name: string; origin: string; built_year: number }> = [
  { id: 'LOT-01', name: 'Hollis Road dairy barn', origin: 'Timber-frame dairy barn, taken down August 2026', built_year: 1911 },
  { id: 'LOT-02', name: 'Pell Street shoe factory', origin: 'Four-storey mill floor and joists', built_year: 1924 },
  { id: 'LOT-03', name: 'Marsh Lane farmhouse', origin: 'Farmhouse floorboards and mantel stock', built_year: 1880 },
];

const SEED_RATES: Array<{ species: string; grade: string; rate: number }> = [
  { species: 'White oak', grade: 'Select', rate: 1450 },
  { species: 'White oak', grade: 'Character', rate: 1100 },
  { species: 'White oak', grade: 'Rustic', rate: 800 },
  { species: 'Black walnut', grade: 'Select', rate: 2400 },
  { species: 'Black walnut', grade: 'Character', rate: 1850 },
  { species: 'Black walnut', grade: 'Rustic', rate: 1300 },
  { species: 'Douglas fir', grade: 'Select', rate: 900 },
  { species: 'Douglas fir', grade: 'Character', rate: 700 },
  { species: 'Douglas fir', grade: 'Rustic', rate: 500 },
  { species: 'Heart pine', grade: 'Select', rate: 1600 },
  { species: 'Heart pine', grade: 'Character', rate: 1250 },
  { species: 'Heart pine', grade: 'Rustic', rate: 900 },
  { species: 'Chestnut', grade: 'Select', rate: 2800 },
  { species: 'Chestnut', grade: 'Character', rate: 2200 },
  { species: 'Chestnut', grade: 'Rustic', rate: 1600 },
];

export interface SeedBoard {
  tag: string;
  species: string;
  grade: string | null;
  lot: string;
  length: number;
  width: number;
  thickness: number;
  status: string;
  defects: Array<[string, number, number]>;
}

export const SEED_BOARDS: SeedBoard[] = [
  { tag: 'KW-0001', species: 'White oak', grade: 'Character', lot: 'LOT-01', length: 2440, width: 190, thickness: 32, status: 'available', defects: [['nail hole', 610, 640], ['check', 1500, 1720], ['nail hole', 2200, 2230]] },
  { tag: 'KW-0002', species: 'Black walnut', grade: 'Select', lot: 'LOT-03', length: 2100, width: 305, thickness: 45, status: 'available', defects: [['check', 0, 120], ['bolt hole', 1340, 1380]] },
  { tag: 'KW-0003', species: 'Black walnut', grade: 'Character', lot: 'LOT-03', length: 1830, width: 210, thickness: 25, status: 'available', defects: [['nail hole', 400, 420], ['nail hole', 900, 920]] },
  { tag: 'KW-0004', species: 'Douglas fir', grade: 'Rustic', lot: 'LOT-02', length: 4880, width: 235, thickness: 70, status: 'available', defects: [['bolt hole', 1200, 1260], ['bolt hole', 3600, 3660], ['check', 4500, 4880]] },
  { tag: 'KW-0005', species: 'Heart pine', grade: 'Select', lot: 'LOT-02', length: 3050, width: 140, thickness: 38, status: 'available', defects: [] },
  { tag: 'KW-0006', species: 'Chestnut', grade: 'Character', lot: 'LOT-03', length: 2740, width: 250, thickness: 28, status: 'available', defects: [['nail hole', 300, 330], ['check', 2000, 2300]] },
  { tag: 'KW-0007', species: 'White oak', grade: 'Rustic', lot: 'LOT-01', length: 3660, width: 200, thickness: 50, status: 'available', defects: [['nail hole', 900, 930], ['nail hole', 1800, 1830], ['bolt hole', 2700, 2760]] },
  { tag: 'KW-0008', species: 'Heart pine', grade: null, lot: 'LOT-02', length: 2400, width: 180, thickness: 38, status: 'tagged', defects: [['nail hole', 1000, 1020]] },
  { tag: 'KW-0009', species: 'Douglas fir', grade: 'Character', lot: 'LOT-02', length: 3000, width: 185, thickness: 45, status: 'graded', defects: [] },
  { tag: 'KW-0010', species: 'Black walnut', grade: 'Select', lot: 'LOT-03', length: 1220, width: 330, thickness: 50, status: 'available', defects: [] },
];

const SEED_CREATED_AT = '2026-01-01T00:00:00Z';

/** Apply the seed, idempotently and safe under concurrent starts. */
export async function applySeed(pool: Pool, passwordHash: (plain: string) => string, yardId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Advisory lock keeps concurrent starts from racing the seed.
    await client.query('SELECT pg_advisory_xact_lock(812736401)');
    await seedCatalog(client);
    await seedUsers(client, passwordHash);
    await seedLots(client);
    await seedRates(client);
    await seedBoards(client);
    await client.query(`INSERT INTO app_meta (key, value) VALUES ('yard_id', $1) ON CONFLICT (key) DO NOTHING`, [yardId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedCatalog(client: PoolClient): Promise<void> {
  const species = ['White oak', 'Black walnut', 'Douglas fir', 'Heart pine', 'Chestnut'];
  for (const name of species) {
    await client.query('INSERT INTO species (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
  }
  for (const name of ['Select', 'Character', 'Rustic']) {
    await client.query('INSERT INTO grades (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
  }
}

async function seedUsers(client: PoolClient, hash: (plain: string) => string): Promise<void> {
  for (const user of SEED_USERS) {
    await client.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, password_hash = EXCLUDED.password_hash`,
      [user.name, user.email, hash(user.password), user.role],
    );
  }
}

async function seedLots(client: PoolClient): Promise<void> {
  for (const lot of SEED_LOTS) {
    await client.query(
      `INSERT INTO lots (id, name, origin, built_year) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, origin = EXCLUDED.origin, built_year = EXCLUDED.built_year`,
      [lot.id, lot.name, lot.origin, lot.built_year],
    );
  }
}

async function seedRates(client: PoolClient): Promise<void> {
  const existing = await client.query('SELECT count(*)::int AS n FROM rate_versions');
  if (existing.rows[0].n > 0) return;
  for (const rate of SEED_RATES) {
    await client.query(
      `INSERT INTO rate_versions (species, grade, rate_cents, effective_at, created_at)
       VALUES ($1, $2, $3, $4, $4)`,
      [rate.species, rate.grade, rate.rate, '2026-01-01T00:00:00Z'],
    );
  }
}

async function seedBoards(client: PoolClient): Promise<void> {
  for (const board of SEED_BOARDS) {
    await client.query(
      `INSERT INTO boards (tag, species, grade, status, lot_id, length_mm, width_mm, thickness_mm, parent_tag, from_intake, created_at, graded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, true, $9, $9)
       ON CONFLICT (tag) DO NOTHING`,
      [board.tag, board.species, board.grade, board.status, board.lot, board.length, board.width, board.thickness, SEED_CREATED_AT],
    );
    await client.query('DELETE FROM defect_zones WHERE board_tag = $1', [board.tag]);
    for (let i = 0; i < board.defects.length; i += 1) {
      const [kind, start, end] = board.defects[i];
      await client.query(
        'INSERT INTO defect_zones (board_tag, kind, start_mm, end_mm, position) VALUES ($1, $2, $3, $4, $5)',
        [board.tag, kind, start, end, i],
      );
    }
    const existingMovement = await client.query(
      `SELECT 1 FROM ledger_movements WHERE kind = 'intake' AND id IN
        (SELECT movement_id FROM ledger_entries WHERE account = $1) LIMIT 1`,
      [`board:${board.tag}`],
    );
    if (existingMovement.rowCount === 0) {
      const volume = BigInt(board.length) * BigInt(board.width) * BigInt(board.thickness);
      const movement = await client.query(
        'INSERT INTO ledger_movements (kind, ticket, by_user_id) VALUES ($1, NULL, NULL) RETURNING id',
        ['intake'],
      );
      const movementId = movement.rows[0].id as number;
      await client.query(
        'INSERT INTO ledger_entries (movement_id, account, volume_mm3) VALUES ($1, $2, $3), ($1, $4, $5)',
        [movementId, 'intake', -volume, `board:${board.tag}`, volume],
      );
    }
  }
  // Advance the tag counter past the seeds
  await client.query(
    `UPDATE tag_counter SET next_value = GREATEST(next_value,
      (SELECT max(COALESCE(substring(tag from 4)::int, 0)) + 1 FROM boards))`,
  );
}
