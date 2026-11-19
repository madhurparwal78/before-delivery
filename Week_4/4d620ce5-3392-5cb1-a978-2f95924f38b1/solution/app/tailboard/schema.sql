-- Tailboard system of record. Applied on every start; every statement is idempotent.

CREATE TABLE IF NOT EXISTS meta (
    key   text PRIMARY KEY,
    value text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id            text PRIMARY KEY,
    seq           integer NOT NULL,
    username      text UNIQUE NOT NULL,
    passcode_hash text,
    display_name  text NOT NULL,
    role          text NOT NULL,
    contractor    boolean,
    licence       text,
    email         text,
    scope         text[],
    erased        boolean NOT NULL DEFAULT false,
    erased_at     timestamptz
);

-- One-way hashes of erased names and licences, so later legacy imports can be anonymised too.
CREATE TABLE IF NOT EXISTS erased_identities (
    hash  text PRIMARY KEY,
    token text NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    user_id    text NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS standby (
    model    text NOT NULL,
    position integer NOT NULL,
    user_id  text NOT NULL REFERENCES users (id),
    PRIMARY KEY (model, position)
);

CREATE TABLE IF NOT EXISTS tails (
    registration      text PRIMARY KEY,
    model             text NOT NULL,
    msn               bigint NOT NULL,
    seed_hours        numeric(10, 1) NOT NULL,
    daily_utilisation numeric(5, 1) NOT NULL
);

CREATE TABLE IF NOT EXISTS flight_hours (
    id           bigserial PRIMARY KEY,
    registration text NOT NULL REFERENCES tails (registration),
    hours        numeric(5, 1) NOT NULL,
    total_after  numeric(10, 1) NOT NULL,
    logged_at    timestamptz NOT NULL,
    logged_by    text NOT NULL REFERENCES users (id)
);
CREATE INDEX IF NOT EXISTS flight_hours_tail ON flight_hours (registration, id);

CREATE TABLE IF NOT EXISTS documents (
    id          text PRIMARY KEY,
    sha256      text UNIQUE NOT NULL,
    key         text NOT NULL,
    bytes       bigint NOT NULL,
    uploaded_by text NOT NULL REFERENCES users (id),
    uploaded_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS directives (
    id                text PRIMARY KEY,
    seq               bigserial,
    authority         text NOT NULL,
    number            text NOT NULL,
    status            text NOT NULL,
    current_revision  integer NOT NULL,
    withdrawn_at      timestamptz,
    withdrawal_reason text,
    UNIQUE (authority, number)
);

CREATE TABLE IF NOT EXISTS revisions (
    directive_id  text NOT NULL REFERENCES directives (id),
    revision      integer NOT NULL,
    title         text NOT NULL,
    method        text NOT NULL,
    effective_date date NOT NULL,
    calendar_days integer NOT NULL,
    fh_interval   numeric(8, 1) NOT NULL,
    applicability jsonb NOT NULL,
    prior_credit  boolean NOT NULL,
    document_id   text REFERENCES documents (id),
    ingested_at   timestamptz NOT NULL,
    ingested_by   text REFERENCES users (id),
    PRIMARY KEY (directive_id, revision)
);

CREATE SEQUENCE IF NOT EXISTS work_card_seq START 10001;

CREATE TABLE IF NOT EXISTS threads (
    id               text PRIMARY KEY,
    directive_id     text NOT NULL REFERENCES directives (id),
    registration     text NOT NULL REFERENCES tails (registration),
    work_card_id     text UNIQUE NOT NULL,
    stage            text NOT NULL,
    rule_revision    integer NOT NULL,
    pinned           boolean NOT NULL DEFAULT false,
    entered_at       timestamptz NOT NULL,
    fh_baseline      numeric(10, 1) NOT NULL,
    deferred         boolean NOT NULL DEFAULT false,
    deferral_by      text REFERENCES users (id),
    deferral_at      timestamptz,
    deferral_reason  text,
    holder_id        text REFERENCES users (id),
    claimed_at       timestamptz,
    timeliness       text,
    certifier_id     text REFERENCES users (id),
    certifier_status text,
    frozen           jsonb,
    UNIQUE (directive_id, registration)
);

CREATE TABLE IF NOT EXISTS thread_history (
    thread_id  text NOT NULL REFERENCES threads (id),
    revision   integer NOT NULL,
    entered_at timestamptz NOT NULL,
    left_at    timestamptz NOT NULL,
    limits     jsonb NOT NULL,
    wording    jsonb NOT NULL,
    outcome    text NOT NULL,
    PRIMARY KEY (thread_id, revision)
);

CREATE TABLE IF NOT EXISTS evidence (
    id           text PRIMARY KEY,
    seq          bigserial,
    thread_id    text NOT NULL REFERENCES threads (id),
    key          text NOT NULL,
    sha256       text NOT NULL,
    content_type text NOT NULL,
    bytes        bigint NOT NULL,
    attached_by  text NOT NULL REFERENCES users (id),
    attached_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS evidence_thread ON evidence (thread_id, seq);

CREATE TABLE IF NOT EXISTS signatures (
    id             text PRIMARY KEY,
    seq            bigserial,
    thread_id      text NOT NULL REFERENCES threads (id),
    kind           text NOT NULL,
    signs_as       text NOT NULL,
    signer_id      text REFERENCES users (id),
    signer_text    text,
    licence_text   text,
    revision       integer NOT NULL,
    committed_at   timestamptz NOT NULL,
    timeliness     text,
    method_ref     text,
    findings       text,
    status         text NOT NULL,
    void_reason    text,
    evidence_ids   jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS signatures_thread ON signatures (thread_id, seq);

CREATE TABLE IF NOT EXISTS imports (
    id          text PRIMARY KEY,
    seq         bigserial,
    file_sha256 text UNIQUE NOT NULL,
    result      jsonb NOT NULL,
    imported_by text NOT NULL REFERENCES users (id),
    imported_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy_records (
    id                text PRIMARY KEY,
    seq               bigserial,
    thread_id         text NOT NULL REFERENCES threads (id),
    revision          integer NOT NULL,
    status            text NOT NULL,
    inspector         text,
    inspector_licence text,
    inspected_on      date,
    certifier         text,
    certifier_licence text,
    certified_on      date,
    notes             text,
    import_id         text NOT NULL REFERENCES imports (id),
    row_number        integer NOT NULL,
    UNIQUE NULLS NOT DISTINCT (thread_id, revision, status, inspected_on, certified_on)
);

CREATE TABLE IF NOT EXISTS notices (
    id              text PRIMARY KEY,
    seq             bigserial,
    kind            text NOT NULL,
    to_user_id      text REFERENCES users (id),
    to_address      text NOT NULL,
    subject         text NOT NULL,
    body            text NOT NULL,
    params          jsonb NOT NULL,
    thread_id       text REFERENCES threads (id),
    card_id         text,
    status          text NOT NULL,
    queued_at       timestamptz NOT NULL,
    send_after      timestamptz NOT NULL,
    sent_at         timestamptz,
    last_attempt_at timestamptz
);
CREATE INDEX IF NOT EXISTS notices_status ON notices (status, send_after);

CREATE TABLE IF NOT EXISTS packs (
    id              text PRIMARY KEY,
    seq             bigserial,
    directive_id    text NOT NULL REFERENCES directives (id),
    revision        integer NOT NULL,
    status          text NOT NULL,
    waiting_for     text,
    requested_by    text NOT NULL REFERENCES users (id),
    requested_at    timestamptz NOT NULL,
    transmitted_at  timestamptz,
    attempts        integer NOT NULL DEFAULT 0,
    last_attempt_at timestamptz,
    pdf_key         text,
    csv_key         text,
    pdf_sha256      text,
    csv_sha256      text,
    snapshot        jsonb,
    stale           boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS packs_one_queued ON packs (directive_id) WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS board_snapshots (
    directive_id text NOT NULL REFERENCES directives (id),
    revision     integer NOT NULL,
    taken_at     timestamptz NOT NULL,
    entry        jsonb NOT NULL,
    cells        jsonb NOT NULL,
    threads      jsonb NOT NULL,
    PRIMARY KEY (directive_id, revision)
);

CREATE TABLE IF NOT EXISTS audit (
    id           text PRIMARY KEY,
    seq          bigserial,
    at           timestamptz NOT NULL,
    actor_id     text REFERENCES users (id),  -- NULL is the system actor: background work has no signed-in person
    action       text NOT NULL,
    directive_id text,
    thread_id    text,
    detail       text NOT NULL
);
ALTER TABLE audit ALTER COLUMN actor_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS audit_thread ON audit (thread_id);
CREATE INDEX IF NOT EXISTS audit_directive ON audit (directive_id);

CREATE OR REPLACE FUNCTION audit_is_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit entries are append-only';
END $$;
DROP TRIGGER IF EXISTS audit_append_only ON audit;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit
    FOR EACH ROW EXECUTE FUNCTION audit_is_append_only();

CREATE TABLE IF NOT EXISTS idempotency (
    user_id     text NOT NULL,
    method      text NOT NULL,
    path        text NOT NULL,
    key         text NOT NULL,
    fingerprint text NOT NULL,
    status      integer NOT NULL,
    body        jsonb NOT NULL,
    created_at  timestamptz NOT NULL,
    PRIMARY KEY (user_id, method, path, key)
);
