"""Connections, jobs, live events, Builder projects, audit log."""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import threading

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from . import accounts, builder, catalog, config, connections, db, domain, sync, validation
from .core import ApiError, json_error, validation as validation_error
from .routes import (bearer_token, current_user, get_limit, idempotency_key,
                     idempotent_replay, need_db, record_idempotency, require_role)

router = APIRouter()


# ---------------------------------------------------------------- connections

CONN_FIELDS = {
    "name": True, "source_id": True, "destination_id": True, "namespace_prefix": True,
    "streams": [{"name": True, "selected": True, "sync_mode": True, "cursor_field": True,
                 "primary_key": True}],
    "schedule": {"type": True, "interval_minutes": True, "cron_expression": True,
                 "time_zone": True},
    "schema_change_policy": True,
}
CONN_TYPES = {
    "name": str, "source_id": str, "destination_id": str, "namespace_prefix": str,
    "streams": (list, {"name": str, "selected": bool, "sync_mode": str, "cursor_field": str,
                       "primary_key": list}),
    "schedule": {"type": str, "interval_minutes": int, "cron_expression": str, "time_zone": str},
    "schema_change_policy": str,
}


@router.get("/api/connections")
def list_connections(request: Request):
    need_db()
    user, workspace_id, _, _ = current_user(request)
    with db.connection() as conn:
        rows = connections.list_connections(conn, workspace_id)
    return {"connections": [connections.connection_payload(r) for r in rows]}


@router.post("/api/connections")
async def create_connection(request: Request):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "editor")
    raw = await request.body()
    key = idempotency_key(request)
    fingerprint = json.loads(json.dumps(body_fingerprint(raw)))
    if key:
        with db.connection() as conn:
            replay = idempotent_replay(conn, workspace_id, key, "POST", "/api/connections",
                                       fingerprint)
        if replay is not None:
            with db.connection() as conn:
                row = connections.connection_by_id(conn, workspace_id, replay["resource_id"])
            if row is None:
                raise ApiError("not_found", 404)
            return JSONResponse({"connection": connections.connection_payload(row)}, status_code=200)
    body = validation.validate_body(raw, CONN_FIELDS, CONN_TYPES)
    errors: dict[str, str] = {}
    name = body.get("name")
    if not isinstance(name, str) or not (1 <= len(name.strip()) <= 80):
        errors["name"] = "Enter a name of 1 to 80 characters."
    prefix = body.get("namespace_prefix")
    if not isinstance(prefix, str) or not domain.valid_prefix(prefix):
        errors["namespace_prefix"] = "Use a lowercase letter then letters, digits or underscores."
    policy = body.get("schema_change_policy")
    if policy not in ("propagate", "ignore", "pause"):
        errors["schema_change_policy"] = "Choose propagate, ignore or pause."
    with db.connection() as conn:
        source = None
        destination = None
        source_id = body.get("source_id")
        destination_id = body.get("destination_id")
        if isinstance(source_id, str):
            source = catalog.source_by_id(conn, workspace_id, source_id)
        if isinstance(destination_id, str):
            destination = catalog.destination_by_id(conn, workspace_id, destination_id)
        if source is None or not domain.is_well_formed_id(source_id or ""):
            errors["source_id"] = "Choose a source in this workspace."
        else:
            if destination is None or not domain.is_well_formed_id(destination_id or ""):
                errors["destination_id"] = "Choose a destination in this workspace."
        if errors:
            raise validation_error(errors)
        definition = catalog.definition_row(conn, source["definition_id"])
        custom = bool(definition["custom"])
        if custom:
            stream_catalog = catalog.custom_catalog(definition, int(definition["version"]))
        else:
            state = catalog.source_state(conn, source["id"])
            stream_catalog = catalog.sample_catalog(state)
        streams = connections.validate_streams(body.get("streams"), stream_catalog, custom, errors)
        workspace_row = accounts.workspace(conn, workspace_id)
        min_interval = accounts.min_interval_minutes(workspace_row["plan"])
        schedule = connections.validate_schedule(body.get("schedule") or {}, custom, min_interval, errors)
        if errors:
            final_errors = {k: v for k, v in errors.items() if k != "__frequency__"}
            if errors.get("__frequency__"):
                raise ApiError("frequency_exceeds_plan", 422)
            raise validation_error(final_errors)
        with db.tx() as txn:
            if connections.name_taken(conn, workspace_id, name.strip()):
                raise ApiError("name_taken", 409)
            targets = connections.table_targets(conn, destination_id)
            for stream in streams:
                if stream.get("selected"):
                    table = catalog.table_name(prefix, stream["name"])
                    if table in targets:
                        raise ApiError("table_conflict", 409)
            connection_id = domain.new_id("con_")
            now = dt.datetime.now(dt.timezone.utc)
            conn.execute(
                "INSERT INTO connections (id, workspace_id, name, status, version, source_id, "
                "destination_id, namespace_prefix, streams, schedule, schema_change_policy, cursors) "
                "VALUES (%s,%s,%s,'active',1,%s,%s,%s,%s,%s,%s,'{}'::jsonb)",
                (connection_id, workspace_id, name.strip(), source_id, destination_id, prefix,
                 json.dumps(streams), json.dumps(schedule), policy))
            accounts.write_audit(conn, workspace_id, "connection.created", connection_id,
                                 user["email"])
            connections.recompute_next_run(conn, connection_id)
            if key:
                record_idempotency(conn, workspace_id, key, "POST", "/api/connections",
                                   fingerprint, connection_id)
            row = connections.connection_by_id(conn, workspace_id, connection_id)
    return JSONResponse({"connection": connections.connection_payload(row)}, status_code=201)


def body_fingerprint(raw: bytes) -> dict:
    try:
        parsed = json.loads(raw.decode()) if raw else {}
    except Exception:
        parsed = {}
    return parsed if isinstance(parsed, dict) else {}


@router.get("/api/connections/{connection_id}")
def one_connection(request: Request, connection_id: str):
    need_db()
    user, workspace_id, _, _ = current_user(request)
    with db.connection() as conn:
        row = connections.connection_by_id(conn, workspace_id, connection_id)
    if row is None or not domain.is_well_formed_id(connection_id):
        raise ApiError("not_found", 404)
    response = JSONResponse({"connection": connections.connection_payload(row)})
    response.headers["ETag"] = f'"{int(row["version"])}"'
    return response


PATCH_FIELDS = {
    "name": True, "streams": CONN_FIELDS["streams"], "schedule": CONN_FIELDS["schedule"],
    "schema_change_policy": True, "status": True,
}
PATCH_TYPES = {
    "name": str, "streams": CONN_TYPES["streams"], "schedule": CONN_TYPES["schedule"],
    "schema_change_policy": str, "status": str,
}


@router.patch("/api/connections/{connection_id}")
async def patch_connection(request: Request, connection_id: str):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "editor")
    if_match = request.headers.get("if-match")
    if not if_match:
        raise ApiError("precondition_required", 428)
    with db.connection() as conn:
        row = connections.connection_by_id(conn, workspace_id, connection_id)
        if row is None or not domain.is_well_formed_id(connection_id):
            raise ApiError("not_found", 404)
        current_version = int(row["version"])
    try:
        wanted = int(json.loads(if_match))
    except (ValueError, json.JSONDecodeError):
        wanted = None
    if if_match.strip().strip('"') != str(current_version):
        return JSONResponse({"error": "version_mismatch", "current_version": current_version,
                             "request_id": request.state.request_id}, status_code=412)
    raw = await request.body()
    body = validation.validate_body(raw, PATCH_FIELDS, PATCH_TYPES)
    errors: dict[str, str] = {}
    with db.connection() as conn:
        row = connections.connection_by_id(conn, workspace_id, connection_id)
        if row is None:
            raise ApiError("not_found", 404)
        source = catalog.source_by_id(conn, workspace_id, row["source_id"])
        definition = catalog.definition_row(conn, source["definition_id"])
        custom = bool(definition["custom"])
        if custom:
            stream_catalog = catalog.custom_catalog(definition, int(definition["version"]))
        else:
            state = catalog.source_state(conn, source["id"])
            stream_catalog = catalog.sample_catalog(state)
        new_streams = row["streams"]
        if "streams" in body:
            new_streams = connections.validate_streams(body["streams"], stream_catalog, custom, errors)
        new_schedule = row["schedule"]
        if "schedule" in body:
            workspace_row = accounts.workspace(conn, workspace_id)
            min_interval = accounts.min_interval_minutes(workspace_row["plan"])
            new_schedule = connections.validate_schedule(body["schedule"], custom, min_interval, errors)
        new_policy = row["schema_change_policy"]
        if "schema_change_policy" in body:
            if body["schema_change_policy"] not in ("propagate", "ignore", "pause"):
                errors["schema_change_policy"] = "Choose propagate, ignore or pause."
            else:
                new_policy = body["schema_change_policy"]
        new_status = row["status"]
        if "status" in body:
            if body["status"] not in ("active", "inactive"):
                errors["status"] = "Choose active or inactive."
            else:
                new_status = body["status"]
        new_name = row["name"]
        if "name" in body:
            if not isinstance(body["name"], str) or not (1 <= len(body["name"].strip()) <= 80):
                errors["name"] = "Enter a name of 1 to 80 characters."
            else:
                new_name = body["name"].strip()
        if errors:
            if errors.get("__frequency__"):
                raise ApiError("frequency_exceeds_plan", 422)
            raise validation_error(errors)
        # reactivate adopts current fields as the known schema
        streams_for_write = new_streams
        if new_status == "active" and row["status"] == "inactive":
            adopted = []
            for stream in new_streams:
                entry = dict(stream)
                catalog_entry = next((s for s in stream_catalog if s["name"] == stream["name"]), None)
                if catalog_entry is not None:
                    entry["known_fields"] = list(catalog_entry["fields"])
                adopted.append(entry)
            streams_for_write = adopted
        with db.tx() as txn:
            if new_name != row["name"] and connections.name_taken(conn, workspace_id, new_name):
                raise ApiError("name_taken", 409)
            if "streams" in body:
                others = connections.table_targets_excluding(conn, row["destination_id"],
                                                             connection_id)
                for stream in new_streams:
                    if stream.get("selected"):
                        table = catalog.table_name(row["namespace_prefix"], stream["name"])
                        if table in others:
                            raise ApiError("table_conflict", 409)
            new_version = current_version + 1
            conn.execute(
                "UPDATE connections SET name=%s, streams=%s, schedule=%s, "
                "schema_change_policy=%s, status=%s, version=%s, updated_at=now() WHERE id=%s",
                (new_name, json.dumps(streams_for_write), json.dumps(new_schedule), new_policy,
                 new_status, new_version, connection_id))
            accounts.write_audit(conn, workspace_id, "connection.updated", connection_id,
                                 user["email"])
            connections.recompute_next_run(conn, connection_id)
            updated = connections.connection_by_id(conn, workspace_id, connection_id)
    response = JSONResponse({"connection": connections.connection_payload(updated)})
    response.headers["ETag"] = f'"{new_version}"'
    return response


@router.get("/api/connections/{connection_id}/state")
def connection_state(request: Request, connection_id: str):
    need_db()
    user, workspace_id, _, _ = current_user(request)
    with db.connection() as conn:
        row = connections.connection_by_id(conn, workspace_id, connection_id)
    if row is None or not domain.is_well_formed_id(connection_id):
        raise ApiError("not_found", 404)
    return {"streams": connections.state_payload(row)}


@router.post("/api/connections/{connection_id}/reset")
async def reset_connection(request: Request, connection_id: str):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "editor")
    raw = await request.body()
    if raw and raw.strip() not in (b"{}", b""):
        validation.validate_body(raw, {}, None)
    with db.tx() as conn:
        row = connections.connection_by_id(conn, workspace_id, connection_id)
        if row is None or not domain.is_well_formed_id(connection_id):
            raise ApiError("not_found", 404)
        active = conn.execute("SELECT 1 FROM jobs WHERE connection_id = %s AND status IN ('pending','running')",
                              (connection_id,)).fetchone()
        if active is not None:
            raise ApiError("sync_already_running", 409)
        schema = catalog.warehouse_schema(row["destination_id"])
        prefix = row["namespace_prefix"]
        for stream in row["streams"]:
            if not stream.get("selected"):
                continue
            table = catalog.table_name(prefix, stream["name"])
            if catalog.table_exists(conn, row["destination_id"], table):
                conn.execute(f'DELETE FROM {schema}."{table}"')
                catalog.bump_generation(conn, row["destination_id"], table)
        conn.execute("UPDATE connections SET cursors='{}'::jsonb WHERE id=%s", (connection_id,))
        accounts.write_audit(conn, workspace_id, "connection.reset", connection_id, user["email"])
        updated = connections.connection_by_id(conn, workspace_id, connection_id)
    return {"connection": connections.connection_payload(updated)}


@router.post("/api/connections/{connection_id}/sync")
async def start_sync(request: Request, connection_id: str):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "editor")
    raw = await request.body()
    if raw and raw.strip() not in (b"{}", b""):
        validation.validate_body(raw, {}, None)
    key = idempotency_key(request)
    fingerprint = body_fingerprint(raw)
    if key:
        with db.connection() as conn:
            replay = idempotent_replay(conn, workspace_id, key, "POST",
                                       f"/api/connections/{connection_id}/sync", fingerprint)
        if replay is not None:
            with db.connection() as conn:
                row = sync.job_by_id_ws(conn, workspace_id, replay["resource_id"])
            from .routes import job_payload

            return JSONResponse({"job": job_payload(row)}, status_code=200)
    with db.tx() as conn:
        row = connections.connection_by_id(conn, workspace_id, connection_id)
        if row is None or not domain.is_well_formed_id(connection_id):
            raise ApiError("not_found", 404)
        if row["status"] != "active":
            raise ApiError("connection_inactive", 409)
        active = conn.execute("SELECT 1 FROM jobs WHERE connection_id = %s AND status IN ('pending','running')",
                               (connection_id,)).fetchone()
        if active is not None:
            if key:
                pass
            raise ApiError("sync_already_running", 409)
        job_info = sync.start_job(conn, row, None, user["id"], request.state.request_id)
        accounts.write_audit(conn, workspace_id, "sync.started", job_info["id"], user["email"])
        if key:
            record_idempotency(conn, workspace_id, key, "POST",
                               f"/api/connections/{connection_id}/sync", fingerprint,
                               job_info["id"])
        job_row = sync.job_by_id(conn, job_info["id"])
    threading.Thread(target=sync.run_to_completion, args=(job_row["id"],), daemon=True).start()
    return JSONResponse({"job": _job_payload(job_row)}, status_code=201)


def _job_payload(row) -> dict:
    from .routes import job_payload

    return job_payload(row)


# ---------------------------------------------------------------- jobs

@router.get("/api/jobs")
def jobs(request: Request):
    need_db()
    user, workspace_id, _, _ = current_user(request)
    limit = get_limit(request.query_params.get("limit"), 20)
    cursor_raw = request.query_params.get("cursor")
    connection_id = request.query_params.get("connection_id")
    with db.connection() as conn:
        if connection_id is not None:
            row = connections.connection_by_id(conn, workspace_id, connection_id)
            if row is None or not domain.is_well_formed_id(connection_id):
                raise ApiError("not_found", 404)
        payload = domain.decode_cursor(cursor_raw)
        if cursor_raw and payload is None:
            raise ApiError("invalid_cursor", 400)
        if payload is not None:
            if payload.get("w") != workspace_id or payload.get("c") != connection_id:
                raise ApiError("invalid_cursor", 400)
        if payload is None:
            rows = conn.execute(
                "SELECT * FROM jobs WHERE workspace_id = %s "
                + ("AND connection_id = %s " if connection_id else "") +
                "ORDER BY created_at DESC, id DESC LIMIT %s",
                tuple(filter(None, [workspace_id, connection_id, limit]))).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM jobs WHERE workspace_id = %s "
                + ("AND connection_id = %s " if connection_id else "") +
                "AND (created_at, id) < (%s, %s) ORDER BY created_at DESC, id DESC LIMIT %s",
                tuple(filter(None, [workspace_id, connection_id, payload["t"], payload["i"], limit]))).fetchall()
        next_cursor = None
        has_more = False
        if len(rows) == limit:
            last = rows[-1]
            has_more = conn.execute(
                "SELECT 1 FROM jobs WHERE workspace_id = %s "
                + ("AND connection_id = %s " if connection_id else "") +
                "AND (created_at, id) < (%s, %s) LIMIT 1",
                tuple(filter(None, [workspace_id, connection_id, last["created_at"], last["id"]]))).fetchone() is not None
            if has_more:
                next_cursor = domain.encode_cursor({"w": workspace_id, "c": connection_id,
                                                    "t": domain.to_zulu(last["created_at"]),
                                                    "i": last["id"]})
    from .routes import job_payload

    return {"jobs": [job_payload(r) for r in rows], "next_cursor": next_cursor,
            "has_more": has_more}


@router.get("/api/jobs/{job_id}")
def one_job(request: Request, job_id: str):
    need_db()
    user, workspace_id, _, _ = current_user(request)
    with db.connection() as conn:
        row = sync.job_by_id_ws(conn, workspace_id, job_id)
    if row is None or not domain.is_well_formed_id(job_id):
        raise ApiError("not_found", 404)
    from .routes import job_payload

    return {"job": job_payload(row)}


@router.get("/api/jobs/{job_id}/logs")
def job_logs(request: Request, job_id: str):
    need_db()
    user, workspace_id, _, _ = current_user(request)
    with db.connection() as conn:
        row = sync.job_by_id_ws(conn, workspace_id, job_id)
    if row is None or not domain.is_well_formed_id(job_id):
        raise ApiError("not_found", 404)
    return {"lines": row["log_lines"] or []}


@router.post("/api/jobs/{job_id}/cancel")
async def cancel_job(request: Request, job_id: str):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "editor")
    raw = await request.body()
    if raw and raw.strip() not in (b"{}", b""):
        validation.validate_body(raw, {}, None)
    with db.tx() as conn:
        row = sync.job_by_id_ws(conn, workspace_id, job_id)
        if row is None or not domain.is_well_formed_id(job_id):
            raise ApiError("not_found", 404)
        if row["status"] not in ("pending", "running"):
            raise ApiError("job_not_active", 409)
        conn.execute("INSERT INTO cancel_requests (job_id) VALUES (%s) ON CONFLICT DO NOTHING",
                     (job_id,))
        now = dt.datetime.now(dt.timezone.utc)
        attempts = row["attempts"] or []
        last = attempts[-1] if attempts else {"number": 1}
        attempts = attempts + [{"number": last["number"] + 1, "status": "cancelled",
                                "failure_reason": None}]
        updated = conn.execute(
            "UPDATE jobs SET status='cancelled', ended_at=%s, attempts=%s, "
            "failure_reason=NULL WHERE id=%s AND status IN ('pending','running') RETURNING *",
            (now, json.dumps(attempts), job_id)).fetchone()
        if updated is None:
            raise ApiError("job_not_active", 409)
        sync.append_log(conn, job_id, now, "info", "Sync cancelled")
        accounts.write_audit(conn, workspace_id, "sync.cancelled", job_id, user["email"])
        connections.recompute_next_run(conn, row["connection_id"])
        sync.publish(job_id, {"type": "status", "status": "cancelled"})
    from .routes import job_payload

    return {"job": job_payload(updated)}


@router.get("/api/jobs/{job_id}/events")
async def job_events(request: Request, job_id: str):
    need_db()
    token = request.query_params.get("token") or bearer_token(request)
    if not token:
        raise ApiError("unauthenticated", 401)
    with db.connection() as conn:
        user = accounts.session_user(conn, token)
        if user is None:
            raise ApiError("unauthenticated", 401)
        row = sync.job_by_id_ws(conn, user["workspace_id"], job_id)
    if row is None or not domain.is_well_formed_id(job_id):
        raise ApiError("not_found", 404)
    last_event_id = request.headers.get("last-event-id", "")
    start_after = 0
    if last_event_id:
        try:
            start_after = int(last_event_id)
        except ValueError:
            start_after = 0

    async def stream():
        queue = sync.subscribe(job_id)
        try:
            sent = start_after
            # send history first
            with db.connection() as conn:
                current = sync.job_by_id(conn, job_id)
                lines = current["log_lines"] or []
                status = current["status"]
            for idx, line in enumerate(lines, start=1):
                if idx > sent:
                    sent = idx
                    yield _sse("log", line, str(idx))
            if status in ("succeeded", "failed", "cancelled"):
                yield _sse("status", {"status": status}, None)
                return
            # wait for new events, holding no database connection
            deadline = asyncio.get_event_loop().time() + 3600
            while True:
                if await request.is_disconnected():
                    break
                items = await asyncio.to_thread(queue.pop_all, 0.5)
                for item in items:
                    if item["type"] == "log":
                        if item["seq"] > sent:
                            sent = item["seq"]
                            yield _sse("log", item, str(item["seq"]))
                    else:
                        yield _sse("status", {"status": item["status"]}, None)
                        return
                if asyncio.get_event_loop().time() > deadline:
                    break
        finally:
            sync.unsubscribe(job_id, queue)

    return StreamingResponse(stream(), media_type="text/event-stream",
                              headers={"Cache-Control": "no-cache",
                                       "X-Accel-Buffering": "no"})


def _sse(event: str, data: dict, event_id: str | None) -> str:
    out = ""
    if event_id is not None:
        out += f"id: {event_id}\n"
    out += f"event: {event}\n"
    out += f"data: {json.dumps(data)}\n\n"
    return out


# ---------------------------------------------------------------- builder projects

PROJECT_FIELDS = {"name": True, "manifest": {
    "base_url": True, "auth": {"type": True, "header": True},
    "streams": [{"name": True, "path": True, "primary_key": True, "record_selector": True,
                 "paginator": {"page_size": True}}],
}}
PROJECT_TYPES = {"name": str, "manifest": {
    "base_url": str, "auth": {"type": str, "header": str},
    "streams": (list, {"name": str, "path": str, "primary_key": list, "record_selector": str,
                       "paginator": {"page_size": int}}),
}}


@router.get("/api/builder/projects")
def builder_projects(request: Request):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "editor")
    with db.connection() as conn:
        return {"projects": builder.list_projects(conn, workspace_id)}


@router.post("/api/builder/projects")
async def create_project(request: Request):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "editor")
    raw = await request.body()
    body = validation.validate_body(raw, PROJECT_FIELDS, PROJECT_TYPES)
    errors: dict[str, str] = {}
    name = body.get("name")
    if not isinstance(name, str) or not (1 <= len(name.strip()) <= 80):
        errors["name"] = "Enter a name of 1 to 80 characters."
    if errors:
        raise validation_error(errors)
    manifest = builder.validate_manifest(body.get("manifest"))
    with db.connection() as conn:
        project_id = domain.new_id("bpr_")
        conn.execute(
            "INSERT INTO builder_projects (id, workspace_id, name, manifest, tested_streams) "
            "VALUES (%s,%s,%s,%s,'{}'::jsonb)",
            (project_id, workspace_id, name.strip(), json.dumps(manifest)))
        row = builder.project_by_id(conn, workspace_id, project_id)
    return JSONResponse({"project": builder.project_payload(row)}, status_code=201)


@router.get("/api/builder/projects/{project_id}")
def one_project(request: Request, project_id: str):
    need_db()
    user, workspace_id, _, _ = current_user(request)
    with db.connection() as conn:
        row = builder.project_by_id(conn, workspace_id, project_id)
    if row is None or not domain.is_well_formed_id(project_id):
        raise ApiError("not_found", 404)
    return {"project": builder.project_payload(row)}


@router.put("/api/builder/projects/{project_id}")
async def update_project(request: Request, project_id: str):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "editor")
    raw = await request.body()
    body = validation.validate_body(raw, PROJECT_FIELDS, PROJECT_TYPES)
    with db.connection() as conn:
        row = builder.project_by_id(conn, workspace_id, project_id)
        if row is None or not domain.is_well_formed_id(project_id):
            raise ApiError("not_found", 404)
    errors: dict[str, str] = {}
    name = body.get("name")
    if not isinstance(name, str) or not (1 <= len(name.strip()) <= 80):
        errors["name"] = "Enter a name of 1 to 80 characters."
    if errors:
        raise validation_error(errors)
    manifest = builder.validate_manifest(body.get("manifest"))
    with db.tx() as conn:
        tested = row["tested_streams"] or {}
        # a stream that changed loses its tested state
        kept = {}
        old_manifest = row["manifest"] or {}
        for stream in manifest.get("streams", []):
            old = next((s for s in old_manifest.get("streams", [])
                        if s["name"] == stream["name"]), None)
            if old is not None and old == stream and stream["name"] in tested:
                kept[stream["name"]] = tested[stream["name"]]
        conn.execute(
            "UPDATE builder_projects SET name=%s, manifest=%s, tested_streams=%s, "
            "updated_at=now() WHERE id=%s",
            (name.strip(), json.dumps(manifest), json.dumps(kept), project_id))
        updated = builder.project_by_id(conn, workspace_id, project_id)
    return {"project": builder.project_payload(updated)}


TEST_FIELDS = {"stream": True, "api_key": True}
TEST_TYPES = {"stream": str, "api_key": str}


@router.post("/api/builder/projects/{project_id}/test")
async def test_project(request: Request, project_id: str):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "editor")
    raw = await request.body()
    body = validation.validate_body(raw, TEST_FIELDS, TEST_TYPES)
    stream_name = body.get("stream")
    api_key = body.get("api_key")
    with db.connection() as conn:
        row = builder.project_by_id(conn, workspace_id, project_id)
        if row is None or not domain.is_well_formed_id(project_id):
            raise ApiError("not_found", 404)
    manifest = row["manifest"]
    stream = next((s for s in manifest.get("streams", []) if s["name"] == stream_name), None)
    if stream is None:
        raise validation_error({"stream": "Choose a stream from the manifest."})
    records = builder.read_stream(manifest, stream, api_key or "")
    schema = builder.detect_schema(records)
    with db.tx() as conn:
        tested = dict(row["tested_streams"] or {})
        tested[stream_name] = schema
        conn.execute("UPDATE builder_projects SET tested_streams=%s, updated_at=now() WHERE id=%s",
                     (json.dumps(tested), project_id))
    return {"records": records, "pages_read": -(-len(records) // max(1, stream.get("paginator", {}).get("page_size", 3))),
            "detected_schema": schema}


@router.post("/api/builder/projects/{project_id}/publish")
async def publish_project(request: Request, project_id: str):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "editor")
    raw = await request.body()
    if raw and raw.strip() not in (b"{}", b""):
        validation.validate_body(raw, {}, None)
    with db.tx() as conn:
        row = builder.project_by_id(conn, workspace_id, project_id)
        if row is None or not domain.is_well_formed_id(project_id):
            raise ApiError("not_found", 404)
        manifest = row["manifest"]
        tested = row["tested_streams"] or {}
        for stream in manifest.get("streams", []):
            if stream["name"] not in tested:
                raise ApiError("stream_not_tested", 422)
        definition_id, version = builder.publish(conn, row, workspace_id)
        accounts.write_audit(conn, workspace_id, "connector.published", definition_id,
                             user["email"])
        definition_row = catalog.definition_row(conn, definition_id)
    return JSONResponse({"definition": catalog.definition_payload(definition_row)},
                        status_code=201)


# ---------------------------------------------------------------- audit

@router.get("/api/audit")
def audit(request: Request):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "admin")
    with db.connection() as conn:
        rows = accounts.list_audit(conn, workspace_id)
    from .routes import audit_payload

    return {"events": [audit_payload(r) for r in rows]}


@router.get("/api/audit/{seq}")
def audit_one(request: Request, seq: str):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "admin")
    if not seq.isdigit():
        raise ApiError("not_found", 404)
    with db.connection() as conn:
        row = conn.execute("SELECT * FROM audit_events WHERE workspace_id = %s AND seq = %s",
                           (workspace_id, int(seq))).fetchone()
    if row is None:
        raise ApiError("not_found", 404)
    from .routes import audit_payload

    return {"event": audit_payload(row)}


# ---------------------------------------------------------------- sandbox API

@router.get("/mock-api/v1/invoices")
def sandbox_invoices(request: Request):
    key = request.headers.get("x-api-key", "")
    if key != config.SANDBOX_API_KEY:
        return JSONResponse({"error": "not_found", "request_id": request.state.request_id},
                            status_code=401)
    params = request.query_params
    try:
        page = int(params.get("page", "1"))
    except ValueError:
        page = 1
    try:
        page_size = int(params.get("page_size", "3"))
    except ValueError:
        return JSONResponse({"error": "validation", "request_id": request.state.request_id},
                            status_code=400)
    if not (1 <= page_size <= 100):
        return JSONResponse({"error": "validation", "request_id": request.state.request_id},
                            status_code=400)
    chunk, next_page = builder.sandbox_page(page, page_size)
    return {"data": chunk, "next_page": next_page}
