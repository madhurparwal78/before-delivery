"""Connections: creation, validation, versions, schedules, reset, state."""
from __future__ import annotations

import datetime as dt
import json
import zoneinfo

from . import config, domain
from .core import validation as validation_error

SYNC_MODES = {
    "full_refresh_overwrite": "Full refresh overwrite",
    "full_refresh_append": "Full refresh append",
    "incremental_append": "Incremental append",
    "incremental_dedup": "Incremental dedup",
}

CUSTOM_MODES = {"full_refresh_overwrite", "full_refresh_append"}


def connection_by_id(conn, workspace_id: str, connection_id: str):
    return conn.execute("SELECT * FROM connections WHERE id = %s AND workspace_id = %s",
                        (connection_id, workspace_id)).fetchone()


def list_connections(conn, workspace_id: str) -> list[dict]:
    rows = conn.execute("SELECT * FROM connections WHERE workspace_id = %s ORDER BY created_at, id",
                        (workspace_id,)).fetchall()
    return [dict(r) for r in rows]


def name_taken(conn, workspace_id: str, name: str) -> bool:
    row = conn.execute("SELECT 1 FROM connections WHERE workspace_id = %s AND lower(name) = %s",
                       (workspace_id, name.lower())).fetchone()
    return row is not None


def table_targets_excluding(conn, destination_id: str, exclude_connection: str) -> set[str]:
    rows = conn.execute(
        "SELECT id, namespace_prefix, streams FROM connections WHERE destination_id = %s",
        (destination_id,)).fetchall()
    out: set[str] = set()
    for row in rows:
        if row["id"] == exclude_connection:
            continue
        for stream in row["streams"] or []:
            if stream.get("selected"):
                out.add(f"{row['namespace_prefix']}{stream['name']}")
    return out


def table_targets(conn, destination_id: str) -> set[str]:
    rows = conn.execute(
        "SELECT namespace_prefix, streams FROM connections WHERE destination_id = %s",
        (destination_id,)).fetchall()
    out: set[str] = set()
    for row in rows:
        for stream in row["streams"] or []:
            if stream.get("selected"):
                out.add(f"{row['namespace_prefix']}{stream['name']}")
    return out


def validate_schedule(schedule: dict, custom_streams: bool,
                      min_interval: int, errors: dict) -> dict:
    """Validate and normalise a schedule payload. Raises frequency_exceeds_plan markers."""
    stype = schedule.get("type")
    if stype not in ("manual", "interval", "cron"):
        errors["schedule.type"] = "Choose a schedule type."
        return {"type": "manual"}
    if stype == "interval":
        minutes = schedule.get("interval_minutes")
        if isinstance(minutes, bool) or not isinstance(minutes, int):
            errors["schedule.interval_minutes"] = "Enter the interval in whole minutes."
            return {"type": "interval", "interval_minutes": None}
        if not (1 <= minutes <= 1440):
            errors["schedule.interval_minutes"] = "Enter a whole number from 1 to 1440."
            return {"type": "interval", "interval_minutes": None}
        if minutes < min_interval:
            errors["__frequency__"] = "frequency"
        return {"type": "interval", "interval_minutes": minutes}
    if stype == "cron":
        expression = schedule.get("cron_expression")
        if not isinstance(expression, str) or not expression.strip():
            errors["schedule.cron_expression"] = "Enter a five-field cron expression."
            expression = None
        parsed = domain.parse_cron(expression.strip()) if expression else None
        if expression and parsed is None:
            errors["schedule.cron_expression"] = "This cron expression cannot be read."
        time_zone = schedule.get("time_zone", "UTC")
        if not isinstance(time_zone, str) or time_zone == "":
            time_zone = "UTC"
        try:
            zoneinfo.ZoneInfo(time_zone)
        except Exception:
            errors["schedule.time_zone"] = "Choose a known time zone."
            time_zone = None
        result = {"type": "cron", "cron_expression": expression or "", "time_zone": time_zone or "UTC"}
        if parsed is not None and time_zone is not None:
            if stype == "cron" and parsed.minute_gap() < min_interval:
                errors["__frequency__"] = "frequency"
        return result
    return {"type": "manual"}


def compute_next_run(schedule: dict, anchor: dt.datetime) -> dt.datetime | None:
    """One place that decides next_run_at."""
    if schedule.get("type") == "manual":
        return None
    if schedule.get("type") == "interval":
        minutes = int(schedule.get("interval_minutes") or 0)
        if minutes <= 0:
            return None
        return anchor + dt.timedelta(minutes=minutes)
    if schedule.get("type") == "cron":
        expression = (schedule.get("cron_expression") or "").strip()
        time_zone = schedule.get("time_zone") or "UTC"
        parsed = domain.parse_cron(expression)
        if parsed is None:
            return None
        return parsed.next_after(anchor, time_zone)
    return None


def anchor_for(conn, connection_id: str, created_at: dt.datetime) -> dt.datetime:
    row = conn.execute(
        "SELECT started_at, created_at FROM jobs WHERE connection_id = %s "
        "ORDER BY created_at DESC, id DESC LIMIT 1", (connection_id,)).fetchone()
    if row and row["started_at"] is not None:
        return max(created_at, row["started_at"])
    return created_at


def connection_payload(row) -> dict:
    schedule = row["schedule"] or {}
    streams = []
    for stream in row["streams"] or []:
        entry = {
            "name": stream["name"],
            "selected": bool(stream.get("selected")),
            "sync_mode": stream["sync_mode"],
            "cursor_field": stream.get("cursor_field"),
            "primary_key": stream.get("primary_key"),
        }
        if stream.get("known_fields") is not None:
            entry["known_fields"] = stream["known_fields"]
        streams.append(entry)
    payload = {
        "id": row["id"],
        "workspace_id": row["workspace_id"],
        "name": row["name"],
        "status": row["status"],
        "version": int(row["version"]),
        "source_id": row["source_id"],
        "destination_id": row["destination_id"],
        "namespace_prefix": row["namespace_prefix"],
        "streams": streams,
        "schedule": schedule_payload(schedule),
        "schema_change_policy": row["schema_change_policy"],
        "created_at": domain.to_zulu(row["created_at"]),
        "next_run_at": domain.to_zulu(row["next_run_at"]),
    }
    return payload


def schedule_payload(schedule: dict) -> dict:
    out = {"type": schedule.get("type", "manual")}
    if out["type"] == "interval" and schedule.get("interval_minutes") is not None:
        out["interval_minutes"] = schedule["interval_minutes"]
    if out["type"] == "cron":
        out["cron_expression"] = schedule.get("cron_expression", "")
        out["time_zone"] = schedule.get("time_zone", "UTC")
    return out


def state_payload(row) -> list[dict]:
    cursors = row["cursors"] or {}
    out = []
    for stream in row["streams"] or []:
        if not stream.get("selected"):
            continue
        name = stream["name"]
        entry = {
            "name": name,
            "cursor_field": stream.get("cursor_field"),
            "cursor_value": cursors.get(name),
        }
        out.append(entry)
    return out


def recompute_next_run(conn, connection_id: str) -> None:
    row = conn.execute("SELECT * FROM connections WHERE id = %s", (connection_id,)).fetchone()
    if row is None:
        return
    if row["status"] != "active":
        next_run = None
    else:
        anchor = anchor_for(conn, connection_id, row["created_at"])
        next_run = compute_next_run(row["schedule"], anchor)
    conn.execute("UPDATE connections SET next_run_at = %s WHERE id = %s",
                 (next_run, connection_id))


def validate_streams(streams, catalog_streams: list[dict], custom: bool,
                      errors: dict) -> list[dict]:
    """Validate the request's stream list against the source catalog."""
    if not isinstance(streams, list):
        errors["streams"] = "Choose at least one stream."
        return []
    by_name = {s["name"]: s for s in catalog_streams}
    seen: set[str] = set()
    selected_any = False
    result: list[dict] = []
    for idx, stream in enumerate(streams):
        if not isinstance(stream, dict):
            errors[f"streams.{idx}"] = "This value must be an object."
            continue
        name = stream.get("name")
        if not isinstance(name, str) or name not in by_name:
            errors[f"streams.{idx}.name"] = "Choose a stream this source provides."
            continue
        if name in seen:
            errors[f"streams.{idx}.name"] = "Each stream can appear once."
            continue
        seen.add(name)
        mode = stream.get("sync_mode")
        if mode not in SYNC_MODES:
            errors[f"streams.{idx}.sync_mode"] = "Choose one of the four sync modes."
            continue
        if custom and mode not in CUSTOM_MODES:
            errors[f"streams.{idx}.sync_mode"] = "Custom sources support the two full refresh modes."
            continue
        selected = bool(stream.get("selected"))
        if selected:
            selected_any = True
        if mode.startswith("incremental"):
            if stream.get("cursor_field") != "updated_at":
                errors[f"streams.{idx}.cursor_field"] = "Incremental streams need the updated_at cursor."
                continue
            if mode == "incremental_dedup" and stream.get("primary_key") != ["id"]:
                errors[f"streams.{idx}.primary_key"] = "Incremental dedup needs the id primary key."
                continue
        known = by_name[name]
        result.append({
            "name": name,
            "selected": selected,
            "sync_mode": mode,
            "cursor_field": stream.get("cursor_field"),
            "primary_key": stream.get("primary_key"),
            "known_fields": list(known["fields"]),
        })
    if not selected_any:
        errors["streams"] = "Select at least one stream."
    return result
