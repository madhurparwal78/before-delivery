"""The sync engine: job creation, the snapshot a job runs on, the all-or-nothing commit,
cancellation, restart recovery and the live job events."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import sys
import uuid
from datetime import datetime, timezone
from typing import Any

import asyncpg

from . import warehouse
from .audit import append_event
from .builder import read_stream
from .catalog import SAMPLE_COMMERCE_ID
from .context import iso
from .db import database
from .errors import ApiError
from .sample_source import SampleState, read_records
from .scheduling import compute_next_run
from .security import reveal_secret

log = logging.getLogger("wayline.sync")

PENDING_SECONDS = 0.3
RUNNING_FLOOR_SECONDS = 9.0
AUTH_ATTEMPTS = 3
ACTIVE_STATUSES = ("pending", "running")
FINAL_STATUSES = ("succeeded", "failed", "cancelled")
REVOKED_KEY_PREFIX = "revoked-"


class JobEvents:
    """In-process fan-out of job log lines and final statuses, holding no database connection."""

    def __init__(self) -> None:
        self._subscribers: dict[uuid.UUID, set[asyncio.Queue[dict[str, Any]]]] = {}

    def subscribe(self, job_id: uuid.UUID) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._subscribers.setdefault(job_id, set()).add(queue)
        return queue

    def unsubscribe(self, job_id: uuid.UUID, queue: asyncio.Queue[dict[str, Any]]) -> None:
        listeners = self._subscribers.get(job_id)
        if listeners is None:
            return
        listeners.discard(queue)
        if not listeners:
            self._subscribers.pop(job_id, None)

    def publish(self, job_id: uuid.UUID, event: dict[str, Any]) -> None:
        for queue in self._subscribers.get(job_id, set()):
            queue.put_nowait(event)


events = JobEvents()
_runners: set[asyncio.Task[None]] = set()


def job_payload(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "connection_id": str(row["connection_id"]),
        "connection_version": row["connection_version"],
        "definition_version": row["definition_version"],
        "status": row["status"],
        "attempts": row["attempts"],
        "records_committed": row["records_committed"],
        "per_stream": row["per_stream"],
        "failure_reason": row["failure_reason"],
        "trigger_request_id": row["trigger_request_id"],
        "created_at": iso(row["created_at"]),
        "started_at": iso(row["started_at"]),
        "ended_at": iso(row["ended_at"]),
    }


def selected_streams(settings: dict[str, Any]) -> list[dict[str, Any]]:
    return [stream for stream in settings["streams"] if stream["selected"]]


async def append_log(
    conn: asyncpg.Connection, job_id: uuid.UUID, level: str, message: str, request_id: str
) -> dict[str, Any]:
    at = datetime.now(timezone.utc)
    position = await conn.fetchval(
        """
        INSERT INTO job_log_lines (job_id, position, at, level, message)
        VALUES ($1, coalesce((SELECT max(position) FROM job_log_lines WHERE job_id = $1), 0) + 1, $2, $3, $4)
        RETURNING position
        """,
        job_id,
        at,
        level,
        message,
    )
    line = {"at": iso(at), "level": level, "message": message}
    _write_stdout_line(request_id, line)
    return {"type": "log", "position": position, "line": line}


def _write_stdout_line(request_id: str, line: dict[str, Any]) -> None:
    sys.stdout.write(
        json.dumps({"request_id": request_id, "level": line["level"], "message": line["message"]}) + "\n"
    )
    sys.stdout.flush()


# ---------------------------------------------------------------- creating a job


async def create_job(
    connection_id: uuid.UUID, workspace_id: uuid.UUID, started_by: uuid.UUID, actor_email: str, request_id: str
) -> dict[str, Any]:
    job_id = uuid.uuid4()
    async with database.transaction() as conn:
        connection = await conn.fetchrow(
            "SELECT * FROM connections WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
            connection_id,
            workspace_id,
        )
        if connection["status"] != "active":
            raise ApiError("connection_inactive")
        active = await conn.fetchval(
            "SELECT exists (SELECT 1 FROM jobs WHERE connection_id = $1 AND status = ANY($2::text[]))",
            connection_id,
            list(ACTIVE_STATUSES),
        )
        if active:
            raise ApiError("sync_already_running")
        definition_version = await conn.fetchval(
            """
            SELECT d.version FROM connector_definitions d
            JOIN sources s ON s.definition_id = d.id
            WHERE s.id = $1
            """,
            connection["source_id"],
        )
        settings = {
            "source_id": str(connection["source_id"]),
            "destination_id": str(connection["destination_id"]),
            "namespace_prefix": connection["namespace_prefix"],
            "streams": connection["streams"],
            "schema_change_policy": connection["schema_change_policy"],
        }
        per_stream = [
            {"stream": stream["name"], "records_committed": 0} for stream in selected_streams(settings)
        ]
        row = await conn.fetchrow(
            """
            INSERT INTO jobs (
                id, workspace_id, connection_id, connection_version, definition_version, status,
                attempts, records_committed, per_stream, failure_reason, trigger_request_id,
                started_by, settings, created_at
            )
            VALUES ($1, $2, $3, $4, $5, 'pending', '[]'::jsonb, 0, $6, NULL, $7, $8, $9, $10)
            RETURNING *
            """,
            job_id,
            workspace_id,
            connection_id,
            connection["version"],
            definition_version,
            per_stream,
            request_id,
            started_by,
            settings,
            datetime.now(timezone.utc),
        )
        await append_event(
            conn,
            workspace_id=workspace_id,
            action="sync.started",
            target_id=str(job_id),
            actor_email=actor_email,
        )
    start_runner(job_id)
    return job_payload(row)


def start_runner(job_id: uuid.UUID) -> None:
    task = asyncio.create_task(_run_job(job_id), name=f"wayline-job-{job_id}")
    _runners.add(task)
    task.add_done_callback(_runners.discard)


# ---------------------------------------------------------------- running a job


async def _run_job(job_id: uuid.UUID) -> None:
    try:
        await asyncio.sleep(PENDING_SECONDS)
        started = await _begin_run(job_id)
        if started is None:
            return
        job, snapshot = started
        request_id = job["trigger_request_id"]
        streams = selected_streams(job["settings"])
        if snapshot["api_key_rejected"]:
            await _fail_after_auth_attempts(job_id, request_id, len(streams))
            return
        pause_each = max(1.0, (RUNNING_FLOOR_SECONDS - 2.5) / max(len(streams), 1))
        for stream in streams:
            await asyncio.sleep(pause_each)
            if not await _still_running(job_id):
                return
            count = len(snapshot["streams"][stream["name"]]["records"])
            await _publish_log(job_id, "info", f"stream {stream['name']}: {count} records read", request_id)
        await _sleep_until_floor(job["started_at"])
        if not await _still_running(job_id):
            return
        await _commit_job(job_id)
    except ApiError:
        log.warning(json.dumps({"event": "job_paused_by_outage", "job_id": str(job_id)}))
    except asyncio.CancelledError:
        raise


async def _begin_run(job_id: uuid.UUID) -> tuple[asyncpg.Record, dict[str, Any]] | None:
    """Move the job from pending to running and freeze the source records it runs on."""
    async with database.transaction() as conn:
        job = await conn.fetchrow("SELECT * FROM jobs WHERE id = $1 FOR UPDATE", job_id)
        if job["status"] != "pending":
            return None
        snapshot = await _build_snapshot(conn, job)
        for stream, payload in snapshot["streams"].items():
            await conn.execute(
                "INSERT INTO job_snapshots (job_id, stream, records) VALUES ($1, $2, $3)",
                job_id,
                stream,
                payload,
            )
        started_at = datetime.now(timezone.utc)
        job = await conn.fetchrow(
            """
            UPDATE jobs SET status = 'running', started_at = $2,
                attempts = '[{"number": 1, "status": "running", "failure_reason": null}]'::jsonb
            WHERE id = $1 RETURNING *
            """,
            job_id,
            started_at,
        )
        connection = await conn.fetchrow(
            "SELECT status, schedule, created_at FROM connections WHERE id = $1", job["connection_id"]
        )
        await conn.execute(
            "UPDATE connections SET next_run_at = $2 WHERE id = $1",
            job["connection_id"],
            compute_next_run(
                connection["status"], connection["schedule"], connection["created_at"], started_at
            ),
        )
        line = await append_log(conn, job_id, "info", "Sync started", job["trigger_request_id"])
    events.publish(job_id, line)
    return job, snapshot


async def _build_snapshot(conn: asyncpg.Connection, job: asyncpg.Record) -> dict[str, Any]:
    settings = job["settings"]
    source = await conn.fetchrow("SELECT * FROM sources WHERE id = $1", uuid.UUID(settings["source_id"]))
    definition = await conn.fetchrow(
        "SELECT * FROM connector_definitions WHERE id = $1", source["definition_id"]
    )
    api_key = reveal_secret(source["api_key_secret"])
    streams: dict[str, Any] = {}
    rejected = False
    if definition["custom"]:
        manifest = definition["manifests"][str(job["definition_version"])]
        for stream in selected_streams(settings):
            try:
                records, _ = read_stream(manifest, stream["name"], api_key)
            except ApiError:
                rejected = True
                records = []
            fields = list(records[0].keys()) if records else []
            streams[stream["name"]] = {"fields": fields, "records": records}
    else:
        rejected = api_key.startswith(REVOKED_KEY_PREFIX)
        state = await read_sample_state(conn, source["id"])
        start_date = datetime.fromisoformat(source["config"]["start_date"]).replace(tzinfo=timezone.utc)
        for stream in selected_streams(settings):
            records = read_records(stream["name"], state, start_date)
            streams[stream["name"]] = {
                "fields": state.fields_of(stream["name"]),
                "records": [_jsonable(record) for record in records],
            }
    return {"streams": streams, "api_key_rejected": rejected}


def _jsonable(record: dict[str, Any]) -> dict[str, Any]:
    return {key: iso(value) if isinstance(value, datetime) else value for key, value in record.items()}


async def read_sample_state(conn: asyncpg.Connection, source_id: uuid.UUID) -> SampleState:
    state = SampleState()
    for row in await conn.fetch(
        "SELECT stream, record_id, updated_at FROM sample_appended_records WHERE source_id = $1", source_id
    ):
        state.appended.setdefault(row["stream"], {})[row["record_id"]] = row["updated_at"]
    for row in await conn.fetch(
        "SELECT stream, record_id, status, updated_at FROM sample_record_updates WHERE source_id = $1",
        source_id,
    ):
        state.updates.setdefault(row["stream"], {})[row["record_id"]] = (row["status"], row["updated_at"])
    for row in await conn.fetch(
        "SELECT stream, field FROM sample_added_fields WHERE source_id = $1 ORDER BY added_seq", source_id
    ):
        state.added_fields.setdefault(row["stream"], []).append(row["field"])
    return state


async def _still_running(job_id: uuid.UUID) -> bool:
    return await database.fetchval("SELECT status = 'running' FROM jobs WHERE id = $1", job_id)


async def _sleep_until_floor(started_at: datetime) -> None:
    elapsed = (datetime.now(timezone.utc) - started_at).total_seconds()
    if elapsed < RUNNING_FLOOR_SECONDS:
        await asyncio.sleep(RUNNING_FLOOR_SECONDS - elapsed)


async def _publish_log(job_id: uuid.UUID, level: str, message: str, request_id: str) -> None:
    async with database.acquire() as conn:
        line = await append_log(conn, job_id, level, message, request_id)
    events.publish(job_id, line)


async def _fail_after_auth_attempts(job_id: uuid.UUID, request_id: str, stream_count: int) -> None:
    pause = max(1.0, RUNNING_FLOOR_SECONDS / AUTH_ATTEMPTS)
    for attempt in range(1, AUTH_ATTEMPTS + 1):
        await asyncio.sleep(pause)
        if not await _still_running(job_id):
            return
        await _record_attempt(job_id, attempt, "auth_failed")
        await _publish_log(job_id, "error", f"attempt {attempt} failed: auth_failed", request_id)
    await finish_job(job_id, "failed", "auth_failed")


async def _record_attempt(job_id: uuid.UUID, number: int, failure_reason: str | None) -> None:
    async with database.acquire() as conn:
        attempts = await conn.fetchval("SELECT attempts FROM jobs WHERE id = $1", job_id)
        attempts = [attempt for attempt in attempts if attempt["number"] != number]
        attempts.append({"number": number, "status": "failed", "failure_reason": failure_reason})
        next_attempts = sorted(attempts, key=lambda attempt: attempt["number"])
        if number < AUTH_ATTEMPTS:
            next_attempts.append(
                {"number": number + 1, "status": "running", "failure_reason": None}
            )
        await conn.execute("UPDATE jobs SET attempts = $2 WHERE id = $1", job_id, next_attempts)


# ---------------------------------------------------------------- the commit


async def _commit_job(job_id: uuid.UUID) -> None:
    ending: tuple[list[dict[str, Any]], str] | None = None
    async with database.transaction() as conn:
        job = await conn.fetchrow("SELECT * FROM jobs WHERE id = $1 FOR UPDATE", job_id)
        if job["status"] != "running":
            return
        settings = job["settings"]
        destination_id = uuid.UUID(settings["destination_id"])
        connection = await conn.fetchrow(
            "SELECT * FROM connections WHERE id = $1 FOR UPDATE", job["connection_id"]
        )
        snapshot = {
            row["stream"]: row["records"]
            for row in await conn.fetch(
                "SELECT stream, records FROM job_snapshots WHERE job_id = $1", job_id
            )
        }
        policy = settings["schema_change_policy"]
        paused_streams = [
            stream["name"]
            for stream in selected_streams(settings)
            if _new_fields(stream, snapshot[stream["name"]]["fields"])
        ]
        if policy == "pause" and paused_streams:
            await _fail_in_transaction(conn, job, "schema_change_detected", pause_connection=connection)
            lines = [
                await append_log(
                    conn, job_id, "error", "attempt 1 failed: schema_change_detected", job["trigger_request_id"]
                ),
                await append_log(
                    conn, job_id, "error", "Sync failed: schema_change_detected", job["trigger_request_id"]
                ),
            ]
            await append_event(
                conn,
                workspace_id=job["workspace_id"],
                action="sync.failed",
                target_id=str(job_id),
                actor_email=await _actor_email(conn, job["started_by"]),
            )
            ending = (lines, "failed")
        else:
            ending = await _write_commit(conn, job, snapshot, connection)
    _publish_end(job_id, *ending)


async def _write_commit(
    conn: asyncpg.Connection,
    job: asyncpg.Record,
    snapshot: dict[str, Any],
    connection: asyncpg.Record,
) -> tuple[list[dict[str, Any]], str]:
    """Land the rows, advance the cursors and mark the job succeeded, all in one transaction."""
    job_id = job["id"]
    settings = job["settings"]
    policy = settings["schema_change_policy"]
    destination_id = uuid.UUID(settings["destination_id"])
    await warehouse.ensure_schema(conn, destination_id)
    cursors = dict(connection["cursors"])
    known_fields = {stream["name"]: list(stream["known_fields"]) for stream in settings["streams"]}
    per_stream: list[dict[str, Any]] = []
    extracted_at = datetime.now(timezone.utc)
    adopted = False
    for stream in selected_streams(settings):
        name = stream["name"]
        table = settings["namespace_prefix"] + name
        fields = list(stream["known_fields"])
        if policy == "propagate":
            for field in _new_fields(stream, snapshot[name]["fields"]):
                fields.append(field)
                known_fields[name].append(field)
                adopted = True
        rows, cursor_value = _rows_to_write(stream, snapshot[name]["records"], cursors.get(name))
        await _write_table(
            conn, destination_id, table, fields, rows, job_id, extracted_at, stream, connection["id"]
        )
        cursors[name] = cursor_value
        per_stream.append({"stream": name, "records_committed": len(rows)})
    streams_with_schema = [
        {**stream, "known_fields": known_fields[stream["name"]]} for stream in settings["streams"]
    ]
    await conn.execute(
        "UPDATE connections SET cursors = $2, streams = $3, version = version + $4 WHERE id = $1",
        connection["id"],
        cursors,
        streams_with_schema,
        1 if adopted else 0,
    )
    await conn.execute(
        """
        UPDATE jobs SET status = 'succeeded', records_committed = $2, per_stream = $3,
            attempts = $4, ended_at = $5
        WHERE id = $1
        """,
        job_id,
        sum(entry["records_committed"] for entry in per_stream),
        per_stream,
        [{"number": 1, "status": "succeeded", "failure_reason": None}],
        datetime.now(timezone.utc),
    )
    lines = [
        await append_log(
            conn,
            job_id,
            "info",
            f"stream {entry['stream']}: {entry['records_committed']} records committed",
            job["trigger_request_id"],
        )
        for entry in per_stream
    ]
    lines.append(await append_log(conn, job_id, "info", "Sync succeeded", job["trigger_request_id"]))
    await append_event(
        conn,
        workspace_id=job["workspace_id"],
        action="sync.succeeded",
        target_id=str(job_id),
        actor_email=await _actor_email(conn, job["started_by"]),
    )
    return lines, "succeeded"


def _new_fields(stream: dict[str, Any], snapshot_fields: list[str]) -> list[str]:
    known = set(stream["known_fields"])
    return [field for field in snapshot_fields if field not in known]


def _rows_to_write(
    stream: dict[str, Any], records: list[dict[str, Any]], cursor: str | None
) -> tuple[list[dict[str, Any]], str | None]:
    mode = stream["sync_mode"]
    if mode.startswith("full_refresh"):
        return records, None
    cursor_field = stream["cursor_field"]
    fresh = [record for record in records if cursor is None or record[cursor_field] > cursor]
    if mode == "incremental_dedup":
        newest: dict[Any, dict[str, Any]] = {}
        for record in fresh:
            kept = newest.get(record["id"])
            if kept is None or record[cursor_field] > kept[cursor_field]:
                newest[record["id"]] = record
        fresh = [newest[key] for key in sorted(newest)]
    next_cursor = cursor
    for record in fresh:
        if next_cursor is None or record[cursor_field] > next_cursor:
            next_cursor = record[cursor_field]
    return fresh, next_cursor


async def _write_table(
    conn: asyncpg.Connection,
    destination_id: uuid.UUID,
    table: str,
    fields: list[str],
    rows: list[dict[str, Any]],
    job_id: uuid.UUID,
    extracted_at: datetime,
    stream: dict[str, Any],
    connection_id: uuid.UUID,
) -> None:
    registration = await warehouse.table_registration(conn, destination_id, table)
    overwrite = stream["sync_mode"] == "full_refresh_overwrite"
    if registration is None:
        await warehouse.create_table(conn, destination_id, table, fields)
        await conn.execute(
            """
            INSERT INTO warehouse_tables (destination_id, name, connection_id, generation, fields)
            VALUES ($1, $2, $3, 1, $4)
            """,
            destination_id,
            table,
            connection_id,
            fields,
        )
    else:
        stored_fields = list(registration["fields"])
        added = [field for field in fields if field not in stored_fields]
        if added:
            await warehouse.add_columns(conn, destination_id, table, added)
            stored_fields.extend(added)
        if overwrite:
            await warehouse.delete_rows(conn, destination_id, table)
        await conn.execute(
            """
            UPDATE warehouse_tables SET fields = $3, generation = generation + $4
            WHERE destination_id = $1 AND name = $2
            """,
            destination_id,
            table,
            stored_fields,
            1 if overwrite else 0,
        )
    await warehouse.insert_rows(conn, destination_id, table, fields, rows, job_id, extracted_at)


# ---------------------------------------------------------------- ending a job


async def finish_job(job_id: uuid.UUID, status: str, failure_reason: str | None) -> dict[str, Any] | None:
    """End a running or pending job, with its log line and its audit event, in one step."""
    async with database.transaction() as conn:
        job = await conn.fetchrow("SELECT * FROM jobs WHERE id = $1 FOR UPDATE", job_id)
        if job["status"] not in ACTIVE_STATUSES:
            return None
        await _fail_in_transaction(conn, job, failure_reason, status=status)
        message = "Sync cancelled" if status == "cancelled" else f"Sync failed: {failure_reason}"
        level = "info" if status == "cancelled" else "error"
        line = await append_log(conn, job_id, level, message, job["trigger_request_id"])
        await append_event(
            conn,
            workspace_id=job["workspace_id"],
            action=f"sync.{status}",
            target_id=str(job_id),
            actor_email=await _actor_email(conn, job["started_by"]),
        )
        row = await conn.fetchrow("SELECT * FROM jobs WHERE id = $1", job_id)
    _publish_end(job_id, [line], status)
    return job_payload(row)


async def _fail_in_transaction(
    conn: asyncpg.Connection,
    job: asyncpg.Record,
    failure_reason: str | None,
    *,
    status: str = "failed",
    pause_connection: asyncpg.Record | None = None,
) -> None:
    attempts = [
        {**attempt, "status": status, "failure_reason": failure_reason}
        if attempt["status"] == "running"
        else attempt
        for attempt in job["attempts"]
    ] or [{"number": 1, "status": status, "failure_reason": failure_reason}]
    await conn.execute(
        """
        UPDATE jobs SET status = $2, failure_reason = $3, attempts = $4, ended_at = $5,
            records_committed = 0
        WHERE id = $1
        """,
        job["id"],
        status,
        failure_reason,
        attempts,
        datetime.now(timezone.utc),
    )
    if pause_connection is not None:
        await conn.execute(
            "UPDATE connections SET status = 'inactive', version = version + 1, next_run_at = NULL WHERE id = $1",
            pause_connection["id"],
        )


async def _actor_email(conn: asyncpg.Connection, user_id: uuid.UUID) -> str:
    return await conn.fetchval("SELECT email FROM users WHERE id = $1", user_id)


def _publish_end(job_id: uuid.UUID, lines: list[dict[str, Any]], status: str) -> None:
    for line in lines:
        events.publish(job_id, line)
    events.publish(job_id, {"type": "status", "status": status})


# ---------------------------------------------------------------- restart recovery


async def recover_interrupted_jobs(pool: asyncpg.Pool) -> None:
    """Every job left pending or running when the server stopped is failed as interrupted."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id FROM jobs WHERE status = ANY($1::text[])", list(ACTIVE_STATUSES)
        )
        for row in rows:
            async with conn.transaction():
                job = await conn.fetchrow("SELECT * FROM jobs WHERE id = $1 FOR UPDATE", row["id"])
                if job["status"] not in ACTIVE_STATUSES:
                    continue
                await _fail_in_transaction(conn, job, "interrupted")
                await append_log(
                    conn, job["id"], "error", "Sync failed: interrupted", job["trigger_request_id"]
                )
                await append_event(
                    conn,
                    workspace_id=job["workspace_id"],
                    action="sync.failed",
                    target_id=str(job["id"]),
                    actor_email=await _actor_email(conn, job["started_by"]),
                )


async def stop_runners() -> None:
    for task in list(_runners):
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task
