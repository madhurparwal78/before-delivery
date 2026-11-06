CREATE TABLE IF NOT EXISTS id_counters (
    prefix text PRIMARY KEY,
    n bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL UNIQUE,
    role text NOT NULL,
    password_hash text NOT NULL,
    totp_secret text NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users (id),
    cookie_hash text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL,
    last_activity_at timestamptz NOT NULL,
    state text NOT NULL,
    closed_reason text
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS sign_in_attempts (
    identity text PRIMARY KEY,
    fails integer NOT NULL DEFAULT 0,
    locked_until timestamptz,
    target text NOT NULL
);

CREATE TABLE IF NOT EXISTS step_up_proofs (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users (id),
    session_id text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz
);

CREATE TABLE IF NOT EXISTS compartments (
    id text PRIMARY KEY,
    name text NOT NULL,
    owner_id text NOT NULL REFERENCES users (id),
    access_version integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS grants (
    id text PRIMARY KEY,
    compartment_id text NOT NULL REFERENCES compartments (id),
    user_id text NOT NULL REFERENCES users (id),
    scope text NOT NULL,
    state text NOT NULL,
    expires_at timestamptz,
    kind text NOT NULL,
    reason text,
    created_at timestamptz NOT NULL,
    lapse_written boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS grants_lookup_idx ON grants (compartment_id, user_id, state);

CREATE TABLE IF NOT EXISTS exhibits (
    id text PRIMARY KEY,
    compartment_id text NOT NULL REFERENCES compartments (id),
    name text NOT NULL,
    state text NOT NULL,
    sha256 text NOT NULL,
    size bigint NOT NULL,
    sniffed_type text NOT NULL,
    page_count integer,
    registered_by text NOT NULL REFERENCES users (id),
    marks_version integer NOT NULL DEFAULT 0,
    marks_saved_by text,
    seal_check text,
    disposal_proposed_by text,
    object_key text,
    renderable boolean NOT NULL DEFAULT true,
    source text NOT NULL,
    collected_by text NOT NULL,
    collected_on text NOT NULL,
    capture_notes text,
    created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS exhibits_compartment_idx ON exhibits (compartment_id);

CREATE TABLE IF NOT EXISTS holds (
    id text PRIMARY KEY,
    exhibit_id text NOT NULL REFERENCES exhibits (id),
    matter_ref text NOT NULL,
    placed_by text NOT NULL REFERENCES users (id),
    reason text NOT NULL,
    state text NOT NULL,
    placed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS holds_exhibit_idx ON holds (exhibit_id, state);

CREATE TABLE IF NOT EXISTS redactions (
    exhibit_id text PRIMARY KEY REFERENCES exhibits (id),
    regions jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS derivatives (
    id text PRIMARY KEY,
    exhibit_id text NOT NULL REFERENCES exhibits (id),
    compartment_id text NOT NULL REFERENCES compartments (id),
    sha256 text NOT NULL,
    size bigint NOT NULL,
    content_type text NOT NULL,
    page_count integer,
    created_by text NOT NULL REFERENCES users (id),
    marks_version integer NOT NULL,
    marks_saved_by text,
    object_key text,
    disposed boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS derivatives_exhibit_idx ON derivatives (exhibit_id);

CREATE TABLE IF NOT EXISTS releases (
    id text PRIMARY KEY,
    compartment_id text NOT NULL REFERENCES compartments (id),
    name text NOT NULL,
    matter_ref text NOT NULL,
    recipient_kind text NOT NULL,
    state text NOT NULL,
    assembler_id text NOT NULL REFERENCES users (id),
    rejection_reason text,
    created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS releases_compartment_idx ON releases (compartment_id);

CREATE TABLE IF NOT EXISTS release_items (
    id text PRIMARY KEY,
    release_id text NOT NULL REFERENCES releases (id),
    derivative_id text NOT NULL REFERENCES derivatives (id),
    label text NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS release_items_release_idx ON release_items (release_id);

CREATE TABLE IF NOT EXISTS release_contributors (
    release_id text NOT NULL REFERENCES releases (id),
    user_id text NOT NULL REFERENCES users (id),
    PRIMARY KEY (release_id, user_id)
);

CREATE TABLE IF NOT EXISTS links (
    id text PRIMARY KEY,
    release_id text NOT NULL REFERENCES releases (id),
    token_hash text NOT NULL UNIQUE,
    state text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS download_grants (
    id text PRIMARY KEY,
    token_hash text NOT NULL UNIQUE,
    kind text NOT NULL,
    user_id text,
    session_id text,
    grant_id text,
    link_id text,
    exhibit_id text,
    derivative_id text,
    page integer,
    expires_at timestamptz NOT NULL,
    claimed_at timestamptz,
    claimed_by_session text,
    created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS download_grants_claim_idx ON download_grants (derivative_id, claimed_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    endpoint text NOT NULL,
    key text NOT NULL,
    fingerprint text NOT NULL,
    status integer NOT NULL,
    body jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    UNIQUE (user_id, endpoint, key)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
    seq bigint PRIMARY KEY,
    at text NOT NULL,
    actor_id text NOT NULL,
    session_id text,
    action text NOT NULL,
    target text NOT NULL,
    detail jsonb NOT NULL,
    prev_digest text NOT NULL,
    digest text NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_action_idx ON ledger_entries (action);
CREATE INDEX IF NOT EXISTS ledger_target_idx ON ledger_entries (target);

CREATE TABLE IF NOT EXISTS signals (
    id text PRIMARY KEY,
    kind text NOT NULL,
    at timestamptz NOT NULL,
    target text NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_outbox (
    id text PRIMARY KEY,
    recipient text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    status text NOT NULL,
    claimed_at timestamptz,
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_events (
    id bigserial PRIMARY KEY,
    link_id text NOT NULL,
    at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS collection_events_link_idx ON collection_events (link_id, at);

CREATE OR REPLACE FUNCTION ledger_entries_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'ledger_entries is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_no_update ON ledger_entries;
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();

DROP TRIGGER IF EXISTS ledger_entries_no_delete ON ledger_entries;
CREATE TRIGGER ledger_entries_no_delete BEFORE DELETE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();

DROP TRIGGER IF EXISTS ledger_entries_no_truncate ON ledger_entries;
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
    EXECUTE FUNCTION ledger_entries_immutable();
