"""Dashboard, search, compartments, grants, ending sessions, break-glass."""

from __future__ import annotations

import datetime as dt
import re
from typing import Any

import asyncpg

from wardline import fields, idempotency, ledger
from wardline.access import (
    GRANT_PAST_TIME,
    active_grant_on,
    authorise,
    can_read_access_list,
    end_past_grant,
    ended_state,
    entry,
    grant_in_force,
    grant_past_time,
    load_compartment,
    may,
    require_grant,
    require_role,
    well_formed,
)
from wardline.auth import consume_proof, require_proof
from wardline.config import CONFIG
from wardline.db import DB, next_id
from wardline.errors import ApiError
from wardline.web import Reply, Request, route
from wardline.workers import STATUS

ACTIVE = grant_in_force()
_FLATTEN = re.compile("[\n\u0085  ]+")
_COUNTS = """
  (SELECT count(*) FROM exhibits e WHERE e.compartment_id = c.id AND e.state <> 'disposed') AS exhibit_count,
  (SELECT count(*) FROM exhibits e WHERE e.compartment_id = c.id AND e.state = 'quarantined') AS quarantine_count,
  (SELECT coalesce(sum(d.size), 0)::bigint FROM releases r
     JOIN release_items i ON i.release_id = r.id JOIN derivatives d ON d.id = i.derivative_id
     WHERE r.compartment_id = c.id AND r.state <> 'withdrawn') AS release_bytes
"""


def grant_json(row: asyncpg.Record) -> dict[str, Any]:
    state = row["state"]
    if state == "active" and grant_past_time(row):
        state = ended_state(row["kind"])
    return {
        "id": row["id"],
        "compartment_id": row["compartment_id"],
        "user_id": row["user_id"],
        "scope": row["scope"],
        "state": state,
        "expires_at": fields.format_time(row["expires_at"]),
        "kind": row["kind"],
    }


def _compartment_json(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "exhibit_count": row["exhibit_count"],
        "quarantine_count": row["quarantine_count"],
        "release_bytes": row["release_bytes"],
    }


async def _counted(conn: asyncpg.Connection, compartment_id: str) -> asyncpg.Record:
    return await conn.fetchrow(f"SELECT c.*, {_COUNTS} FROM compartments c WHERE c.id = $1", compartment_id)


@route("GET", "/api/dashboard")
async def dashboard(request: Request) -> Reply:
    async with DB.connection() as conn:
        row = await conn.fetchrow(
            f"""WITH mine AS (SELECT compartment_id AS id FROM grants WHERE user_id = $1 AND {ACTIVE})
            SELECT (SELECT count(*) FROM mine) AS compartments,
              (SELECT count(*) FROM exhibits WHERE compartment_id IN (SELECT id FROM mine) AND state <> 'disposed') AS exhibits,
              (SELECT count(*) FROM exhibits WHERE compartment_id IN (SELECT id FROM mine) AND state = 'quarantined') AS quarantined,
              (SELECT count(*) FROM exhibits WHERE compartment_id IN (SELECT id FROM mine) AND state = 'held') AS held,
              (SELECT count(*) FROM releases WHERE compartment_id IN (SELECT id FROM mine) AND state = 'submitted') AS releases_in_review,
              (SELECT coalesce(sum(d.size), 0)::bigint FROM releases r
                 JOIN release_items i ON i.release_id = r.id JOIN derivatives d ON d.id = i.derivative_id
                 WHERE r.compartment_id IN (SELECT id FROM mine) AND r.state <> 'withdrawn') AS release_bytes""",
            request.person.id,
        )
    return Reply(200, dict(row))


@route("GET", "/api/search")
async def search(request: Request) -> Reply:
    query = request.query.get("q", "")
    if not query or fields.unstorable(query):
        return Reply(200, {"results": []})
    async with DB.connection() as conn:
        rows = await conn.fetch(
            f"""SELECT id, compartment_id, name, state FROM exhibits
                WHERE state <> 'disposed' AND strpos(lower(name), lower($2)) > 0
                  AND compartment_id IN (SELECT compartment_id FROM grants WHERE user_id = $1 AND {ACTIVE})
                ORDER BY id LIMIT 200""",
            request.person.id,
            query,
        )
    return Reply(200, {"results": [
        {"exhibit_id": r["id"], "compartment_id": r["compartment_id"], "name": r["name"], "state": r["state"]} for r in rows
    ]})


@route("GET", "/api/compartments")
async def list_compartments(request: Request) -> Reply:
    async with DB.connection() as conn:
        rows = await conn.fetch(
            f"""SELECT c.*, {_COUNTS} FROM compartments c
                WHERE c.id IN (SELECT compartment_id FROM grants WHERE user_id = $1 AND {ACTIVE}) ORDER BY c.id""",
            request.person.id,
        )
    return Reply(200, {"compartments": [_compartment_json(r) for r in rows]})


async def _insert_grant(conn: asyncpg.Connection, compartment_id: str, user_id: str, scope: str,
                        expires_at: dt.datetime | None, kind: str) -> asyncpg.Record:
    grant_id = await next_id(conn, "GRT", "grants_seq")
    return await conn.fetchrow(
        "INSERT INTO grants (id, compartment_id, user_id, scope, state, expires_at, kind)"
        " VALUES ($1, $2, $3, $4, 'active', $5, $6) RETURNING *",
        grant_id, compartment_id, user_id, scope, expires_at, kind,
    )


@route("POST", "/api/compartments")
async def create_compartment(request: Request) -> Reply:
    person = request.person
    require_role(request, "create_compartment")
    form = fields.Form(request.require_body())
    name = form.text("name", 200)
    form.done()
    async with DB.tx() as conn:
        compartment_id = await next_id(conn, "CMP", "compartments_seq")
        await conn.execute("INSERT INTO compartments (id, name, owner_id) VALUES ($1, $2, $3)", compartment_id, name, person.id)
        grant = await _insert_grant(conn, compartment_id, person.id, "full", None, "grant")
        await entry(conn, request, "compartment.created", compartment_id)
        await entry(conn, request, "grant.issued", grant["id"], {"compartment_id": compartment_id, "user_id": person.id})
        return Reply(201, _compartment_json(await _counted(conn, compartment_id)))


@route("GET", "/api/compartments/{id}")
async def read_compartment(request: Request) -> Reply:
    identifier = request.params["id"]
    async with DB.connection() as conn:
        await load_compartment(request, conn, identifier)
        standing = await require_grant(request, conn, identifier, identifier)
        row = await _counted(conn, str(identifier))
        access = None
        if can_read_access_list(request, standing):
            grants = await conn.fetch("SELECT * FROM grants WHERE compartment_id = $1 ORDER BY id", str(identifier))
            access = [grant_json(g) for g in grants]
    return Reply(200, {
        **_compartment_json(row),
        "owner_id": row["owner_id"],
        "access_version": row["access_version"],
        "caller_scope": standing.scope,
        "access": access,
    })


def _check_version(form: fields.Form, row: asyncpg.Record) -> None:
    """A whole number other than the current one is a state conflict; no usable value is left to validation."""
    version = form.body.get("access_version")
    if type(version) is int and version != row["access_version"]:
        raise ApiError("stale_access_list", access_version=row["access_version"])


async def _bump_version(conn: asyncpg.Connection, compartment_id: str) -> None:
    await conn.execute("UPDATE compartments SET access_version = access_version + 1 WHERE id = $1", compartment_id)


async def _settle_lapsed(conn: asyncpg.Connection, compartment_id: str, user_id: str) -> None:
    """A grant past its lapse time, not yet swept, leaves the person free for a new grant."""
    row = await conn.fetchrow(
        f"SELECT * FROM grants WHERE compartment_id = $1 AND user_id = $2 AND {GRANT_PAST_TIME}",
        compartment_id, user_id,
    )
    if row is None:
        return
    await end_past_grant(conn, row)


@route("POST", "/api/compartments/{id}/grants")
async def issue_grant(request: Request) -> Reply:
    identifier = request.params["id"]
    body = request.json_body() or {}
    user_id = body.get("user_id")
    async with DB.tx() as conn:
        compartment = await load_compartment(request, conn, identifier, lock=True)
        standing = await require_grant(request, conn, str(identifier), identifier)
        if (
            isinstance(user_id, str)
            and user_id.strip(fields.TRIM)
            and (not well_formed(user_id) or not await conn.fetchval("SELECT 1 FROM people WHERE id = $1", user_id))
        ):
            raise request.not_found(user_id)
        authorise(request, standing, "manage_grants")
        await require_proof(request, conn)
        form = fields.Form(body)
        _check_version(form, compartment)
        if isinstance(user_id, str) and user_id.strip(fields.TRIM):
            await _settle_lapsed(conn, str(identifier), user_id)
            if await active_grant_on(conn, str(identifier), user_id):
                raise ApiError("grant_exists")
        else:
            form.errors["user_id"] = fields.REQUIRED
        request.require_body()
        scope = form.choice("scope", ("full", "derivatives"))
        form.whole_number("access_version")
        expires_at = form.grant_expiry()
        form.done()
        await consume_proof(request, conn)
        grant = await _insert_grant(conn, str(identifier), user_id, scope, expires_at, "grant")
        await _bump_version(conn, str(identifier))
        await entry(conn, request, "grant.issued", grant["id"], {"compartment_id": str(identifier), "user_id": user_id})
        return Reply(201, grant_json(grant))


async def _grant_for_change(request: Request, conn: asyncpg.Connection) -> tuple[asyncpg.Record, asyncpg.Record]:
    """The grant, its locked compartment, and the caller's authority checked again after that lock."""
    grant_id = request.params["id"]
    if not well_formed(grant_id):
        raise request.not_found(grant_id)
    grant = await conn.fetchrow("SELECT * FROM grants WHERE id = $1", str(grant_id))
    if grant is None:
        raise request.not_found(grant_id)
    compartment = await conn.fetchrow("SELECT * FROM compartments WHERE id = $1 FOR UPDATE", grant["compartment_id"])
    grant = await conn.fetchrow("SELECT * FROM grants WHERE id = $1", str(grant_id))
    standing = await require_grant(request, conn, grant["compartment_id"], grant_id)
    if grant["kind"] == "break_glass":
        raise request.forbidden()
    authorise(request, standing, "manage_grants")
    return grant, compartment


def _is_active(grant: asyncpg.Record) -> bool:
    return grant["state"] == "active" and not grant_past_time(grant)


async def _strands_last_lead(conn: asyncpg.Connection, grant: asyncpg.Record) -> bool:
    holder_role = await conn.fetchval("SELECT role FROM people WHERE id = $1", grant["user_id"])
    if holder_role != "case_lead" or grant["scope"] != "full":
        return False
    other = await conn.fetchval(
        """SELECT 1 FROM grants g JOIN people p ON p.id = g.user_id
           WHERE g.compartment_id = $1 AND g.id <> $2 AND g.kind = 'grant' AND g.state = 'active'
             AND g.scope = 'full' AND g.expires_at IS NULL AND p.role = 'case_lead' LIMIT 1""",
        grant["compartment_id"], grant["id"],
    )
    return other is None


@route("PATCH", "/api/grants/{id}")
async def edit_grant(request: Request) -> Reply:
    body = request.json_body() or {}
    async with DB.tx() as conn:
        grant, compartment = await _grant_for_change(request, conn)
        await require_proof(request, conn)
        form = fields.Form(body)
        _check_version(form, compartment)
        if not _is_active(grant):
            raise ApiError("grant_not_active")
        request.require_body()
        scope = form.choice("scope", ("full", "derivatives"))
        expires_at = form.grant_expiry()
        takes_lead_away = not form.errors and (scope == "derivatives" or expires_at is not None)
        if takes_lead_away and await _strands_last_lead(conn, grant):
            raise ApiError("last_case_lead")
        form.whole_number("access_version")
        form.done()
        await consume_proof(request, conn)
        updated = await conn.fetchrow(
            "UPDATE grants SET scope = $2, expires_at = $3 WHERE id = $1 AND state = 'active' RETURNING *",
            grant["id"], scope, expires_at,
        )
        if updated is None:
            raise ApiError("grant_not_active")
        await _bump_version(conn, grant["compartment_id"])
        await entry(conn, request, "grant.edited", grant["id"],
                    {"compartment_id": grant["compartment_id"], "user_id": grant["user_id"]})
        return Reply(200, grant_json(updated))


@route("POST", "/api/grants/{id}/revoke")
async def revoke_grant(request: Request) -> Reply:
    async with DB.tx() as conn:
        grant, _ = await _grant_for_change(request, conn)
        await require_proof(request, conn)
        if not _is_active(grant):
            raise ApiError("grant_not_active")
        if await _strands_last_lead(conn, grant):
            raise ApiError("last_case_lead")
        request.require_body()
        await consume_proof(request, conn)
        updated = await conn.fetchrow("UPDATE grants SET state = 'revoked' WHERE id = $1 AND state = 'active' RETURNING *", grant["id"])
        if updated is None:
            raise ApiError("grant_not_active")
        await _bump_version(conn, grant["compartment_id"])
        await entry(conn, request, "grant.revoked", grant["id"],
                    {"compartment_id": grant["compartment_id"], "user_id": grant["user_id"]})
        return Reply(200, grant_json(updated))


@route("POST", "/api/users/{id}/sessions/revoke")
async def end_sessions(request: Request) -> Reply:
    person_id = request.params["id"]
    async with DB.tx() as conn:
        if not well_formed(person_id) or not await conn.fetchval("SELECT 1 FROM people WHERE id = $1", str(person_id)):
            raise request.not_found(person_id)
        require_role(request, "end_sessions")
        shared = await conn.fetchval(
            f"""SELECT 1 FROM grants mine JOIN grants theirs ON theirs.compartment_id = mine.compartment_id
                WHERE mine.user_id = $1 AND mine.kind = 'grant' AND mine.scope = 'full'
                  AND {grant_in_force("mine")}
                  AND theirs.user_id = $2 AND {grant_in_force("theirs")} LIMIT 1""",
            request.person.id, str(person_id),
        )
        if not shared:
            raise request.forbidden()
        await require_proof(request, conn)
        request.require_body()
        await consume_proof(request, conn)
        ended = await conn.fetch(
            "UPDATE sessions SET closed_at = now() WHERE user_id = $1 AND closed_at IS NULL RETURNING id", str(person_id)
        )
        await entry(conn, request, "session.revoked", str(person_id), {"revoked": len(ended)})
    return Reply(200, {"revoked": len(ended)})


@route("GET", "/api/directory")
async def directory(request: Request) -> Reply:
    require_role(request, "read_directory")
    async with DB.connection() as conn:
        rows = await conn.fetch("SELECT id, name, role FROM people ORDER BY id")
    return Reply(200, {"people": [dict(r) for r in rows]})


@route("POST", "/api/compartments/{id}/break-glass")
async def open_break_glass(request: Request) -> Reply:
    identifier = request.params["id"]
    person = request.person
    body = request.json_body() or {}
    key = idempotency.key_of(request)
    endpoint = "POST /api/compartments/{id}/break-glass"
    expected = idempotency.fingerprint(str(identifier), body.get("reason"))
    if (replayed := await idempotency.find_replay(request, endpoint, key, expected)) is not None:
        return replayed
    async with DB.tx() as conn:
        compartment = await load_compartment(request, conn, identifier, lock=True)
        standing = await active_grant_on(conn, str(identifier), person.id)
        if not may(request, "open_break_glass"):
            if standing is None:
                raise request.not_found(identifier)
            raise request.forbidden()
        await require_proof(request, conn)
        if standing is not None:
            raise ApiError("break_glass_active" if standing.break_glass else "already_granted")
        await _settle_lapsed(conn, str(identifier), person.id)
        request.require_body()
        form = fields.Form(body)
        reason = form.reason(20)
        if (problem := idempotency.key_error(key)) is not None:
            form.errors["idempotency_key"] = problem
        form.done()
        if (replayed := await idempotency.claim_key(conn, request, endpoint, key, expected)) is not None:
            return replayed
        await consume_proof(request, conn)
        ends_at = fields.now() + dt.timedelta(seconds=CONFIG.break_glass_seconds)
        grant = await _insert_grant(conn, str(identifier), person.id, "full", ends_at, "break_glass")
        owner_email = await conn.fetchval("SELECT email FROM people WHERE id = $1", compartment["owner_id"])
        flattened = _FLATTEN.sub(" ", reason)
        await conn.execute(
            "INSERT INTO mail_outbox (recipient, subject, body) VALUES ($1, $2, $3)",
            owner_email,
            f"Break-glass access opened on {identifier}",
            f"Break-glass access opened.\nActor: {person.name}\nReason: {flattened}\nCompartment: {identifier}\n",
        )
        reply = Reply(201, {
            "id": grant["id"],
            "compartment_id": str(identifier),
            "ends_at": fields.format_time(ends_at),
            "state": "active",
            "notice": "queued" if STATUS.mail_up else "held",
        })
        await idempotency.store_reply(conn, request, endpoint, key, expected, reply)
        await ledger.append(conn, actor_id=person.id, session_id=person.session_id, action="break_glass.opened",
                            target=grant["id"], detail={"compartment_id": str(identifier), "reason": reason})
        return reply


