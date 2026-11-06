import { query, withAdvisoryLock } from './db';

const SCHEMA_LOCK = 718_264_301;

const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS app_state (
     name text PRIMARY KEY,
     value text NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS staff_user (
     id text PRIMARY KEY,
     name text NOT NULL,
     email text NOT NULL UNIQUE,
     password_hash text NOT NULL,
     roles text[] NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS staff_session (
     id text PRIMARY KEY,
     user_id text NOT NULL REFERENCES staff_user (id),
     created_at timestamptz NOT NULL,
     last_request_at timestamptz NOT NULL,
     ended boolean NOT NULL DEFAULT false
   )`,

  `CREATE TABLE IF NOT EXISTS restatement (
     id text PRIMARY KEY,
     version integer NOT NULL,
     week_ending text NOT NULL,
     state text NOT NULL,
     supersedes text REFERENCES restatement (id),
     correction_reason text,
     row_beginning_balance text,
     row_eth_acquired text,
     row_staking_rewards text,
     row_ending_balance text,
     row_cumulative_staking_rewards text,
     row_diluted_shares text,
     accession text,
     exhibit_page integer,
     exhibit_status text,
     exhibit_sha256 text,
     exhibit_bytes integer,
     exhibit_key text,
     prepared_by text NOT NULL REFERENCES staff_user (id),
     cleared_by text REFERENCES staff_user (id),
     released_by text REFERENCES staff_user (id),
     return_note text,
     release_at timestamptz,
     published_at timestamptz,
     superseded_by text REFERENCES restatement (id),
     created_at timestamptz NOT NULL,
     updated_at timestamptz NOT NULL,
     seq bigserial NOT NULL
   )`,

  // At most one open restatement, guaranteed by the database itself.
  `CREATE UNIQUE INDEX IF NOT EXISTS restatement_single_open
     ON restatement ((state IS NOT NULL))
     WHERE state IN ('draft', 'in_review', 'returned', 'cleared', 'queued')`,

  // At most one current published restatement per week.
  `CREATE UNIQUE INDEX IF NOT EXISTS restatement_single_published_week
     ON restatement (week_ending)
     WHERE state = 'published'`,

  `CREATE TABLE IF NOT EXISTS share_event (
     id text PRIMARY KEY,
     restatement_id text NOT NULL REFERENCES restatement (id) ON DELETE CASCADE,
     position integer NOT NULL,
     kind text NOT NULL,
     shares text NOT NULL,
     effective_date text NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS share_event_restatement
     ON share_event (restatement_id, position)`,

  `CREATE TABLE IF NOT EXISTS restatement_audit (
     restatement_id text NOT NULL REFERENCES restatement (id),
     version integer NOT NULL,
     action text NOT NULL,
     actor_id text REFERENCES staff_user (id),
     at timestamptz NOT NULL,
     from_state text,
     to_state text NOT NULL,
     note text,
     PRIMARY KEY (restatement_id, version)
   )`,

  `CREATE TABLE IF NOT EXISTS computations (
     id text PRIMARY KEY,
     figure text NOT NULL,
     computed_at timestamptz NOT NULL,
     restatement_id text NOT NULL REFERENCES restatement (id),
     value text NOT NULL,
     display text NOT NULL,
     as_of timestamptz NOT NULL,
     inputs jsonb NOT NULL,
     restated jsonb,
     seq bigserial NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS computations_figure_order
     ON computations (figure, computed_at DESC, seq DESC)`,

  `CREATE INDEX IF NOT EXISTS computations_restatement
     ON computations (restatement_id)`,

  `CREATE TABLE IF NOT EXISTS tick (
     id text PRIMARY KEY,
     instrument text NOT NULL,
     price text NOT NULL,
     at timestamptz NOT NULL,
     seq bigserial NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS tick_instrument_order
     ON tick (instrument, at DESC, seq DESC)`,

  `CREATE TABLE IF NOT EXISTS session_close (
     close_date text PRIMARY KEY,
     closes_at timestamptz NOT NULL,
     processed_at timestamptz NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS release_idempotency (
     user_id text NOT NULL,
     key text NOT NULL,
     restatement_id text NOT NULL,
     status integer NOT NULL,
     body jsonb NOT NULL,
     created_at timestamptz NOT NULL,
     PRIMARY KEY (user_id, key)
   )`,

  `CREATE TABLE IF NOT EXISTS tape_state (
     id integer PRIMARY KEY,
     state text NOT NULL,
     position integer NOT NULL,
     last_step_at timestamptz
   )`,

  `CREATE TABLE IF NOT EXISTS clock_setting (
     id integer PRIMARY KEY,
     rehearsal_at timestamptz,
     set_at_real timestamptz
   )`,

  `INSERT INTO tape_state (id, state, position, last_step_at)
     VALUES (1, 'playing', 0, NULL)
     ON CONFLICT (id) DO NOTHING`,

  `INSERT INTO clock_setting (id, rehearsal_at, set_at_real)
     VALUES (1, NULL, NULL)
     ON CONFLICT (id) DO NOTHING`,

  // The audit trail is append-only, enforced by the database.
  `CREATE OR REPLACE FUNCTION restatement_audit_append_only() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       RAISE EXCEPTION 'restatement_audit is append-only';
     END $$`,

  `DROP TRIGGER IF EXISTS restatement_audit_no_change ON restatement_audit`,

  `CREATE TRIGGER restatement_audit_no_change
     BEFORE UPDATE OR DELETE ON restatement_audit
     FOR EACH ROW EXECUTE FUNCTION restatement_audit_append_only()`,

  `DROP TRIGGER IF EXISTS restatement_audit_no_truncate ON restatement_audit`,

  `CREATE TRIGGER restatement_audit_no_truncate
     BEFORE TRUNCATE ON restatement_audit
     FOR EACH STATEMENT EXECUTE FUNCTION restatement_audit_append_only()`,

  // A stored computation is never deleted.
  `CREATE OR REPLACE FUNCTION computations_no_delete() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       RAISE EXCEPTION 'computations rows are never deleted';
     END $$`,

  `DROP TRIGGER IF EXISTS computations_no_delete_trigger ON computations`,

  `CREATE TRIGGER computations_no_delete_trigger
     BEFORE DELETE ON computations
     FOR EACH ROW EXECUTE FUNCTION computations_no_delete()`,
];

export async function applySchema(): Promise<void> {
  await withAdvisoryLock(SCHEMA_LOCK, async () => {
    for (const statement of STATEMENTS) {
      await query(statement);
    }
  });
}

export async function readAppState(name: string): Promise<string | null> {
  const rows = await query<{ value: string }>('SELECT value FROM app_state WHERE name = $1', [name]);
  return rows[0]?.value ?? null;
}

export async function writeAppState(name: string, value: string): Promise<void> {
  await query(
    `INSERT INTO app_state (name, value) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
    [name, value],
  );
}
