"""Postgres schema and idempotent seed (DP-03)."""
import json
from datetime import datetime, timedelta, timezone

import asyncpg

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS people (
    id          text PRIMARY KEY,
    username    text UNIQUE,
    role        text,
    contractor  boolean NOT NULL DEFAULT false,
    display_name text NOT NULL,
    licence     text,
    email       text,
    passcode    text,
    scope       jsonb,
    erased      boolean NOT NULL DEFAULT false,
    signer_token text
);
ALTER TABLE people ADD COLUMN IF NOT EXISTS contractor boolean NOT NULL DEFAULT false;
ALTER TABLE people ADD COLUMN IF NOT EXISTS signer_token text;

CREATE TABLE IF NOT EXISTS standby (
    model   text NOT NULL,
    position smallint NOT NULL,
    person_id text NOT NULL REFERENCES people(id),
    PRIMARY KEY (model, position)
);

CREATE TABLE IF NOT EXISTS tails (
    registration     text PRIMARY KEY,
    model            text NOT NULL,
    msn              bigint NOT NULL,
    total_hours      numeric(10,1) NOT NULL,
    daily_utilisation numeric(5,1) NOT NULL,
    seed_hours       numeric(10,1)
);

CREATE TABLE IF NOT EXISTS flight_hours (
    id          bigserial PRIMARY KEY,
    registration text NOT NULL REFERENCES tails(registration),
    hours       numeric(5,1) NOT NULL,
    logged_at   timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS lineages (
    id         text PRIMARY KEY,
    authority  text NOT NULL,
    number     text NOT NULL UNIQUE,
    revision   integer NOT NULL,
    status     text NOT NULL DEFAULT 'active',
    title      text NOT NULL
);

CREATE TABLE IF NOT EXISTS revisions (
    lineage_id     text NOT NULL REFERENCES lineages(id),
    revision       integer NOT NULL,
    title          text NOT NULL,
    method         text NOT NULL,
    effective_date date NOT NULL,
    calendar_days  integer NOT NULL,
    fh_interval    numeric(8,1) NOT NULL,
    applicability  jsonb NOT NULL,
    prior_credit   boolean NOT NULL DEFAULT false,
    document_key   text,
    ingested_at    timestamptz NOT NULL,
    ingested_by    text NOT NULL REFERENCES people(id),
    PRIMARY KEY (lineage_id, revision)
);

CREATE TABLE IF NOT EXISTS threads (
    id              text PRIMARY KEY,
    lineage_id      text NOT NULL REFERENCES lineages(id),
    registration    text NOT NULL REFERENCES tails(registration),
    stage           text NOT NULL,
    revision        integer NOT NULL,
    pinned_revision integer,
    fh_baseline     numeric(10,1) NOT NULL,
    threshold       numeric(10,1) NOT NULL,
    deadline_date   date NOT NULL,
    claimed_at      timestamptz,
    holder_id       text REFERENCES people(id),
    certifier_id    text REFERENCES people(id),
    created_at      timestamptz NOT NULL,
    last_revision_change timestamptz,
    hours_due_at    timestamptz
);
CREATE INDEX IF NOT EXISTS threads_lineage ON threads(lineage_id);
CREATE UNIQUE INDEX IF NOT EXISTS threads_one_per_tail ON threads(lineage_id, registration);
ALTER TABLE threads ADD COLUMN IF NOT EXISTS last_revision_change timestamptz;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS hours_due_at timestamptz;

CREATE TABLE IF NOT EXISTS work_cards (
    thread_id text PRIMARY KEY REFERENCES threads(id),
    card_id   text UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS signatures (
    id           text PRIMARY KEY,
    thread_id    text NOT NULL REFERENCES threads(id),
    kind         text NOT NULL,
    signer_id    text REFERENCES people(id),
    signer_text  text,
    revision     integer NOT NULL,
    committed_at timestamptz NOT NULL,
    timeliness   text,
    method_ref   text,
    findings     text,
    status       text NOT NULL DEFAULT 'valid',
    void_reason  text
);
CREATE INDEX IF NOT EXISTS signatures_thread ON signatures(thread_id);

CREATE TABLE IF NOT EXISTS evidence (
    id           text PRIMARY KEY,
    thread_id    text NOT NULL REFERENCES threads(id),
    key          text NOT NULL,
    sha256       text NOT NULL,
    content_type text NOT NULL,
    bytes        bigint NOT NULL,
    attached_by  text NOT NULL REFERENCES people(id),
    attached_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS evidence_thread ON evidence(thread_id);

CREATE TABLE IF NOT EXISTS deferrals (
    thread_id  text PRIMARY KEY REFERENCES threads(id),
    granted_by text NOT NULL REFERENCES people(id),
    granted_at timestamptz NOT NULL,
    reason     text NOT NULL,
    revision   integer NOT NULL
);

CREATE TABLE IF NOT EXISTS history_entries (
    id          bigserial PRIMARY KEY,
    thread_id   text NOT NULL REFERENCES threads(id),
    lineage_id  text NOT NULL,
    revision    integer NOT NULL,
    entered_at  timestamptz NOT NULL,
    left_at     timestamptz,
    outcome     text NOT NULL DEFAULT 'current',
    fh_baseline numeric(10,1) NOT NULL,
    threshold   numeric(10,1) NOT NULL,
    deadline_date date NOT NULL,
    title       text NOT NULL,
    method      text NOT NULL
);
CREATE INDEX IF NOT EXISTS history_thread ON history_entries(thread_id);

CREATE TABLE IF NOT EXISTS legacy_records (
    id          bigserial PRIMARY KEY,
    thread_id   text NOT NULL REFERENCES threads(id),
    revision    integer NOT NULL,
    status      text NOT NULL,
    inspected_on date,
    certified_on date,
    notes       text NOT NULL DEFAULT '',
    inspector_name text,
    inspector_licence text,
    certifier_name text,
    certifier_licence text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_key ON legacy_records(thread_id, revision, status, inspected_on, certified_on);

CREATE TABLE IF NOT EXISTS snapshots (
    lineage_id text NOT NULL REFERENCES lineages(id),
    revision   integer NOT NULL,
    payload    jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (lineage_id, revision)
);

CREATE TABLE IF NOT EXISTS documents (
    id          text PRIMARY KEY,
    sha256      text NOT NULL UNIQUE,
    key         text NOT NULL,
    bytes       bigint NOT NULL,
    uploaded_by text NOT NULL REFERENCES people(id),
    uploaded_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
    key          text NOT NULL,
    user_id      text NOT NULL,
    method       text NOT NULL,
    path         text NOT NULL,
    request_hash text NOT NULL,
    status       integer NOT NULL,
    body         text NOT NULL,
    created_at   timestamptz NOT NULL,
    PRIMARY KEY (key, user_id, method, path)
);

CREATE TABLE IF NOT EXISTS imports (
    id          text PRIMARY KEY,
    file_sha256 text UNIQUE NOT NULL,
    rows        integer NOT NULL,
    merged      integer NOT NULL,
    duplicates  integer NOT NULL,
    closed      integer NOT NULL,
    result      jsonb NOT NULL,
    imported_at timestamptz NOT NULL,
    imported_by text NOT NULL REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS notices (
    id        text PRIMARY KEY,
    kind      text NOT NULL,
    to_person text REFERENCES people(id),
    to_email  text NOT NULL,
    subject   text NOT NULL,
    body      text NOT NULL,
    status    text NOT NULL DEFAULT 'queued',
    queued_at timestamptz NOT NULL,
    send_after timestamptz NOT NULL,
    sent_at   timestamptz,
    thread_id  text,
    lineage_id text,
    card_id    text
);
CREATE INDEX IF NOT EXISTS notices_status ON notices(status);

CREATE TABLE IF NOT EXISTS packs (
    id           text PRIMARY KEY,
    lineage_id   text NOT NULL REFERENCES lineages(id),
    revision     integer NOT NULL,
    status       text NOT NULL DEFAULT 'queued',
    waiting_for  text,
    requested_by text NOT NULL REFERENCES people(id),
    requested_at timestamptz NOT NULL,
    transmitted_at timestamptz,
    attempts     integer NOT NULL DEFAULT 0,
    pdf_key      text,
    csv_key      text,
    pdf_sha256   text,
    csv_sha256   text
);
CREATE INDEX IF NOT EXISTS packs_status ON packs(status);

CREATE TABLE IF NOT EXISTS audit (
    id          bigserial PRIMARY KEY,
    at          timestamptz NOT NULL,
    actor_id    text NOT NULL REFERENCES people(id),
    action      text NOT NULL,
    directive_id text,
    thread_id   text,
    detail      jsonb
);
CREATE INDEX IF NOT EXISTS audit_time ON audit(id DESC);

CREATE TABLE IF NOT EXISTS sessions (
    token      text PRIMARY KEY,
    person_id  text NOT NULL REFERENCES people(id),
    started_at timestamptz NOT NULL,
    last_seen  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id          bigserial PRIMARY KEY,
    kind        text NOT NULL,
    payload    jsonb NOT NULL,
    created_at  timestamptz NOT NULL
);
"""

SEED_USERS = [
    # username, passcode, display name, role, contractor, licence, email, scope
    ("avery.lund", "saltmarsh-planner-1", "Avery Lund", "compliance_planner", False, None, "avery.lund@fenwick-regional.test", None),
    ("noor.haddad", "saltmarsh-planner-2", "Noor Haddad", "compliance_planner", False, None, "noor.haddad@fenwick-regional.test", None),
    ("dara.okafor", "saltmarsh-insp-1", "Dara Okafor", "licensed_inspector", False, "LIC-66-48213", "dara.okafor@fenwick-regional.test", None),
    ("sol.brennan", "saltmarsh-insp-2", "Sol Brennan", "licensed_inspector", False, "LIC-66-51077", "sol.brennan@fenwick-regional.test", None),
    ("mika.hollis", "saltmarsh-insp-3", "Mika Hollis", "licensed_inspector", True, "LIC-66-90412", "mika.hollis@hangarcrew.test", None),
    ("jun.teller", "saltmarsh-insp-4", "Jun Teller", "licensed_inspector", True, "LIC-66-90655", "jun.teller@hangarcrew.test", None),
    ("ines.varga", "saltmarsh-cert-1", "Ines Varga", "certifying_engineer", False, "LIC-66-30218", "ines.varga@fenwick-regional.test", ["ATR72-212A", "DHC-8-402"]),
    ("tomasz.wilk", "saltmarsh-cert-2", "Tomasz Wilk", "certifying_engineer", False, "LIC-66-30544", "tomasz.wilk@fenwick-regional.test", ["ATR72-212A", "ERJ-170-200"]),
    ("priya.raman", "saltmarsh-cert-3", "Priya Raman", "certifying_engineer", False, "LIC-66-30981", "priya.raman@fenwick-regional.test", ["ERJ-170-200", "DHC-8-402"]),
    ("robin.achterberg", "saltmarsh-records-1", "Robin Achterberg", "records_clerk", False, None, "robin.achterberg@fenwick-regional.test", None),
    ("casey.moreau", "saltmarsh-audit-1", "Casey Moreau", "regulator_auditor", False, None, "casey.moreau@caa-oversight.test", None),
    ("__system__", None, "Tailboard", None, False, None, None, None),
]

STANDBY = {
    "ATR72-212A": ["Ines Varga", "Tomasz Wilk", "Priya Raman"],
    "DHC-8-402": ["Priya Raman", "Ines Varga", "Tomasz Wilk"],
    "ERJ-170-200": ["Tomasz Wilk", "Priya Raman", "Ines Varga"],
}

ATR_TAILS = [
    ("G-FNAA", 1102, 18420.3), ("G-FNAB", 1118, 17985.0), ("G-FNAC", 1135, 17210.6),
    ("G-FNAD", 1149, 16844.2), ("G-FNAE", 1163, 16102.9), ("G-FNAF", 1180, 15577.4),
    ("G-FNAG", 1196, 14930.1), ("G-FNAH", 1211, 14288.8), ("G-FNAI", 1227, 13650.5),
    ("G-FNAJ", 1244, 12904.0), ("G-FNAK", 1260, 12411.7), ("G-FNAL", 1278, 11876.3),
]
DHC_TAILS = [
    ("G-FNBA", 4388, 24510.2), ("G-FNBB", 4402, 23877.9), ("G-FNBC", 4417, 23105.4),
    ("G-FNBD", 4431, 22690.0), ("G-FNBE", 4446, 21948.6), ("G-FNBF", 4460, 21302.3),
    ("G-FNBG", 4475, 20755.8), ("G-FNBH", 4489, 20114.1),
]
ERJ_TAILS = [
    ("G-FNCA", 17000512, 21033.5), ("G-FNCB", 17000527, 20488.2), ("G-FNCC", 17000541, 19870.9),
    ("G-FNCD", 17000558, 19244.6), ("G-FNCE", 17000573, 18602.3), ("G-FNCF", 17000586, 17955.0),
    ("G-FNCG", 17000602, 17310.7), ("G-FNCH", 17000619, 16688.4),
]


def seed_person_id(username: str) -> str:
    return f"per_{username.replace('.', '-')}"


def seed_tail_id(registration: str) -> str:
    return f"tail_{registration.replace('-', '')}"


async def apply_schema(database_url: str):
    """Create the schema before seeding, once per start; idempotent."""
    conn = await asyncpg.connect(database_url)
    try:
        await conn.execute(SCHEMA_SQL)
    finally:
        await conn.close()
