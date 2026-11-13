"""Postgres: the pool, the schema and seed, the live-event channel and the vault snapshot."""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import date, timedelta

import asyncpg

from . import domain
from .config import Config

log = logging.getLogger("strongroom")

APP_NAME = "strongroom"
CHANNEL = "strongroom_events"
SCHEMA_LOCK = 7_340_211

SCHEMA = """
CREATE TABLE IF NOT EXISTS vault (
    id uuid PRIMARY KEY,
    owner_sub text UNIQUE,
    owner_email text NOT NULL,
    owner_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS holding (
    id uuid PRIMARY KEY,
    vault_id uuid NOT NULL REFERENCES vault ON DELETE CASCADE,
    seq bigint GENERATED ALWAYS AS IDENTITY,
    company text NOT NULL,
    company_key text NOT NULL,
    data_kind text NOT NULL,
    value text NOT NULL,
    notes text NOT NULL DEFAULT '',
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (vault_id, company_key, data_kind)
);
CREATE TABLE IF NOT EXISTS grading_rule (
    id uuid PRIMARY KEY,
    vault_id uuid NOT NULL REFERENCES vault ON DELETE CASCADE,
    seq bigint GENERATED ALWAYS AS IDENTITY,
    priority integer NOT NULL,
    data_kind text NOT NULL,
    company_contains text NOT NULL DEFAULT '',
    level text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS breach (
    id uuid PRIMARY KEY,
    vault_id uuid NOT NULL REFERENCES vault ON DELETE CASCADE,
    seq bigint GENERATED ALWAYS AS IDENTITY,
    company text NOT NULL,
    company_key text NOT NULL,
    announced_on date NOT NULL,
    data_kinds text[] NOT NULL,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS next_step (
    vault_id uuid NOT NULL REFERENCES vault ON DELETE CASCADE,
    step_key text NOT NULL,
    id uuid NOT NULL UNIQUE,
    done boolean NOT NULL DEFAULT false,
    PRIMARY KEY (vault_id, step_key)
);
CREATE TABLE IF NOT EXISTS breach_request (
    vault_id uuid NOT NULL REFERENCES vault ON DELETE CASCADE,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    response text NOT NULL,
    PRIMARY KEY (vault_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS access_grant (
    id uuid PRIMARY KEY,
    vault_id uuid NOT NULL REFERENCES vault ON DELETE CASCADE,
    contact_name text NOT NULL,
    contact_email text NOT NULL,
    contact_user_id text,
    duration text NOT NULL,
    levels text[] NOT NULL,
    created_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS app_session (
    id text PRIMARY KEY,
    sub text NOT NULL,
    role text NOT NULL,
    vault_id uuid NOT NULL REFERENCES vault ON DELETE CASCADE,
    email text NOT NULL,
    name text NOT NULL,
    last_active timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS app_session_vault ON app_session (vault_id, role);
CREATE TABLE IF NOT EXISTS pending_signin (
    id text PRIMARY KEY,
    state text NOT NULL,
    nonce text NOT NULL,
    verifier text NOT NULL,
    next_path text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS realm_logout (
    user_id text PRIMARY KEY,
    queued_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
"""

# --------------------------------------------------------------------------- seed data (brief: Seed data)

SEED_ACCOUNTS: tuple[tuple[str, str, str, str], ...] = (
    ("ada.marsh@example.com", "Strongroom-Owner-1", "Ada", "Marsh"),
    ("teodor.vance@example.com", "Strongroom-Owner-2", "Teodor", "Vance"),
    ("ines.marsh@example.com", "Strongroom-Contact-1", "Ines", "Marsh"),
)

SEED_VAULT_A_HOLDINGS: tuple[tuple[str, str, str, str], ...] = (
    ("Brightway Air", "passport", "P 5520 4471 8", "Saved for online check-in"),
    ("Brightway Air", "date_of_birth", "1986-03-14", ""),
    ("Brightway Air", "email", "ada.marsh@example.com", ""),
    ("Copperleaf Bank", "bank_account", "GB29 CPLF 6016 1331 9268 19", "Joint account with Ines"),
    ("Copperleaf Bank", "payment_card", "4929 1180 2231 6604", ""),
    ("Copperleaf Bank", "home_address", "14 Wren Row, Aldmoor", ""),
    ("Larchfield Clinic", "health_record", "Patient LC-208113", "Asthma review every spring"),
    ("Larchfield Clinic", "phone", "+44 7700 900412", ""),
    ("Parcelwise", "home_address", "14 Wren Row, Aldmoor", ""),
    ("Parcelwise", "phone", "+44 7700 900412", ""),
    ("Tally Rent", "national_id", "QQ 12 34 56 C", "Scan of ID card uploaded at signup"),
    ("Tally Rent", "home_address", "14 Wren Row, Aldmoor", ""),
)

SEED_VAULT_B_HOLDINGS: tuple[tuple[str, str, str, str], ...] = (
    ("Quayside Mobile", "phone", "+44 7700 900118", ""),
    ("Quayside Mobile", "payment_card", "5412 7500 0000 1290", ""),
    ("Harbor Gym", "home_address", "3 Pier Lane, Saltby", ""),
)

GRANT_HOURS: dict[str, int] = {"24h": 24, "7d": 168, "30d": 720}


async def connect_pool(config: Config) -> asyncpg.Pool:
    """Retries every 2 seconds until the database answers (brief: Server boundary)."""
    while True:
        try:
            return await asyncpg.create_pool(
                config.database_url, min_size=1, max_size=20, max_inactive_connection_lifetime=10,
                server_settings={"application_name": APP_NAME},
            )
        except (OSError, asyncpg.PostgresError) as error:
            log.warning("database unreachable (%s); retrying in 2 s", error)
            await asyncio.sleep(2)


async def migrate_and_seed(pool: asyncpg.Pool, config: Config) -> None:
    async with pool.acquire() as conn:
        await conn.execute("SELECT pg_advisory_lock($1)", SCHEMA_LOCK)
        try:
            await conn.execute(SCHEMA)
            if await conn.fetchval("SELECT count(*) FROM vault") == 0:
                async with conn.transaction():
                    await _seed(conn, config)
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", SCHEMA_LOCK)


async def _seed(conn: asyncpg.Connection, config: Config) -> None:
    vault_a, vault_b = uuid.uuid4(), uuid.uuid4()
    await conn.execute("INSERT INTO vault (id, owner_email, owner_name) VALUES ($1, $2, $3), ($4, $5, $6)",
                       vault_a, "ada.marsh@example.com", "Ada Marsh", vault_b, "teodor.vance@example.com", "Teodor Vance")
    await insert_rules(conn, vault_a, [("any", "clinic", "critical")] + [(k, "", lv) for k, lv in domain.DEFAULT_RULES])
    await insert_rules(conn, vault_b, [(k, "", lv) for k, lv in domain.DEFAULT_RULES])
    for vault_id, rows in ((vault_a, SEED_VAULT_A_HOLDINGS), (vault_b, SEED_VAULT_B_HOLDINGS)):
        for company, kind, value, notes in rows:
            holding_id = uuid.uuid4()
            await conn.execute(
                "INSERT INTO holding (id, vault_id, company, company_key, data_kind, value, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)",
                holding_id, vault_id, company, domain.company_key(company), kind, value, notes)
            await notify(conn, vault_id, "holding.created", holding_id)
    for vault_id, company, announced, kinds in ((vault_a, "Brightway Air", date(2026, 10, 20), ["passport", "date_of_birth"]),
                                                (vault_b, "Quayside Mobile", date(2026, 10, 28), ["phone"])):
        breach_id = uuid.uuid4()
        await conn.execute(
            "INSERT INTO breach (id, vault_id, company, company_key, announced_on, data_kinds) VALUES ($1,$2,$3,$4,$5,$6)",
            breach_id, vault_id, company, domain.company_key(company), announced, kinds)
        await notify(conn, vault_id, "breach.created", breach_id)
    grant_id = uuid.uuid4()
    await conn.execute(
        "INSERT INTO access_grant (id, vault_id, contact_name, contact_email, duration, levels, created_at, ends_at) "
        "SELECT $1, $2, 'Ines Marsh', 'ines.marsh@example.com', '30d', $3, t, t + $4 FROM clock_timestamp() t",
        grant_id, vault_a, [lv.code for lv in domain.LEVELS],
        timedelta(seconds=GRANT_HOURS["30d"] * config.grant_hour_seconds))
    await notify(conn, vault_a, "grant.created", grant_id)
    for vault_id in (vault_a, vault_b):
        await sync_steps(conn, vault_id)


async def insert_rules(conn: asyncpg.Connection, vault_id: uuid.UUID, rules: list[tuple[str, str, str]]) -> None:
    """Writes a new vault's grading rules, each with its rule.created notification in the same transaction."""
    rows = [(uuid.uuid4(), vault_id, i, kind, contains, level) for i, (kind, contains, level) in enumerate(rules, 1)]
    await conn.executemany(
        "INSERT INTO grading_rule (id, vault_id, priority, data_kind, company_contains, level) VALUES ($1,$2,$3,$4,$5,$6)",
        rows)
    for rule_id, *_ in rows:
        await notify(conn, vault_id, "rule.created", rule_id)


# --------------------------------------------------------------------------- snapshot


async def load_snapshot(conn: asyncpg.Connection, vault_id: uuid.UUID) -> domain.Snapshot:
    holdings = tuple(
        domain.Holding(r["id"], r["company"], r["company_key"], r["data_kind"], r["value"], r["notes"], r["version"],
                       r["created_at"], r["updated_at"], r["seq"])
        for r in await conn.fetch("SELECT * FROM holding WHERE vault_id = $1", vault_id))
    rules = tuple(
        domain.Rule(r["id"], r["priority"], r["data_kind"], r["company_contains"], r["level"], r["version"], r["seq"])
        for r in await conn.fetch("SELECT * FROM grading_rule WHERE vault_id = $1", vault_id))
    breaches = tuple(
        domain.Breach(r["id"], r["company"], r["company_key"], r["announced_on"], tuple(r["data_kinds"]), r["version"],
                      r["created_at"], r["seq"])
        for r in await conn.fetch("SELECT * FROM breach WHERE vault_id = $1", vault_id))
    marks = {r["step_key"]: (r["id"], r["done"])
             for r in await conn.fetch("SELECT step_key, id, done FROM next_step WHERE vault_id = $1", vault_id)}
    return domain.Snapshot(vault_id, holdings, rules, breaches, marks)


async def sync_steps(conn: asyncpg.Connection, vault_id: uuid.UUID) -> domain.Snapshot:
    """Gives every current step a stored id and done mark, and drops those of steps that no longer exist.

    Runs inside the writing transaction, so a holding or breach change and its derived steps commit together.
    """
    snapshot = await load_snapshot(conn, vault_id)
    keys = {s.key for s in domain.build_view(snapshot).steps}
    stale = [k for k in snapshot.marks if k not in keys]
    fresh = {k: (uuid.uuid4(), False) for k in keys if k not in snapshot.marks}
    if stale:
        await conn.execute("DELETE FROM next_step WHERE vault_id = $1 AND step_key = ANY($2)", vault_id, stale)
    if fresh:
        await conn.executemany("INSERT INTO next_step (vault_id, step_key, id) VALUES ($1, $2, $3)",
                               [(vault_id, k, v[0]) for k, v in fresh.items()])
    marks = {k: v for k, v in snapshot.marks.items() if k in keys} | fresh
    return domain.Snapshot(vault_id, snapshot.holdings, snapshot.rules, snapshot.breaches, marks)


async def notify(conn: asyncpg.Connection, vault_id: uuid.UUID, kind: str, record_id: uuid.UUID) -> None:
    """One id-only notification per directly written record, sent inside the writing transaction."""
    payload = json.dumps({"vault_id": str(vault_id), "type": kind, "id": str(record_id)})
    await conn.execute("SELECT pg_notify($1, $2)", CHANNEL, payload)


# --------------------------------------------------------------------------- live events


class Listener:
    """One stream's own LISTEN session on `strongroom_events`; it keeps its vault's notifications and is closed
    with the stream."""

    def __init__(self, conn: asyncpg.Connection, vault_id: uuid.UUID) -> None:
        self.conn = conn
        self.notifications: asyncio.Queue[dict] = asyncio.Queue()
        self._vault = str(vault_id)

    def _deliver(self, _conn: object, _pid: int, _channel: str, payload: str) -> None:
        event = json.loads(payload)
        if event["vault_id"] == self._vault:
            self.notifications.put_nowait(event)

    async def close(self) -> None:
        if not self.conn.is_closed():
            await self.conn.close()


async def listen(config: Config, vault_id: uuid.UUID) -> Listener:
    conn = await asyncpg.connect(config.database_url, server_settings={"application_name": APP_NAME})
    listener = Listener(conn, vault_id)
    await conn.add_listener(CHANNEL, listener._deliver)
    return listener
