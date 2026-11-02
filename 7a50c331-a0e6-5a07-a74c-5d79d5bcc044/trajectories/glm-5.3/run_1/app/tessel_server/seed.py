"""Idempotent seed: both organizations, both launch_brain databases and their facts."""
import asyncpg

from .handlers import hash_password
from .textutil import entity_key, tokens, dt_to_str, datetime_str_to_dt

SEED_PASSWORD = "deku-demo-pw-2026"

NORTHWIND_SOURCES = [
    ("kickoff-notes", "Atlas launch kickoff",
     "Priya Raman owns the Atlas launch. The launch is blocked by the billing migration, "
     "which Marco Silva owns.",
     [("Atlas Launch", "OWNED_BY", "Priya Raman", "2026-01-05T09:00:00Z", "Kickoff assignment"),
      ("Billing Migration", "OWNED_BY", "Marco Silva", "2026-01-05T09:00:00Z",
       "Kickoff assignment"),
      ("Atlas Launch", "BLOCKED_BY", "Billing Migration", "2026-02-01T00:00:00Z",
       "Invoices must move first")]),
    ("reorg-memo", "Platform reorg memo",
     "Priya Raman moved to the platform team. Dana Okafor now owns the Atlas launch.",
     [("Atlas Launch", "OWNED_BY", "Dana Okafor", "2026-03-10T12:00:00Z",
       "Priya moved to the platform team")]),
    ("billing-standup", "Billing standup notes",
     "The billing migration depends on the ledger service. Marco Silva owns the ledger service too.",
     [("Billing Migration", "DEPENDS_ON", "Ledger Service", "2026-03-14T10:00:00Z",
       "Standup finding"),
      ("Ledger Service", "OWNED_BY", "Marco Silva", "2026-03-14T10:00:00Z",
       "Standup finding")]),
    ("launch-retro", "Atlas launch retro",
     "The billing migration shipped. The Atlas launch is now blocked by the security review, "
     "owned by Lena Brandt.",
     [("Atlas Launch", "BLOCKED_BY", "Security Review", "2026-04-02T15:30:00Z",
       "Billing migration shipped"),
      ("Security Review", "OWNED_BY", "Lena Brandt", "2026-04-02T15:30:00Z",
       "Retro assignment")]),
]

ACME_SOURCES = [
    ("acme-plan", "Acme rollout plan", "The rollout is owned by Jordan Lee.",
     [("Acme Rollout", "OWNED_BY", "Jordan Lee", "2026-02-01T00:00:00Z", "Plan of record")]),
]


async def ensure_organization(conn, name, plan):
    row = await conn.fetchrow("SELECT id FROM app.organizations WHERE name = $1", name)
    if row is not None:
        return row["id"]
    return await conn.fetchval(
        "INSERT INTO app.organizations (name, plan, created_at) VALUES ($1,$2,now()) "
        "RETURNING id", name, plan)


async def ensure_member(conn, org_id, email, role):
    row = await conn.fetchrow("SELECT id FROM app.members WHERE lower(email) = $1",
                              email.lower())
    if row is not None:
        return row["id"]
    return await conn.fetchval(
        "INSERT INTO app.members (organization_id, email, role, password_hash, created_at) "
        "VALUES ($1,$2,$3,$4,now()) RETURNING id", org_id, email.lower(), role,
        hash_password(SEED_PASSWORD))


async def ensure_database(conn, org_id, name, *, compacted_lsns):
    row = await conn.fetchrow(
        "SELECT id FROM app.databases WHERE organization_id = $1 AND name = $2",
        org_id, name)
    if row is not None:
        return row["id"]
    created = await conn.fetchrow(
        "INSERT INTO app.databases (organization_id, name, created_at, ready_at, last_lsn, "
        "indexed_lsn, index_generation) VALUES ($1,$2,now(),now(),0,0,0) RETURNING id",
        org_id, name)
    await conn.execute(
        "INSERT INTO app.collections (database_id, name) VALUES ($1,'default')", created["id"])
    return created["id"]


async def seed_source(conn, db_id, org_id, lsn, sid, title, text, facts):
    existing = await conn.fetchrow(
        "SELECT id FROM app.sources WHERE database_id = $1 AND collection = 'default' "
        "AND source_id = $2", db_id, sid)
    if existing is not None:
        return
    token_count = len(tokens(title + " " + text))
    await conn.execute(
        "INSERT INTO app.sources (database_id, collection, source_id, title, text, version, "
        "token_count, ingested_at, lsn, live) VALUES ($1,'default',$2,$3,$4,1,$5,now(),$6,true)",
        db_id, sid, title, text, token_count, lsn)
    await conn.execute(
        "INSERT INTO app.source_versions (organization_id, database_id, collection, "
        "source_id, version, lsn, token_count, ingested_at) "
        "VALUES ($1,$2,'default',$3,1,$4,$5,now())", org_id, db_id, sid, lsn, token_count)
    await conn.execute(
        "INSERT INTO app.wal_entries (database_id, lsn, kind, source_id, created_at) "
        "VALUES ($1,$2,'ingest',$3,now())", db_id, lsn, sid)
    for pos, (subject, predicate, obj, valid_from, reason) in enumerate(facts):
        await conn.execute(
            "INSERT INTO app.facts (database_id, lsn, position, source_id, subject, "
            "subject_key, object, object_key, predicate, valid_from, reason, source_live) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)",
            db_id, lsn, pos, sid, subject, entity_key(subject), obj, entity_key(obj),
            predicate, datetime_str_to_dt(valid_from), reason)


async def seed_all(pool):
    async with pool.acquire() as conn:
        async with conn.transaction():
            northwind = await ensure_organization(conn, "Northwind Labs", "ship")
            acme = await ensure_organization(conn, "Acme Ops", "scale")
            await ensure_member(conn, northwind, "northwind.owner@example.com", "owner")
            await ensure_member(conn, northwind, "northwind.editor@example.com", "editor")
            await ensure_member(conn, northwind, "northwind.viewer@example.com", "viewer")
            await ensure_member(conn, acme, "acme.owner@example.com", "owner")

            nb = await ensure_database(conn, northwind, "launch_brain", compacted_lsns=4)
            existing = await conn.fetchval(
                "SELECT count(*) FROM app.sources WHERE database_id = $1", nb)
            if existing == 0:
                for i, (sid, title, text, facts) in enumerate(NORTHWIND_SOURCES, start=1):
                    await seed_source(conn, nb, northwind, i, sid, title, text, facts)
                await conn.execute(
                    "UPDATE app.databases SET last_lsn = 4, indexed_lsn = 4, "
                    "index_generation = 1 WHERE id = $1", nb)

            ab = await ensure_database(conn, acme, "launch_brain", compacted_lsns=1)
            existing = await conn.fetchval(
                "SELECT count(*) FROM app.sources WHERE database_id = $1", ab)
            if existing == 0:
                for i, (sid, title, text, facts) in enumerate(ACME_SOURCES, start=1):
                    await seed_source(conn, ab, acme, i, sid, title, text, facts)
                await conn.execute(
                    "UPDATE app.databases SET last_lsn = 1, indexed_lsn = 1, "
                    "index_generation = 1 WHERE id = $1", ab)
