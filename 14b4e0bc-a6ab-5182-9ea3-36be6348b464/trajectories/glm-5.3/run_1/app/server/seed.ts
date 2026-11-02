import type { Database } from './db';
import { hashPassword } from './passwords';
import { sha256Hex } from './hashutil';
import {
  SEED_ASSETS,
  SEED_COLUMNS,
  SEED_DIRECT_TAGS,
  SEED_DEPRECATED,
  SEED_DEPRECATION_REASON,
  SEED_EDGES,
  SEED_PASSWORD,
  SEED_TERMS,
  SEED_USERS,
} from './seeddata';

/**
 * Applies schema and seed idempotently on every serve. The seed writes exactly
 * once even when two instances start against the same database at the same
 * moment: an advisory lock serialises the whole apply, and every insert is
 * guarded so a second pass changes nothing.
 */
export async function applySchemaAndSeed(db: Database): Promise<void> {
  await db.query(`SELECT pg_advisory_lock(hashtext('strata-schema-seed'))`);
  try {
    await applySchemaStatements(db);
    const seeded = await db.queryOne<{ ok: boolean }>(`SELECT EXISTS (SELECT 1 FROM users WHERE id = 'u-morgan') AS ok`);
    if (seeded?.ok) return;
    await seed(db);
  } finally {
    await db.query(`SELECT pg_advisory_unlock(hashtext('strata-schema-seed'))`);
  }
}

async function applySchemaStatements(db: Database): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.query(stmt);
  }
}

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
     id text PRIMARY KEY,
     name text NOT NULL,
     email text NOT NULL,
     role text NOT NULL,
     password_hash text NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash text PRIMARY KEY,
     user_id text NOT NULL REFERENCES users(id),
     created_at bigint NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS assets (
     id text PRIMARY KEY,
     kind text NOT NULL,
     description text NOT NULL,
     owner_id text NOT NULL REFERENCES users(id),
     state text NOT NULL DEFAULT 'draft',
     verified_at text,
     created_at bigint NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS columns_ (
     id text PRIMARY KEY,
     asset text NOT NULL REFERENCES assets(id),
     name text NOT NULL,
     data_type text NOT NULL,
     position int NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS columns_asset_position ON columns_(asset, position)`,
  `CREATE TABLE IF NOT EXISTS column_samples (
     column_id text NOT NULL REFERENCES columns_(id),
     position int NOT NULL,
     value text NOT NULL,
     PRIMARY KEY (column_id, position)
   )`,
  `CREATE TABLE IF NOT EXISTS edges (
     id text PRIMARY KEY,
     from_col text NOT NULL REFERENCES columns_(id),
     to_col text NOT NULL REFERENCES columns_(id),
     transform text NOT NULL,
     UNIQUE (from_col, to_col)
   )`,
  `CREATE INDEX IF NOT EXISTS edges_from ON edges(from_col)`,
  `CREATE INDEX IF NOT EXISTS edges_to ON edges(to_col)`,
  `CREATE TABLE IF NOT EXISTS direct_tags (
     column_id text NOT NULL REFERENCES columns_(id),
     tag text NOT NULL,
     PRIMARY KEY (column_id, tag)
   )`,
  `CREATE TABLE IF NOT EXISTS suppressions (
     column_id text NOT NULL REFERENCES columns_(id),
     tag text NOT NULL,
     justification text NOT NULL,
     at text NOT NULL,
     by text NOT NULL REFERENCES users(id),
     PRIMARY KEY (column_id, tag)
   )`,
  `CREATE TABLE IF NOT EXISTS tag_batches (
     id text PRIMARY KEY,
     asset text NOT NULL REFERENCES assets(id),
     tag text NOT NULL,
    audit_seq bigint NOT NULL,
     created_at bigint NOT NULL,
     undone boolean NOT NULL DEFAULT false
   )`,
  `CREATE TABLE IF NOT EXISTS tag_batch_columns (
     batch_id text NOT NULL REFERENCES tag_batches(id),
     column_id text NOT NULL REFERENCES columns_(id),
     direct_tags text NOT NULL,
     position int NOT NULL,
     PRIMARY KEY (batch_id, column_id)
   )`,
  `CREATE TABLE IF NOT EXISTS terms (
     id text PRIMARY KEY,
     name text NOT NULL,
     definition text NOT NULL,
     revision int NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS terms_name ON terms (lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')))`,
  `CREATE TABLE IF NOT EXISTS asset_terms (
     asset text NOT NULL REFERENCES assets(id),
     term_id text NOT NULL REFERENCES terms(id),
     PRIMARY KEY (asset, term_id)
   )`,
  `CREATE TABLE IF NOT EXISTS evidence (
     asset text PRIMARY KEY REFERENCES assets(id),
     evidence_id text NOT NULL,
     filename text NOT NULL,
     content_type text NOT NULL,
     size_bytes bigint NOT NULL,
     sha256 text NOT NULL,
     object_key text NOT NULL,
     uploaded_at text NOT NULL,
     uploaded_by text NOT NULL REFERENCES users(id)
   )`,
  `CREATE TABLE IF NOT EXISTS deprecation_events (
     id text PRIMARY KEY,
     asset text NOT NULL REFERENCES assets(id),
     reason text NOT NULL,
     at text NOT NULL,
     by text NOT NULL REFERENCES users(id)
   )`,
  `CREATE INDEX IF NOT EXISTS deprecation_events_asset ON deprecation_events(asset)`,
  `CREATE TABLE IF NOT EXISTS notices (
     id text PRIMARY KEY,
     event_id text NOT NULL REFERENCES deprecation_events(id),
     asset text NOT NULL REFERENCES assets(id),
     owner_id text NOT NULL REFERENCES users(id),
     state text NOT NULL DEFAULT 'queued',
     claim_expires_at bigint,
     attempts int NOT NULL DEFAULT 0,
     message_id text NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS notices_state ON notices(state)`,
  `CREATE TABLE IF NOT EXISTS idempotency (
     key text NOT NULL,
     user_id text NOT NULL REFERENCES users(id),
     route text NOT NULL,
     asset text NOT NULL,
     fingerprint text NOT NULL,
     status int,
     body text,
     state text NOT NULL DEFAULT 'in_progress',
     created_at bigint NOT NULL,
     PRIMARY KEY (key, user_id, route, asset)
   )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
     id text NOT NULL DEFAULT gen_random_uuid()::text,
     seq bigint PRIMARY KEY,
     at text NOT NULL,
     actor_id text NOT NULL,
     actor_role text NOT NULL,
     action text NOT NULL,
     target_type text NOT NULL,
     target_id text NOT NULL,
     before jsonb,
     after jsonb,
     prev_hash text NOT NULL,
     hash text NOT NULL
   )`,
  `CREATE OR REPLACE FUNCTION strata_audit_guard() RETURNS trigger AS $$
     BEGIN
       RAISE EXCEPTION 'audit_log is append-only';
     END;
   $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS strata_audit_no_update ON audit_log`,
  `CREATE TRIGGER strata_audit_no_update BEFORE UPDATE OR DELETE ON audit_log
     FOR EACH STATEMENT EXECUTE FUNCTION strata_audit_guard()`,
  `DROP TRIGGER IF EXISTS strata_audit_no_truncate ON audit_log`,
  `CREATE TRIGGER strata_audit_no_truncate BEFORE TRUNCATE ON audit_log
     FOR EACH STATEMENT EXECUTE FUNCTION strata_audit_guard()`,
];

async function seed(db: Database): Promise<void> {
  const now = Date.now();
  const passwordHash = await hashPassword(SEED_PASSWORD);
  for (const u of SEED_USERS) {
    await db.query(
      `INSERT INTO users (id, name, email, role, password_hash) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [u.id, u.name, u.email, u.role, passwordHash]
    );
  }
  for (const t of SEED_TERMS) {
    await db.query(
      `INSERT INTO terms (id, name, definition, revision) VALUES ($1,$2,$3,1)
       ON CONFLICT (id) DO NOTHING`,
      [t.id, t.name, t.definition]
    );
  }
  for (const a of SEED_ASSETS) {
    await db.query(
      `INSERT INTO assets (id, kind, description, owner_id, state, verified_at, created_at)
       VALUES ($1,$2,$3,$4,'draft',NULL,$5) ON CONFLICT (id) DO NOTHING`,
      [a.id, a.kind, a.description, a.owner, now]
    );
    for (const termId of a.terms) {
      await db.query(`INSERT INTO asset_terms (asset, term_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [a.id, termId]);
    }
  }
  let position = 0;
  for (const c of SEED_COLUMNS) {
    const asset = c.id.slice(0, c.id.lastIndexOf('.'));
    const name = c.id.slice(c.id.lastIndexOf('.') + 1);
    await db.query(
      `INSERT INTO columns_ (id, asset, name, data_type, position) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [c.id, asset, name, c.type, position]
    );
    position += 1;
    for (let i = 0; i < c.samples.length; i++) {
      await db.query(
        `INSERT INTO column_samples (column_id, position, value) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [c.id, i, c.samples[i]!]
      );
    }
  }
  for (const e of SEED_EDGES) {
    const id = sha256Hex(`${e.from}|${e.to}`).slice(0, 24);
    await db.query(
      `INSERT INTO edges (id, from_col, to_col, transform) VALUES ($1,$2,$3,$4)
       ON CONFLICT (from_col, to_col) DO NOTHING`,
      [id, e.from, e.to, e.transform]
    );
  }
  for (const t of SEED_DIRECT_TAGS) {
    await db.query(`INSERT INTO direct_tags (column_id, tag) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [t.column, t.tag]);
  }
  await db.query(`UPDATE assets SET state = 'deprecated' WHERE id = $1 AND state = 'draft'`, [SEED_DEPRECATED]);
  const dep = await db.queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM deprecation_events WHERE asset = $1`,
    [SEED_DEPRECATED]
  );
  if ((dep?.n ?? 0) === 0) {
    await db.query(
      `INSERT INTO deprecation_events (id, asset, reason, at, by) VALUES ($1,$2,$3,$4,'u-morgan')`,
      ['de-seed-eligibility-2019', SEED_DEPRECATED, SEED_DEPRECATION_REASON, new Date(now).toISOString()]
    );
  }
}

