"""The calibration library: sets, versions, masters, matching against batches and the calibration state machine."""
import hashlib
import re
from datetime import UTC, date, datetime
from typing import Any
from zoneinfo import ZoneInfo

import asyncpg
from aiohttp import web

from darkframe.common.http import imager_id, json_response, read_json_object
from darkframe.common.ids import new_id
from darkframe.common.s3 import StorageUnavailable
from darkframe.common.validate import Fields
from darkframe.ledger import entries
from darkframe.ledger.context import Context
from darkframe.ledger.sessions import (
    KINDS,
    batch_body,
    batch_for_matching,
    fetch_batch,
    fetch_session,
)
from darkframe.rules import matching
from darkframe.rules.errors import ApiFault, conflict, not_found, validation
from darkframe.rules.states import (
    CALIBRATION_EDGES,
    CALIBRATION_TARGETS,
    SESSION_FRAME_STATES,
    refuse_edge,
)
from darkframe.rules.timestamps import utc_text

FILE_NAME = re.compile(r"^[A-Za-z0-9._-]{1,120}$")
VERSION_COLUMNS = ("name", "camera", "gain", "offset_value", "exposure_s", "temperature_c", "binning", "filter",
                   "frame_count", "captured_on")
MASTER_COLUMNS = ("master_filename", "master_size", "master_sha256", "master_key", "master_content_type")
STORAGE_DOWN = "Calibration storage is unreachable. The master was not recorded."


def site_today(site: dict[str, Any]) -> date:
    return datetime.now(UTC).astimezone(ZoneInfo(site["time_zone"])).date()


def set_body(row: asyncpg.Record, today: date) -> dict[str, Any]:
    age = (today - row["captured_on"]).days
    master = None
    if row["master_filename"]:
        master = {"filename": row["master_filename"], "size_bytes": row["master_size"], "sha256": row["master_sha256"]}
    return {"id": row["id"], "name": row["name"], "kind": row["kind"], "camera": row["camera"], "gain": row["gain"],
            "offset": row["offset_value"], "exposure_s": row["exposure_s"], "temperature_c": row["temperature_c"],
            "binning": row["binning"], "filter": row["filter"], "frame_count": row["frame_count"],
            "captured_on": row["captured_on"].isoformat(), "status": matching.reported_status(row["status"], age, row["kind"]),
            "age_days": age, "max_age_days": matching.MAX_AGE_DAYS[row["kind"]], "version": row["version"], "master": master}


SET_QUERY = ("SELECT s.id, s.kind, s.status, s.version, v.* FROM ledger.calibration_sets s "
             "JOIN ledger.calibration_versions v ON v.set_id = s.id AND v.version = s.version")


async def fetch_set(connection: asyncpg.Connection, imager: str, set_id: str, *, lock: bool = False) -> asyncpg.Record:
    if lock:
        await connection.fetchval("SELECT 1 FROM ledger.calibration_sets WHERE id = $1 AND imager_id = $2 FOR UPDATE", set_id, imager)
    row = await connection.fetchrow(SET_QUERY + " WHERE s.id = $1 AND s.imager_id = $2", set_id, imager)
    if row is None:
        raise not_found()
    return row


def set_fields(body: dict[str, Any], kind: str, today: date) -> dict[str, Any]:
    fields = Fields(body)
    exposure = None
    if kind == "dark":
        exposure = fields.whole("exposure_s", 1, 3600, "Exposure")
    elif body.get("exposure_s") is not None:
        fields.fail("exposure_s", "Exposure applies to darks only.")
    chosen_filter = None
    if kind == "flat":
        chosen_filter = fields.choice("filter", entries.FILTERS, "Filter")
    elif body.get("filter") is not None:
        fields.fail("filter", "Filter applies to flats only.")
    captured = fields.date("captured_on", "Captured on")
    if captured is not None and captured > today:
        fields.fail("captured_on", "Captured on cannot be after today.")
    values = {
        "name": fields.text("name", 1, 80, "Set name"), "camera": fields.text("camera", 1, 60, "Camera"),
        "gain": fields.whole("gain", 0, 1000, "Gain"), "offset_value": fields.whole("offset", 0, 1000, "Offset"),
        "exposure_s": exposure, "temperature_c": fields.number("temperature_c", -40, 40, "Sensor temperature", places=1),
        "binning": fields.whole("binning", 1, 4, "Binning"), "filter": chosen_filter,
        "frame_count": fields.whole("frame_count", 1, 1000, "Frames combined"), "captured_on": captured,
    }
    fields.raise_errors()
    return values


def current_values(row: asyncpg.Record) -> dict[str, Any]:
    values = {name: row[name] for name in VERSION_COLUMNS}
    values["offset"] = values.pop("offset_value")
    values["captured_on"] = values["captured_on"].isoformat()
    return values


async def add_version(connection: asyncpg.Connection, set_id: str, version: int, values: dict[str, Any],
                      master: dict[str, Any]) -> None:
    columns = VERSION_COLUMNS + MASTER_COLUMNS
    merged = {**values, **master}
    await connection.execute(
        f"INSERT INTO ledger.calibration_versions (set_id, version, {', '.join(columns)}) "
        f"VALUES ($1, $2, {', '.join(f'${i + 3}' for i in range(len(columns)))})", set_id, version,
        *(merged[name] for name in columns))
    await connection.execute("UPDATE ledger.calibration_sets SET version = $2 WHERE id = $1", set_id, version)


def master_of(row: asyncpg.Record) -> dict[str, Any]:
    return {name: row[name] for name in MASTER_COLUMNS}


class CalibrationRoutes:
    def __init__(self, context: Context) -> None:
        self.context = context

    def add_to(self, app: web.Application) -> None:
        app.add_routes([
            web.get("/api/calibration-sets", self.list),
            web.post("/api/calibration-sets", self.create),
            web.get("/api/calibration-sets/{id}", self.get),
            web.patch("/api/calibration-sets/{id}", self.patch),
            web.put("/api/calibration-sets/{id}/master", self.upload_master),
            web.get("/api/calibration-sets/{id}/master", self.download_master),
            web.post("/api/calibration-sets/{id}/transition", self.transition),
            web.get("/api/calibration-sets/{id}/versions", self.versions),
            web.post("/api/calibration-sets/{id}/restore", self.restore),
            web.get("/api/batches/{id}/calibration-candidates", self.candidates),
            web.post("/api/batches/{id}/calibration", self.link),
            web.delete("/api/batches/{id}/calibration/{kind}", self.unlink),
        ])

    async def today(self, imager: str) -> date:
        return site_today(await self.context.site(imager))

    async def list(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        today = await self.today(imager)
        async with self.context.database.connection() as connection:
            rows = await connection.fetch(SET_QUERY + " WHERE s.imager_id = $1 ORDER BY lower(v.name), v.name", imager)
        return json_response({"calibration_sets": [set_body(row, today) for row in rows]})

    async def create(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        body = await read_json_object(request)
        today = await self.today(imager)
        kind = Fields(body).choice("kind", KINDS, "Kind")
        if kind is None:
            raise validation({"kind": f"Kind must be one of {', '.join(KINDS)}."})
        values = set_fields(body, kind, today)
        set_id = new_id()
        async with self.context.database.transaction() as connection:
            await connection.execute(
                "INSERT INTO ledger.calibration_sets (id, imager_id, kind, status, version) VALUES ($1, $2, $3, 'building', 0)",
                set_id, imager, kind)
            await add_version(connection, set_id, 1, values, dict.fromkeys(MASTER_COLUMNS))
            return json_response(set_body(await fetch_set(connection, imager, set_id), today), 201)

    async def get(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        today = await self.today(imager)
        async with self.context.database.connection() as connection:
            return json_response(set_body(await fetch_set(connection, imager, request.match_info["id"]), today))

    async def patch(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        body = await read_json_object(request)
        today = await self.today(imager)
        async with self.context.database.transaction() as connection:
            row = await fetch_set(connection, imager, request.match_info["id"], lock=True)
            if row["status"] == "retired":
                raise conflict("set_retired", "A retired calibration set cannot be changed.")
            if "kind" in body and body["kind"] != row["kind"]:
                raise validation({"kind": "The kind of a set cannot change."})
            merged = {**current_values(row), **body, "kind": row["kind"]}
            values = set_fields(merged, row["kind"], today)
            await add_version(connection, row["id"], row["version"] + 1, values, master_of(row))
            return json_response(set_body(await fetch_set(connection, imager, row["id"]), today))

    async def upload_master(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        filename = request.query.get("filename", "")
        content_type = request.headers.get("Content-Type", "").split(";")[0].strip().lower()
        upload_bytes = await request.read()
        today = await self.today(imager)
        async with self.context.database.transaction() as connection:
            row = await fetch_set(connection, imager, request.match_info["id"], lock=True)
            if row["status"] == "retired":
                raise conflict("set_retired", "A retired calibration set cannot be changed.")
            if not FILE_NAME.fullmatch(filename) or not upload_bytes:
                raise validation({"filename" if not FILE_NAME.fullmatch(filename) else "body":
                                  "Master file names use letters, digits, dots, underscores and hyphens, and masters are not empty."})
            version = row["version"] + 1
            key = f"calibration/{imager}/{row['id']}/v{version}/{filename}"
            try:
                await self.context.objects.put(key, upload_bytes, content_type)
            except StorageUnavailable as error:
                raise ApiFault(503, "storage_unavailable", STORAGE_DOWN) from error
            master = {"master_filename": filename, "master_size": len(upload_bytes), "master_sha256": hashlib.sha256(upload_bytes).hexdigest(),
                      "master_key": key, "master_content_type": content_type}
            await add_version(connection, row["id"], version, {name: row[name] for name in VERSION_COLUMNS}, master)
            return json_response(set_body(await fetch_set(connection, imager, row["id"]), today))

    async def download_master(self, request: web.Request) -> web.Response:
        async with self.context.database.connection() as connection:
            row = await fetch_set(connection, imager_id(request), request.match_info["id"])
        if not row["master_key"]:
            raise not_found()
        try:
            upload_bytes, _ = await self.context.objects.get(row["master_key"])
        except StorageUnavailable as error:
            raise ApiFault(503, "storage_unavailable", "Calibration storage is unreachable. The master could not be read.") from error
        return web.Response(body=upload_bytes, content_type=row["master_content_type"])

    async def transition(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        target = (await read_json_object(request)).get("to")
        today = await self.today(imager)
        async with self.context.database.transaction() as connection:
            row = await fetch_set(connection, imager, request.match_info["id"], lock=True)
            if target not in CALIBRATION_TARGETS:
                raise validation({"to": f"State must be one of {', '.join(CALIBRATION_TARGETS)}."})
            reported = set_body(row, today)["status"]
            refuse_edge("calibration set", CALIBRATION_EDGES, row["status"], target, reported)
            if target == "ready" and not row["master_key"]:
                raise conflict("master_missing", "Upload a master before marking the set ready.")
            await connection.execute("UPDATE ledger.calibration_sets SET status = $2 WHERE id = $1", row["id"], target)
            return json_response(set_body(await fetch_set(connection, imager, row["id"]), today))

    async def versions(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        async with self.context.database.connection() as connection:
            row = await fetch_set(connection, imager, request.match_info["id"])
            records = await connection.fetch(
                "SELECT * FROM ledger.calibration_versions WHERE set_id = $1 ORDER BY version", row["id"])
        listed = []
        for record in records:
            master = ({"filename": record["master_filename"], "size_bytes": record["master_size"],
                       "sha256": record["master_sha256"]} if record["master_filename"] else None)
            listed.append({"version": record["version"], "created_at": utc_text(record["created_at"]),
                           **current_values(record), "master": master})
        return json_response({"versions": listed})

    async def restore(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        wanted = (await read_json_object(request)).get("version")
        today = await self.today(imager)
        async with self.context.database.transaction() as connection:
            row = await fetch_set(connection, imager, request.match_info["id"], lock=True)
            if isinstance(wanted, bool) or not isinstance(wanted, int):
                raise validation({"version": "Version must be a whole number."})
            earlier = await connection.fetchrow(
                "SELECT * FROM ledger.calibration_versions WHERE set_id = $1 AND version = $2", row["id"], wanted)
            if earlier is None:
                raise not_found()
            if row["status"] == "retired":
                raise conflict("set_retired", "A retired calibration set cannot be changed.")
            await add_version(connection, row["id"], row["version"] + 1, {name: earlier[name] for name in VERSION_COLUMNS},
                              master_of(earlier))
            return json_response(set_body(await fetch_set(connection, imager, row["id"]), today))

    async def candidates(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        today = await self.today(imager)
        async with self.context.database.connection() as connection:
            batch = await fetch_batch(connection, imager, request.match_info["id"])
            rows = await connection.fetch(SET_QUERY + " WHERE s.imager_id = $1 ORDER BY lower(v.name), v.name", imager)
        found = []
        for row in rows:
            body = set_body(row, today)
            failing = matching.mismatches({**body, "offset": row["offset_value"]}, batch_for_matching(batch))
            found.append({"calibration_set_id": body["id"], "name": body["name"], "kind": body["kind"],
                          "status": body["status"], "matches": not failing,
                          "reasons": [matching.reason(entry) for entry in failing]})
        return json_response({"candidates": found})

    async def link(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        set_id = (await read_json_object(request)).get("calibration_set_id")
        if not isinstance(set_id, str) or not set_id:
            raise validation({"calibration_set_id": "Choose a calibration set."})
        today = await self.today(imager)
        async with self.context.database.transaction() as connection:
            batch = await fetch_batch(connection, imager, request.match_info["id"])
            row = await fetch_set(connection, imager, set_id)
            session = await fetch_session(connection, imager, batch["session_id"])
            if session["state"] not in SESSION_FRAME_STATES:
                raise conflict("wrong_state", "Calibration can only be linked to an imaging or logged session.")
            body = set_body(row, today)
            if body["status"] in ("building", "retired"):
                raise conflict("calibration_not_usable", "Only ready or stale sets can calibrate a batch.")
            failing = matching.mismatches({**body, "offset": row["offset_value"]}, batch_for_matching(batch))
            if failing:
                raise ApiFault(422, "calibration_mismatch", matching.refusal_message(failing), extra={"mismatches": failing})
            await connection.execute(
                "INSERT INTO ledger.batch_calibrations VALUES ($1, $2, $3) ON CONFLICT (batch_id, kind) "
                "DO UPDATE SET calibration_set_id = EXCLUDED.calibration_set_id", batch["id"], row["kind"], set_id)
            return json_response({"batch": await self.batch_view(connection, batch["id"]),
                                  "warning": "stale" if body["status"] == "stale" else None})

    async def unlink(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        async with self.context.database.transaction() as connection:
            batch = await fetch_batch(connection, imager, request.match_info["id"])
            removed = await connection.fetchval(
                "DELETE FROM ledger.batch_calibrations WHERE batch_id = $1 AND kind = $2 RETURNING 1",
                batch["id"], request.match_info["kind"])
            if removed is None:
                raise not_found()
            return json_response(await self.batch_view(connection, batch["id"]))

    @staticmethod
    async def batch_view(connection: asyncpg.Connection, batch_id: str) -> dict[str, Any]:
        row = await connection.fetchrow("SELECT * FROM ledger.batches WHERE id = $1", batch_id)
        links = {link["kind"]: link["calibration_set_id"] for link in
                 await connection.fetch("SELECT * FROM ledger.batch_calibrations WHERE batch_id = $1", batch_id)}
        frame_count = await connection.fetchval("SELECT count(*) FROM ledger.frames WHERE batch_id = $1", batch_id)
        return batch_body(row, links, frame_count)
