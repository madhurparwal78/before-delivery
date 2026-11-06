"""Exhibit registration, states, clearance, holds and disposal."""

from __future__ import annotations

import asyncio
import hashlib
import re
import tempfile
from typing import Any

import asyncpg
from python_multipart.exceptions import MultipartParseError
from python_multipart.multipart import MultipartParser

from wardline import fields, idempotency, ledger, media
from wardline.access import (
    authorise,
    authorise_disposal,
    entry,
    load_compartment,
    require_grant,
    well_formed,
)
from wardline.auth import consume_proof, require_proof, touch_session
from wardline.db import DB, next_id
from wardline.errors import ApiError, ClientGone, StorageUnavailable, ValidationFailed
from wardline.s3 import STORAGE, fresh_key
from wardline.states import exhibit_transition
from wardline.web import MAX_FILE, MAX_MULTIPART, Reply, Request, route

FIELD_CAP = 16_384
TOUCH_EVERY = 3.0
NOT_ACCEPTED = "This file type is not accepted."
BAD_NAME = "This file name is not accepted."
TYPE_MISMATCH = "The declared type does not match the file."
DIGEST_DIFFERS = "The file does not match the submitted digest."
_BOUNDARY = re.compile(r'boundary=(?:"([^"]+)"|([^\s;]+))', re.IGNORECASE)
_DISPOSITION_NAME = re.compile(r'[;\s]name="?([^";]*)"?', re.IGNORECASE)
_DISPOSITION_FILE = re.compile(r'filename="((?:[^"\\]|\\.)*)"|filename=([^;\s]+)', re.IGNORECASE)
REGISTER_ENDPOINT = "POST /api/compartments/{id}/exhibits"


async def holds_of(conn: asyncpg.Connection, exhibit_id: str) -> list[dict[str, str]]:
    rows = await conn.fetch("SELECT id, matter_ref, placed_by FROM holds WHERE exhibit_id = $1 AND active ORDER BY id", exhibit_id)
    return [dict(r) for r in rows]


def exhibit_json(row: asyncpg.Record, holds: list[dict[str, str]], full_scope: bool) -> dict[str, Any]:
    return {
        "id": row["id"],
        "compartment_id": row["compartment_id"],
        "name": row["name"],
        "state": row["state"],
        "sealed": True,
        "sha256": row["sha256"],
        "size": row["size"],
        "sniffed_type": row["sniffed_type"],
        "page_count": row["page_count"],
        "registered_by": row["registered_by"],
        "marks_version": row["marks_version"],
        "seal_check": row["seal_check"],
        "disposal_proposed_by": row["disposal_proposed_by"],
        "holds": holds,
        "provenance": {
            "source": row["source"],
            "collected_by": row["collected_by"],
            "collected_on": row["collected_on"],
            "capture_notes": row["capture_notes"],
        } if full_scope else None,
    }


async def load_exhibit(request: Request, conn: asyncpg.Connection, *, lock: bool = False) -> asyncpg.Record:
    identifier = request.params["id"]
    if not well_formed(identifier):
        raise request.not_found(identifier)
    suffix = " FOR UPDATE" if lock else ""
    row = await conn.fetchrow(f"SELECT * FROM exhibits WHERE id = $1{suffix}", str(identifier))
    if row is None:
        raise request.not_found(identifier)
    return row


async def _reply_exhibit(conn: asyncpg.Connection, exhibit_id: str, status: int = 200) -> Reply:
    row = await conn.fetchrow("SELECT * FROM exhibits WHERE id = $1", exhibit_id)
    return Reply(status, exhibit_json(row, await holds_of(conn, exhibit_id), True))


class Upload:
    """A multipart registration, spooled to a private temporary file with its digest kept as it arrives."""

    def __init__(self, request: Request, spool: Any) -> None:
        self.request, self.spool = request, spool
        self.values: dict[str, str] = {}
        self.has_file = False
        self.filename: str | None = None
        self.size = 0
        self.head = b""
        self.digest = hashlib.sha256()
        self._name: str | None = None
        self._is_file = False
        self._value = bytearray()
        self._field = bytearray()
        self._header_value = bytearray()
        self.finished = False

    def _on_header_end(self) -> None:
        if self._field.lower() == b"content-disposition":
            text = self._header_value.decode("utf-8", "replace")
            name = _DISPOSITION_NAME.search(text)
            self._name = name.group(1) if name else None
            found = _DISPOSITION_FILE.search(text)
            self._is_file = self._name == "file"
            if self._is_file and found:
                raw = found.group(1) if found.group(1) is not None else found.group(2)
                self.filename = raw.replace('\\"', '"').replace("\\\\", "\\")
        self._field.clear()
        self._header_value.clear()

    def _on_data(self, data: bytes, start: int, end: int) -> None:
        piece = data[start:end]
        if self._is_file:
            self.has_file = True
            self.size += len(piece)
            if self.size <= MAX_FILE:
                self.digest.update(piece)
                self.spool.write(piece)
                if len(self.head) < 16:
                    self.head += piece[: 16 - len(self.head)]
        elif len(self._value) < FIELD_CAP:
            self._value += piece[: FIELD_CAP - len(self._value)]

    def _on_part_end(self) -> None:
        if not self._is_file and self._name and self._name not in self.values:
            self.values[self._name] = self._value.decode("utf-8", "surrogateescape")
        self._value.clear()
        self._name, self._is_file = None, False

    def _on_end(self) -> None:
        self.finished = True

    async def read(self) -> bool:
        """Read the whole body. Returns False when it cannot be parsed."""
        match = _BOUNDARY.search(self.request.headers.get("content-type", ""))
        parseable = match is not None
        parser = None
        if parseable:
            boundary = (match.group(1) or match.group(2)).encode("latin-1")
            parser = MultipartParser(boundary, {
                "on_part_data": self._on_data,
                "on_part_end": self._on_part_end,
                "on_header_field": lambda d, s, e: self._field.extend(d[s:e]),
                "on_header_value": lambda d, s, e: self._header_value.extend(d[s:e]),
                "on_header_end": self._on_header_end,
                "on_end": self._on_end,
            })
        touched = asyncio.get_running_loop().time()
        total = 0
        while True:
            message = await self.request.next_message()
            chunk = message.get("body", b"")
            total += len(chunk)
            if parseable and chunk:
                try:
                    parser.write(chunk)
                except MultipartParseError:
                    parseable = False
            now_ = asyncio.get_running_loop().time()
            if now_ - touched >= TOUCH_EVERY:
                touched = now_
                await touch_session(self.request.person)
            if not message.get("more_body"):
                break
            if total > MAX_MULTIPART:
                raise ApiError("file_too_large", max_bytes=MAX_FILE)
        if self.size > MAX_FILE:
            raise ApiError("file_too_large", max_bytes=MAX_FILE)
        return parseable and self.finished


def _file_error(upload: Upload, declared: str | None, submitted: str | None) -> str | None:
    """The upload checks, in their published order."""
    name = upload.filename
    if name is not None and ("/" in name or "\\" in name or ".." in name or any(ord(c) < 0x20 or ord(c) == 0x7F for c in name)):
        return BAD_NAME
    sniffed = media.sniff(upload.head)
    if (declared is not None and declared not in media.ACCEPTED) or sniffed is None:
        return NOT_ACCEPTED
    if declared is not None and sniffed != declared:
        return TYPE_MISMATCH
    if submitted and submitted != upload.digest.hexdigest():
        return DIGEST_DIFFERS
    return None


def _validate_registration(upload: Upload, key: str | None) -> tuple[dict[str, Any], str]:
    form = fields.Form(upload.values)
    clean: dict[str, Any] = {
        "name": form.text("name", 200),
        "source": form.text("source", 500),
        "collected_by": form.text("collected_by", 200),
    }
    collected_on = upload.values.get("collected_on")
    if (problem := fields.collected_on_error(collected_on)) is not None:
        form.errors["collected_on"] = problem
    else:
        clean["collected_on"] = collected_on.strip(fields.TRIM)
    notes = upload.values.get("capture_notes", "").strip(fields.TRIM)
    if fields.unstorable(notes):
        form.errors["capture_notes"] = fields.UNSTORABLE
    elif len(notes) > 2000:
        form.errors["capture_notes"] = fields.over_length(2000)
    clean["capture_notes"] = notes or None
    declared = upload.values.get("declared_type", "").strip(fields.TRIM)
    if not declared:
        form.errors["declared_type"] = fields.REQUIRED
    submitted = upload.values.get("submitted_sha256", "").strip(fields.TRIM)
    if not upload.has_file:
        form.errors["file"] = fields.REQUIRED
    elif (problem := _file_error(upload, declared or None, submitted)) is not None:
        form.errors["file"] = problem
    if (problem := idempotency.key_error(key)) is not None:
        form.errors["idempotency_key"] = problem
    form.done()
    return clean, declared


def _fingerprint(compartment_id: str, upload: Upload) -> str:
    return idempotency.fingerprint(compartment_id, sorted(
        (k, v.strip(fields.TRIM)) for k, v in upload.values.items()
    ), upload.digest.hexdigest())


@route("POST", "/api/compartments/{id}/exhibits", body="multipart")
async def register_exhibit(request: Request) -> Reply:
    identifier = request.params["id"]
    person = request.person
    key = idempotency.key_of(request)
    with tempfile.NamedTemporaryFile(prefix="wardline-") as spool:
        upload = Upload(request, spool)
        parsed = await upload.read()
        spool.flush()
        await touch_session(person)
        expected = _fingerprint(str(identifier), upload)
        if (replayed := await idempotency.find_replay(request, REGISTER_ENDPOINT, key, expected)) is not None:
            return replayed
        async with DB.connection() as conn:
            await load_compartment(request, conn, identifier)
            standing = await require_grant(request, conn, str(identifier), identifier)
            authorise(request, standing, "register")
        if not parsed:
            raise ValidationFailed({"body": fields.BODY})
        clean, declared = _validate_registration(upload, key)
        page_count, over_limits = (None, False)
        if declared in media.IMAGE_TYPES or declared == "application/pdf":
            page_count, over_limits = await media.POOL.run(media.inspect, spool.name, declared)
        object_key = fresh_key("originals")
        sha256 = upload.digest.hexdigest()
        client_left = asyncio.ensure_future(request.client_left())
        try:
            await STORAGE.put_file(object_key, spool, upload.size)
            if await STORAGE.digest_of(object_key) != (sha256, upload.size):
                raise StorageUnavailable("stored object does not match what was sent")
            if client_left.done():
                raise ClientGone
            async with DB.tx() as conn:
                if (replayed := await idempotency.claim_key(conn, request, REGISTER_ENDPOINT, key, expected)) is not None:
                    raise _AlreadyRegistered(replayed)
                authorise(request, await require_grant(request, conn, str(identifier), identifier), "register")
                exhibit_id = await next_id(conn, "EX", "exhibits_seq")
                await conn.execute(
                    """INSERT INTO exhibits (id, compartment_id, name, state, sha256, size, sniffed_type, page_count,
                         over_render_limits, registered_by, object_key, source, collected_by, collected_on, capture_notes)
                       VALUES ($1, $2, $3, 'quarantined', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)""",
                    exhibit_id, str(identifier), clean["name"], sha256, upload.size, declared, page_count, over_limits,
                    person.id, object_key, clean["source"], clean["collected_by"], clean["collected_on"], clean["capture_notes"],
                )
                reply = Reply(201, {
                    "id": exhibit_id, "compartment_id": str(identifier), "state": "quarantined", "sealed": True,
                    "sha256": sha256, "size": upload.size, "sniffed_type": declared,
                })
                await idempotency.store_reply(conn, request, REGISTER_ENDPOINT, key, expected, reply)
                await entry(conn, request, "exhibit.sealed", exhibit_id, {"sha256": sha256, "size": upload.size})
        except _AlreadyRegistered as lost:
            await remove_object(object_key)
            return lost.reply
        except BaseException:
            await remove_object(object_key)
            raise
        finally:
            client_left.cancel()
    return reply


class _AlreadyRegistered(Exception):
    def __init__(self, reply: Reply) -> None:
        super().__init__("replay")
        self.reply = reply


async def remove_object(object_key: str) -> None:
    """Shielded, so a dropped connection still leaves nothing in the bucket."""
    try:
        await asyncio.shield(STORAGE.delete(object_key))
    except StorageUnavailable:
        pass


@route("GET", "/api/compartments/{id}/exhibits")
async def list_exhibits(request: Request) -> Reply:
    identifier = request.params["id"]
    state = request.query.get("state")
    async with DB.connection() as conn:
        await load_compartment(request, conn, identifier)
        standing = await require_grant(request, conn, str(identifier), identifier)
        if state is not None and fields.unstorable(state):
            return Reply(200, {"exhibits": []})
        rows = await conn.fetch(
            """SELECT * FROM exhibits WHERE compartment_id = $1 AND ($2::text IS NULL OR state = $2)
               ORDER BY length(id), id""",
            str(identifier), state or None,
        )
        holds = await conn.fetch(
            "SELECT id, exhibit_id, matter_ref, placed_by FROM holds WHERE active AND exhibit_id = ANY($1::text[]) ORDER BY id",
            [r["id"] for r in rows],
        )
    by_exhibit: dict[str, list] = {}
    for hold in holds:
        by_exhibit.setdefault(hold["exhibit_id"], []).append(
            {"id": hold["id"], "matter_ref": hold["matter_ref"], "placed_by": hold["placed_by"]}
        )
    return Reply(200, {"exhibits": [exhibit_json(r, by_exhibit.get(r["id"], []), standing.scope == "full") for r in rows]})


@route("GET", "/api/exhibits/{id}")
async def read_exhibit(request: Request) -> Reply:
    identifier = request.params["id"]
    async with DB.connection() as conn:
        row = await load_exhibit(request, conn)
        standing = await require_grant(request, conn, row["compartment_id"], identifier)
        return Reply(200, exhibit_json(row, await holds_of(conn, row["id"]), standing.scope == "full"))


def _require_second_officer(request: Request, row: asyncpg.Record) -> None:
    if row["registered_by"] == request.person.id:
        raise request.separation()


@route("POST", "/api/exhibits/{id}/clear")
async def clear_exhibit(request: Request) -> Reply:
    identifier = request.params["id"]
    async with DB.tx() as conn:
        row = await load_exhibit(request, conn)
        standing = await require_grant(request, conn, row["compartment_id"], identifier)
        authorise(request, standing, "clear")
        _require_second_officer(request, row)
        await require_proof(request, conn)
        exhibit_transition(row["state"], "clear")
        request.require_body()
    found = await STORAGE.digest_of(row["object_key"])
    if found != (row["sha256"], row["size"]):
        await _record_seal_failure(request, row, found)
        raise ApiError("seal_mismatch", sha256=row["sha256"])
    async with DB.tx() as conn:
        current = await conn.fetchrow("SELECT state FROM exhibits WHERE id = $1 FOR UPDATE", row["id"])
        authorise(request, await require_grant(request, conn, row["compartment_id"], identifier), "clear")
        produces = exhibit_transition(current["state"], "clear")
        await consume_proof(request, conn)
        await conn.execute("UPDATE exhibits SET state = $2, seal_check = NULL WHERE id = $1", row["id"], produces)
        reply = await _reply_exhibit(conn, row["id"])
        await entry(conn, request, "exhibit.cleared", row["id"])
        return reply


async def _record_seal_failure(request: Request, row: asyncpg.Record, found: tuple[str, int] | None) -> None:
    async with DB.tx() as conn:
        current = await conn.fetchval("SELECT state FROM exhibits WHERE id = $1 FOR UPDATE", row["id"])
        exhibit_transition(current, "clear")
        await conn.execute("UPDATE exhibits SET seal_check = 'failed' WHERE id = $1", row["id"])
        await ledger.raise_signal(conn, "seal_mismatch", row["id"])
        await entry(conn, request, "exhibit.seal_failed", row["id"], {
            "sealed_sha256": row["sha256"],
            "sealed_size": row["size"],
            "found_sha256": found[0] if found else None,
            "found_size": found[1] if found else None,
        })


@route("POST", "/api/exhibits/{id}/refuse")
async def refuse_exhibit(request: Request) -> Reply:
    identifier = request.params["id"]
    async with DB.tx() as conn:
        row = await load_exhibit(request, conn, lock=True)
        standing = await require_grant(request, conn, row["compartment_id"], identifier)
        authorise(request, standing, "refuse")
        _require_second_officer(request, row)
        await require_proof(request, conn)
        produces = exhibit_transition(row["state"], "refuse")
        form = fields.Form(request.require_body())
        reason = form.reason()
        form.done()
        await consume_proof(request, conn)
        await conn.execute("UPDATE exhibits SET state = $2 WHERE id = $1", row["id"], produces)
        reply = await _reply_exhibit(conn, row["id"])
        await entry(conn, request, "exhibit.refused", row["id"], {"reason": reason})
        return reply


@route("POST", "/api/exhibits/{id}/hold")
async def place_hold(request: Request) -> Reply:
    identifier = request.params["id"]
    body = request.json_body() or {}
    async with DB.tx() as conn:
        row = await load_exhibit(request, conn, lock=True)
        standing = await require_grant(request, conn, row["compartment_id"], identifier)
        authorise(request, standing, "hold")
        await require_proof(request, conn)
        produces = exhibit_transition(row["state"], "hold")
        requested = body.get("matter_ref")
        if isinstance(requested, str) and requested.strip(fields.TRIM) and not fields.unstorable(requested):
            exists = await conn.fetchval(
                "SELECT 1 FROM holds WHERE exhibit_id = $1 AND matter_ref = $2 AND active", row["id"], requested.strip(fields.TRIM)
            )
            if exists:
                raise ApiError("hold_exists")
        form = fields.Form(request.require_body())
        reason = form.reason()
        matter = form.text("matter_ref", 200)
        form.done()
        await consume_proof(request, conn)
        hold_id = await next_id(conn, "HLD", "holds_seq")
        await conn.execute(
            "INSERT INTO holds (id, exhibit_id, matter_ref, reason, placed_by) VALUES ($1, $2, $3, $4, $5)",
            hold_id, row["id"], matter, reason, request.person.id,
        )
        await conn.execute("UPDATE exhibits SET state = $2, disposal_proposed_by = NULL WHERE id = $1", row["id"], produces)
        reply = await _reply_exhibit(conn, row["id"])
        if row["state"] == "disposal proposed":
            await entry(conn, request, "disposal.cancelled", row["id"], {"reason": reason})
        await entry(conn, request, "hold.placed", row["id"], {"hold_id": hold_id, "matter_ref": matter, "reason": reason})
        return reply


@route("POST", "/api/exhibits/{id}/lift-hold")
async def lift_hold(request: Request) -> Reply:
    identifier = request.params["id"]
    body = request.json_body() or {}
    hold_id = body.get("hold_id")
    async with DB.tx() as conn:
        row = await load_exhibit(request, conn, lock=True)
        standing = await require_grant(request, conn, row["compartment_id"], identifier)
        hold = None
        if isinstance(hold_id, str) and hold_id.strip(fields.TRIM):
            if well_formed(hold_id):
                hold = await conn.fetchrow("SELECT * FROM holds WHERE id = $1 AND exhibit_id = $2 AND active", hold_id, row["id"])
            if hold is None:
                raise request.not_found(hold_id)
        authorise(request, standing, "lift_hold")
        await require_proof(request, conn)
        form = fields.Form(request.require_body())
        if hold is None:
            form.errors["hold_id"] = fields.REQUIRED
        reason = form.reason()
        form.done()
        await consume_proof(request, conn)
        await conn.execute("UPDATE holds SET active = false WHERE id = $1", hold["id"])
        remaining = await conn.fetchval("SELECT count(*) FROM holds WHERE exhibit_id = $1 AND active", row["id"])
        if remaining == 0:
            await conn.execute("UPDATE exhibits SET state = $2 WHERE id = $1", row["id"], exhibit_transition(row["state"], "lift_last_hold"))
        reply = await _reply_exhibit(conn, row["id"])
        await entry(conn, request, "hold.lifted", row["id"], {"hold_id": hold["id"], "matter_ref": hold["matter_ref"], "reason": reason})
        return reply


@route("POST", "/api/exhibits/{id}/dispose")
async def propose_disposal(request: Request) -> Reply:
    identifier = request.params["id"]
    async with DB.tx() as conn:
        row = await load_exhibit(request, conn, lock=True)
        standing = await require_grant(request, conn, row["compartment_id"], identifier)
        authorise_disposal(request, standing, held=row["state"] == "held")
        await require_proof(request, conn)
        if row["state"] == "held":
            raise ApiError("legal_hold")
        in_release = await conn.fetchval(
            """SELECT 1 FROM release_items i JOIN derivatives d ON d.id = i.derivative_id JOIN releases r ON r.id = i.release_id
               WHERE d.exhibit_id = $1 AND r.state <> 'withdrawn' LIMIT 1""",
            row["id"],
        )
        if in_release:
            raise ApiError("exhibit_in_release")
        produces = exhibit_transition(row["state"], "propose_disposal")
        form = fields.Form(request.require_body())
        reason = form.reason()
        form.done()
        await consume_proof(request, conn)
        await conn.execute(
            "UPDATE exhibits SET state = $3, disposal_proposed_by = $2 WHERE id = $1", row["id"], request.person.id, produces
        )
        reply = await _reply_exhibit(conn, row["id"])
        await entry(conn, request, "disposal.proposed", row["id"], {"reason": reason})
        return reply


@route("POST", "/api/exhibits/{id}/dispose/confirm")
async def confirm_disposal(request: Request) -> Reply:
    identifier = request.params["id"]
    async with DB.tx() as conn:
        row = await load_exhibit(request, conn, lock=True)
        standing = await require_grant(request, conn, row["compartment_id"], identifier)
        authorise_disposal(request, standing, held=row["state"] == "held")
        if row["disposal_proposed_by"] == request.person.id:
            raise request.separation()
        await require_proof(request, conn)
        if row["state"] == "held":
            raise ApiError("legal_hold")
        produces = exhibit_transition(row["state"], "confirm_disposal")
        request.require_body()
        if not await STORAGE.check_bucket():
            raise StorageUnavailable("bucket check failed")
        derivatives = await conn.fetch("SELECT id, object_key FROM derivatives WHERE exhibit_id = $1 AND object_key IS NOT NULL", row["id"])
        await consume_proof(request, conn)
        for key in [row["object_key"], *(d["object_key"] for d in derivatives)]:
            await STORAGE.delete(key)
        await conn.execute(
            "UPDATE derivatives SET object_key = NULL, disposed = true WHERE exhibit_id = $1", row["id"]
        )
        await conn.execute(
            "UPDATE exhibits SET state = $2, object_key = NULL, regions = '[]', disposal_proposed_by = NULL WHERE id = $1",
            row["id"], produces,
        )
        reply = await _reply_exhibit(conn, row["id"])
        await entry(conn, request, "exhibit.disposed", row["id"])
        return reply


@route("POST", "/api/exhibits/{id}/dispose/cancel")
async def cancel_disposal(request: Request) -> Reply:
    identifier = request.params["id"]
    async with DB.tx() as conn:
        row = await load_exhibit(request, conn, lock=True)
        standing = await require_grant(request, conn, row["compartment_id"], identifier)
        authorise_disposal(request, standing, held=False)
        await require_proof(request, conn)
        produces = exhibit_transition(row["state"], "cancel_disposal")
        form = fields.Form(request.require_body())
        reason = form.reason()
        form.done()
        await consume_proof(request, conn)
        await conn.execute("UPDATE exhibits SET state = $2, disposal_proposed_by = NULL WHERE id = $1", row["id"], produces)
        reply = await _reply_exhibit(conn, row["id"])
        await entry(conn, request, "disposal.cancelled", row["id"], {"reason": reason})
        return reply


