"""The sync runner: a job reads the settings it recorded and the source snapshot fixed when it started running,
then commits rows, cursors and its succeeded status in one transaction."""

import asyncio
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import asyncpg

from . import builder, lifecycle, sample, warehouse
from .catalog import SAMPLE_DEFINITION
from .db import UNAVAILABLE, db, iso, utcnow
from .sealing import unseal
from .sources import FULL_REFRESH_MODES as FULL_REFRESH

START_AFTER_S = 1.0
READ_STEP_S = 1.2
MIN_RUNNING_S = 20.0
ATTEMPT_GAP_S = 2.9
ATTEMPTS = 3
_tasks: set[asyncio.Task] = set()


@dataclass
class StreamRead:
    name: str
    fields: list[str]
    rows: list[dict[str, Any]]


class SourceRejected(Exception):
    """The source refused the job's credentials."""


def launch(job_id: uuid.UUID) -> None:
    task = asyncio.create_task(run(job_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def _parse_cursor(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


async def _read(conn: asyncpg.Connection, job: asyncpg.Record) -> list[StreamRead]:
    """Each stream the job syncs, from the snapshot, filtered by start date and the stream cursor."""
    settings = job["settings"]
    source = await conn.fetchrow("SELECT config, sealed_api_key FROM sources WHERE id = $1",
                                 uuid.UUID(settings["source_id"]))
    api_key = unseal(bytes(source["sealed_api_key"]))
    cursors = await conn.fetchval("SELECT cursors FROM connections WHERE id = $1", job["connection_id"])
    if settings["definition_id"] == SAMPLE_DEFINITION:
        if sample.key_rejected(api_key):
            raise SourceRejected
        state = await sample.snapshot(conn, uuid.UUID(settings["source_id"]), job["snapshot_seq"])
        start = datetime.fromisoformat(source["config"]["start_date"] + "T00:00:00+00:00")
        reads = []
        for stream in settings["streams"]:
            rows = [row for row in state[stream["name"]].rows() if row["updated_at"] >= start]
            cursor = _parse_cursor(cursors.get(stream["name"]))
            if stream["sync_mode"] not in FULL_REFRESH and cursor is not None:
                rows = [row for row in rows if row["updated_at"] > cursor]
            reads.append(StreamRead(stream["name"], state[stream["name"]].fields, rows))
        return reads
    published = settings["published"]
    reads = []
    for stream in settings["streams"]:
        result = await asyncio.to_thread(builder.read_stream, published["manifest"], stream["name"], api_key)
        if result.http_status is not None:
            raise SourceRejected
        reads.append(StreamRead(stream["name"], list(published["schemas"][stream["name"]]), result.records))
    return reads


async def _job(conn: asyncpg.Connection, job_id: uuid.UUID) -> asyncpg.Record:
    return await conn.fetchrow("SELECT * FROM jobs WHERE id = $1", job_id)


async def run(job_id: uuid.UUID) -> None:
    """Drive one job to a final state. Whatever goes wrong, the job never stays active without a runner."""
    try:
        await _run(job_id)
    except asyncio.CancelledError:
        raise
    except Exception:
        await _fail_when_reachable(job_id)


async def _fail_when_reachable(job_id: uuid.UUID) -> None:
    while True:
        try:
            async with db.transaction() as conn:
                await lifecycle.fail(conn, job_id, "commit_failed")
            return
        except UNAVAILABLE:
            await asyncio.sleep(START_AFTER_S * 2)


async def _run(job_id: uuid.UUID) -> None:
    await asyncio.sleep(START_AFTER_S)
    async with db.transaction() as conn:
        settings = (await _job(conn, job_id))["settings"]
        seq = (await sample.latest_seq(conn, uuid.UUID(settings["source_id"]))
               if settings["definition_id"] == SAMPLE_DEFINITION else None)
        if not await lifecycle.start(conn, job_id, seq):
            return
    began = time.monotonic()
    for attempt in range(1, ATTEMPTS + 1):
        try:
            async with db.snapshot() as conn:
                reads = await _read(conn, await _job(conn, job_id))
            break
        except SourceRejected:
            await asyncio.sleep(ATTEMPT_GAP_S)
            async with db.transaction() as conn:
                if attempt == ATTEMPTS:
                    await lifecycle.fail(conn, job_id, "auth_failed")
                    return
                if not await lifecycle.retry(conn, job_id, "auth_failed"):
                    return
    extracted_at = utcnow()
    for read in reads:
        await asyncio.sleep(READ_STEP_S)
        async with db.transaction() as conn:
            if not await lifecycle.log_if_running(conn, job_id, f"stream {read.name}: {len(read.rows)} records read"):
                return
    await asyncio.sleep(max(0.0, MIN_RUNNING_S - (time.monotonic() - began)))
    await commit(job_id, reads, extracted_at)


def _stored(row: dict[str, Any], columns: list[str]) -> dict[str, Any]:
    return {name: iso(row[name]) if isinstance(row.get(name), datetime) else row.get(name)
            for name in columns if name in row}


async def commit(job_id: uuid.UUID, reads: list[StreamRead], extracted_at: datetime) -> None:
    """The one all-or-nothing step: rows, cursors, known schemas and the job's status and counts."""
    async with db.transaction() as conn:
        job = await _job(conn, job_id)
        connection = await conn.fetchrow("SELECT * FROM connections WHERE id = $1 FOR UPDATE", job["connection_id"])
        settings = job["settings"]
        known = {s["name"]: s["known_fields"] for s in settings["streams"]}
        added = {read.name: [f for f in read.fields if f not in known[read.name]] for read in reads}
        policy = settings["schema_change_policy"]
        if policy == "pause" and any(added.values()):
            if await lifecycle.fail(conn, job_id, "schema_change_detected"):
                await conn.execute("UPDATE connections SET status = 'inactive', version = version + 1, "
                                   "schema_paused = true WHERE id = $1", connection["id"])
            return
        columns = {read.name: known[read.name] + (added[read.name] if policy == "propagate" else []) for read in reads}
        rows = {read.name: [_stored(row, columns[read.name]) for row in read.rows] for read in reads}
        if not await lifecycle.succeed(conn, job_id, [{"stream": n, "records_committed": len(r)} for n, r in rows.items()]):
            return
        modes = {s["name"]: s["sync_mode"] for s in settings["streams"]}
        cursors = dict(connection["cursors"])
        for read in reads:
            await warehouse.write(conn, destination_id=uuid.UUID(settings["destination_id"]),
                                  table=settings["namespace_prefix"] + read.name, connection_id=connection["id"],
                                  columns=columns[read.name], mode=modes[read.name], rows=rows[read.name],
                                  job_id=job_id, extracted_at=extracted_at)
            if modes[read.name] in FULL_REFRESH:
                cursors[read.name] = None
            elif read.rows:
                newest = max(row["updated_at"] for row in read.rows)
                previous = _parse_cursor(cursors.get(read.name))
                cursors[read.name] = iso(max(newest, previous) if previous else newest)
        streams = connection["streams"]
        adopted = False
        if policy == "propagate":
            for stream in streams:
                fresh = [f for f in added.get(stream["name"], []) if f not in stream["known_fields"]]
                stream["known_fields"] = stream["known_fields"] + fresh
                adopted = adopted or bool(fresh)
        await conn.execute("UPDATE connections SET cursors = $2, streams = $3, version = version + $4 WHERE id = $1",
                           connection["id"], cursors, streams, 1 if adopted else 0)
