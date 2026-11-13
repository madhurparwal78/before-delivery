import pg from 'pg';
import { config } from './config';

pg.types.setTypeParser(pg.types.builtins.INT8, (text) => Number(text));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 5000 });
// A dropped idle connection must not take the process down; the next query opens a fresh one.
pool.on('error', () => undefined);

export type Db = pg.PoolClient;

/** Anything a query can run on: the pool or a connection inside a transaction. */
export type Queryable = Pick<pg.Pool, 'query'>;

export async function transaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    db.release();
  }
}

/** Applied on every start; every statement is idempotent. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, role text NOT NULL,
  password_hash text NOT NULL, units text NOT NULL DEFAULT 'mm', precision integer NOT NULL DEFAULT 2
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, member_id text NOT NULL REFERENCES members(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspace (
  id integer PRIMARY KEY CHECK (id = 1), name text NOT NULL, product_assembly_id text NOT NULL
);
CREATE TABLE IF NOT EXISTS materials (
  id text PRIMARY KEY, name text NOT NULL UNIQUE, density_g_cm3 double precision NOT NULL
);
CREATE TABLE IF NOT EXISTS component_names (name_key text PRIMARY KEY, component_id text NOT NULL);
CREATE TABLE IF NOT EXISTS parts (
  id text PRIMARY KEY, name text NOT NULL, revision integer NOT NULL DEFAULT 1,
  saved_by text NOT NULL REFERENCES members(id), material_id text NOT NULL REFERENCES materials(id),
  next_sketch integer NOT NULL DEFAULT 1, next_feature integer NOT NULL DEFAULT 1,
  build_counter integer NOT NULL DEFAULT 0, body_status text NOT NULL DEFAULT 'none', confirmed jsonb,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS sketches (
  id text PRIMARY KEY, part_id text NOT NULL REFERENCES parts(id), name text NOT NULL, plane text NOT NULL,
  offset_mm double precision NOT NULL, revision integer NOT NULL DEFAULT 1, saved_by text NOT NULL REFERENCES members(id),
  entity_counters jsonb NOT NULL DEFAULT '{}', constraint_counters jsonb NOT NULL DEFAULT '{}', seq bigserial
);
CREATE TABLE IF NOT EXISTS entities (
  id text PRIMARY KEY, sketch_id text NOT NULL REFERENCES sketches(id) ON DELETE CASCADE,
  label text NOT NULL, geometry jsonb NOT NULL, seq bigserial
);
CREATE TABLE IF NOT EXISTS constraints (
  id text PRIMARY KEY, sketch_id text NOT NULL REFERENCES sketches(id) ON DELETE CASCADE,
  label text NOT NULL, kind text NOT NULL, refs jsonb NOT NULL, value_mm double precision, tolerance jsonb,
  anchor jsonb, sign integer NOT NULL DEFAULT 1, seq bigserial
);
CREATE TABLE IF NOT EXISTS features (
  id text PRIMARY KEY, part_id text NOT NULL REFERENCES parts(id), sketch_id text NOT NULL REFERENCES sketches(id),
  name text NOT NULL, operation text NOT NULL, depth_mm double precision NOT NULL, direction text NOT NULL, seq bigserial
);
CREATE TABLE IF NOT EXISTS assemblies (
  id text PRIMARY KEY, name text NOT NULL, revision integer NOT NULL DEFAULT 1, saved_by text NOT NULL REFERENCES members(id),
  seq bigserial
);
CREATE TABLE IF NOT EXISTS instances (
  id text PRIMARY KEY, assembly_id text NOT NULL REFERENCES assemblies(id), component_type text NOT NULL,
  component_id text NOT NULL, quantity integer NOT NULL, seq bigserial
);
CREATE TABLE IF NOT EXISTS purchased_parts (
  id text PRIMARY KEY, name text NOT NULL, declared_mass_g double precision NOT NULL, revision integer NOT NULL DEFAULT 1,
  saved_by text NOT NULL REFERENCES members(id), seq bigserial
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  member_id text NOT NULL, path text NOT NULL, key text NOT NULL, request_hash text NOT NULL,
  status integer NOT NULL, response jsonb, settled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, path, key)
);
`;

export async function applySchema(db: Db): Promise<void> {
  await db.query(SCHEMA);
}

/** Held for the length of a session by whichever process is seeding, so two starting together seed once. */
export const SEED_LOCK = 427310;

/** Taken before an instance is placed so two placements cannot each pass the cycle check and together make a cycle. */
export const INSTANCE_LOCK = 427311;
