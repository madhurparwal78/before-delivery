import { Client } from 'pg'

/**
 * Idempotent schema application. Safe when two instances start at once:
 * the migration advisory lock serialises schema changes, and each statement
 * is written to be re-runnable.
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS people (
    id text PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    org_role text NOT NULL CHECK (org_role IN ('admin','steward','member'))
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    slug text PRIMARY KEY,
    name text NOT NULL,
    kind text NOT NULL,
    code text NOT NULL UNIQUE,
    floor_pct text NOT NULL,
    buffer_pct text NOT NULL,
    lead_person_id text REFERENCES people(id),
    boundary jsonb NOT NULL,
    boundary_area_m2 integer NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sensors (
    id text NOT NULL,
    project text NOT NULL REFERENCES projects(slug),
    kind text NOT NULL CHECK (kind IN ('tower','satellite')),
    polygon jsonb NOT NULL,
    PRIMARY KEY (project, id)
  )`,
  `CREATE TABLE IF NOT EXISTS readings (
    project text NOT NULL REFERENCES projects(slug),
    sensor_id text NOT NULL,
    interval_start text NOT NULL,
    fc text NOT NULL,
    fch4 text NOT NULL,
    qc integer NOT NULL CHECK (qc IN (0,1,2,3)),
    PRIMARY KEY (project, sensor_id, interval_start)
  )`,
  `CREATE INDEX IF NOT EXISTS readings_interval_idx ON readings (project, interval_start)`,
  `CREATE TABLE IF NOT EXISTS revisions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project text NOT NULL,
    sensor_id text NOT NULL,
    interval_start text NOT NULL,
    old_fc text, old_fch4 text, old_qc integer,
    new_fc text NOT NULL, new_fch4 text NOT NULL, new_qc integer NOT NULL,
    batch_id text NOT NULL,
    revised_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS revisions_scope_idx ON revisions (project, sensor_id, interval_start, id)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token text PRIMARY KEY,
    person_id text NOT NULL REFERENCES people(id),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS grants (
    person_id text NOT NULL REFERENCES people(id),
    project text NOT NULL REFERENCES projects(slug),
    role text NOT NULL CHECK (role IN ('viewer','analyst','sealer')),
    PRIMARY KEY (person_id, project)
  )`,
  `CREATE TABLE IF NOT EXISTS figures (
    id text PRIMARY KEY,
    project text NOT NULL REFERENCES projects(slug),
    seq integer NOT NULL,
    start_ts text NOT NULL,
    end_ts text NOT NULL,
    sensor_ids jsonb NOT NULL,
    status text NOT NULL CHECK (status IN ('sealed','broken','superseded')),
    supersedes text,
    superseded_by text,
    coverage_pct text NOT NULL,
    floor_pct text NOT NULL,
    net_tco2e text NOT NULL,
    co2_tco2e text NOT NULL,
    ch4_tco2e text NOT NULL,
    buffer_pct text NOT NULL,
    buffer_tco2e text NOT NULL,
    credited_tco2e text NOT NULL,
    readings_count integer NOT NULL,
    fingerprint text NOT NULL,
    contributions jsonb NOT NULL,
    sealed_at timestamptz NOT NULL,
    sealed_by text NOT NULL REFERENCES people(id),
    checked_at timestamptz NOT NULL,
    UNIQUE (project, seq)
  )`,
  `CREATE INDEX IF NOT EXISTS figures_status_idx ON figures (project, status)`,
  `CREATE TABLE IF NOT EXISTS ledger (
    id text PRIMARY KEY,
    project text NOT NULL REFERENCES projects(slug),
    figure_id text NOT NULL REFERENCES figures(id),
    kind text NOT NULL CHECK (kind IN ('issuance','buffer','reversal')),
    tco2e text NOT NULL,
    reverses text,
    recorded_at timestamptz NOT NULL,
    seq bigint GENERATED ALWAYS AS IDENTITY
  )`,
  `CREATE INDEX IF NOT EXISTS ledger_project_idx ON ledger (project, id)`,
  `CREATE TABLE IF NOT EXISTS idempotency (
    person_id text NOT NULL,
    key text NOT NULL,
    project text NOT NULL,
    request jsonb NOT NULL,
    status integer NOT NULL,
    body jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (person_id, key)
  )`,
  `CREATE TABLE IF NOT EXISTS idempotency_pending (
    person_id text NOT NULL,
    key text NOT NULL,
    acquired_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (person_id, key)
  )`,
  `CREATE TABLE IF NOT EXISTS links (
    id text PRIMARY KEY,
    figure_id text NOT NULL REFERENCES figures(id),
    token text NOT NULL UNIQUE,
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
  )`,
  `CREATE TABLE IF NOT EXISTS alert_queue (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    figure_id text NOT NULL REFERENCES figures(id),
    moved integer NOT NULL,
    reversed_tco2e text NOT NULL,
    claimed_by text,
    claimed_at timestamptz,
    queued_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz
  )`,
  `CREATE TABLE IF NOT EXISTS seed_state (
    key text PRIMARY KEY,
    value text NOT NULL
  )`,
]

export async function applySchema(client: Client): Promise<void> {
  await client.query('SELECT pg_advisory_lock(97001)')

  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    idx integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  for (let i = 0; i < MIGRATIONS.length; i++) {
    const res = await client.query('SELECT 1 FROM schema_migrations WHERE idx = $1', [i])
    if (res.rowCount === 0) {
      await client.query(MIGRATIONS[i])
      await client.query('INSERT INTO schema_migrations (idx) VALUES ($1)', [i])
    }
  }
  await client.query('SELECT pg_advisory_unlock(97001)')
}
