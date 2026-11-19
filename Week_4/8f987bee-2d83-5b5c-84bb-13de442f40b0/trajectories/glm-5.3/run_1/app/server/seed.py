"""Idempotent seed with fixed identities, and restart recovery."""
from __future__ import annotations

import datetime as dt
import json

from . import accounts, catalog, config, db, domain, sync

SEED_KEY = "seed:done"

LUMEN_SEEDS = {
    "workspace": "a1b2c3d4e5f6a7b8c9d0e1f2",
    "admin": "b1b2c3d4e5f6a7b8c9d0e1f2",
    "editor": "c1b2c3d4e5f6a7b8c9d0e1f2",
    "viewer": "d1b2c3d4e5f6a7b8c9d0e1f2",
    "source": "e1b2c3d4e5f6a7b8c9d0e1f2",
    "destination": "f1b2c3d4e5f6a7b8c9d0e1f2",
    "connection": "11b2c3d4e5f6a7b8c9d0e1f2",
}
OUTPOST_SEEDS = {
    "workspace": "0f1e2d3c4b5a6978879605f4",
    "admin": "21b2c3d4e5f6a7b8c9d0e1f2",
    "source": "31b2c3d4e5f6a7b8c9d0e1f2",
    "destination": "41b2c3d4e5f6a7b8c9d0e1f2",
    "connection": "51b2c3d4e5f6a7b8c9d0e1f2",
}


def _seed_state_recorded(conn) -> bool:
    return conn.execute("SELECT 1 FROM seed_state WHERE key = %s", (SEED_KEY,)).fetchone() is not None


def run() -> bool:
    """Create the baseline once. Returns True when work was done."""
    with db.tx() as conn:
        if _seed_state_recorded(conn):
            return False
        # builtin catalog: fixed identities equal to their slugs
        for definition in catalog.builtin_definitions():
            conn.execute(
                "INSERT INTO connector_definitions (id, workspace_id, name, slug, type, category, "
                "availability, runnable, custom, version) VALUES (%s,NULL,%s,%s,%s,%s,%s,%s,false,1) "
                "ON CONFLICT (id) DO NOTHING",
                (definition["id"], definition["name"], definition["slug"], definition["type"],
                 definition["category"], json.dumps(definition["availability"]),
                 definition["runnable"]))
        lumen_ws = _seed_workspace(conn, LUMEN_SEEDS, "Lumen Freight", "team")
        outpost_ws = _seed_workspace(conn, OUTPOST_SEEDS, "Outpost Data", "starter")
        _seed_lumen(conn, lumen_ws)
        _seed_outpost(conn, outpost_ws)
        conn.execute("INSERT INTO seed_state (key) VALUES (%s)", (SEED_KEY,))
    return True


def _seed_workspace(conn, seeds: dict, name: str, plan: str) -> str:
    row = conn.execute("SELECT id FROM workspaces WHERE id = %s", (seeds["workspace"],)).fetchone()
    if row:
        return seeds["workspace"]
    conn.execute("INSERT INTO workspaces (id, name, plan) VALUES (%s,%s,%s) ON CONFLICT (id) DO NOTHING",
                 (seeds["workspace"], name, plan))
    return seeds["workspace"]


def _seed_user(conn, seed_id: str, email: str, name: str, password: str) -> str:
    row = conn.execute("SELECT id FROM users WHERE id = %s", (seed_id,)).fetchone()
    if row:
        return seed_id
    conn.execute(
        "INSERT INTO users (id, email, name, password_hash) VALUES (%s,%s,%s,%s) "
        "ON CONFLICT (id) DO NOTHING",
        (seed_id, email, name, domain.hash_secret(password)))
    return seed_id


def _seed_membership(conn, user_id: str, workspace_id: str, role: str) -> None:
    conn.execute(
        "INSERT INTO memberships (user_id, workspace_id, role) VALUES (%s,%s,%s) "
        "ON CONFLICT (user_id, workspace_id) DO NOTHING", (user_id, workspace_id, role))


def _seed_source(conn, seed_id: str, workspace_id: str, name: str, api_key: str) -> str:
    row = conn.execute("SELECT id FROM sources WHERE id = %s", (seed_id,)).fetchone()
    if row:
        return seed_id
    conn.execute(
        "INSERT INTO sources (id, workspace_id, name, definition_id, config) VALUES (%s,%s,%s,%s,%s) "
        "ON CONFLICT (id) DO NOTHING",
        (seed_id, workspace_id, name, "sample-commerce-api",
         json.dumps({"api_key": domain.seal_secret(api_key),
                     "start_date": "2026-01-01"})))
    return seed_id


def _seed_destination(conn, seed_id: str, workspace_id: str, name: str) -> str:
    row = conn.execute("SELECT id FROM destinations WHERE id = %s", (seed_id,)).fetchone()
    if row:
        return seed_id
    conn.execute(
        "INSERT INTO destinations (id, workspace_id, name, definition_id) VALUES (%s,%s,%s,%s) "
        "ON CONFLICT (id) DO NOTHING",
        (seed_id, workspace_id, name, "wayline-warehouse"))
    return seed_id


def _seed_connection(conn, seed_id: str, workspace_id: str, name: str, source_id: str,
                     destination_id: str, prefix: str) -> str:
    row = conn.execute("SELECT id FROM connections WHERE id = %s", (seed_id,)).fetchone()
    if row:
        return seed_id
    streams = []
    for stream in catalog.sample_catalog({}):
        streams.append({
            "name": stream["name"],
            "selected": True,
            "sync_mode": "full_refresh_overwrite",
            "cursor_field": stream["cursor_field"],
            "primary_key": stream["primary_key"],
            "known_fields": stream["fields"],
        })
    conn.execute(
        "INSERT INTO connections (id, workspace_id, name, status, version, source_id, destination_id, "
        "namespace_prefix, streams, schedule, schema_change_policy, cursors) "
        "VALUES (%s,%s,%s,'active',1,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING",
        (seed_id, workspace_id, name, source_id, destination_id, prefix,
         json.dumps(streams), json.dumps({"type": "manual"}), "propagate", json.dumps({})))
    return seed_id


def _seed_lumen(conn, workspace_id: str) -> None:
    admin = _seed_user(conn, LUMEN_SEEDS["admin"], "admin@example.com", "Priya Natarajan", config.SEED_PASSWORD)
    editor = _seed_user(conn, LUMEN_SEEDS["editor"], "editor@example.com", "Marco Bell", config.SEED_PASSWORD)
    viewer = _seed_user(conn, LUMEN_SEEDS["viewer"], "viewer@example.com", "Dana Okafor", config.SEED_PASSWORD)
    for user_id, role in ((admin, "admin"), (editor, "editor"), (viewer, "viewer")):
        _seed_membership(conn, user_id, workspace_id, role)
    source = _seed_source(conn, LUMEN_SEEDS["source"], workspace_id, "Shop Orders", "lumen-shop-key-01")
    destination = _seed_destination(conn, LUMEN_SEEDS["destination"], workspace_id, "Lumen Warehouse")
    _seed_connection(conn, LUMEN_SEEDS["connection"], workspace_id,
                     "Shop Orders to Warehouse", source, destination, "shop_")


def _seed_outpost(conn, workspace_id: str) -> None:
    admin = _seed_user(conn, OUTPOST_SEEDS["admin"], "outsider@example.com", "Sasha Reyes", config.SEED_PASSWORD)
    _seed_membership(conn, admin, workspace_id, "admin")
    source = _seed_source(conn, OUTPOST_SEEDS["source"], workspace_id, "Outpost Events", "outpost-key-01")
    destination = _seed_destination(conn, OUTPOST_SEEDS["destination"], workspace_id, "Outpost Warehouse")
    _seed_connection(conn, OUTPOST_SEEDS["connection"], workspace_id,
                     "Outpost Sync", source, destination, "outpost_")


def recover() -> int:
    """Restart recovery: fail pending or running jobs as interrupted. Once each."""
    now = dt.datetime.now(dt.timezone.utc)
    count = 0
    with db.tx() as conn:
        rows = conn.execute("SELECT * FROM jobs WHERE status IN ('pending','running')").fetchall()
        for job in rows:
            attempts = job["attempts"] or []
            if attempts:
                attempts = attempts[:-1] + [{"number": attempts[-1]["number"],
                                             "status": "failed",
                                             "failure_reason": "interrupted"}]
            else:
                attempts = [{"number": 1, "status": "failed", "failure_reason": "interrupted"}]
            conn.execute(
                "UPDATE jobs SET status='failed', failure_reason='interrupted', ended_at=%s, "
                "attempts=%s WHERE id=%s AND status IN ('pending','running')",
                (now, json.dumps(attempts), job["id"]))
            if conn.execute("SELECT 1 FROM jobs WHERE id=%s AND status='failed'", (job["id"],)).fetchone():
                sync.append_log(conn, job["id"], now, "error", "Sync failed: interrupted")
                actor = conn.execute("SELECT email FROM users WHERE id = %s",
                                      (job["started_by"],)).fetchone()
                accounts.write_audit(conn, job["workspace_id"], "sync.failed", job["id"], actor["email"])
                from . import connections as connections_mod

                connections_mod.recompute_next_run(conn, job["connection_id"])
                sync.publish(job["id"], {"type": "status", "status": "failed"})
                count += 1
    return count
