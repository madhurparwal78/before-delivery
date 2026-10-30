CREATE TABLE IF NOT EXISTS homes (
    id text PRIMARY KEY,
    name text NOT NULL,
    manager_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
    id text PRIMARY KEY,
    home_id text NOT NULL REFERENCES homes,
    name text NOT NULL,
    position int NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
    id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    display_name text NOT NULL,
    role text NOT NULL,
    home_id text REFERENCES homes,
    unit_id text REFERENCES units,
    skill text
);

CREATE TABLE IF NOT EXISTS credentials (
    person_id text NOT NULL REFERENCES people,
    home_id text NOT NULL REFERENCES homes,
    PRIMARY KEY (person_id, home_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    person_id text NOT NULL REFERENCES people,
    expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS floor_versions (
    id text PRIMARY KEY,
    home_id text NOT NULL REFERENCES homes,
    unit_id text NOT NULL REFERENCES units,
    shift text NOT NULL,
    min_staff int NOT NULL,
    min_seniors int NOT NULL,
    effective_from date NOT NULL,
    created_by text REFERENCES people,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (unit_id, shift, effective_from)
);

CREATE TABLE IF NOT EXISTS policy_versions (
    id text PRIMARY KEY,
    home_id text NOT NULL REFERENCES homes,
    notice_multiplier int NOT NULL,
    effective_from date NOT NULL,
    created_by text REFERENCES people,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (home_id, effective_from)
);

CREATE TABLE IF NOT EXISTS assignments (
    id text PRIMARY KEY,
    person_id text NOT NULL REFERENCES people,
    home_id text NOT NULL REFERENCES homes,
    unit_id text NOT NULL REFERENCES units,
    date date NOT NULL,
    shift text NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS assignments_unit_date ON assignments (unit_id, date);
CREATE INDEX IF NOT EXISTS assignments_person_starts ON assignments (person_id, starts_at);

CREATE TABLE IF NOT EXISTS leave_requests (
    id text PRIMARY KEY,
    requester_id text NOT NULL REFERENCES people,
    home_id text NOT NULL REFERENCES homes,
    unit_id text REFERENCES units,
    type text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    note text,
    status text NOT NULL,
    hours_seconds bigint NOT NULL DEFAULT 0,
    short_notice boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    submitted_at timestamptz,
    decided_at timestamptz,
    decided_by text REFERENCES people,
    decision_reason text
);
CREATE INDEX IF NOT EXISTS leave_requests_home ON leave_requests (home_id, status);
CREATE INDEX IF NOT EXISTS leave_requests_requester ON leave_requests (requester_id);

CREATE TABLE IF NOT EXISTS sickness (
    id text PRIMARY KEY,
    person_id text NOT NULL REFERENCES people,
    home_id text NOT NULL REFERENCES homes,
    start_date date NOT NULL,
    last_sick_date date,
    status text NOT NULL,
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sickness_person ON sickness (person_id);

CREATE TABLE IF NOT EXISTS fit_notes (
    id text PRIMARY KEY,
    sickness_id text NOT NULL UNIQUE REFERENCES sickness,
    file_name text NOT NULL,
    content_type text NOT NULL,
    storage_key text NOT NULL,
    held bytea,
    uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS covers (
    id text PRIMARY KEY,
    leave_request_id text NOT NULL REFERENCES leave_requests,
    home_id text NOT NULL REFERENCES homes,
    unit_id text NOT NULL REFERENCES units,
    date date NOT NULL,
    shift text NOT NULL,
    skill text NOT NULL,
    status text NOT NULL,
    claimed_by text REFERENCES people,
    assignment_id text REFERENCES assignments ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS covers_request ON covers (leave_request_id);

CREATE TABLE IF NOT EXISTS attendance (
    id text PRIMARY KEY,
    assignment_id text NOT NULL UNIQUE REFERENCES assignments,
    clock_in_at timestamptz NOT NULL,
    clock_out_at timestamptz,
    late boolean NOT NULL,
    late_acknowledged boolean NOT NULL DEFAULT false,
    correction_note text,
    version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS punches (
    id text PRIMARY KEY,
    person_id text NOT NULL REFERENCES people,
    attendance_id text NOT NULL REFERENCES attendance,
    kind text NOT NULL,
    at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    person_id text NOT NULL REFERENCES people,
    key text NOT NULL,
    request_hash text NOT NULL,
    status int NOT NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (person_id, key)
);

CREATE TABLE IF NOT EXISTS outbox (
    id bigserial PRIMARY KEY,
    to_address text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_unsent ON outbox (id) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS pay_periods (
    period text PRIMARY KEY,
    closed_at timestamptz NOT NULL DEFAULT now(),
    closed_by text NOT NULL REFERENCES people
);

CREATE TABLE IF NOT EXISTS ledger_entries (
    id text PRIMARY KEY,
    seq bigserial,
    person_id text NOT NULL REFERENCES people,
    period text NOT NULL,
    kind text NOT NULL,
    worked_seconds bigint NOT NULL,
    worked_hours numeric(14, 4) NOT NULL,
    accrued_hours numeric(14, 4) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exports (
    id text PRIMARY KEY,
    period text NOT NULL,
    home_ids text[] NOT NULL,
    row_count int NOT NULL,
    storage_key text NOT NULL,
    held bytea,
    created_by text NOT NULL REFERENCES people,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_entries (
    id text PRIMARY KEY,
    seq bigserial,
    at timestamptz NOT NULL DEFAULT clock_timestamp(),
    actor_id text NOT NULL REFERENCES people,
    actor_name text NOT NULL,
    actor_role text NOT NULL,
    action text NOT NULL,
    home_id text NOT NULL REFERENCES homes,
    target_type text NOT NULL,
    target_id text NOT NULL,
    before jsonb,
    after jsonb,
    reason text
);
CREATE INDEX IF NOT EXISTS audit_entries_home ON audit_entries (home_id, at DESC);

CREATE OR REPLACE FUNCTION audit_entries_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit entries are append-only';
END
$$;
CREATE OR REPLACE TRIGGER audit_entries_append_only
    BEFORE UPDATE OR DELETE ON audit_entries
    FOR EACH ROW EXECUTE FUNCTION audit_entries_append_only();
CREATE OR REPLACE TRIGGER audit_entries_no_truncate
    BEFORE TRUNCATE ON audit_entries
    FOR EACH STATEMENT EXECUTE FUNCTION audit_entries_append_only();

-- A leave request's hours: the requester's real rostered hours whose dates fall inside it.
CREATE OR REPLACE FUNCTION rostered_seconds(person text, first_day date, last_day date) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT coalesce(sum(extract(epoch FROM ends_at - starts_at)), 0)::bigint
    FROM assignments WHERE person_id = person AND date BETWEEN first_day AND last_day
$$;

-- Off sick on a date: a sickness record covers its start date to its last sick date (open: no end).
CREATE OR REPLACE FUNCTION off_sick(person text, day date) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM sickness s WHERE s.person_id = person AND day >= s.start_date
                   AND (s.last_sick_date IS NULL OR day <= s.last_sick_date))
$$;

-- Sick-covered hours: the person's current rostered shifts inside the dates that fall on days off sick.
CREATE OR REPLACE FUNCTION sick_covered_seconds(person text, first_day date, last_day date) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT coalesce(sum(extract(epoch FROM ends_at - starts_at)), 0)::bigint
    FROM assignments WHERE person_id = person AND date BETWEEN first_day AND last_day AND off_sick(person, date)
$$;

-- A request's cost: its hours less its sick-covered hours, which are capped at its hours.
CREATE OR REPLACE FUNCTION cost_seconds(person text, first_day date, last_day date, hours bigint) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT hours - least(hours, sick_covered_seconds(person, first_day, last_day))
$$;
