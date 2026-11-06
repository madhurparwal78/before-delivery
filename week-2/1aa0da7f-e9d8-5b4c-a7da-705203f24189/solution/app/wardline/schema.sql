CREATE TABLE IF NOT EXISTS people (
    id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, role text NOT NULL,
    password_hash text NOT NULL, totp_secret text NOT NULL);

CREATE SEQUENCE IF NOT EXISTS sessions_seq;
CREATE TABLE IF NOT EXISTS sessions (
    id text PRIMARY KEY, token_hash text NOT NULL UNIQUE, user_id text NOT NULL REFERENCES people,
    created_at timestamptz NOT NULL, last_activity timestamptz NOT NULL, life_ends_at timestamptz NOT NULL,
    closed_at timestamptz);
CREATE INDEX IF NOT EXISTS sessions_open ON sessions (user_id) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS step_up_proofs (
    token_hash text PRIMARY KEY, session_id text NOT NULL REFERENCES sessions,
    expires_at timestamptz NOT NULL, used_at timestamptz);

CREATE TABLE IF NOT EXISTS sign_in_limits (
    identity text PRIMARY KEY, failures integer NOT NULL, locked_until timestamptz);

CREATE SEQUENCE IF NOT EXISTS compartments_seq START 4;
CREATE TABLE IF NOT EXISTS compartments (
    id text PRIMARY KEY, name text NOT NULL, owner_id text NOT NULL REFERENCES people,
    access_version bigint NOT NULL DEFAULT 0);

CREATE SEQUENCE IF NOT EXISTS grants_seq;
CREATE TABLE IF NOT EXISTS grants (
    id text PRIMARY KEY, compartment_id text NOT NULL REFERENCES compartments, user_id text NOT NULL REFERENCES people,
    scope text NOT NULL, state text NOT NULL, expires_at timestamptz, kind text NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS grants_one_active ON grants (compartment_id, user_id) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS grants_by_user ON grants (user_id) WHERE state = 'active';

CREATE SEQUENCE IF NOT EXISTS exhibits_seq START 7;
CREATE TABLE IF NOT EXISTS exhibits (
    id text PRIMARY KEY, compartment_id text NOT NULL REFERENCES compartments, name text NOT NULL,
    state text NOT NULL, sha256 text NOT NULL, size bigint NOT NULL, sniffed_type text NOT NULL,
    page_count integer, over_render_limits boolean NOT NULL DEFAULT false, registered_by text NOT NULL REFERENCES people,
    object_key text, marks_version bigint NOT NULL DEFAULT 0, marks_saved_by text REFERENCES people,
    regions jsonb NOT NULL DEFAULT '[]', seal_check text, disposal_proposed_by text REFERENCES people,
    source text NOT NULL, collected_by text NOT NULL, collected_on text NOT NULL, capture_notes text);
CREATE INDEX IF NOT EXISTS exhibits_by_compartment ON exhibits (compartment_id, id);

CREATE SEQUENCE IF NOT EXISTS holds_seq START 2;
CREATE TABLE IF NOT EXISTS holds (
    id text PRIMARY KEY, exhibit_id text NOT NULL REFERENCES exhibits, matter_ref text NOT NULL, reason text NOT NULL,
    placed_by text NOT NULL REFERENCES people, active boolean NOT NULL DEFAULT true);
CREATE UNIQUE INDEX IF NOT EXISTS holds_one_per_matter ON holds (exhibit_id, matter_ref) WHERE active;

CREATE SEQUENCE IF NOT EXISTS derivatives_seq START 4;
CREATE TABLE IF NOT EXISTS derivatives (
    id text PRIMARY KEY, exhibit_id text NOT NULL REFERENCES exhibits, compartment_id text NOT NULL REFERENCES compartments,
    sha256 text NOT NULL, size bigint NOT NULL, content_type text NOT NULL, page_count integer,
    created_by text NOT NULL REFERENCES people, marks_version bigint NOT NULL, marks_saved_by text REFERENCES people,
    object_key text, disposed boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS derivatives_by_exhibit ON derivatives (exhibit_id, id);

CREATE SEQUENCE IF NOT EXISTS releases_seq START 3;
CREATE TABLE IF NOT EXISTS releases (
    id text PRIMARY KEY, compartment_id text NOT NULL REFERENCES compartments, name text NOT NULL, matter_ref text NOT NULL,
    recipient_kind text NOT NULL, state text NOT NULL, assembler_id text NOT NULL REFERENCES people, rejection_reason text);
CREATE INDEX IF NOT EXISTS releases_by_compartment ON releases (compartment_id, id);

CREATE TABLE IF NOT EXISTS release_contributors (
    release_id text NOT NULL REFERENCES releases, user_id text NOT NULL REFERENCES people, PRIMARY KEY (release_id, user_id));

CREATE SEQUENCE IF NOT EXISTS release_items_seq START 3;
CREATE TABLE IF NOT EXISTS release_items (
    id text PRIMARY KEY, release_id text NOT NULL REFERENCES releases, derivative_id text NOT NULL REFERENCES derivatives,
    label text NOT NULL);
CREATE INDEX IF NOT EXISTS release_items_by_release ON release_items (release_id, id);

CREATE SEQUENCE IF NOT EXISTS links_seq START 2;
CREATE TABLE IF NOT EXISTS links (
    id text PRIMARY KEY, release_id text NOT NULL REFERENCES releases, token_hash text NOT NULL UNIQUE,
    active boolean NOT NULL DEFAULT true, expires_at timestamptz NOT NULL, burst_signalled boolean NOT NULL DEFAULT false);
CREATE UNIQUE INDEX IF NOT EXISTS links_one_active ON links (release_id) WHERE active;

CREATE TABLE IF NOT EXISTS collection_grants (link_id text NOT NULL REFERENCES links, at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS collection_grants_recent ON collection_grants (link_id, at);

CREATE TABLE IF NOT EXISTS download_grants (
    token_hash text PRIMARY KEY, kind text NOT NULL, exhibit_id text NOT NULL REFERENCES exhibits,
    derivative_id text REFERENCES derivatives, page integer, issued_by text REFERENCES people, session_id text REFERENCES sessions,
    grant_id text REFERENCES grants, link_id text REFERENCES links, via_break_glass boolean NOT NULL DEFAULT false,
    expires_at timestamptz NOT NULL, claimed_at timestamptz);
CREATE INDEX IF NOT EXISTS download_claims ON download_grants (issued_by, derivative_id) WHERE claimed_at IS NOT NULL;

CREATE SEQUENCE IF NOT EXISTS signals_seq;
CREATE TABLE IF NOT EXISTS signals (id text PRIMARY KEY, kind text NOT NULL, at timestamptz NOT NULL, target text NOT NULL);

CREATE TABLE IF NOT EXISTS mail_outbox (
    id bigserial PRIMARY KEY, recipient text NOT NULL, subject text NOT NULL, body text NOT NULL,
    status text NOT NULL DEFAULT 'pending', claimed_until timestamptz);
CREATE INDEX IF NOT EXISTS mail_outbox_pending ON mail_outbox (id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS idempotency_keys (
    user_id text NOT NULL, endpoint text NOT NULL, key text NOT NULL, fingerprint text NOT NULL,
    status integer NOT NULL, body text NOT NULL, PRIMARY KEY (user_id, endpoint, key));

CREATE TABLE IF NOT EXISTS ledger_entries (
    seq bigint PRIMARY KEY, at text NOT NULL, actor_id text NOT NULL, session_id text, action text NOT NULL,
    target text NOT NULL, detail jsonb NOT NULL, prev_digest text NOT NULL, digest text NOT NULL);
CREATE INDEX IF NOT EXISTS ledger_by_target ON ledger_entries (target, seq);
CREATE INDEX IF NOT EXISTS ledger_by_action ON ledger_entries (action, seq);
CREATE INDEX IF NOT EXISTS ledger_by_exhibit ON ledger_entries ((detail->>'exhibit_id'), seq);

CREATE OR REPLACE FUNCTION ledger_entries_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'ledger_entries is append-only';
END $$;
DROP TRIGGER IF EXISTS ledger_entries_no_change ON ledger_entries;
CREATE TRIGGER ledger_entries_no_change BEFORE UPDATE OR DELETE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION ledger_entries_refuse_change();
DROP TRIGGER IF EXISTS ledger_entries_no_truncate ON ledger_entries;
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
    FOR EACH STATEMENT EXECUTE FUNCTION ledger_entries_refuse_change();
REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries FROM PUBLIC;
DO $$ BEGIN
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries FROM %I', current_user);
END $$;
