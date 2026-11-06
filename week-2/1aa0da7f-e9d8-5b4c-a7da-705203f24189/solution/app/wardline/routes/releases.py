"""Releases: assembly, the state machine, separated sign-off, sharing and links."""

from __future__ import annotations

import datetime as dt
import hashlib
from typing import Any

import asyncpg

from wardline import fields, ledger
from wardline.access import (
    ActiveGrant,
    authorise,
    entry,
    grant_in_force,
    link_in_force,
    load_compartment,
    require_grant,
    require_role,
    well_formed,
)
from wardline.auth import consume_proof, digest_token, new_token, require_proof
from wardline.db import DB, next_id
from wardline.errors import ApiError, illegal
from wardline.s3 import STORAGE
from wardline.states import (
    SUPERSEDED_SQL,
    WRITABLE,
    is_superseded,
    release_transition,
    require_assembling,
)
from wardline.web import Person, Reply, Request, route
from wardline.workers import STATUS

ITEM_ORDER = "length(i.id), i.id"
ITEMS_SQL = f"""SELECT i.id, i.derivative_id, i.label, d.size, d.sha256, d.object_key, d.exhibit_id,
                    {SUPERSEDED_SQL} AS superseded
             FROM release_items i JOIN derivatives d ON d.id = i.derivative_id JOIN exhibits e ON e.id = d.exhibit_id
             WHERE i.release_id = $1 ORDER BY {ITEM_ORDER}"""


def manifest_digest(items: list[asyncpg.Record]) -> str:
    rows = [{"derivative_id": i["derivative_id"], "label": i["label"], "sha256": i["sha256"]} for i in items]
    return hashlib.sha256(ledger.canonical_json(rows).encode()).hexdigest()


async def _opened_by(conn: asyncpg.Connection, person_id: str, derivative_ids: list[str]) -> set[str]:
    rows = await conn.fetch(
        """SELECT DISTINCT derivative_id FROM download_grants
           WHERE issued_by = $1 AND derivative_id = ANY($2::text[]) AND claimed_at IS NOT NULL""",
        person_id, derivative_ids,
    )
    return {r["derivative_id"] for r in rows}


async def release_json(conn: asyncpg.Connection, row: asyncpg.Record, person: Person, notice: str | None = None) -> dict[str, Any]:
    items = await conn.fetch(ITEMS_SQL, row["id"])
    opened = await _opened_by(conn, person.id, [i["derivative_id"] for i in items])
    contributors = await conn.fetch("SELECT user_id FROM release_contributors WHERE release_id = $1 ORDER BY user_id", row["id"])
    body: dict[str, Any] = {
        "id": row["id"],
        "compartment_id": row["compartment_id"],
        "name": row["name"],
        "matter_ref": row["matter_ref"],
        "recipient_kind": row["recipient_kind"],
        "state": row["state"],
        "assembler_id": row["assembler_id"],
        "contributor_ids": [c["user_id"] for c in contributors],
        "manifest_digest": manifest_digest(items),
        "items": [
            {
                "id": i["id"],
                "derivative_id": i["derivative_id"],
                "label": i["label"],
                "size": i["size"],
                "superseded": i["superseded"],
                "opened_by_caller": i["derivative_id"] in opened,
            }
            for i in items
        ],
        "total_bytes": sum(i["size"] for i in items),
        "rejection_reason": row["rejection_reason"],
    }
    if notice is not None:
        body["notice"] = notice
    return body


async def _load_release(request: Request, conn: asyncpg.Connection, *, lock: bool = False) -> tuple[asyncpg.Record, ActiveGrant]:
    identifier = request.params["id"]
    if not well_formed(identifier):
        raise request.not_found(identifier)
    suffix = " FOR UPDATE" if lock else ""
    row = await conn.fetchrow(f"SELECT * FROM releases WHERE id = $1{suffix}", str(identifier))
    if row is None:
        raise request.not_found(identifier)
    return row, await require_grant(request, conn, row["compartment_id"], identifier)


async def _worked_on(conn: asyncpg.Connection, row: asyncpg.Record, person_id: str) -> bool:
    """Separation of duties: the assembler, or anyone who ever added an item, rendered it or saved its marks."""
    if row["assembler_id"] == person_id:
        return True
    return bool(await conn.fetchval(
        "SELECT 1 FROM release_contributors WHERE release_id = $1 AND user_id = $2", row["id"], person_id
    ))


def _first_superseded(items: list[asyncpg.Record]) -> str | None:
    return next((i["derivative_id"] for i in items if i["superseded"]), None)


def _reject_superseded(items: list[asyncpg.Record]) -> None:
    derivative = _first_superseded(items)
    if derivative is not None:
        raise ApiError("derivative_superseded", derivative_id=derivative)


@route("GET", "/api/reviews")
async def review_queue(request: Request) -> Reply:
    person = request.person
    require_role(request, "read_review_queue")
    async with DB.connection() as conn:
        rows = await conn.fetch(
            f"""SELECT r.* FROM releases r WHERE r.state = 'submitted' AND r.compartment_id IN (
                 SELECT compartment_id FROM grants WHERE user_id = $1 AND kind = 'grant' AND scope = 'full'
                   AND {grant_in_force()})
               ORDER BY length(r.id), r.id""",
            person.id,
        )
        return Reply(200, {"releases": [await release_json(conn, r, person) for r in rows]})


@route("POST", "/api/compartments/{id}/releases")
async def create_release(request: Request) -> Reply:
    identifier = request.params["id"]
    async with DB.tx() as conn:
        await load_compartment(request, conn, identifier)
        standing = await require_grant(request, conn, str(identifier), identifier)
        authorise(request, standing, "work_release")
        form = fields.Form(request.require_body())
        name = form.text("name", 200)
        matter = form.text("matter_ref", 200)
        kind = form.choice("recipient_kind", ("counsel", "requester"))
        form.done()
        release_id = await next_id(conn, "REL", "releases_seq")
        row = await conn.fetchrow(
            """INSERT INTO releases (id, compartment_id, name, matter_ref, recipient_kind, state, assembler_id)
               VALUES ($1, $2, $3, $4, $5, 'assembling', $6) RETURNING *""",
            release_id, str(identifier), name, matter, kind, request.person.id,
        )
        body = await release_json(conn, row, request.person)
        await entry(conn, request, "release.created", release_id)
        return Reply(201, body)


@route("GET", "/api/compartments/{id}/releases")
async def list_releases(request: Request) -> Reply:
    identifier = request.params["id"]
    async with DB.connection() as conn:
        await load_compartment(request, conn, identifier)
        await require_grant(request, conn, str(identifier), identifier)
        rows = await conn.fetch("SELECT * FROM releases r WHERE compartment_id = $1 ORDER BY length(id), id", str(identifier))
        return Reply(200, {"releases": [await release_json(conn, r, request.person) for r in rows]})


@route("GET", "/api/releases/{id}")
async def read_release(request: Request) -> Reply:
    async with DB.connection() as conn:
        row, _ = await _load_release(request, conn)
        return Reply(200, await release_json(conn, row, request.person))


@route("POST", "/api/releases/{id}/items")
async def add_item(request: Request) -> Reply:
    body = request.json_body() or {}
    derivative_id = body.get("derivative_id")
    usable_id = isinstance(derivative_id, str) and bool(derivative_id.strip(fields.TRIM))
    async with DB.tx() as conn:
        row, standing = await _load_release(request, conn, lock=True)
        derivative = None
        if usable_id:
            if well_formed(derivative_id):
                derivative = await conn.fetchrow(
                    "SELECT * FROM derivatives WHERE id = $1 AND compartment_id = $2", derivative_id, row["compartment_id"]
                )
            if derivative is None:
                raise request.not_found(derivative_id)
        authorise(request, standing, "work_release")
        require_assembling(row["state"])
        if derivative is not None:
            exhibit = await conn.fetchrow(
                "SELECT state, marks_version FROM exhibits WHERE id = $1 FOR UPDATE", derivative["exhibit_id"]
            )
            if exhibit["state"] not in WRITABLE:
                raise ApiError("exhibit_not_cleared", state=exhibit["state"])
            if is_superseded(derivative["marks_version"], exhibit["marks_version"]):
                raise ApiError("derivative_superseded", derivative_id=derivative["id"])
        form = fields.Form(request.require_body())
        if not usable_id:
            form.errors["derivative_id"] = fields.REQUIRED
        label = form.text("label", 120)
        form.done()
        item_id = await next_id(conn, "ITM", "release_items_seq")
        await conn.execute(
            "INSERT INTO release_items (id, release_id, derivative_id, label) VALUES ($1, $2, $3, $4)",
            item_id, row["id"], derivative["id"], label,
        )
        people = {request.person.id, derivative["created_by"], derivative["marks_saved_by"]} - {None}
        await conn.executemany(
            "INSERT INTO release_contributors (release_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [(row["id"], person) for person in sorted(people)],
        )
        reply = await release_json(conn, row, request.person)
        await entry(conn, request, "release.item_added", row["id"], {
            "item_id": item_id, "derivative_id": derivative["id"], "exhibit_id": derivative["exhibit_id"],
        })
        return Reply(201, reply)


@route("DELETE", "/api/releases/{id}/items/{item_id}")
async def remove_item(request: Request) -> Reply:
    item_param = request.params["item_id"]
    async with DB.tx() as conn:
        row, standing = await _load_release(request, conn, lock=True)
        item = None
        if well_formed(item_param):
            item = await conn.fetchrow(
                """SELECT i.id, i.derivative_id, d.exhibit_id FROM release_items i JOIN derivatives d ON d.id = i.derivative_id
                   WHERE i.id = $1 AND i.release_id = $2""",
                str(item_param), row["id"],
            )
        if item is None:
            raise request.not_found(item_param)
        authorise(request, standing, "work_release")
        require_assembling(row["state"])
        await conn.execute("DELETE FROM release_items WHERE id = $1", item["id"])
        reply = await release_json(conn, row, request.person)
        await entry(conn, request, "release.item_removed", row["id"], {
            "item_id": item["id"], "derivative_id": item["derivative_id"], "exhibit_id": item["exhibit_id"],
        })
        return Reply(200, reply)


async def _set_state(conn: asyncpg.Connection, release_id: str, state: str, reason: str | None = None) -> asyncpg.Record:
    return await conn.fetchrow(
        "UPDATE releases SET state = $2, rejection_reason = coalesce($3, rejection_reason) WHERE id = $1 RETURNING *",
        release_id, state, reason,
    )


@route("POST", "/api/releases/{id}/submit")
async def submit_release(request: Request) -> Reply:
    async with DB.tx() as conn:
        row, standing = await _load_release(request, conn, lock=True)
        authorise(request, standing, "work_release")
        if not await _worked_on(conn, row, request.person.id):
            raise request.forbidden()
        await require_proof(request, conn)
        produces = release_transition(row["state"], "submit")
        items = await conn.fetch(ITEMS_SQL, row["id"])
        if not items:
            raise ApiError("release_empty")
        _reject_superseded(items)
        request.require_body()
        await consume_proof(request, conn)
        updated = await _set_state(conn, row["id"], produces)
        reply = await release_json(conn, updated, request.person)
        await entry(conn, request, "release.submitted", row["id"])
        return Reply(200, reply)


async def _queue_decision_notice(conn: asyncpg.Connection, row: asyncpg.Record, reviewer: Person, words: str) -> str:
    recipient = await conn.fetchval("SELECT email FROM people WHERE id = $1", row["assembler_id"])
    await conn.execute(
        "INSERT INTO mail_outbox (recipient, subject, body) VALUES ($1, $2, $3)",
        recipient,
        f"Release {row['id']} {words}",
        f"Release {row['id']} was {words} by {reviewer.name}.\nOpen Wardline to read the decision.\n",
    )
    return "queued" if STATUS.mail_up else "held"


async def _decision_checks(request: Request, conn: asyncpg.Connection, action: str) -> tuple[asyncpg.Record, list[asyncpg.Record], str]:
    row, standing = await _load_release(request, conn, lock=True)
    authorise(request, standing, action)
    if await _worked_on(conn, row, request.person.id):
        raise request.separation()
    await require_proof(request, conn)
    produces = release_transition(row["state"], action)
    return row, await conn.fetch(ITEMS_SQL, row["id"]), produces


@route("POST", "/api/releases/{id}/sign-off")
async def sign_off(request: Request) -> Reply:
    body = request.json_body() or {}
    async with DB.tx() as conn:
        row, items, produces = await _decision_checks(request, conn, "sign_off")
        current = manifest_digest(items)
        sent = body.get("manifest_digest")
        if isinstance(sent, str) and sent.strip(fields.TRIM) and sent != current:
            raise ApiError("release_changed", manifest_digest=current)
        _reject_superseded(items)
        opened = await _opened_by(conn, request.person.id, [i["derivative_id"] for i in items])
        unopened = [i["id"] for i in items if i["derivative_id"] not in opened]
        if unopened:
            raise ApiError("items_unopened", item_ids=unopened)
        form = fields.Form(request.require_body())
        if not isinstance(sent, str) or not sent.strip(fields.TRIM):
            form.errors["manifest_digest"] = fields.REQUIRED
        form.done()
        await consume_proof(request, conn)
        updated = await _set_state(conn, row["id"], produces)
        notice = await _queue_decision_notice(conn, row, request.person, "signed off")
        reply = await release_json(conn, updated, request.person, notice)
        await entry(conn, request, "release.signed_off", row["id"], {
            "manifest_digest": current, "opened_items": [i["id"] for i in items],
        })
        return Reply(200, reply)


@route("POST", "/api/releases/{id}/reject")
async def reject_release(request: Request) -> Reply:
    async with DB.tx() as conn:
        row, _, produces = await _decision_checks(request, conn, "reject")
        form = fields.Form(request.require_body())
        reason = form.reason()
        form.done()
        await consume_proof(request, conn)
        updated = await _set_state(conn, row["id"], produces, reason)
        notice = await _queue_decision_notice(conn, row, request.person, "rejected")
        reply = await release_json(conn, updated, request.person, notice)
        await entry(conn, request, "release.rejected", row["id"], {"reason": reason})
        return Reply(200, reply)


@route("POST", "/api/releases/{id}/reopen")
async def reopen_release(request: Request) -> Reply:
    async with DB.tx() as conn:
        row, standing = await _load_release(request, conn, lock=True)
        authorise(request, standing, "work_release")
        if row["assembler_id"] != request.person.id:
            raise request.forbidden()
        produces = release_transition(row["state"], "reopen")
        request.require_body()
        updated = await _set_state(conn, row["id"], produces)
        reply = await release_json(conn, updated, request.person)
        await entry(conn, request, "release.reopened", row["id"])
        return Reply(200, reply)


async def _confirm_objects(items: list[asyncpg.Record]) -> None:
    """Every item's object present in storage at its recorded size, before anything commits."""
    for item in items:
        if await STORAGE.size_of(item["object_key"]) != item["size"]:
            raise ApiError("derivative_missing")


async def _issue_link(conn: asyncpg.Connection, release_id: str, expires_at: dt.datetime) -> tuple[str, str]:
    link_id = await next_id(conn, "LNK", "links_seq")
    token = new_token()
    await conn.execute(
        "INSERT INTO links (id, release_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
        link_id, release_id, digest_token(token), expires_at,
    )
    return link_id, token


def _link_reply(release_id: str, link_id: str, token: str, expires_at: dt.datetime) -> Reply:
    return Reply(201, {
        "release_id": release_id, "state": "shared", "link_id": link_id, "token": token,
        "url": f"/l/{token}", "expires_at": fields.format_time(expires_at),
    })


async def _link_checks(request: Request, action: str) -> tuple[asyncpg.Record, dt.datetime]:
    """Everything before a share or regenerate commits: role, proof, state, stored objects, then the lapse time."""
    async with DB.connection() as conn:
        row, standing = await _load_release(request, conn)
        authorise(request, standing, "share")
        await require_proof(request, conn)
        release_transition(row["state"], action)
        items = await conn.fetch(ITEMS_SQL, row["id"])
    _reject_superseded(items)
    await _confirm_objects(items)
    form = fields.Form(request.require_body())
    expires_at = form.link_expiry()
    form.done()
    return row, expires_at


@route("POST", "/api/releases/{id}/share")
async def share_release(request: Request) -> Reply:
    row, expires_at = await _link_checks(request, "share")
    async with DB.tx() as conn:
        current, standing = await _load_release(request, conn, lock=True)
        authorise(request, standing, "share")
        produces = release_transition(current["state"], "share")
        _reject_superseded(await conn.fetch(ITEMS_SQL, row["id"]))
        await consume_proof(request, conn)
        await _set_state(conn, row["id"], produces)
        link_id, token = await _issue_link(conn, row["id"], expires_at)
        await entry(conn, request, "release.shared", row["id"], {"link_id": link_id})
    return _link_reply(row["id"], link_id, token, expires_at)


@route("POST", "/api/releases/{id}/link/regenerate")
async def regenerate_link(request: Request) -> Reply:
    row, expires_at = await _link_checks(request, "regenerate_link")
    async with DB.tx() as conn:
        current, standing = await _load_release(request, conn, lock=True)
        authorise(request, standing, "share")
        release_transition(current["state"], "regenerate_link")
        _reject_superseded(await conn.fetch(ITEMS_SQL, row["id"]))
        await consume_proof(request, conn)
        await conn.execute("UPDATE links SET active = false WHERE release_id = $1 AND active", row["id"])
        link_id, token = await _issue_link(conn, row["id"], expires_at)
        await entry(conn, request, "link.regenerated", row["id"], {"link_id": link_id})
    return _link_reply(row["id"], link_id, token, expires_at)


@route("POST", "/api/releases/{id}/link/revoke")
async def revoke_link(request: Request) -> Reply:
    async with DB.tx() as conn:
        row, standing = await _load_release(request, conn, lock=True)
        authorise(request, standing, "share")
        await require_proof(request, conn)
        link_id = await conn.fetchval(
            f"SELECT l.id FROM links l JOIN releases r ON r.id = l.release_id WHERE l.release_id = $1 AND {link_in_force()}",
            row["id"],
        )
        if link_id is None:
            raise illegal(row["state"], "shared")
        request.require_body()
        await consume_proof(request, conn)
        await conn.execute("UPDATE links SET active = false WHERE id = $1", link_id)
        await entry(conn, request, "link.revoked", row["id"], {"link_id": link_id})
    return Reply(200, {"link_id": link_id, "state": "revoked"})


@route("POST", "/api/releases/{id}/withdraw")
async def withdraw_release(request: Request) -> Reply:
    async with DB.tx() as conn:
        row, standing = await _load_release(request, conn, lock=True)
        authorise(request, standing, "withdraw")
        await require_proof(request, conn)
        produces = release_transition(row["state"], "withdraw")
        request.require_body()
        await consume_proof(request, conn)
        await conn.execute("UPDATE links SET active = false WHERE release_id = $1 AND active", row["id"])
        updated = await _set_state(conn, row["id"], produces)
        reply = await release_json(conn, updated, request.person)
        await entry(conn, request, "release.withdrawn", row["id"])
        return Reply(200, reply)
