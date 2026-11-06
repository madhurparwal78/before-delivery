import { LOCKS, lock, transaction } from './db.js';

const DDL = `
CREATE TABLE IF NOT EXISTS employer (
  id integer PRIMARY KEY,
  name text NOT NULL,
  time_zone text NOT NULL,
  seeded_on date NOT NULL
);

CREATE TABLE IF NOT EXISTS person (
  id integer PRIMARY KEY,
  employer_id integer NOT NULL REFERENCES employer (id),
  name text NOT NULL,
  work_address text NOT NULL,
  role text NOT NULL CHECK (role IN ('employee', 'manager', 'admin')),
  manager_id integer REFERENCES person (id),
  active boolean NOT NULL,
  subject text,
  phone text,
  private_note text
);

CREATE UNIQUE INDEX IF NOT EXISTS person_work_address_folded ON person (lower(work_address));

CREATE TABLE IF NOT EXISTS attendance_day (
  id bigserial PRIMARY KEY,
  person_id integer NOT NULL REFERENCES person (id),
  day date NOT NULL,
  recorded_in timestamptz,
  recorded_out timestamptz,
  source text NOT NULL CHECK (source IN ('clock', 'regularisation')),
  UNIQUE (person_id, day)
);

CREATE TABLE IF NOT EXISTS leave_day (
  id bigserial PRIMARY KEY,
  person_id integer NOT NULL REFERENCES person (id),
  day date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('annual', 'sickness')),
  status text NOT NULL CHECK (status IN ('approved', 'pending')),
  UNIQUE (person_id, day)
);

CREATE TABLE IF NOT EXISTS regularisation_request (
  id bigserial PRIMARY KEY,
  person_id integer NOT NULL REFERENCES person (id),
  day date NOT NULL,
  correction_type text NOT NULL CHECK (correction_type IN ('missed_in', 'missed_out', 'offsite', 'whole_day', 'night_shift')),
  claimed_in text,
  claimed_out text,
  reason text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'approved', 'rejected', 'cancelled')),
  raised_at timestamptz NOT NULL,
  decided_by integer REFERENCES person (id),
  decided_at timestamptz,
  decision_note text,
  idempotency_key text,
  CONSTRAINT decision_recorded_with_decided_state
    CHECK ((state IN ('approved', 'rejected')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT rejection_carries_a_note
    CHECK (state <> 'rejected' OR decision_note IS NOT NULL),
  CONSTRAINT decider_is_never_the_raiser
    CHECK (decided_by IS NULL OR decided_by <> person_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS regularisation_request_one_pending_per_day
  ON regularisation_request (person_id, day) WHERE state = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS regularisation_request_idempotency_key
  ON regularisation_request (person_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS policy (
  version integer PRIMARY KEY,
  employer_id integer NOT NULL REFERENCES employer (id),
  monthly_cap integer NOT NULL,
  lookback_days integer NOT NULL,
  enabled_types text[] NOT NULL,
  require_note_on_approve boolean NOT NULL,
  self_approval_allowed boolean NOT NULL,
  created_by integer NOT NULL REFERENCES person (id),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_event (
  id bigint PRIMARY KEY,
  seq integer NOT NULL UNIQUE,
  request_id bigint REFERENCES regularisation_request (id),
  actor_id integer NOT NULL REFERENCES person (id),
  actor_role text NOT NULL,
  verb text NOT NULL CHECK (verb IN ('approved', 'rejected', 'policy_saved', 'share_mint', 'share_revoke')),
  subject_type text NOT NULL CHECK (subject_type IN ('request', 'policy', 'share_link')),
  subject_id bigint NOT NULL,
  occurred_at timestamptz NOT NULL,
  note text,
  prev_hash text NOT NULL,
  entry_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS share_link (
  id bigserial PRIMARY KEY,
  person_id integer NOT NULL REFERENCES person (id),
  month text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  minted_by integer NOT NULL REFERENCES person (id),
  minted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS share_link_one_live_per_person_month
  ON share_link (person_id, month) WHERE revoked_at IS NULL AND replaced_at IS NULL;

CREATE TABLE IF NOT EXISTS sign_in_attempt (
  id bigserial PRIMARY KEY,
  work_address text NOT NULL,
  attempted_at timestamptz NOT NULL,
  succeeded boolean NOT NULL
);

CREATE INDEX IF NOT EXISTS sign_in_attempt_by_address ON sign_in_attempt (work_address, attempted_at DESC);

CREATE TABLE IF NOT EXISTS app_session (
  token_hash text PRIMARY KEY,
  person_id integer NOT NULL REFERENCES person (id),
  created_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL,
  ended_at timestamptz,
  ended_reason text
);

CREATE OR REPLACE FUNCTION audit_event_is_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $audit$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only';
END;
$audit$;
`;

const TRIGGERS = `
DROP TRIGGER IF EXISTS audit_event_no_change ON audit_event;
CREATE TRIGGER audit_event_no_change
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_is_append_only();

DROP TRIGGER IF EXISTS audit_event_no_truncate ON audit_event;
CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON audit_event
  EXECUTE FUNCTION audit_event_is_append_only();
`;

export async function ensureSchema() {
  await transaction(async (client) => {
    await lock(client, LOCKS.seed);
    await client.query(DDL);
    await client.query(TRIGGERS);
  });
}
