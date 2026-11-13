import pg from "pg";

/**
 * The single Postgres pool for the whole server. The schema is applied
 * idempotently at every boot.
 */

let pool: pg.Pool | null = null;

export function getPool(config: { databaseUrl: string }): pg.Pool {
  if (pool) return pool;
  pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 8
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  units TEXT NOT NULL,
  precision INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  density_g_cm3 DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS parts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  material_id TEXT NOT NULL REFERENCES materials(id),
  revision INTEGER NOT NULL DEFAULT 1,
  last_saved_by TEXT,
  body_status TEXT NOT NULL,
  body_build INTEGER,
  confirmed_build INTEGER,
  confirmed_object_key TEXT,
  confirmed_volume_mm3 DOUBLE PRECISION,
  confirmed_area_mm2 DOUBLE PRECISION,
  confirmed_centroid_x DOUBLE PRECISION,
  confirmed_centroid_y DOUBLE PRECISION,
  confirmed_centroid_z DOUBLE PRECISION,
  confirmed_mass_g DOUBLE PRECISION,
  next_sketch_number INTEGER NOT NULL DEFAULT 0,
  next_feature_number INTEGER NOT NULL DEFAULT 0,
  seeded BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS parts_name_ci ON parts (lower(name));

CREATE TABLE IF NOT EXISTS sketches (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  name TEXT NOT NULL,
  plane TEXT NOT NULL,
  offset_mm DOUBLE PRECISION NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  slack INTEGER NOT NULL DEFAULT 0,
  entity_counters JSONB NOT NULL DEFAULT '{}',
  constraint_counters JSONB NOT NULL DEFAULT '{}',
  last_saved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  sketch_id TEXT NOT NULL REFERENCES sketches(id),
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  number INTEGER NOT NULL,
  geometry JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entities_sketch ON entities (sketch_id);

CREATE TABLE IF NOT EXISTS constraints (
  id TEXT PRIMARY KEY,
  sketch_id TEXT NOT NULL REFERENCES sketches(id),
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  number INTEGER NOT NULL,
  refs JSONB NOT NULL,
  value_mm DOUBLE PRECISION,
  tolerance JSONB,
  redundant BOOLEAN NOT NULL DEFAULT FALSE,
  fix_targets JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS constraints_sketch ON constraints (sketch_id);

CREATE TABLE IF NOT EXISTS features (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  sketch_id TEXT NOT NULL REFERENCES sketches(id),
  name TEXT NOT NULL,
  operation TEXT NOT NULL,
  depth_mm DOUBLE PRECISION NOT NULL,
  direction TEXT NOT NULL,
  number INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS features_part ON features (part_id);

CREATE TABLE IF NOT EXISTS assemblies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  is_product BOOLEAN NOT NULL DEFAULT FALSE,
  last_saved_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS assemblies_name_ci ON assemblies (lower(name));

CREATE TABLE IF NOT EXISTS instances (
  id TEXT PRIMARY KEY,
  assembly_id TEXT NOT NULL REFERENCES assemblies(id),
  component_type TEXT NOT NULL,
  component_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  position INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS instances_assembly ON instances (assembly_id);

CREATE TABLE IF NOT EXISTS purchased_parts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  declared_mass_g DOUBLE PRECISION NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  last_saved_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS purchased_name_ci ON purchased_parts (lower(name));

CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT NOT NULL,
  member_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, endpoint, key)
);

CREATE TABLE IF NOT EXISTS workspace (
  id INTEGER PRIMARY KEY DEFAULT 1,
  name TEXT NOT NULL,
  product_assembly_id TEXT NOT NULL REFERENCES assemblies(id)
);
CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY DEFAULT 1,
  version INTEGER NOT NULL
);
`;
