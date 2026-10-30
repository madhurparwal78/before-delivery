CREATE TABLE IF NOT EXISTS homes (
    id            text PRIMARY KEY,
    name          text NOT NULL,
    manager_id    text
);

CREATE TABLE IF NOT EXISTS units (
    id      text PRIMARY KEY,
    home_id text NOT NULL REFERENCES homes(id),
    name    text NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
    id                 text PRIMARY KEY,
    email              text NOT NULL UNIQUE,
    password_hash      text NOT NULL,
    display_name       text NOT NULL,
    role               text NOT NULL,
    home_id            text REFERENCES homes(id),
    unit_id            text REFERENCES units(id),
    skill              text NOT NULL,
    entitlement_hours  numeric(8, 2)
);

CREATE TABLE IF NOT EXISTS bank_credentials (
    person_id text NOT NULL REFERENCES people(id),
    home_id   text NOT NULL REFERENCES homes(id),
    PRIMARY KEY (person_id, home_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id         text PRIMARY KEY,
    person_id  text NOT NULL REFERENCES people(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS rota_assignments (
    id         text PRIMARY KEY,
    person_id  text NOT NULL REFERENCES people(id),
    unit_id    text NOT NULL REFERENCES units(id),
    shift_date date NOT NULL,
    shift      text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rota_by_unit ON rota_assignments (unit_id, shift_date);
CREATE INDEX IF NOT EXISTS rota_by_person ON rota_assignments (person_id, shift_date);

CREATE TABLE IF NOT EXISTS floor_versions (
    id             text PRIMARY KEY,
    home_id        text NOT NULL REFERENCES homes(id),
    unit_id        text NOT NULL REFERENCES units(id),
    shift          text NOT NULL,
    min_staff      integer NOT NULL,
    min_seniors    integer NOT NULL,
    effective_from date NOT NULL,
    created_by     text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (unit_id, shift, effective_from)
);

CREATE TABLE IF NOT EXISTS policy_versions (
    id                text PRIMARY KEY,
    home_id           text NOT NULL REFERENCES homes(id),
    notice_multiplier integer NOT NULL,
    effective_from    date NOT NULL,
    created_by        text NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (home_id, effective_from)
);

CREATE TABLE IF NOT EXISTS leave_requests (
    id              text PRIMARY KEY,
    requester_id    text NOT NULL REFERENCES people(id),
    home_id         text NOT NULL REFERENCES homes(id),
    unit_id         text REFERENCES units(id),
    leave_type      text NOT NULL,
    start_date      date NOT NULL,
    end_date        date NOT NULL,
    note            text,
    status          text NOT NULL,
    hours           numeric(8, 2) NOT NULL DEFAULT 0,
    short_notice    boolean NOT NULL DEFAULT false,
    submitted_at    timestamptz,
    decided_at      timestamptz,
    decided_by      text REFERENCES people(id),
    decision_reason text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leave_by_requester ON leave_requests (requester_id);
CREATE INDEX IF NOT EXISTS leave_by_home ON leave_requests (home_id, status);

CREATE TABLE IF NOT EXISTS sickness_records (
    id             text PRIMARY KEY,
    person_id      text NOT NULL REFERENCES people(id),
    home_id        text NOT NULL REFERENCES homes(id),
    start_date     date NOT NULL,
    last_sick_date date,
    status         text NOT NULL,
    reason         text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sickness_by_person ON sickness_records (person_id);

CREATE TABLE IF NOT EXISTS uploads (
    id           text PRIMARY KEY,
    sickness_id  text NOT NULL REFERENCES sickness_records(id),
    file_name    text NOT NULL,
    content_type text NOT NULL,
    storage_key  text NOT NULL,
    storage      text NOT NULL,
    content      bytea,
    uploaded_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uploads_by_sickness ON uploads (sickness_id);

CREATE TABLE IF NOT EXISTS cover_shifts (
    id               text PRIMARY KEY,
    leave_request_id text NOT NULL REFERENCES leave_requests(id),
    home_id          text NOT NULL REFERENCES homes(id),
    unit_id          text NOT NULL REFERENCES units(id),
    shift_date       date NOT NULL,
    shift            text NOT NULL,
    skill            text NOT NULL,
    status           text NOT NULL,
    claimed_by       text REFERENCES people(id),
    assignment_id    text,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS covers_by_request ON cover_shifts (leave_request_id);
CREATE INDEX IF NOT EXISTS covers_by_slot ON cover_shifts (unit_id, shift_date, shift, skill);

CREATE TABLE IF NOT EXISTS attendance (
    id               text PRIMARY KEY,
    person_id        text NOT NULL REFERENCES people(id),
    home_id          text NOT NULL REFERENCES homes(id),
    unit_id          text NOT NULL REFERENCES units(id),
    assignment_id    text NOT NULL UNIQUE,
    shift_date       date NOT NULL,
    shift            text NOT NULL,
    clock_in_at      timestamptz NOT NULL,
    clock_out_at     timestamptz,
    late             boolean NOT NULL DEFAULT false,
    late_acknowledged boolean NOT NULL DEFAULT false,
    correction_note  text,
    version          integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS attendance_by_person ON attendance (person_id);
CREATE INDEX IF NOT EXISTS attendance_by_home ON attendance (home_id, shift_date);

CREATE TABLE IF NOT EXISTS punches (
    id            text PRIMARY KEY,
    person_id     text NOT NULL REFERENCES people(id),
    attendance_id text NOT NULL REFERENCES attendance(id),
    kind          text NOT NULL,
    punched_at    timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS accrual_ledger (
    id            text PRIMARY KEY,
    person_id     text NOT NULL REFERENCES people(id),
    period        text NOT NULL,
    kind          text NOT NULL,
    worked_hours  numeric(12, 4) NOT NULL,
    accrued_hours numeric(12, 4) NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_by_person ON accrual_ledger (person_id, period);

CREATE TABLE IF NOT EXISTS pay_periods (
    period    text PRIMARY KEY,
    closed_at timestamptz NOT NULL,
    closed_by text NOT NULL
);

CREATE TABLE IF NOT EXISTS timesheet_exports (
    id          text PRIMARY KEY,
    period      text NOT NULL,
    home_ids    text[] NOT NULL,
    row_count   integer NOT NULL,
    storage     text NOT NULL,
    storage_key text NOT NULL,
    content     bytea,
    created_by  text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_entries (
    id                 text PRIMARY KEY,
    entered_at         timestamptz NOT NULL DEFAULT now(),
    actor_id           text NOT NULL,
    actor_display_name text NOT NULL,
    actor_role         text NOT NULL,
    action             text NOT NULL,
    home_id            text NOT NULL,
    target_type        text NOT NULL,
    target_id          text NOT NULL,
    before_state       jsonb,
    after_state        jsonb NOT NULL,
    reason             text
);
CREATE INDEX IF NOT EXISTS audit_by_home ON audit_entries (home_id, entered_at DESC);

CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_entries is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_no_update ON audit_entries;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_entries
    FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only();

CREATE TABLE IF NOT EXISTS outbox (
    id           text PRIMARY KEY,
    to_email     text NOT NULL,
    subject      text NOT NULL,
    body         text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    sent_at      timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (created_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS idempotency_records (
    person_id     text NOT NULL,
    idem_key      text NOT NULL,
    method        text NOT NULL,
    path          text NOT NULL,
    body_hash     text NOT NULL,
    status        integer,
    response_body text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (person_id, idem_key)
);
