// The whole schema. Every statement is idempotent, so it is applied on every start.
// The database itself guarantees the exactly-once outcomes: unique ids, partial unique indexes,
// primary keys on closes and audit versions, and triggers that make audit entries append-only.

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_secrets (
  name text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  roles text[] NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz
);

CREATE TABLE IF NOT EXISTS market_clock (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  anchor_ms bigint,
  set_real_ms bigint
);

CREATE TABLE IF NOT EXISTS session_calendar (
  date date PRIMARY KEY,
  holiday text,
  early_close boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS ticks (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  id text PRIMARY KEY,
  instrument text NOT NULL CHECK (instrument IN ('ETH-USD', 'VLCH')),
  price text NOT NULL,
  at timestamptz NOT NULL,
  session_date date
);
CREATE INDEX IF NOT EXISTS ticks_instrument_at ON ticks (instrument, at DESC, seq DESC);
CREATE INDEX IF NOT EXISTS ticks_session_date ON ticks (session_date, at DESC, seq DESC) WHERE instrument = 'VLCH';

CREATE TABLE IF NOT EXISTS processed_closes (
  date date PRIMARY KEY,
  close_at timestamptz NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS tape_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  state text NOT NULL CHECK (state IN ('playing', 'paused')),
  position bigint NOT NULL,
  next_due_ms bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS restatements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL,
  week_ending date NOT NULL,
  state text NOT NULL CHECK (state IN ('draft','in_review','returned','cleared','queued','published','superseded')),
  supersedes uuid REFERENCES restatements(id),
  correction_reason text,
  rows jsonb NOT NULL,
  accession text,
  exhibit_page integer,
  exhibit_status text CHECK (exhibit_status IN ('verified', 'rejected')),
  exhibit_sha256 text,
  exhibit_bytes bigint,
  exhibit_key text,
  prepared_by uuid NOT NULL REFERENCES staff_users(id),
  cleared_by uuid REFERENCES staff_users(id),
  released_by uuid REFERENCES staff_users(id),
  return_note text,
  release_at timestamptz,
  published_at timestamptz,
  superseded_by uuid REFERENCES restatements(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS restatements_one_open ON restatements ((true))
  WHERE state IN ('draft', 'in_review', 'returned', 'cleared', 'queued');
CREATE UNIQUE INDEX IF NOT EXISTS restatements_one_current_per_week ON restatements (week_ending)
  WHERE state = 'published';
CREATE INDEX IF NOT EXISTS restatements_exhibit_sha ON restatements (exhibit_sha256) WHERE exhibit_status = 'verified';

CREATE TABLE IF NOT EXISTS share_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restatement_id uuid NOT NULL REFERENCES restatements(id),
  position integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('atm_settlement', 'warrant_exercise', 'buyback')),
  shares text NOT NULL,
  effective_date date NOT NULL
);
CREATE INDEX IF NOT EXISTS share_events_restatement ON share_events (restatement_id, position);

CREATE TABLE IF NOT EXISTS restatement_audit (
  restatement_id uuid NOT NULL REFERENCES restatements(id),
  version integer NOT NULL,
  action text NOT NULL,
  actor_id uuid REFERENCES staff_users(id),
  at timestamptz NOT NULL,
  from_state text,
  to_state text NOT NULL,
  note text,
  PRIMARY KEY (restatement_id, version)
);

CREATE OR REPLACE FUNCTION refuse_audit_change() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'audit entries are append-only';
END;
$fn$;
DROP TRIGGER IF EXISTS restatement_audit_append_only ON restatement_audit;
CREATE TRIGGER restatement_audit_append_only BEFORE UPDATE OR DELETE ON restatement_audit
  FOR EACH ROW EXECUTE FUNCTION refuse_audit_change();
DROP TRIGGER IF EXISTS restatement_audit_no_truncate ON restatement_audit;
CREATE TRIGGER restatement_audit_no_truncate BEFORE TRUNCATE ON restatement_audit
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_audit_change();

CREATE TABLE IF NOT EXISTS computations (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  figure text NOT NULL,
  computed_at timestamptz NOT NULL,
  restatement_id uuid NOT NULL REFERENCES restatements(id),
  trigger text NOT NULL CHECK (trigger IN ('publication', 'tick', 'close')),
  label text NOT NULL,
  value text NOT NULL,
  display text NOT NULL,
  as_of timestamptz NOT NULL,
  inputs json NOT NULL,
  exhibit json NOT NULL,
  restated json
);
CREATE INDEX IF NOT EXISTS computations_figure_time ON computations (figure, computed_at DESC, seq DESC);
CREATE INDEX IF NOT EXISTS computations_restatement ON computations (restatement_id, figure);

CREATE OR REPLACE FUNCTION guard_computation_change() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'stored computations are never deleted';
  END IF;
  IF OLD.restated IS NOT NULL
     OR (NEW.id, NEW.seq, NEW.figure, NEW.computed_at, NEW.restatement_id, NEW.trigger, NEW.label, NEW.value,
         NEW.display, NEW.as_of, NEW.inputs::text, NEW.exhibit::text)
        IS DISTINCT FROM
        (OLD.id, OLD.seq, OLD.figure, OLD.computed_at, OLD.restatement_id, OLD.trigger, OLD.label, OLD.value,
         OLD.display, OLD.as_of, OLD.inputs::text, OLD.exhibit::text) THEN
    RAISE EXCEPTION 'a stored computation only ever gains its restated marker, once';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS computations_guard ON computations;
CREATE TRIGGER computations_guard BEFORE UPDATE OR DELETE ON computations
  FOR EACH ROW EXECUTE FUNCTION guard_computation_change();
DROP TRIGGER IF EXISTS computations_no_truncate ON computations;
CREATE TRIGGER computations_no_truncate BEFORE TRUNCATE ON computations
  FOR EACH STATEMENT EXECUTE FUNCTION guard_computation_change();

CREATE TABLE IF NOT EXISTS release_replays (
  user_id uuid NOT NULL REFERENCES staff_users(id),
  idempotency_key text NOT NULL,
  restatement_id uuid NOT NULL REFERENCES restatements(id),
  status integer NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS seed_marks (
  name text PRIMARY KEY
);
`;
