"""Sessions, their batches, the edit lock and the session state machine, with the ledger movements each edge posts."""
import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import asyncpg
from aiohttp import web

from darkframe.common.http import imager_id, json_response, read_json_object
from darkframe.common.ids import new_id
from darkframe.common.validate import Fields, parse_offset_datetime
from darkframe.ledger import entries
from darkframe.ledger.context import Context
from darkframe.ledger.projects import fetch_project
from darkframe.rules import matching
from darkframe.rules.errors import ApiFault, conflict, not_found, validation
from darkframe.rules.observing import observing_date
from darkframe.rules.states import (
    SESSION_EDGES,
    SESSION_LEDGER_STATES,
    refuse_edge,
    refuse_restore,
)
from darkframe.rules.timestamps import utc_text

NOTES_LIMIT = 10_000
IDEMPOTENCY_HOURS = 24
KINDS = ("dark", "flat", "bias")
NOT_PLANNED = "This filter is not planned for the project."


async def fetch_session(connection: asyncpg.Connection, imager: str, session_id: str, *, lock: bool = False) -> asyncpg.Record:
    row = await connection.fetchrow(
        "SELECT s.*, p.name AS project_name, p.state AS project_state FROM ledger.sessions s "
        "JOIN ledger.projects p ON p.id = s.project_id WHERE s.id = $1 AND s.imager_id = $2"
        + (" FOR UPDATE OF s" if lock else ""), session_id, imager)
    if row is None:
        raise not_found()
    return row


async def fetch_batch(connection: asyncpg.Connection, imager: str, batch_id: str) -> asyncpg.Record:
    row = await connection.fetchrow("SELECT * FROM ledger.batches WHERE id = $1 AND imager_id = $2", batch_id, imager)
    if row is None:
        raise not_found()
    return row


def batch_integration(row: asyncpg.Record | dict[str, Any]) -> int:
    return row["sub_count"] * row["exposure_s"]


async def session_bodies(connection: asyncpg.Connection, rows: list[asyncpg.Record], zone: ZoneInfo | None) -> list[dict[str, Any]]:
    ids = [row["id"] for row in rows]
    batch_rows = await connection.fetch("SELECT * FROM ledger.batches WHERE session_id = ANY($1) ORDER BY seq", ids)
    frame_rows = await connection.fetch("SELECT * FROM ledger.frames WHERE session_id = ANY($1) ORDER BY seq", ids)
    link_rows = await connection.fetch(
        "SELECT * FROM ledger.batch_calibrations WHERE batch_id = ANY($1)", [row["id"] for row in batch_rows])
    links: dict[str, dict[str, str | None]] = {}
    for link in link_rows:
        links.setdefault(link["batch_id"], {})[link["kind"]] = link["calibration_set_id"]
    frames_by_batch: dict[str, int] = {}
    for frame in frame_rows:
        frames_by_batch[frame["batch_id"]] = frames_by_batch.get(frame["batch_id"], 0) + 1
    bodies = []
    for row in rows:
        batches = [batch_body(batch, links.get(batch["id"], {}), frames_by_batch.get(batch["id"], 0))
                   for batch in batch_rows if batch["session_id"] == row["id"]]
        frames = [frame_body(frame) for frame in frame_rows if frame["session_id"] == row["id"]]
        bodies.append({
            "id": row["id"], "project_id": row["project_id"], "project_name": row["project_name"], "state": row["state"],
            "previous_state": row["previous_state"], "observing_date": row["observing_date"].isoformat(),
            "started_at": row["started_at"].astimezone(zone).isoformat(timespec="seconds") if row["started_at"] else None,
            "logged_at": utc_text(row["logged_at"]) if row["logged_at"] else None, "notes": row["notes"],
            "batches": batches, "frames": frames, "frame_count": len(frames),
            "integration_seconds": sum(batch["integration_seconds"] for batch in batches)})
    return bodies


def batch_body(row: asyncpg.Record, links: dict[str, str | None], frame_count: int) -> dict[str, Any]:
    return {"id": row["id"], "filter": row["filter"], "sub_count": row["sub_count"], "exposure_s": row["exposure_s"],
            "integration_seconds": batch_integration(row), "camera": row["camera"], "gain": row["gain"],
            "offset": row["offset_value"], "temperature_c": row["temperature_c"], "binning": row["binning"],
            "calibration": {kind: links.get(kind) for kind in KINDS}, "frame_count": frame_count}


def frame_body(row: asyncpg.Record) -> dict[str, Any]:
    return {"id": row["id"], "batch_id": row["batch_id"], "name": row["name"], "size_bytes": row["size_bytes"],
            "content_type": row["content_type"], "sha256": row["sha256"]}


async def one_session_body(context: Context, connection: asyncpg.Connection, imager: str, session_id: str) -> dict[str, Any]:
    row = await fetch_session(connection, imager, session_id)
    return (await session_bodies(connection, [row], await context.zone(imager)))[0]


def batch_fields(body: dict[str, Any], planned_filters: set[str], prefix: str = "") -> dict[str, Any]:
    fields = Fields(body, prefix)
    chosen = fields.choice("filter", entries.FILTERS, "Filter")
    if chosen is not None and chosen not in planned_filters:
        fields.fail("filter", NOT_PLANNED)
    values = {
        "filter": chosen,
        "sub_count": fields.whole("sub_count", 1, 10_000, "Subs"),
        "exposure_s": fields.whole("exposure_s", 1, 3600, "Sub exposure"),
        "camera": fields.text("camera", 1, 60, "Camera"),
        "gain": fields.whole("gain", 0, 1000, "Gain"),
        "offset_value": fields.whole("offset", 0, 1000, "Offset"),
        "temperature_c": fields.number("temperature_c", -40, 40, "Sensor temperature", places=1),
        "binning": fields.whole("binning", 1, 4, "Binning"),
    }
    fields.raise_errors()
    return values


async def drop_unmatched_links(connection: asyncpg.Connection, batch_id: str) -> None:
    """Amending a batch drops any calibration link that no longer matches."""
    batch = await connection.fetchrow("SELECT * FROM ledger.batches WHERE id = $1", batch_id)
    for link in await connection.fetch("SELECT * FROM ledger.batch_calibrations WHERE batch_id = $1", batch_id):
        calibration_set = await current_set_fields(connection, link["calibration_set_id"])
        if matching.mismatches(calibration_set, batch_for_matching(batch)):
            await connection.execute("DELETE FROM ledger.batch_calibrations WHERE batch_id = $1 AND kind = $2",
                                     batch_id, link["kind"])


def batch_for_matching(batch: asyncpg.Record) -> dict[str, Any]:
    return {"camera": batch["camera"], "binning": batch["binning"], "gain": batch["gain"], "offset": batch["offset_value"],
            "exposure_s": batch["exposure_s"], "temperature_c": batch["temperature_c"], "filter": batch["filter"]}


async def current_set_fields(connection: asyncpg.Connection, set_id: str) -> dict[str, Any]:
    row = await connection.fetchrow(
        "SELECT s.kind, v.camera, v.binning, v.gain, v.offset_value AS offset, v.exposure_s, v.temperature_c, v.filter "
        "FROM ledger.calibration_sets s JOIN ledger.calibration_versions v ON v.set_id = s.id AND v.version = s.version "
        "WHERE s.id = $1", set_id)
    return dict(row)


def held_by_other(row: asyncpg.Record, token: Any, now: datetime) -> bool:
    """Another device holds an unexpired edit lock."""
    stored = row["lock_token"]
    return stored is not None and stored != token and row["lock_expires_at"] > now


def refuse_held(row: asyncpg.Record, token: Any, now: datetime) -> None:
    if held_by_other(row, token, now):
        raise conflict("session_locked", "This session is open for editing on another device.")


def check_lock(row: asyncpg.Record, token: Any, now: datetime) -> None:
    """A notes save needs the current unexpired token."""
    refuse_held(row, token, now)
    if token is None or row["lock_token"] != token or row["lock_expires_at"] <= now:
        raise conflict("lock_expired", "Your edit lock expired. Take the lock again to save.")


class SessionRoutes:
    def __init__(self, context: Context) -> None:
        self.context = context

    def add_to(self, app: web.Application) -> None:
        app.add_routes([
            web.get("/api/sessions", self.list),
            web.post("/api/sessions", self.create),
            web.get("/api/sessions/{id}", self.get),
            web.post("/api/sessions/{id}/start", self.start),
            web.post("/api/sessions/{id}/batches", self.add_batch),
            web.post("/api/sessions/{id}/log", self.log),
            web.post("/api/sessions/{id}/amend", self.amend),
            web.post("/api/sessions/{id}/trash", self.trash),
            web.post("/api/sessions/{id}/restore", self.restore),
            web.post("/api/sessions/{id}/lock", self.take_lock),
            web.delete("/api/sessions/{id}/lock", self.release_lock),
            web.patch("/api/sessions/{id}/notes", self.save_notes),
        ])

    async def list(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        project_id = request.query.get("project_id")
        include_trashed = request.query.get("include_trashed") == "true"
        zone = await self.context.zone(imager)
        async with self.context.database.connection() as connection:
            if project_id is not None:
                await fetch_project(connection, imager, project_id)
            rows = await connection.fetch(
                "SELECT s.*, p.name AS project_name FROM ledger.sessions s JOIN ledger.projects p ON p.id = s.project_id "
                "WHERE s.imager_id = $1 AND ($2::text IS NULL OR s.project_id = $2) AND ($3 OR s.state <> 'trashed') "
                "ORDER BY s.observing_date DESC, s.seq DESC", imager, project_id, include_trashed)
            return json_response({"sessions": await session_bodies(connection, rows, zone)})

    async def create(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        body = await read_json_object(request)
        project_id = body.get("project_id")
        if not isinstance(project_id, str) or not project_id:
            raise validation({"project_id": "Choose a project."})
        zone = await self.context.zone(imager)
        session = new_id()
        async with self.context.database.transaction() as connection:
            project = await fetch_project(connection, imager, project_id)
            if project["state"] != "active":
                raise conflict("project_not_active", "Sessions can only be planned for active projects.")
            fields = Fields(body)
            planned_date = fields.date("observing_date", "Observing date")
            notes = fields.text("notes", 0, NOTES_LIMIT, "Notes") if "notes" in body else ""
            fields.raise_errors()
            await connection.execute(
                "INSERT INTO ledger.sessions (id, imager_id, project_id, state, observing_date, notes) "
                "VALUES ($1, $2, $3, 'planned', $4, $5)", session, imager, project_id, planned_date, notes)
            row = await fetch_session(connection, imager, session)
            return json_response((await session_bodies(connection, [row], zone))[0], 201)

    async def get(self, request: web.Request) -> web.Response:
        async with self.context.database.connection() as connection:
            return json_response(await one_session_body(self.context, connection, imager_id(request), request.match_info["id"]))

    async def start(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        body = await read_json_object(request)
        zone = await self.context.zone(imager)
        async with self.context.database.transaction() as connection:
            row = await fetch_session(connection, imager, request.match_info["id"], lock=True)
            refuse_edge("session", SESSION_EDGES, row["state"], "imaging")
            if row["project_state"] != "active":
                raise conflict("project_not_active", "Sessions can only start for active projects.")
            if body.get("started_at") is None:
                started = datetime.now(UTC)
            else:
                started = parse_offset_datetime(body["started_at"]) if isinstance(body["started_at"], str) else None
                if started is None:
                    raise validation({"started_at": "Started at must be an ISO 8601 time with a UTC offset."})
            await connection.execute(
                "UPDATE ledger.sessions SET state = 'imaging', started_at = $2, observing_date = $3 WHERE id = $1",
                row["id"], started, observing_date(started, zone))
            return json_response(await one_session_body(self.context, connection, imager, row["id"]))

    async def add_batch(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        body = await read_json_object(request)
        key = request.headers.get("Idempotency-Key", "")
        zone = await self.context.zone(imager)
        async with self.context.database.transaction() as connection:
            row = await fetch_session(connection, imager, request.match_info["id"], lock=True)
            request_hash = hashlib.sha256(json.dumps([row["id"], body], sort_keys=True).encode()).hexdigest()
            if key:
                await connection.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", f"{imager}:{key}")
                await connection.execute("DELETE FROM ledger.idempotency_keys WHERE created_at < $1",
                                         datetime.now(UTC) - timedelta(hours=IDEMPOTENCY_HOURS))
                stored = await connection.fetchrow(
                    "SELECT * FROM ledger.idempotency_keys WHERE imager_id = $1 AND key = $2", imager, key)
                if stored is not None:
                    if stored["request_hash"] != request_hash:
                        raise conflict("idempotency_conflict", "That idempotency key was used with a different batch.")
                    return json_response(stored["response"], stored["status"])
            if row["state"] != "imaging":
                raise conflict("wrong_state", "Batches can only be added while the session is imaging.")
            errors: dict[str, str] = {}
            if not 1 <= len(key) <= 100:
                errors["Idempotency-Key"] = "Send an Idempotency-Key header of 1 to 100 characters."
            planned = {item["filter"] for item in await entries.project_filters(connection, row["project_id"])}
            try:
                values = batch_fields(body, planned)
            except ApiFault as fault:
                errors.update(fault.fields or {})
            if errors:
                raise validation(errors)
            batch = new_id()
            await connection.execute(
                "INSERT INTO ledger.batches (id, session_id, imager_id, filter, sub_count, exposure_s, camera, gain, "
                "offset_value, temperature_c, binning) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
                batch, row["id"], imager, *values.values())
            session_body = (await session_bodies(connection, [await fetch_session(connection, imager, row["id"])], zone))[0]
            response = {"batch": next(item for item in session_body["batches"] if item["id"] == batch), "session": session_body}
            await connection.execute("INSERT INTO ledger.idempotency_keys VALUES ($1, $2, $3, 201, $4, now())",
                                     imager, key, request_hash, response)
            return json_response(response, 201)

    async def log(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        async with self.context.database.transaction() as connection:
            row = await fetch_session(connection, imager, request.match_info["id"], lock=True)
            refuse_edge("session", SESSION_EDGES, row["state"], "logged")
            batches = await connection.fetch("SELECT * FROM ledger.batches WHERE session_id = $1 ORDER BY seq", row["id"])
            if not batches:
                raise conflict("no_batches", "Add at least one batch before logging the session.")
            for batch in batches:
                await entries.post_log(connection, row["project_id"], row["id"], batch["id"], batch["filter"],
                                       batch_integration(batch))
            await connection.execute("UPDATE ledger.sessions SET state = 'logged', logged_at = now() WHERE id = $1", row["id"])
            result = await one_session_body(self.context, connection, imager, row["id"])
        await self.context.changed(imager)
        return json_response(result)

    async def amend(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        body = await read_json_object(request)
        async with self.context.database.transaction() as connection:
            row = await fetch_session(connection, imager, request.match_info["id"], lock=True)
            refuse_edge("session", SESSION_EDGES, row["state"], "amended")
            requested = body.get("batches")
            if not isinstance(requested, list) or not requested:
                raise validation({"batches": "Amend with at least one batch."})
            planned = {item["filter"] for item in await entries.project_filters(connection, row["project_id"])}
            existing = {batch["id"]: batch for batch in
                        await connection.fetch("SELECT * FROM ledger.batches WHERE session_id = $1 ORDER BY seq", row["id"])}
            errors: dict[str, str] = {}
            parsed: list[tuple[str | None, dict[str, Any]]] = []
            for index, item in enumerate(requested):
                item = item if isinstance(item, dict) else {}
                batch_id = item.get("id")
                if batch_id is not None and batch_id not in existing:
                    raise not_found()
                try:
                    parsed.append((batch_id, batch_fields(item, planned, f"batches[{index}].")))
                except ApiFault as fault:
                    errors.update(fault.fields or {})
            if errors:
                raise validation(errors)
            kept = {batch_id for batch_id, _ in parsed if batch_id}
            for batch_id in existing.keys() - kept:
                if await connection.fetchval("SELECT 1 FROM ledger.frames WHERE batch_id = $1 LIMIT 1", batch_id):
                    raise conflict("batch_has_frames", "A batch with frames cannot be removed.")
            for batch_id in existing.keys() - kept:
                for movement in await entries.unreversed_logs(connection, batch_id=batch_id):
                    await entries.reverse(connection, movement)
                await connection.execute("DELETE FROM ledger.batches WHERE id = $1", batch_id)
                await connection.execute("DELETE FROM ledger.batch_calibrations WHERE batch_id = $1", batch_id)
            for batch_id, values in parsed:
                if batch_id is None:
                    batch_id = new_id()
                    await connection.execute(
                        "INSERT INTO ledger.batches (id, session_id, imager_id, filter, sub_count, exposure_s, camera, "
                        "gain, offset_value, temperature_c, binning) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
                        batch_id, row["id"], imager, *values.values())
                    created = await connection.fetchrow("SELECT * FROM ledger.batches WHERE id = $1", batch_id)
                    await entries.post_log(connection, row["project_id"], row["id"], batch_id, values["filter"], batch_integration(created))
                    continue
                before = existing[batch_id]
                if all(before[name] == value for name, value in values.items()):
                    continue
                for movement in await entries.unreversed_logs(connection, batch_id=batch_id):
                    await entries.reverse(connection, movement)
                assignments = ", ".join(f"{name} = ${index + 2}" for index, name in enumerate(values))
                await connection.execute(f"UPDATE ledger.batches SET {assignments} WHERE id = $1", batch_id, *values.values())
                changed = await connection.fetchrow("SELECT * FROM ledger.batches WHERE id = $1", batch_id)
                await entries.post_log(connection, row["project_id"], row["id"], batch_id, values["filter"], batch_integration(changed))
                await drop_unmatched_links(connection, batch_id)
            await connection.execute("UPDATE ledger.sessions SET state = 'amended' WHERE id = $1", row["id"])
            result = await one_session_body(self.context, connection, imager, row["id"])
        await self.context.changed(imager)
        return json_response(result)

    async def trash(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        async with self.context.database.transaction() as connection:
            row = await fetch_session(connection, imager, request.match_info["id"], lock=True)
            refuse_edge("session", SESSION_EDGES, row["state"], "trashed")
            for movement in await entries.unreversed_logs(connection, session_id=row["id"]):
                await entries.reverse(connection, movement)
            await connection.execute("UPDATE ledger.sessions SET state = 'trashed', previous_state = $2 WHERE id = $1",
                                     row["id"], row["state"])
            result = await one_session_body(self.context, connection, imager, row["id"])
        await self.context.changed(imager)
        return json_response(result)

    async def restore(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        async with self.context.database.transaction() as connection:
            row = await fetch_session(connection, imager, request.match_info["id"], lock=True)
            refuse_restore(row["state"])
            if row["previous_state"] in SESSION_LEDGER_STATES:
                for batch in await connection.fetch("SELECT * FROM ledger.batches WHERE session_id = $1 ORDER BY seq", row["id"]):
                    await entries.post_log(connection, row["project_id"], row["id"], batch["id"], batch["filter"],
                                           batch_integration(batch))
            await connection.execute("UPDATE ledger.sessions SET state = $2, previous_state = NULL WHERE id = $1",
                                     row["id"], row["previous_state"])
            result = await one_session_body(self.context, connection, imager, row["id"])
        await self.context.changed(imager)
        return json_response(result)

    async def take_lock(self, request: web.Request) -> web.Response:
        body = await read_json_object(request)
        token = body.get("lock_token")
        now = datetime.now(UTC)
        seconds = self.context.settings.draft_lock_seconds
        async with self.context.database.transaction() as connection:
            row = await fetch_session(connection, imager_id(request), request.match_info["id"], lock=True)
            if row["state"] == "trashed":
                raise conflict("wrong_state", "A trashed session cannot be edited.")
            refuse_held(row, token, now)
            granted = token if token is not None and row["lock_token"] == token else new_id()
            until = now + timedelta(seconds=seconds)
            await connection.execute("UPDATE ledger.sessions SET lock_token = $2, lock_expires_at = $3 WHERE id = $1",
                                     row["id"], granted, until)
        return json_response({"lock_token": granted, "expires_at": utc_text(until), "expires_in_seconds": seconds})

    async def release_lock(self, request: web.Request) -> web.Response:
        token = (await read_json_object(request)).get("lock_token")
        now = datetime.now(UTC)
        async with self.context.database.transaction() as connection:
            row = await fetch_session(connection, imager_id(request), request.match_info["id"], lock=True)
            refuse_held(row, token, now)
            await connection.execute("UPDATE ledger.sessions SET lock_token = NULL, lock_expires_at = NULL WHERE id = $1",
                                     row["id"])
        return web.Response(status=204)

    async def save_notes(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        body = await read_json_object(request)
        async with self.context.database.transaction() as connection:
            row = await fetch_session(connection, imager, request.match_info["id"], lock=True)
            if row["state"] == "trashed":
                raise conflict("wrong_state", "A trashed session cannot be edited.")
            check_lock(row, body.get("lock_token"), datetime.now(UTC))
            notes = Fields(body)
            value = notes.text("notes", 0, NOTES_LIMIT, "Notes")
            notes.raise_errors()
            await connection.execute("UPDATE ledger.sessions SET notes = $2 WHERE id = $1", row["id"], value)
            return json_response(await one_session_body(self.context, connection, imager, row["id"]))
