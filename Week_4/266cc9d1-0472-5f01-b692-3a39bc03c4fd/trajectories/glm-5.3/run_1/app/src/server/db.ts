import pg from 'pg';

export type Db = pg.Pool;

let pool: Db | null = null;

export function db(): Db {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    pool = new pg.Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
    // TypeScript types come from ./schema-types.ts
    pool.on('error', (err) => {
      console.error('pg pool error', err);
    });
  }
  return pool;
}

/** Apply the schema idempotently. Safe under concurrent processes. */
export async function applySchema(pool: Db): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id text PRIMARY KEY,
      name text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staff (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id),
      name text NOT NULL,
      role text NOT NULL CHECK (role IN ('survey_processor','vegetation_analyst')),
      access_code text NOT NULL UNIQUE,
      email text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS utilities (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id),
      name text NOT NULL,
      time_zone text NOT NULL,
      forester_name text NOT NULL,
      forester_email text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS corridors (
      id text PRIMARY KEY,
      utility_id text NOT NULL REFERENCES utilities(id),
      name text NOT NULL,
      voltage_kv int NOT NULL,
      clearance_threshold_m double precision NOT NULL,
      inspection_due date NOT NULL,
      start_lon double precision NOT NULL,
      start_lat double precision NOT NULL,
      azimuth double precision NOT NULL,
      attachment_height_m double precision NOT NULL
    );
    CREATE TABLE IF NOT EXISTS towers (
      corridor_id text NOT NULL REFERENCES corridors(id),
      number int NOT NULL,
      chainage_m double precision NOT NULL,
      base_height_m double precision NOT NULL,
      PRIMARY KEY (corridor_id, number)
    );
    CREATE TABLE IF NOT EXISTS assets (
      id text PRIMARY KEY,
      corridor_id text NOT NULL REFERENCES corridors(id),
      kind text NOT NULL CHECK (kind IN ('tileset','terrain','czml')),
      state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','stored','rejected')),
      rejected_reason text,
      created_at timestamptz NOT NULL DEFAULT now(),
      stored_at timestamptz,
      seeded boolean NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS asset_files (
      asset_id text NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      path text NOT NULL,
      size_bytes bigint NOT NULL,
      sha256 text NOT NULL,
      state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','stored','rejected')),
      PRIMARY KEY (asset_id, path)
    );
    CREATE TABLE IF NOT EXISTS flight_tracks (
      corridor_id text NOT NULL REFERENCES corridors(id),
      asset_id text NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      epoch_ms bigint NOT NULL,
      parsed jsonb NOT NULL,
      coverage jsonb NOT NULL,
      parsed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (corridor_id, asset_id)
    );
    CREATE TABLE IF NOT EXISTS findings_sets (
      id text PRIMARY KEY,
      corridor_id text NOT NULL REFERENCES corridors(id),
      revision int NOT NULL,
      state text NOT NULL CHECK (state IN ('draft','submitted','under_review','accepted','disputed','closed')),
      previous_set_id text REFERENCES findings_sets(id),
      created_by text NOT NULL REFERENCES staff(id),
      submitted_at timestamptz,
      submitted_by text REFERENCES staff(id),
      frozen_finding_count int,
      frozen_violation_count int,
      review_link_token text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (corridor_id, revision)
    );
    CREATE INDEX IF NOT EXISTS findings_sets_corridor ON findings_sets(corridor_id);
    CREATE TABLE IF NOT EXISTS label_counter (
      set_id text PRIMARY KEY REFERENCES findings_sets(id) ON DELETE CASCADE,
      next_number int NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS findings (
      id text PRIMARY KEY,
      set_id text NOT NULL REFERENCES findings_sets(id) ON DELETE CASCADE,
      label text NOT NULL,
      number int NOT NULL,
      chainage_m double precision NOT NULL,
      offset_m double precision NOT NULL,
      lon_deg double precision NOT NULL,
      lat_deg double precision NOT NULL,
      ecef_x double precision NOT NULL,
      ecef_y double precision NOT NULL,
      ecef_z double precision NOT NULL,
      ground_height_m double precision NOT NULL,
      terrain_level int,
      canopy_height_m double precision NOT NULL,
      canopy_top_height_m double precision NOT NULL,
      canopy_radius_m double precision NOT NULL,
      clearance_m double precision NOT NULL,
      status text NOT NULL CHECK (status IN ('violation','clear')),
      comment text NOT NULL DEFAULT '',
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (set_id, number)
    );
    CREATE INDEX IF NOT EXISTS findings_set_chainage ON findings(set_id, chainage_m);
    CREATE TABLE IF NOT EXISTS review_links (
      token text PRIMARY KEY,
      set_id text NOT NULL REFERENCES findings_sets(id),
      expires_at timestamptz NOT NULL,
      revoked boolean NOT NULL DEFAULT false,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS review_links_set ON review_links(set_id);
    CREATE TABLE IF NOT EXISTS email_outbox (
      id bigserial PRIMARY KEY,
      kind text NOT NULL,
      ref_id text NOT NULL,
      to_email text NOT NULL,
      subject text NOT NULL,
      body text NOT NULL,
      state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','sending','sent')),
      attempts int NOT NULL DEFAULT 0,
      attempt_started_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      sent_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS email_outbox_state ON email_outbox(state);
    CREATE TABLE IF NOT EXISTS link_email_state (
      token text NOT NULL,
      email_id bigint NOT NULL,
      set_id text NOT NULL,
      PRIMARY KEY (token, email_id)
    );
    CREATE TABLE IF NOT EXISTS idempotency (
      key text NOT NULL,
      scope text NOT NULL,
      body_hash text NOT NULL,
      status int NOT NULL,
      response jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (scope, key)
    );
    CREATE TABLE IF NOT EXISTS decisions (
      set_id text NOT NULL REFERENCES findings_sets(id) ON DELETE CASCADE,
      finding_id text NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
      decision text NOT NULL CHECK (decision IN ('accept','dispute')),
      note text NOT NULL DEFAULT '',
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (set_id, finding_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token text PRIMARY KEY,
      staff_id text NOT NULL REFERENCES staff(id),
      tenant_id text NOT NULL,
      role text NOT NULL,
      name text NOT NULL,
      email text NOT NULL,
      expires_at timestamptz NOT NULL
    );
  `);
}
