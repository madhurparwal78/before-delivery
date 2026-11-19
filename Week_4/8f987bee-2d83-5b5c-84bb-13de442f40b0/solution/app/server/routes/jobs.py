"""Job history, one job, its log, its live events and cancel."""

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import datetime

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from .. import jobs, lifecycle, paging
from ..auth import Member, bearer, current_member, member_for_token
from ..db import db
from ..errors import ApiError, validation
from ..inputs import Body, raw_json, shape_errors
from ..objects import owned, parse_id
from ..views import JobOut, Jobs, Logs

router = APIRouter()
POLL_SECONDS = 0.25


@router.get("/api/jobs", response_model=Jobs)
async def job_history(request: Request, member: Member = Depends(current_member)) -> dict:
    query = request.query_params
    async with db.snapshot() as conn:
        connection_id = None
        if "connection_id" in query:
            connection_id = (await owned(conn, "connection", query["connection_id"], member.workspace_id))["id"]
        limit = paging.limit_of(query.get("limit"), 20)
        scope = {"k": "jobs", "w": str(member.workspace_id), "c": str(connection_id) if connection_id else None}
        after = paging.decode(query["cursor"], scope) if "cursor" in query else None
        rows = await conn.fetch(
            """SELECT * FROM jobs WHERE workspace_id = $1 AND ($2::uuid IS NULL OR connection_id = $2)
               AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4::uuid))
               ORDER BY created_at DESC, id DESC LIMIT $5""",
            member.workspace_id, connection_id, datetime.fromisoformat(after["t"]) if after else None,
            parse_id(after["i"]) if after else None, limit + 1)
    page, more = rows[:limit], len(rows) > limit
    cursor = paging.encode(scope, {"t": page[-1]["created_at"].isoformat(), "i": str(page[-1]["id"])}) if more else None
    return {"jobs": [jobs.public(row) for row in page], "next_cursor": cursor, "has_more": more}


@router.get("/api/jobs/{job_id}", response_model=JobOut)
async def job(job_id: str, member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        return {"job": jobs.public(await owned(conn, "job", job_id, member.workspace_id))}


@router.get("/api/jobs/{job_id}/logs", response_model=Logs)
async def logs(job_id: str, member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        row = await owned(conn, "job", job_id, member.workspace_id)
        lines = await conn.fetch("SELECT * FROM job_logs WHERE job_id = $1 ORDER BY seq", row["id"])
    return {"lines": [jobs.job_log_line(line) for line in lines]}


@router.post("/api/jobs/{job_id}/cancel", response_model=JobOut)
async def cancel(job_id: str, request: Request, member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        await owned(conn, "job", job_id, member.workspace_id)
    member.require("editor")
    _, fields = shape_errors(Body, raw_json(request))
    if fields:
        raise validation(fields)
    async with db.transaction() as conn:
        row = await owned(conn, "job", job_id, member.workspace_id)
        if not await lifecycle.cancel(conn, row["id"]):
            raise ApiError(409, "job_not_active")
        return {"job": jobs.public(await conn.fetchrow("SELECT * FROM jobs WHERE id = $1", row["id"]))}


def _event(name: str, data: dict, event_id: int | None = None) -> str:
    head = f"id: {event_id}\n" if event_id is not None else ""
    return f"{head}event: {name}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


def _resume_after(request: Request) -> int:
    """The line position a reconnecting client already holds; anything but a whole number means none."""
    value = request.headers.get("last-event-id", "").strip()
    return int(value) if value.isascii() and value.isdigit() else 0


@router.get("/api/jobs/{job_id}/events")
async def events(job_id: str, request: Request) -> StreamingResponse:
    """Every log line after `Last-Event-ID` (all of them without it), then each new one, then the final status."""
    member = await member_for_token(request.query_params.get("token") or bearer(request))
    async with db.snapshot() as conn:
        row = await owned(conn, "job", job_id, member.workspace_id)

    resume = _resume_after(request)

    async def stream() -> AsyncIterator[str]:
        sent = resume
        while True:
            async with db.snapshot() as conn:
                status = await conn.fetchval("SELECT status FROM jobs WHERE id = $1", row["id"])
                lines = await conn.fetch("SELECT * FROM job_logs WHERE job_id = $1 AND seq > $2 ORDER BY seq",
                                         row["id"], sent)
            for line in lines:
                sent = line["seq"]
                yield _event("log", jobs.job_log_line(line), line["seq"])
            if status in lifecycle.FINAL:
                yield _event("status", {"status": status})
                return
            if await request.is_disconnected():
                return
            await asyncio.sleep(POLL_SECONDS)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

