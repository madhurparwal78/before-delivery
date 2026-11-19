"""The sync: one all-or-nothing commit, restart recovery, live events."""
from __future__ import annotations

import datetime as dt
import json
import threading
import time

from . import catalog, config, connections, db, domain
from .core import log_job_line

# ---------------------------------------------------------------- live log fan-out

_subscribers_lock = threading.Lock()
_subscribers: dict[str, set] = {}
# job id -> (seq, generation marker) of last commit broadcast


def subscribe(job_id: str) -> "JobQueue":
    queue: JobQueue = JobQueue()
    with _subscribers_lock:
        _subscribers.setdefault(job_id, set()).add(queue)
    return queue


def unsubscribe(job_id: str, queue: "JobQueue") -> None:
    with _subscribers_lock:
        queues = _subscribers.get(job_id)
        if queues and queue in queues:
            queues.discard(queue)
        if queues is not None and not queues:
            _subscribers.pop(job_id, None)


class JobQueue:
    def __init__(self) -> None:
        self._items: list = []
        self._event = threading.Event()

    def push(self, item) -> None:
        self._items.append(item)
        self._event.set()

    def pop_all(self, timeout: float | None):
        self._event.wait(timeout if timeout is not None else 0.1)
        self._event.clear()
        items, self._items = self._items, []
        return items


def publish(job_id: str, event: dict) -> None:
    with _subscribers_lock:
        queues = list(_subscribers.get(job_id, ()))
    for queue in queues:
        queue.push(event)


# ---------------------------------------------------------------- snapshot

def build_source_snapshot(source_row, definition_row, definition_version: int) -> dict:
    """Read every record of every stream as they stand now."""
    if source_row["definition_id"] == "sample-commerce-api":
        with db.connection() as conn:
            state = catalog.source_state(conn, source_row["id"])
        records = catalog.sample_records(state)
        fields = {s["name"]: s["fields"] for s in catalog.sample_catalog(state)}
        return {"kind": "sample", "streams": records, "fields": fields}
    manifest = catalog.manifest_for_version(definition_row, definition_version)
    streams: dict[str, dict] = {}
    for stream in manifest.get("streams", []):
        from . import builder as builder_mod

        rows = builder_mod.read_stream(manifest, stream, catalog.source_api_key(source_row))
        fields: list[str] = []
        seen: set[str] = set()
        for rec in rows:
            for key in rec:
                if key not in seen:
                    seen.add(key)
                    fields.append(key)
        streams[stream["name"]] = {"records": rows, "fields": fields}
    return {"kind": "custom",
            "streams": {k: v["records"] for k, v in streams.items()},
            "fields": {k: v["fields"] for k, v in streams.items()}}


# ---------------------------------------------------------------- run

MIN_RUN_SECONDS = 8.0


def append_log(conn, job_id: str, at: dt.datetime, level: str, message: str) -> int:
    row = conn.execute(
        "SELECT log_lines FROM jobs WHERE id = %s", (job_id,)).fetchone()
    lines = row["log_lines"] or []
    lines.append({"at": domain.to_zulu(at), "level": level, "message": message})
    conn.execute("UPDATE jobs SET log_lines = %s WHERE id = %s",
                 (json.dumps(lines), job_id))
    publish(job_id, {"type": "log", "seq": len(lines), "at": domain.to_zulu(at),
                     "level": level, "message": message})
    log_job_line(job_id, {"scope": "job", "job_id": job_id, "level": level, "message": message})
    return len(lines)


def job_by_id(conn, job_id: str):
    return conn.execute("SELECT * FROM jobs WHERE id = %s", (job_id,)).fetchone()


def job_by_id_ws(conn, workspace_id: str, job_id: str):
    return conn.execute("SELECT * FROM jobs WHERE id = %s AND workspace_id = %s",
                        (job_id, workspace_id)).fetchone()


def start_job(conn, connection_row, workspace_row, user_id: str, request_id: str) -> dict:
    """Create a pending job. Caller holds the transaction; recovery-safe."""
    job_id = domain.new_id("job_")
    now = dt.datetime.now(dt.timezone.utc)
    source = conn.execute("SELECT * FROM sources WHERE id = %s",
                           (connection_row["source_id"],)).fetchone()
    definition = catalog.definition_row(conn, source["definition_id"])
    settings = {
        "streams": connection_row["streams"],
        "schedule": connection_row["schedule"],
        "schema_change_policy": connection_row["schema_change_policy"],
        "namespace_prefix": connection_row["namespace_prefix"],
    }
    conn.execute(
        "INSERT INTO jobs (id, connection_id, workspace_id, connection_version, definition_version, "
        "status, attempts, trigger_request_id, started_by, settings, created_at) "
        "VALUES (%s,%s,%s,%s,%s,'pending','[]'::jsonb,%s,%s,%s,%s)",
        (job_id, connection_row["id"], connection_row["workspace_id"],
         int(connection_row["version"]), int(definition["version"]), request_id, user_id,
         json.dumps(settings), now))
    return {"id": job_id, "created_at": now}


def transition_running(conn, job_id: str) -> bool:
    """pending -> running within 2 seconds of creation. False when another state won."""
    now = dt.datetime.now(dt.timezone.utc)
    attempts = [{"number": 1, "status": "running", "failure_reason": None}]
    conn.execute(
        "UPDATE jobs SET status='running', started_at=%s, attempts=%s WHERE id=%s AND status='pending'",
        (now, json.dumps(attempts), job_id))
    if conn.execute("SELECT 1 FROM jobs WHERE id=%s AND status='running'", (job_id,)).fetchone():
        publish(job_id, {"type": "status_change", "status": "running"})
        append_log(conn, job_id, now, "info", "Sync started")
        return True
    return False


def run_to_completion(job_id: str) -> None:
    """Background worker: pending -> running, snapshot, commit or fail."""
    try:
        with db.connection() as conn:
            job = job_by_id(conn, job_id)
            if job is None or job["status"] != "pending":
                return
            if not transition_running(conn, job_id):
                return
    except Exception:
        return
    with db.connection() as conn:
        job = job_by_id(conn, job_id)
        if job is None or job["status"] != "running":
            return
        connection_row = conn.execute("SELECT * FROM connections WHERE id = %s",
                                      (job["connection_id"],)).fetchone()
        source = conn.execute("SELECT * FROM sources WHERE id = %s",
                              (connection_row["source_id"],)).fetchone()
        definition = catalog.definition_row(conn, source["definition_id"])
        snapshot = build_source_snapshot(source, definition, int(job["definition_version"]))
        started_at = job["started_at"] or dt.datetime.now(dt.timezone.utc)
        settings = job["settings"]
        if catalog.key_rejected(source):
            for attempt in range(1, 3):
                append_log(conn, job_id, dt.datetime.now(dt.timezone.utc), "error",
                           f"attempt {attempt} failed: auth_failed")
            _finish_failed(conn, job, "auth_failed", dt.datetime.now(dt.timezone.utc))
            return
    streams = [s for s in settings["streams"] if s.get("selected")]
    read_at = dt.datetime.now(dt.timezone.utc)
    for stream in streams:
        records = _snapshot_records(snapshot, stream["name"], source)
        with db.connection() as conn:
            if _cancel_requested(conn, job_id):
                return
            append_log(conn, job_id, read_at, "info",
                       f"stream {stream['name']}: {len(records)} records read")
    elapsed = (dt.datetime.now(dt.timezone.utc) - started_at).total_seconds()
    if elapsed < MIN_RUN_SECONDS:
        time.sleep(max(0.0, MIN_RUN_SECONDS - elapsed))
    with db.tx() as conn:
        job = job_by_id(conn, job_id)
        if job is None or job["status"] != "running":
            return
        if _cancel_requested(conn, job_id):
            return
        connection_row = conn.execute("SELECT * FROM connections WHERE id = %s",
                                      (job["connection_id"],)).fetchone()
        _commit(conn, job, connection_row, source, definition, snapshot, streams, settings)


def _cancel_requested(conn, job_id: str) -> bool:
    return conn.execute("SELECT 1 FROM cancel_requests WHERE job_id = %s", (job_id,)).fetchone() is not None


def _snapshot_records(snapshot: dict, stream: str, source_row) -> list[dict]:
    if snapshot.get("kind") == "sample":
        return snapshot["streams"].get(stream, [])
    entry = snapshot["streams"].get(stream)
    if isinstance(entry, list):
        return entry
    return (entry or {}).get("records", [])


def _stream_fields(snapshot: dict, stream: str, source_row) -> list[str]:
    if snapshot.get("kind") == "sample":
        return snapshot.get("fields", {}).get(stream) or ["id", "updated_at"]
    fields = (snapshot.get("fields") or {}).get(stream)
    if fields:
        return fields
    out: list[str] = []
    seen: set[str] = set()
    for rec in _snapshot_records(snapshot, stream, source_row):
        for key in rec:
            if key not in seen:
                seen.add(key)
                out.append(key)
    return out


def _commit(conn, job, connection_row, source_row, definition_row, snapshot, streams, settings) -> None:
    """One transaction: rows, cursors, counts, job status, audit."""
    if connection_row is None:
        return
    if job["status"] != "running":
        # a terminal state is final; recovery or cancel recorded it first
        conn.rollback()
        return
    now = dt.datetime.now(dt.timezone.utc)
    start = catalog.start_date_of(source_row)
    start_dt = dt.datetime.combine(start, dt.time.min, tzinfo=dt.timezone.utc)
    prefix = settings["namespace_prefix"]
    policy = settings["schema_change_policy"]
    cursors = dict(connection_row["cursors"] or {})
    per_stream = []
    total = 0
    new_known: dict[str, list[str]] = {}
    paused = False
    schema = catalog.warehouse_schema(connection_row["destination_id"])
    for stream in streams:
        name = stream["name"]
        mode = stream["sync_mode"]
        known = stream.get("known_fields") or []
        records = _snapshot_records(snapshot, name, source_row)
        if mode.startswith("incremental") or any("updated_at" in r for r in records):
            records = [r for r in records if _at_or_after(r.get("updated_at"), start_dt)]
        if mode.startswith("incremental"):
            cursor = cursors.get(name)
            if cursor is not None:
                records = [r for r in records if _later_than(r.get("updated_at"), cursor)]
        if mode == "incremental_dedup":
            by_id: dict[str, dict] = {}
            for rec in records:
                key = str(rec.get("id"))
                prev = by_id.get(key)
                if prev is None or _later_than(rec.get("updated_at"), prev.get("updated_at")):
                    by_id[key] = rec
            records = [by_id[k] for k in sorted(by_id, key=str)]
        table = catalog.table_name(prefix, name)
        fields = _stream_fields(snapshot, name, source_row)
        extra = [f for f in fields if f not in known]
        if extra and policy == "pause":
            paused = True
            break
        keep = known if (extra and policy == "ignore") else fields
        if extra and policy == "propagate":
            new_known[name] = keep
        elif not extra:
            new_known[name] = known
        catalog.ensure_table(conn, connection_row["destination_id"], table, keep)
        if mode == "full_refresh_overwrite":
            catalog.bump_generation(conn, connection_row["destination_id"], table)
            conn.execute(f'DELETE FROM {schema}."{table}"')
        rows = []
        for rec in records:
            rows.append((
                rec.get("id"),
                json.dumps({k: rec.get(k) for k in keep if k in rec}),
                job["id"],
                now,
            ))
        if rows:
            with conn.cursor() as cur:
                cur.executemany(
                    f'INSERT INTO {schema}."{table}" (id, data, _wayline_job_id, _wayline_extracted_at) '
                    f'VALUES (%s,%s,%s,%s)', rows)
        per_stream.append({"stream": name, "records_committed": len(rows)})
        total += len(rows)
        if mode.startswith("incremental"):
            committed = [r.get("updated_at") for r in records if r.get("updated_at")]
            if committed:
                cursors[name] = max(committed)
    if paused:
        _finish_failed(conn, job, "schema_change_detected", now)
        conn.execute("UPDATE connections SET status='inactive', version = version + 1 "
                     "WHERE id = %s", (connection_row["id"],))
        return
    adopted = any(new_known.get(s["name"]) not in (None, s.get("known_fields"))
                  for s in streams if s.get("selected"))
    version = int(connection_row["version"])
    new_streams = []
    for stream in settings["streams"]:
        entry = dict(stream)
        if stream["name"] in new_known:
            entry["known_fields"] = new_known[stream["name"]]
        new_streams.append(entry)
    if adopted:
        version += 1
    conn.execute(
        "UPDATE connections SET cursors = %s, streams = %s, version = %s WHERE id = %s",
        (json.dumps(cursors), json.dumps(new_streams), version, connection_row["id"]))
    conn.execute(
        "UPDATE jobs SET status='succeeded', records_committed=%s, per_stream=%s, ended_at=%s, "
        "attempts=%s WHERE id=%s",
        (total, json.dumps(per_stream), now,
         json.dumps([{"number": 1, "status": "succeeded", "failure_reason": None}]), job["id"]))
    for entry in per_stream:
        append_log(conn, job["id"], now, "info",
                   f"stream {entry['stream']}: {entry['records_committed']} records committed")
    append_log(conn, job["id"], now, "info", "Sync succeeded")
    from . import accounts

    actor = conn.execute("SELECT email FROM users WHERE id = %s", (job["started_by"],)).fetchone()
    accounts.write_audit(conn, job["workspace_id"], "sync.succeeded", job["id"], actor["email"])
    connections.recompute_next_run(conn, connection_row["id"])
    publish(job["id"], {"type": "status", "status": "succeeded"})


def _finish_failed(conn, job, reason: str, now: dt.datetime) -> None:
    attempts = [{"number": 1, "status": "failed", "failure_reason": reason}]
    conn.execute(
        "UPDATE jobs SET status='failed', failure_reason=%s, ended_at=%s, attempts=%s WHERE id=%s",
        (reason, now, json.dumps(attempts), job["id"]))
    append_log(conn, job["id"], now, "error", f"Sync failed: {reason}")
    from . import accounts

    actor = conn.execute("SELECT email FROM users WHERE id = %s", (job["started_by"],)).fetchone()
    accounts.write_audit(conn, job["workspace_id"], "sync.failed", job["id"], actor["email"])
    connections.recompute_next_run(conn, job["connection_id"])
    publish(job["id"], {"type": "status", "status": "failed"})


def _at_or_after(value, floor) -> bool:
    if value is None:
        return False
    parsed = domain.parse_zulu(value) if isinstance(value, str) else value
    if parsed is None:
        return False
    return parsed >= floor


def _later_than(value, other) -> bool:
    if value is None or other is None:
        return value is not None
    a = domain.parse_zulu(value) if isinstance(value, str) else value
    b = domain.parse_zulu(other) if isinstance(other, str) else other
    if a is None or b is None:
        return False
    return a > b
