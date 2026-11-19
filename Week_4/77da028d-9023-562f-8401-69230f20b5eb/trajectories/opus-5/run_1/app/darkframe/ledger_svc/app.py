"""The ledger service: projects, the hours-owed ledger, sessions and the library."""

from __future__ import annotations

import hashlib
from typing import Any

from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from .. import ids, objectstore
from ..domain import calibration as calibration_rules, filters, states, timeutil
from ..errors import conflict, not_found, storage_unavailable, validation
from ..service import build_service, imager_of
from ..validate import Fields
from ..webkit import (
    MASTER_CONTENT_TYPES,
    OBJECT_NAME,
    UPLOAD_CONTENT_TYPES,
    json_response,
    read_json_body,
    read_upload_body,
    request_id_of,
)
from . import calibration, projects, sessions, shares
from .seed import apply_seed
from .store import DATABASE, site_facts

MAX_PLANNED_SECONDS = 3_600_000
PROJECT_STATES_REACHABLE = ("active", "paused", "complete", "archived")


async def _site(request: Request) -> Any:
    return await site_facts(imager_of(request), request_id_of(request))


def _text_field(body: dict[str, Any], name: str) -> str:
    value = body.get(name)
    if not isinstance(value, str) or not value:
        raise validation({name: "This field is required."})
    return value


# --- projects ---------------------------------------------------------------


async def list_projects(request: Request) -> Response:
    rows = await DATABASE.fetch(
        "select * from ledger.projects where imager_id = $1 order by name",
        imager_of(request),
    )
    return json_response(
        {"projects": [await projects.project_body(row) for row in rows]}
    )


async def create_project(request: Request) -> Response:
    body = await read_json_body(request)
    fields = Fields(body)
    name = fields.text("name", 1, 80)
    target_name = fields.text("target_name", 1, 80)
    ra_deg = fields.decimal("ra_deg", 0.0, 360.0)
    if isinstance(ra_deg, float) and ra_deg == 360.0:
        fields.fail("ra_deg", "Use a number from 0 to just under 360.")
    dec_deg = fields.decimal("dec_deg", -90.0, 90.0)
    fields.done()
    row = await projects.create_project(
        imager_of(request), name, target_name, ra_deg, dec_deg
    )
    return json_response(await projects.project_body(row), 201)


async def read_project(request: Request) -> Response:
    row = await projects.project_row(
        imager_of(request), request.path_params["project_id"]
    )
    return json_response(await projects.project_body(row))


async def patch_project(request: Request) -> Response:
    imager_id = imager_of(request)
    project_id = request.path_params["project_id"]
    body = await read_json_body(request)
    row = await projects.project_row(imager_id, project_id)
    closed = states.closed_project(row["state"])
    if closed is not None:
        raise closed
    fields = Fields(body)
    changes: dict[str, Any] = {}
    if fields.present("name"):
        changes["name"] = fields.text("name", 1, 80)
    if fields.present("target_name"):
        changes["target_name"] = fields.text("target_name", 1, 80)
    if fields.present("ra_deg"):
        value = fields.decimal("ra_deg", 0.0, 360.0)
        if isinstance(value, float) and value == 360.0:
            fields.fail("ra_deg", "Use a number from 0 to just under 360.")
        changes["ra_deg"] = value
    if fields.present("dec_deg"):
        changes["dec_deg"] = fields.decimal("dec_deg", -90.0, 90.0)
    fields.done()
    for column, value in changes.items():
        await DATABASE.execute(
            f"update ledger.projects set {column} = $2 where id = $1",
            project_id,
            value,
        )
    return json_response(
        await projects.project_body(await projects.project_row(imager_id, project_id))
    )


async def transition_project(request: Request) -> Response:
    imager_id = imager_of(request)
    project_id = request.path_params["project_id"]
    body = await read_json_body(request)
    await projects.project_row(imager_id, project_id)
    fields = Fields(body)
    to_state = fields.choice("to", PROJECT_STATES_REACHABLE)
    fields.done()
    await projects.transition(imager_id, project_id, to_state)
    return json_response(
        await projects.project_body(await projects.project_row(imager_id, project_id))
    )


async def put_allotment(request: Request) -> Response:
    imager_id = imager_of(request)
    project_id = request.path_params["project_id"]
    filter_name = request.path_params["filter_name"]
    body = await read_json_body(request)
    await projects.project_row(imager_id, project_id)

    async def read_planned() -> int:
        fields = Fields(body)
        planned = fields.whole("planned_seconds", 0, MAX_PLANNED_SECONDS)
        if isinstance(planned, int) and planned % 60 != 0:
            fields.fail("planned_seconds", "Use a whole number of minutes.")
        if not filters.is_filter(filter_name):
            fields.fail("filter", "That is not one of the seven filters.")
        fields.done()
        return planned

    await projects.set_allotment(imager_id, project_id, filter_name, read_planned)
    return json_response(
        await projects.project_body(await projects.project_row(imager_id, project_id))
    )


async def read_ledger(request: Request) -> Response:
    imager_id = imager_of(request)
    project_id = request.path_params["project_id"]
    await projects.project_row(imager_id, project_id)
    return json_response({"entries": await projects.ledger_entries(project_id)})


# --- sharing ----------------------------------------------------------------


async def create_share(request: Request) -> Response:
    imager_id = imager_of(request)
    project_id = request.path_params["project_id"]
    body = await read_json_body(request)
    await projects.project_row(imager_id, project_id)
    fields = Fields(body)
    expires_at = fields.instant("expires_at", default=None, nullable=True)
    if expires_at is not None and expires_at <= timeutil.now_utc():
        fields.fail("expires_at", "Choose a time in the future.")
    fields.done()
    return json_response(
        await shares.create_link(imager_id, project_id, expires_at), 201
    )


async def read_share(request: Request) -> Response:
    imager_id = imager_of(request)
    project_id = request.path_params["project_id"]
    await projects.project_row(imager_id, project_id)
    return json_response(await shares.live_link(project_id))


async def delete_share(request: Request) -> Response:
    imager_id = imager_of(request)
    project_id = request.path_params["project_id"]
    await projects.project_row(imager_id, project_id)
    await shares.revoke_link(project_id)
    return Response(status_code=204)


async def read_shared(request: Request) -> Response:
    token = request.path_params["token"]
    imager_id = await shares.imager_of_token(token)
    site = await site_facts(imager_id, request_id_of(request))
    return json_response(await shares.shared_body(token, site))


# --- sessions ---------------------------------------------------------------


async def list_sessions(request: Request) -> Response:
    project_id = request.query_params.get("project_id")
    include_trashed = request.query_params.get("include_trashed") == "true"
    if project_id:
        await projects.project_row(imager_of(request), project_id)
    return json_response(
        {
            "sessions": await sessions.sessions_for(
                imager_of(request), project_id, include_trashed
            )
        }
    )


async def create_session(request: Request) -> Response:
    imager_id = imager_of(request)
    body = await read_json_body(request)
    project_id = _text_field(body, "project_id")
    await projects.project_row(imager_id, project_id)

    async def read_session() -> tuple[Any, str]:
        fields = Fields(body)
        observing_date = fields.day("observing_date")
        notes = fields.text("notes", 0, 10_000, default="")
        fields.done()
        return (observing_date, notes)

    session_id = await sessions.create_session(imager_id, project_id, read_session)
    return json_response(await sessions.body_of(imager_id, session_id), 201)


async def read_session(request: Request) -> Response:
    return json_response(
        await sessions.body_of(imager_of(request), request.path_params["session_id"])
    )


async def start_session(request: Request) -> Response:
    imager_id = imager_of(request)
    session_id = request.path_params["session_id"]
    body = await read_json_body(request)
    await sessions.session_row(imager_id, session_id)
    site = await site_facts(imager_id, request_id_of(request))

    async def read_start() -> Any:
        fields = Fields(body)
        started_at = fields.instant("started_at", default=None, nullable=True)
        fields.done()
        return started_at or timeutil.now_utc()

    await sessions.start_session(imager_id, session_id, read_start, site.time_zone)
    return json_response(await sessions.body_of(imager_id, session_id))


def _batch_fields(
    body: dict[str, Any], allotted: set[str], prefix: str = ""
) -> dict[str, Any]:
    fields = Fields(body, prefix=prefix)
    filter_name = fields.choice("filter", filters.FILTER_ORDER)
    if isinstance(filter_name, str) and filter_name not in allotted:
        fields.fail("filter", "This filter is not planned for the project.")
    values = {
        "filter": filter_name,
        "sub_count": fields.whole("sub_count", 1, 10_000),
        "exposure_s": fields.whole("exposure_s", 1, 3600),
        "camera": fields.text("camera", 1, 60),
        "gain": fields.whole("gain", 0, 1000),
        "offset": fields.whole("offset", 0, 1000),
        "temperature_c": fields.one_decimal("temperature_c", -40.0, 40.0),
        "binning": fields.whole("binning", 1, 4),
    }
    fields.done()
    return values


async def add_batch(request: Request) -> Response:
    imager_id = imager_of(request)
    session_id = request.path_params["session_id"]
    body = await read_json_body(request)
    await sessions.session_row(imager_id, session_id)
    key = request.headers.get("idempotency-key", "")
    if not 1 <= len(key) <= 100:
        raise validation({"Idempotency-Key": "Send an idempotency key."})
    fingerprint = sessions.body_fingerprint(body)
    owned, stored = await sessions.claim_idempotency(imager_id, key, fingerprint)
    if not owned and stored is not None:
        return json_response(stored["body"], stored["status"])

    async def validate_fields(project_id: str) -> dict[str, Any]:
        return _batch_fields(body, await projects.allotted_filters(project_id))

    try:
        batch_id = await sessions.add_batch(imager_id, session_id, validate_fields)
    except BaseException:
        await sessions.drop_idempotency_claim(imager_id, key)
        raise
    reply = {
        "batch": await sessions.batch_body_of(imager_id, batch_id),
        "session": await sessions.body_of(imager_id, session_id),
    }
    await sessions.store_idempotent_reply(imager_id, key, 201, reply)
    return json_response(reply, 201)


async def log_session(request: Request) -> Response:
    imager_id = imager_of(request)
    session_id = request.path_params["session_id"]
    await read_json_body(request)
    await sessions.session_row(imager_id, session_id)
    await sessions.log_session(imager_id, session_id)
    return json_response(await sessions.body_of(imager_id, session_id))


async def amend_session(request: Request) -> Response:
    imager_id = imager_of(request)
    session_id = request.path_params["session_id"]
    body = await read_json_body(request)
    await sessions.session_row(imager_id, session_id)
    raw = body.get("batches")
    shaped = (
        isinstance(raw, list)
        and bool(raw)
        and all(isinstance(item, dict) for item in raw)
        and all(
            item.get("id") is None or isinstance(item.get("id"), str) for item in raw
        )
    )
    offered = (
        [item["id"] for item in raw if item.get("id") is not None] if shaped else []
    )

    async def validate_batches(project_id: str) -> list[dict[str, Any]]:
        if not shaped:
            raise validation({"batches": "Send at least one batch."})
        allotted = await projects.allotted_filters(project_id)
        amended: list[dict[str, Any]] = []
        for index, item in enumerate(raw):
            values = _batch_fields(item, allotted, prefix=f"batches[{index}].")
            values["id"] = item.get("id")
            amended.append(values)
        return amended

    await sessions.amend_session(imager_id, session_id, offered, validate_batches)
    return json_response(await sessions.body_of(imager_id, session_id))


async def trash_session(request: Request) -> Response:
    imager_id = imager_of(request)
    session_id = request.path_params["session_id"]
    await sessions.session_row(imager_id, session_id)
    await sessions.trash_session(imager_id, session_id)
    return json_response(await sessions.body_of(imager_id, session_id))


async def restore_session(request: Request) -> Response:
    imager_id = imager_of(request)
    session_id = request.path_params["session_id"]
    await sessions.session_row(imager_id, session_id)
    await sessions.restore_session(imager_id, session_id)
    return json_response(await sessions.body_of(imager_id, session_id))


async def take_lock(request: Request) -> Response:
    imager_id = imager_of(request)
    session_id = request.path_params["session_id"]
    body = await read_json_body(request)
    await sessions.session_row(imager_id, session_id)
    offered = body.get("lock_token")
    return json_response(
        await sessions.take_lock(
            imager_id, session_id, offered if isinstance(offered, str) else None
        )
    )


async def release_lock(request: Request) -> Response:
    imager_id = imager_of(request)
    session_id = request.path_params["session_id"]
    body = await read_json_body(request)
    await sessions.session_row(imager_id, session_id)
    await sessions.release_lock(imager_id, session_id, _text_field(body, "lock_token"))
    return Response(status_code=204)


async def save_notes(request: Request) -> Response:
    imager_id = imager_of(request)
    session_id = request.path_params["session_id"]
    body = await read_json_body(request)
    await sessions.session_row(imager_id, session_id)

    async def read_notes() -> tuple[str, str]:
        fields = Fields(body)
        notes = fields.text("notes", 0, 10_000)
        token = fields.text("lock_token", 1, 200)
        fields.done()
        return (notes, token)

    await sessions.save_notes(imager_id, session_id, read_notes)
    return json_response(await sessions.body_of(imager_id, session_id))


# --- frames -----------------------------------------------------------------


async def put_frame(request: Request) -> Response:
    imager_id = imager_of(request)
    batch_id = request.path_params["batch_id"]
    name = request.path_params["name"]
    payload = await read_upload_body(request, UPLOAD_CONTENT_TYPES)
    content_type = request.headers.get("content-type", "").split(";")[0].strip()
    batch = await sessions.batch_row(imager_id, batch_id)
    sessions.guard_frame_upload(batch["session_state"])
    if not OBJECT_NAME.match(name):
        raise validation({"name": "Use letters, digits, dots, dashes or underscores."})
    if not payload:
        raise validation({"body": "Upload at least one byte."})
    existing = await DATABASE.fetchval(
        "select 1 from ledger.frames where batch_id = $1 and name = $2", batch_id, name
    )
    if existing:
        raise conflict("frame_exists", "That frame name is already used in this batch.")

    frame_id = ids.record_id("frm")
    key = (
        f"frames/{imager_id}/{batch['session_id']}/{batch_id}/{frame_id}/{name}"
    )
    digest = hashlib.sha256(payload).hexdigest()
    try:
        await objectstore.put_object(key, payload, content_type)
        size, stored_digest = await objectstore.confirm_object(key)
    except objectstore.StorageError:
        raise storage_unavailable(
            "Frame storage is unreachable. The frame was not counted."
        )
    if size != len(payload) or stored_digest != digest:
        raise storage_unavailable(
            "Frame storage is unreachable. The frame was not counted."
        )
    await DATABASE.execute(
        """
        insert into ledger.frames (id, imager_id, session_id, batch_id, name,
            size_bytes, content_type, sha256, object_key)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        """,
        frame_id,
        imager_id,
        batch["session_id"],
        batch_id,
        name,
        len(payload),
        content_type,
        digest,
        key,
    )
    row = await DATABASE.fetchrow("select * from ledger.frames where id = $1", frame_id)
    count = await DATABASE.fetchval(
        "select count(*) from ledger.frames where session_id = $1", batch["session_id"]
    )
    return json_response(
        {"frame": sessions.frame_body(row), "session_frame_count": int(count)}, 201
    )


async def read_frame(request: Request) -> Response:
    row = await DATABASE.fetchrow(
        "select * from ledger.frames where id = $1 and imager_id = $2",
        request.path_params["frame_id"],
        imager_of(request),
    )
    if row is None:
        raise not_found()
    try:
        payload = await objectstore.get_object(row["object_key"])
    except objectstore.StorageError:
        raise storage_unavailable("Frame storage is unreachable. Try again shortly.")
    return Response(payload, media_type=row["content_type"])


# --- calibration ------------------------------------------------------------


async def list_sets(request: Request) -> Response:
    site = await _site(request)
    return json_response(
        {"calibration_sets": await calibration.list_sets(imager_of(request), site.today())}
    )


def _set_fields(body: dict[str, Any], kind: str, today: Any) -> dict[str, Any]:
    fields = Fields(body)
    values = {
        "name": fields.text("name", 1, 80),
        "camera": fields.text("camera", 1, 60),
        "gain": fields.whole("gain", 0, 1000),
        "offset": fields.whole("offset", 0, 1000),
        "temperature_c": fields.one_decimal("temperature_c", -40.0, 40.0),
        "binning": fields.whole("binning", 1, 4),
        "frame_count": fields.whole("frame_count", 1, 1000),
        "captured_on": fields.day("captured_on"),
        "exposure_s": None,
        "filter": None,
    }
    if kind == "dark":
        values["exposure_s"] = fields.whole("exposure_s", 1, 3600)
    elif body.get("exposure_s") is not None:
        fields.fail("exposure_s", "Only a dark set has an exposure.")
    if kind == "flat":
        values["filter"] = fields.choice("filter", filters.FILTER_ORDER)
    elif body.get("filter") is not None:
        fields.fail("filter", "Only a flat set has a filter.")
    if values["captured_on"] is not None and values["captured_on"] > today:
        fields.fail("captured_on", "Choose a date no later than today.")
    fields.done()
    return values


async def create_set(request: Request) -> Response:
    imager_id = imager_of(request)
    body = await read_json_body(request)
    site = await _site(request)
    kind_check = Fields(body)
    kind = kind_check.choice("kind", calibration_rules.KINDS)
    kind_check.done()
    values = _set_fields(body, kind, site.today())
    set_id = await calibration.create_set(imager_id, kind, values)
    return json_response(
        calibration.set_body(
            await calibration.set_row(imager_id, set_id), site.today()
        ),
        201,
    )


async def read_set(request: Request) -> Response:
    site = await _site(request)
    row = await calibration.set_row(
        imager_of(request), request.path_params["set_id"]
    )
    return json_response(calibration.set_body(row, site.today()))


async def patch_set(request: Request) -> Response:
    imager_id = imager_of(request)
    set_id = request.path_params["set_id"]
    body = await read_json_body(request)
    row = await calibration.set_row(imager_id, set_id)
    if row["status"] == calibration_rules.RETIRED:
        raise conflict("set_retired", "A retired set cannot be changed.")
    site = await _site(request)
    if "kind" in body:
        raise validation({"kind": "The kind of a set cannot change."})
    merged = {
        "name": row["name"],
        "camera": row["camera"],
        "gain": row["gain"],
        "offset": row["offset_value"],
        "exposure_s": row["exposure_s"],
        "temperature_c": float(row["temperature_c"]),
        "binning": row["binning"],
        "filter": row["filter"],
        "frame_count": row["frame_count"],
        "captured_on": row["captured_on"].isoformat(),
    }
    merged.update({name: body[name] for name in body if name in merged})
    values = _set_fields(merged, row["kind"], site.today())
    await calibration.edit_set(imager_id, set_id, values)
    return json_response(
        calibration.set_body(
            await calibration.set_row(imager_id, set_id), site.today()
        )
    )


async def put_master(request: Request) -> Response:
    imager_id = imager_of(request)
    set_id = request.path_params["set_id"]
    payload = await read_upload_body(request, MASTER_CONTENT_TYPES)
    content_type = request.headers.get("content-type", "").split(";")[0].strip()
    row = await calibration.set_row(imager_id, set_id)
    if row["status"] == calibration_rules.RETIRED:
        raise conflict("set_retired", "A retired set cannot be changed.")
    filename = request.query_params.get("filename", "")
    if not OBJECT_NAME.match(filename):
        raise validation(
            {"filename": "Use letters, digits, dots, dashes or underscores."}
        )
    if not payload:
        raise validation({"body": "Upload at least one byte."})
    version = row["version"] + 1
    key = f"calibration/{imager_id}/{set_id}/v{version}/{filename}"
    digest = hashlib.sha256(payload).hexdigest()
    try:
        await objectstore.put_object(key, payload, content_type)
        size, stored_digest = await objectstore.confirm_object(key)
    except objectstore.StorageError:
        raise storage_unavailable(
            "Calibration storage is unreachable. The master was not recorded."
        )
    if size != len(payload) or stored_digest != digest:
        raise storage_unavailable(
            "Calibration storage is unreachable. The master was not recorded."
        )
    await calibration.record_master(
        imager_id,
        set_id,
        {
            "filename": filename,
            "size_bytes": len(payload),
            "sha256": digest,
            "object_key": key,
            "content_type": content_type,
        },
    )
    site = await _site(request)
    return json_response(
        calibration.set_body(
            await calibration.set_row(imager_id, set_id), site.today()
        )
    )


async def read_master(request: Request) -> Response:
    imager_id = imager_of(request)
    key, content_type = await calibration.master_object(
        imager_id, request.path_params["set_id"]
    )
    try:
        payload = await objectstore.get_object(key)
    except objectstore.StorageError:
        raise storage_unavailable(
            "Calibration storage is unreachable. Try again shortly."
        )
    return Response(payload, media_type=content_type)


async def transition_set(request: Request) -> Response:
    imager_id = imager_of(request)
    set_id = request.path_params["set_id"]
    body = await read_json_body(request)
    await calibration.set_row(imager_id, set_id)
    site = await _site(request)
    fields = Fields(body)
    to_state = fields.choice(
        "to", (calibration_rules.READY, calibration_rules.RETIRED)
    )
    fields.done()
    await calibration.transition(imager_id, set_id, to_state, site.today())
    return json_response(
        calibration.set_body(
            await calibration.set_row(imager_id, set_id), site.today()
        )
    )


async def list_versions(request: Request) -> Response:
    return json_response(
        {
            "versions": await calibration.versions(
                imager_of(request), request.path_params["set_id"]
            )
        }
    )


async def restore_set_version(request: Request) -> Response:
    imager_id = imager_of(request)
    set_id = request.path_params["set_id"]
    body = await read_json_body(request)
    await calibration.set_row(imager_id, set_id)
    fields = Fields(body)
    version = fields.whole("version", 1, 1_000_000)
    fields.done()
    await calibration.restore_version(imager_id, set_id, version)
    site = await _site(request)
    return json_response(
        calibration.set_body(
            await calibration.set_row(imager_id, set_id), site.today()
        )
    )


async def list_candidates(request: Request) -> Response:
    imager_id = imager_of(request)
    batch = await sessions.batch_row(imager_id, request.path_params["batch_id"])
    site = await _site(request)
    return json_response(
        {"candidates": await calibration.candidates(imager_id, batch, site.today())}
    )


async def link_calibration(request: Request) -> Response:
    imager_id = imager_of(request)
    batch_id = request.path_params["batch_id"]
    body = await read_json_body(request)
    batch = await sessions.batch_row(imager_id, batch_id)
    set_id = _text_field(body, "calibration_set_id")
    await calibration.set_row(imager_id, set_id)
    if batch["session_state"] == "trashed":
        raise conflict("wrong_state", "A trashed session cannot be calibrated.")
    site = await _site(request)
    warning = await calibration.link(imager_id, batch, set_id, site.today())
    return json_response(
        {
            "batch": await sessions.batch_body_of(imager_id, batch_id),
            "warning": warning,
        }
    )


async def unlink_calibration(request: Request) -> Response:
    imager_id = imager_of(request)
    batch_id = request.path_params["batch_id"]
    batch = await sessions.batch_row(imager_id, batch_id)
    await calibration.unlink(imager_id, batch, request.path_params["kind"])
    return json_response(await sessions.batch_body_of(imager_id, batch_id))


async def seed(request: Request) -> Response:
    body = await read_json_body(request)
    await apply_seed(body["imagers"])
    return Response(status_code=204)


ROUTES = [
    Route("/internal/projects", list_projects, methods=["GET"]),
    Route("/internal/projects", create_project, methods=["POST"]),
    Route("/internal/projects/{project_id}", read_project, methods=["GET"]),
    Route("/internal/projects/{project_id}", patch_project, methods=["PATCH"]),
    Route(
        "/internal/projects/{project_id}/transition",
        transition_project,
        methods=["POST"],
    ),
    Route(
        "/internal/projects/{project_id}/allotments/{filter_name}",
        put_allotment,
        methods=["PUT"],
    ),
    Route("/internal/projects/{project_id}/ledger", read_ledger, methods=["GET"]),
    Route("/internal/projects/{project_id}/share", create_share, methods=["POST"]),
    Route("/internal/projects/{project_id}/share", read_share, methods=["GET"]),
    Route("/internal/projects/{project_id}/share", delete_share, methods=["DELETE"]),
    Route("/internal/shared/{token}", read_shared, methods=["GET"]),
    Route("/internal/sessions", list_sessions, methods=["GET"]),
    Route("/internal/sessions", create_session, methods=["POST"]),
    Route("/internal/sessions/{session_id}", read_session, methods=["GET"]),
    Route("/internal/sessions/{session_id}/start", start_session, methods=["POST"]),
    Route("/internal/sessions/{session_id}/batches", add_batch, methods=["POST"]),
    Route("/internal/sessions/{session_id}/log", log_session, methods=["POST"]),
    Route("/internal/sessions/{session_id}/amend", amend_session, methods=["POST"]),
    Route("/internal/sessions/{session_id}/trash", trash_session, methods=["POST"]),
    Route(
        "/internal/sessions/{session_id}/restore", restore_session, methods=["POST"]
    ),
    Route("/internal/sessions/{session_id}/lock", take_lock, methods=["POST"]),
    Route("/internal/sessions/{session_id}/lock", release_lock, methods=["DELETE"]),
    Route("/internal/sessions/{session_id}/notes", save_notes, methods=["PATCH"]),
    Route("/internal/batches/{batch_id}/frames/{name}", put_frame, methods=["PUT"]),
    Route("/internal/frames/{frame_id}/content", read_frame, methods=["GET"]),
    Route(
        "/internal/batches/{batch_id}/calibration-candidates",
        list_candidates,
        methods=["GET"],
    ),
    Route(
        "/internal/batches/{batch_id}/calibration",
        link_calibration,
        methods=["POST"],
    ),
    Route(
        "/internal/batches/{batch_id}/calibration/{kind}",
        unlink_calibration,
        methods=["DELETE"],
    ),
    Route("/internal/calibration-sets", list_sets, methods=["GET"]),
    Route("/internal/calibration-sets", create_set, methods=["POST"]),
    Route("/internal/calibration-sets/{set_id}", read_set, methods=["GET"]),
    Route("/internal/calibration-sets/{set_id}", patch_set, methods=["PATCH"]),
    Route("/internal/calibration-sets/{set_id}/master", put_master, methods=["PUT"]),
    Route("/internal/calibration-sets/{set_id}/master", read_master, methods=["GET"]),
    Route(
        "/internal/calibration-sets/{set_id}/transition",
        transition_set,
        methods=["POST"],
    ),
    Route(
        "/internal/calibration-sets/{set_id}/versions", list_versions, methods=["GET"]
    ),
    Route(
        "/internal/calibration-sets/{set_id}/restore",
        restore_set_version,
        methods=["POST"],
    ),
    Route("/internal/seed", seed, methods=["POST"]),
]

app = build_service("ledger", ROUTES)
