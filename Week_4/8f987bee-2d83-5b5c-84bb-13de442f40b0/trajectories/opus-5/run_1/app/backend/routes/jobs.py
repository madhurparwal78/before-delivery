"""Jobs: their history, their log, their live events and cancelling them."""

from __future__ import annotations

import asyncio
import contextlib
import json
import uuid
from typing import Any, AsyncIterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from ..context import Caller, iso, require_session, require_writer
from ..db import database
from ..errors import ApiError
from ..models import EmptyBody
from ..paging import job_cursor, read_job_cursor
from ..sync import FINAL_STATUSES, events, finish_job, job_payload
from ..validation import parse_body, parse_limit, well_formed_id
from .common import ok, path_uuid, raw_body

router = APIRouter()

EVENT_IDLE_SECONDS = 1.0


async def load_job(caller: Caller, job_id: str) -> Any:
    row = await database.fetchrow(
        "SELECT * FROM jobs WHERE id = $1 AND workspace_id = $2",
        path_uuid(job_id),
        caller.workspace_id,
    )
    if row is None:
        raise ApiError("not_found")
    return row


@router.get("/api/jobs")
async def list_jobs(request: Request) -> Any:
    caller = await require_session(request)
    limit = parse_limit(request.query_params.get("limit"), 20)
    raw_connection = request.query_params.get("connection_id")
    connection_id: uuid.UUID | None = None
    if raw_connection is not None:
        if not well_formed_id(raw_connection):
            raise ApiError("not_found")
        connection_id = uuid.UUID(raw_connection)
        known = await database.fetchval(
            "SELECT exists (SELECT 1 FROM connections WHERE id = $1 AND workspace_id = $2)",
            connection_id,
            caller.workspace_id,
        )
        if not known:
            raise ApiError("not_found")
    cursor = request.query_params.get("cursor")
    position = read_job_cursor(cursor, caller.workspace_id, connection_id) if cursor else None
    rows = await database.fetch(
        """
        SELECT * FROM jobs
        WHERE workspace_id = $1
          AND ($2::uuid IS NULL OR connection_id = $2)
          AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4))
        ORDER BY created_at DESC, id DESC
        LIMIT $5
        """,
        caller.workspace_id,
        connection_id,
        position[0] if position else None,
        position[1] if position else None,
        limit + 1,
    )
    has_more = len(rows) > limit
    page = rows[:limit]
    next_cursor = (
        job_cursor(caller.workspace_id, connection_id, page[-1]["created_at"], page[-1]["id"])
        if has_more
        else None
    )
    return ok(
        {
            "jobs": [job_payload(row) for row in page],
            "next_cursor": next_cursor,
            "has_more": has_more,
        }
    )


@router.get("/api/jobs/{job_id}")
async def read_job(request: Request, job_id: str) -> Any:
    caller = await require_session(request)
    return ok({"job": job_payload(await load_job(caller, job_id))})


@router.get("/api/jobs/{job_id}/logs")
async def read_logs(request: Request, job_id: str) -> Any:
    caller = await require_session(request)
    job = await load_job(caller, job_id)
    rows = await database.fetch(
        "SELECT at, level, message FROM job_log_lines WHERE job_id = $1 ORDER BY position", job["id"]
    )
    return ok(
        {"lines": [{"at": iso(row["at"]), "level": row["level"], "message": row["message"]} for row in rows]}
    )


@router.post("/api/jobs/{job_id}/cancel")
async def cancel_job(request: Request, job_id: str) -> Any:
    caller = await require_session(request)
    job = await load_job(caller, job_id)
    require_writer(caller)
    parse_body(await raw_body(request), EmptyBody)
    cancelled = await finish_job(job["id"], "cancelled", None)
    if cancelled is None:
        raise ApiError("job_not_active")
    return ok({"job": cancelled})


@router.get("/api/jobs/{job_id}/events")
async def stream_events(request: Request, job_id: str) -> Any:
    token = request.query_params.get("token")
    caller = await require_session(request, token=token)
    job = await load_job(caller, job_id)
    return StreamingResponse(
        _event_stream(job["id"], request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


async def _event_stream(job_id: uuid.UUID, request: Request) -> AsyncIterator[bytes]:
    """Send every line after `Last-Event-ID`, then the final status, holding no connection while waiting."""
    last_sent = _last_event_id(request.headers.get("last-event-id"))
    queue = events.subscribe(job_id)
    try:
        rows = await database.fetch(
            """
            SELECT position, at, level, message FROM job_log_lines
            WHERE job_id = $1 AND position > $2 ORDER BY position
            """,
            job_id,
            last_sent,
        )
        for row in rows:
            yield _log_event(
                row["position"], {"at": iso(row["at"]), "level": row["level"], "message": row["message"]}
            )
            last_sent = row["position"]
        status = await database.fetchval("SELECT status FROM jobs WHERE id = $1", job_id)
        if status in FINAL_STATUSES:
            yield _status_event(status)
            return
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=EVENT_IDLE_SECONDS)
            except asyncio.TimeoutError:
                if await request.is_disconnected():
                    return
                continue
            if event["type"] == "log" and event["position"] > last_sent:
                yield _log_event(event["position"], event["line"])
                last_sent = event["position"]
            elif event["type"] == "status":
                yield _status_event(event["status"])
                return
    finally:
        events.unsubscribe(job_id, queue)


def _last_event_id(raw: str | None) -> int:
    if raw is not None and raw.isdigit():
        return int(raw)
    return 0


def _log_event(position: int, line: dict[str, Any]) -> bytes:
    return f"id: {position}\nevent: log\ndata: {json.dumps(line)}\n\n".encode()


def _status_event(status: str) -> bytes:
    return f"event: status\ndata: {json.dumps({'status': status})}\n\n".encode()
