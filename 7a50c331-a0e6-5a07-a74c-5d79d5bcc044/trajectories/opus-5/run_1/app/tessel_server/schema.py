"""The PostgreSQL schema, applied idempotently at every start."""
from . import db

STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS organizations (
        id          bigserial PRIMARY KEY,
        name        text NOT NULL UNIQUE,
        plan        text NOT NULL,
        created_at  timestamptz NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS members (
        id                  bigserial PRIMARY KEY,
        organization_id     bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        email               text NOT NULL UNIQUE,
        role                text NOT NULL,
        password_hash       text NOT NULL,
        created_at          timestamptz NOT NULL,
        totp_enabled        boolean NOT NULL DEFAULT false,
        totp_secret         text,
        totp_pending_secret text,
        totp_last_step      bigint
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sessions (
        id           bigserial PRIMARY KEY,
        member_id    bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        token_digest text NOT NULL UNIQUE,
        created_at   timestamptz NOT NULL,
        revoked_at   timestamptz
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS databases (
        id               bigserial PRIMARY KEY,
        organization_id  bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name             text NOT NULL,
        created_at       timestamptz NOT NULL,
        last_lsn         integer NOT NULL DEFAULT 0,
        indexed_lsn      integer NOT NULL DEFAULT 0,
        index_generation integer NOT NULL DEFAULT 0,
        ready_at         timestamptz NOT NULL,
        UNIQUE (organization_id, name)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS api_keys (
        id              bigserial PRIMARY KEY,
        organization_id bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name            text NOT NULL,
        role            text NOT NULL,
        prefix          text NOT NULL,
        secret_digest   text NOT NULL UNIQUE,
        scope_all       boolean NOT NULL,
        created_at      timestamptz NOT NULL,
        last_used_at    timestamptz,
        rotated_at      timestamptz,
        revoked_at      timestamptz
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS api_key_databases (
        key_id      bigint NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
        database_id bigint NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
        PRIMARY KEY (key_id, database_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS collections (
        id          bigserial PRIMARY KEY,
        database_id bigint NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
        name        text NOT NULL,
        UNIQUE (database_id, name)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sources (
        database_id bigint NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
        collection  text NOT NULL,
        id          text NOT NULL,
        title       text NOT NULL,
        text        text NOT NULL,
        version     integer NOT NULL,
        token_count integer NOT NULL,
        term_count  integer NOT NULL,
        ingested_at timestamptz NOT NULL,
        lsn         integer NOT NULL,
        deleted     boolean NOT NULL DEFAULT false,
        PRIMARY KEY (database_id, collection, id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS source_terms (
        database_id bigint NOT NULL,
        collection  text NOT NULL,
        source_id   text NOT NULL,
        term        text NOT NULL,
        tf          integer NOT NULL,
        positions   integer[] NOT NULL,
        PRIMARY KEY (database_id, collection, source_id, term),
        FOREIGN KEY (database_id, collection, source_id)
            REFERENCES sources(database_id, collection, id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS source_versions (
        id              bigserial PRIMARY KEY,
        organization_id bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        database_id     bigint REFERENCES databases(id) ON DELETE SET NULL,
        collection      text,
        source_id       text,
        version         integer,
        lsn             integer,
        token_count     integer NOT NULL,
        ingested_at     timestamptz NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS facts (
        id          bigserial PRIMARY KEY,
        database_id bigint NOT NULL,
        collection  text NOT NULL,
        source_id   text NOT NULL,
        version     integer NOT NULL,
        lsn         integer NOT NULL,
        position    integer NOT NULL,
        subject     text NOT NULL,
        subject_key text NOT NULL,
        predicate   text NOT NULL,
        object      text NOT NULL,
        object_key  text NOT NULL,
        valid_from  timestamptz NOT NULL,
        reason      text NOT NULL,
        FOREIGN KEY (database_id, collection, source_id)
            REFERENCES sources(database_id, collection, id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS wal_entries (
        database_id bigint NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
        lsn         integer NOT NULL,
        kind        text NOT NULL,
        collection  text NOT NULL,
        source_id   text NOT NULL,
        created_at  timestamptz NOT NULL,
        PRIMARY KEY (database_id, lsn)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS query_records (
        request_id      text PRIMARY KEY,
        organization_id bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        database_id     bigint NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
        created_at      timestamptz NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS feedback (
        request_id      text PRIMARY KEY
                        REFERENCES query_records(request_id) ON DELETE CASCADE,
        organization_id bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        rating          text,
        feedback        text,
        source          text NOT NULL,
        ground_truth    text,
        metadata        text,
        created_at      timestamptz NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS contact_messages (
        id         bigserial PRIMARY KEY,
        email      text NOT NULL,
        message    text NOT NULL,
        created_at timestamptz NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS audit_events (
        id              bigserial PRIMARY KEY,
        organization_id bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        at              timestamptz NOT NULL,
        actor           text NOT NULL,
        action          text NOT NULL,
        target          text NOT NULL,
        detail          text NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS export_jobs (
        id              text PRIMARY KEY,
        organization_id bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        database_id     bigint NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
        database_name   text NOT NULL,
        lsn             integer NOT NULL,
        requested_by    text NOT NULL,
        requested_at    timestamptz NOT NULL,
        document        text NOT NULL,
        sha256          text NOT NULL,
        collections     integer NOT NULL,
        sources         integer NOT NULL,
        facts           integer NOT NULL,
        email_sent_at   timestamptz
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS idempotency_records (
        organization_id bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        route           text NOT NULL,
        key             text NOT NULL,
        request_digest  text NOT NULL,
        state           text NOT NULL,
        status          integer,
        data            text,
        database_id     bigint REFERENCES databases(id) ON DELETE CASCADE,
        created_at      timestamptz NOT NULL,
        PRIMARY KEY (organization_id, route, key)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS reset_tokens (
        id           bigserial PRIMARY KEY,
        member_id    bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        token_digest text NOT NULL UNIQUE,
        created_at   timestamptz NOT NULL,
        used_at      timestamptz,
        cancelled_at timestamptz
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS pending_sign_ins (
        id           bigserial PRIMARY KEY,
        member_id    bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        token_digest text NOT NULL UNIQUE,
        created_at   timestamptz NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS reset_emails (
        id        bigserial PRIMARY KEY,
        member_id bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        at        timestamptz NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS recovery_codes (
        id          bigserial PRIMARY KEY,
        member_id   bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        code_digest text NOT NULL,
        used_at     timestamptz
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sign_in_attempts (
        id    bigserial PRIMARY KEY,
        email text NOT NULL,
        at    timestamptz NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS key_query_hits (
        id     bigserial PRIMARY KEY,
        key_id bigint NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
        at     timestamptz NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS facts_subject_idx ON facts (database_id, subject_key, predicate, valid_from)",
    "CREATE INDEX IF NOT EXISTS facts_object_idx ON facts (database_id, object_key)",
    "CREATE INDEX IF NOT EXISTS facts_source_idx ON facts (database_id, collection, source_id)",
    "CREATE INDEX IF NOT EXISTS sources_live_idx ON sources (database_id, collection, deleted)",
    "CREATE INDEX IF NOT EXISTS source_terms_term_idx ON source_terms (database_id, collection, term)",
    "CREATE INDEX IF NOT EXISTS audit_order_idx ON audit_events (organization_id, at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS audit_actor_idx ON audit_events (organization_id, lower(actor))",
    "CREATE INDEX IF NOT EXISTS versions_org_idx ON source_versions (organization_id, ingested_at)",
    "CREATE INDEX IF NOT EXISTS versions_db_idx ON source_versions (database_id)",
    "CREATE INDEX IF NOT EXISTS sign_in_attempts_idx ON sign_in_attempts (email, at)",
    "CREATE INDEX IF NOT EXISTS key_hits_idx ON key_query_hits (key_id, at)",
    "CREATE INDEX IF NOT EXISTS reset_emails_idx ON reset_emails (member_id, at)",
    "CREATE INDEX IF NOT EXISTS contact_rate_idx ON contact_messages (email, created_at)",
    "CREATE INDEX IF NOT EXISTS feedback_rate_idx ON feedback (organization_id, created_at)",
]


def apply():
    with db.tx() as cur:
        for statement in STATEMENTS:
            cur.execute(statement)
