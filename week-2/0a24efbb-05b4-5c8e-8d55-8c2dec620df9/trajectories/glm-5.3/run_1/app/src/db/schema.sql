-- Rostara attendance desk schema.
-- Every stored instant is UTC. Every day is a business date in Europe/London.

CREATE TABLE employer (
  id integer PRIMARY KEY,
  name text NOT NULL,
  time_zone text NOT NULL,
  seeded_on date NOT NULL
);

CREATE TABLE person (
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

-- Work addresses are unique in their folded form (NFKC + lowercase).
CREATE UNIQUE INDEX person_folded_address_key
  ON person (lower(work_address));

CREATE TABLE attendance_day (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id integer NOT NULL REFERENCES person (id),
  day date NOT NULL,
  recorded_in timestamptz,
  recorded_out timestamptz,
  source text NOT NULL CHECK (source IN ('clock', 'regularisation')),
  CONSTRAINT attendance_person_day_key UNIQUE (person_id, day)
);

CREATE TABLE leave_day (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id integer NOT NULL REFERENCES person (id),
  day date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('annual', 'sickness')),
  status text NOT NULL CHECK (status IN ('approved', 'pending')),
  CONSTRAINT leave_person_day_key UNIQUE (person_id, day)
);

CREATE TABLE regularisation_request (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
  CONSTRAINT request_decided_shape CHECK (
    (state IN ('approved', 'rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    OR (state IN ('pending', 'cancelled') AND decided_by IS NULL AND decided_at IS NULL)
  ),
  CONSTRAINT request_rejected_note CHECK (state <> 'rejected' OR decision_note IS NOT NULL)
);

-- At most one pending request per person per day, enforced by the store.
CREATE UNIQUE INDEX request_one_pending_per_day
  ON regularisation_request (person_id, day) WHERE state = 'pending';

-- An idempotency key is unique per person where present.
CREATE UNIQUE INDEX request_idempotency_key
  ON regularisation_request (person_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE policy (
  version integer PRIMARY KEY,
  employer_id integer NOT NULL REFERENCES employer (id),
  monthly_cap integer NOT NULL CHECK (monthly_cap >= 0 AND monthly_cap <= 10),
  lookback_days integer NOT NULL CHECK (lookback_days >= 1 AND lookback_days <= 90),
  enabled_types text[] NOT NULL,
  require_note_on_approve boolean NOT NULL,
  self_approval_allowed boolean NOT NULL DEFAULT false,
  created_by integer NOT NULL REFERENCES person (id),
  created_at timestamptz NOT NULL
);

CREATE TABLE audit_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seq bigint NOT NULL UNIQUE,
  request_id bigint REFERENCES regularisation_request (id),
  actor_id integer NOT NULL REFERENCES person (id),
  actor_role text NOT NULL CHECK (actor_role IN ('manager', 'admin')),
  verb text NOT NULL CHECK (verb IN ('approved', 'rejected', 'policy_saved', 'share_mint', 'share_revoke')),
  subject_type text NOT NULL CHECK (subject_type IN ('request', 'policy', 'share_link')),
  subject_id bigint NOT NULL,
  occurred_at timestamptz NOT NULL,
  note text,
  prev_hash text NOT NULL,
  entry_hash text NOT NULL
);

-- The application's database account cannot update or delete an audit entry.
CREATE RULE audit_event_no_update AS ON UPDATE TO audit_event DO INSTEAD NOTHING;
CREATE RULE audit_event_no_delete AS ON DELETE TO audit_event DO INSTEAD NOTHING;

CREATE TABLE share_link (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id integer NOT NULL REFERENCES person (id),
  month text NOT NULL,
  token_hash text NOT NULL,
  minted_by integer NOT NULL REFERENCES person (id),
  minted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_at timestamptz
);

-- At most one live shared link per person per month.
CREATE UNIQUE INDEX share_link_one_live
  ON share_link (person_id, month)
  WHERE revoked_at IS NULL AND replaced_at IS NULL;

CREATE TABLE sign_in_attempt (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_address text NOT NULL,
  attempted_at timestamptz NOT NULL,
  succeeded boolean NOT NULL
);

CREATE INDEX sign_in_attempt_address_time ON sign_in_attempt (work_address, attempted_at);

CREATE TABLE desk_session (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  person_id integer NOT NULL REFERENCES person (id),
  created_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL,
  ended_at timestamptz,
  ended_reason text
);

CREATE INDEX desk_session_person ON desk_session (person_id);
