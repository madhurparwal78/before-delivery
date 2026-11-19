"""Plan routes: night, tonight, plans, targets, conditions, reminders."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Optional

import pytz
from starlette.requests import Request
from starlette.responses import JSONResponse

from darkframe.common.http import ApiError, read_json
from darkframe.common.newmoon import new_moons_between
from darkframe.common.validate import is_real_date
from darkframe.common.zones import format_iso_local, observing_date_utc, to_site_local
from darkframe.services.sky_engine.api import (
    _site, _site_object, build_plan, db, now_utc,
)
from darkframe.services.sky_engine.outbox import evaluate_and_maybe_push


def ident(request: Request) -> str:
    return request.headers.get("x-imager-id", "")


async def get_night(request: Request):
    who = ident(request)
    date_str = request.query_params.get("date", "")
    if not is_real_date(date_str):
        raise ApiError(422, "validation", "Choose a real YYYY-MM-DD date.", {"date": "Choose a real YYYY-MM-DD date."})

    def fn(cursor):
        from darkframe.services.sky_engine.api import _site_object, night_body
        from darkframe.common.sky import compute_night

        site = _site_object(_site(cursor, who))
        night = compute_night(date_str, site)
        return night_body(night, site)
    return JSONResponse(db().run_in_transaction(fn))


async def get_tonight(request: Request):
    who = ident(request)

    def fn(cursor):
        from darkframe.services.sky_engine.api import _site_object
        from darkframe.common.sky import compute_night, current_minute

        site = _site_object(_site(cursor, who))
        now = now_utc()
        date_str = observing_date_utc(now, site.time_zone).strftime("%Y-%m-%d")
        night = compute_night(date_str, site)
        minute = current_minute(night, now)
        return date_str, minute
    date_str, minute = db().run_in_transaction(fn)
    return JSONResponse(build_plan(who, date_str, minute))


async def get_plan(request: Request):
    who = ident(request)
    date_str = request.path_params["date"]
    if not is_real_date(date_str):
        raise ApiError(422, "validation", "Choose a real YYYY-MM-DD date.", {"date": "Choose a real YYYY-MM-DD date."})
    raw_minute = request.query_params.get("minute", "0")
    try:
        minute = int(raw_minute)
    except ValueError:
        raise ApiError(422, "validation", "Choose a minute inside the night.", {"minute": "Choose a minute inside the night."})
    if minute < 0:
        raise ApiError(422, "validation", "Choose a minute inside the night.", {"minute": "Choose a minute inside the night."})
    return JSONResponse(build_plan(who, date_str, minute))


async def add_target(request: Request):
    who = ident(request)
    date_str = request.path_params["date"]
    if not is_real_date(date_str):
        raise ApiError(422, "validation", "Choose a real YYYY-MM-DD date.", {"date": "Choose a real YYYY-MM-DD date."})
    body = await read_json(request)
    project_id = body.get("project_id")
    if not isinstance(project_id, str):
        raise ApiError(422, "validation", "Choose a project.", {"project_id": "Choose a project."})

    def fn(cursor):
        project = cursor.execute("SELECT * FROM ledger.projects WHERE id=%s", (project_id,)).fetchone()
        if not project or project["imager_id"] != who:
            raise ApiError(404, "not_found", "There is no project with that id.")
        if project["state"] != "active":
            raise ApiError(409, "project_not_active", "Only an active project can be planned.")
        existing = cursor.execute(
            "SELECT 1 FROM plans WHERE imager_id=%s AND date=%s AND project_id=%s",
            (who, date_str, project_id),
        ).fetchone()
        if existing:
            raise ApiError(409, "already_planned", "That target is already planned for this night.")
        count = cursor.execute(
            "SELECT COUNT(*) AS n FROM plans WHERE imager_id=%s AND date=%s", (who, date_str)
        ).fetchone()["n"]
        if int(count) >= 8:
            raise ApiError(409, "plan_full", "A plan holds at most 8 targets.")
        cursor.execute(
            "INSERT INTO plans (imager_id, date, project_id, added_at) VALUES (%s,%s,%s,%s)",
            (who, date_str, project_id, now_utc()),
        )
        return None
    db().run_in_transaction(fn)
    _evaluate(who, date_str)
    return JSONResponse(build_plan(who, date_str, 0), status_code=201)


async def remove_target(request: Request):
    who = ident(request)
    date_str = request.path_params["date"]
    project_id = request.path_params["project_id"]
    if not is_real_date(date_str):
        raise ApiError(422, "validation", "Choose a real YYYY-MM-DD date.", {"date": "Choose a real YYYY-MM-DD date."})

    def fn(cursor):
        existing = cursor.execute(
            "SELECT 1 FROM plans WHERE imager_id=%s AND date=%s AND project_id=%s",
            (who, date_str, project_id),
        ).fetchone()
        if not existing:
            raise ApiError(404, "not_found", "That target is not in this plan.")
        cursor.execute(
            "DELETE FROM plans WHERE imager_id=%s AND date=%s AND project_id=%s",
            (who, date_str, project_id),
        )
        return None
    db().run_in_transaction(fn)
    _evaluate(who, date_str)
    return JSONResponse(build_plan(who, date_str, 0))


def _evaluate(who: str, date_str: str) -> None:
    """Re-evaluate the night after any change that can move its verdict (DP-51)."""
    try:
        evaluate_and_maybe_push(who, date_str)
    except Exception:
        pass


async def put_conditions(request: Request):
    who = ident(request)
    date_str = request.path_params["date"]
    if not is_real_date(date_str):
        raise ApiError(422, "validation", "Choose a real YYYY-MM-DD date.", {"date": "Choose a real YYYY-MM-DD date."})
    body = await read_json(request)
    hours = body.get("hours")
    if not isinstance(hours, list):
        raise ApiError(422, "validation", "Send the hours for the night.", {"hours": "Send the hours for the night."})
    from darkframe.services.sky_engine.api import _site_object
    from darkframe.common.sky import compute_night

    def fn(cursor):
        site = _site_object(_site(cursor, who))
        night = compute_night(date_str, site)
        allowed = {format_iso_local(h, site.time_zone) for h in night.hours}
        cursor.execute("DELETE FROM conditions WHERE imager_id=%s AND date=%s", (who, date_str))
        for i, entry in enumerate(hours):
            if not isinstance(entry, dict):
                raise ApiError(422, "validation", "Check the highlighted fields.", {f"hours[{i}].hour_start": "Each hour needs cloud, transparency and seeing."})
            hour_start = entry.get("hour_start")
            cloud = entry.get("cloud_pct")
            transparency = entry.get("transparency")
            seeing = entry.get("seeing")
            fields: dict[str, str] = {}
            if hour_start not in allowed:
                fields[f"hours[{i}].hour_start"] = "That hour is not part of this night."
            if not isinstance(cloud, int) or isinstance(cloud, bool) or not (0 <= cloud <= 100):
                fields[f"hours[{i}].cloud_pct"] = "Cloud must be a whole number between 0 and 100."
            if not isinstance(transparency, int) or isinstance(transparency, bool) or not (1 <= transparency <= 5):
                fields[f"hours[{i}].transparency"] = "Transparency must be a whole number between 1 and 5."
            if not isinstance(seeing, int) or isinstance(seeing, bool) or not (1 <= seeing <= 5):
                fields[f"hours[{i}].seeing"] = "Seeing must be a whole number between 1 and 5."
            if fields:
                raise ApiError(422, "validation", "Check the highlighted fields.", fields)
        for entry in hours:
            # The label maps back to a stored instant by offset-aware lookup.
            stamp = _parse_hour_label(entry["hour_start"], site.time_zone)
            cursor.execute(
                "INSERT INTO conditions (imager_id, date, hour_start, cloud_pct, transparency, seeing) VALUES (%s,%s,%s,%s,%s,%s)"
                " ON CONFLICT (imager_id, date, hour_start) DO UPDATE SET cloud_pct=EXCLUDED.cloud_pct, transparency=EXCLUDED.transparency, seeing=EXCLUDED.seeing",
                (who, date_str, stamp, entry["cloud_pct"], entry["transparency"], entry["seeing"]),
            )
        if hours:
            cursor.execute(
                "INSERT INTO condition_headers (imager_id, date, entered_at) VALUES (%s,%s,%s)"
                " ON CONFLICT (imager_id, date) DO UPDATE SET entered_at=EXCLUDED.entered_at",
                (who, date_str, now_utc()),
            )
        else:
            cursor.execute(
                "INSERT INTO condition_headers (imager_id, date, entered_at) VALUES (%s,%s,NULL)"
                " ON CONFLICT (imager_id, date) DO UPDATE SET entered_at=NULL",
                (who, date_str),
            )
        return None
    db().run_in_transaction(fn)
    _evaluate(who, date_str)
    return JSONResponse(build_plan(who, date_str, 0))


def _parse_hour_label(label: str, zone_name: str) -> datetime:
    """The instant for an ISO site-local hour label like 2026-11-03T18:00:00+00:00."""
    text = label if "+" in label or label.endswith("Z") else label + "+00:00"
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    return datetime.fromisoformat(text).astimezone(timezone.utc)


# ---------------------------------------------------------------------------
# Reminders


async def reminders_get(request: Request):
    who = ident(request)

    def fn(cursor):
        from darkframe.services.sky_engine.api import _site_object

        row = cursor.execute("SELECT * FROM reminders WHERE imager_id=%s", (who,)).fetchone()
        site = _site_object(_site(cursor, who))
        enabled = bool(row["enabled"]) if row else False
        local_time = row["local_time"] if row else "18:00"
        return enabled, local_time, site
    enabled, local_time, site = db().run_in_transaction(fn)
    upcoming = _upcoming(site, local_time, 3)
    return JSONResponse({"enabled": enabled, "local_time": local_time, "upcoming": upcoming})


async def reminders_put(request: Request):
    who = ident(request)
    body = await read_json(request)
    enabled = body.get("enabled")
    local_time = body.get("local_time")
    fields: dict[str, str] = {}
    if not isinstance(enabled, bool):
        fields["enabled"] = "Choose whether the reminder is on."
    if not isinstance(local_time, str):
        fields["local_time"] = "Choose a time of day as HH:MM."
    else:
        if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", local_time):
            fields["local_time"] = "Choose a time of day as HH:MM."
    if fields:
        raise ApiError(422, "validation", "Check the highlighted fields.", fields)

    def fn(cursor):
        cursor.execute(
            "INSERT INTO reminders (imager_id, enabled, local_time) VALUES (%s,%s,%s)"
            " ON CONFLICT (imager_id) DO UPDATE SET enabled=EXCLUDED.enabled, local_time=EXCLUDED.local_time",
            (who, enabled, local_time),
        )
        from darkframe.services.sky_engine.api import _site_object

        site = _site_object(_site(cursor, who))
        return site
    site = db().run_in_transaction(fn)
    upcoming = _upcoming(site, local_time, 3)
    return JSONResponse({"enabled": enabled, "local_time": local_time, "upcoming": upcoming})


async def reminder_occurrences(request: Request):
    who = ident(request)
    date_str = request.query_params.get("from", "")
    count_raw = request.query_params.get("count", "1")
    if not is_real_date(date_str):
        raise ApiError(422, "validation", "Choose a real YYYY-MM-DD date.", {"from": "Choose a real YYYY-MM-DD date."})
    try:
        count = int(count_raw)
    except ValueError:
        raise ApiError(422, "validation", "Count must be between 1 and 12.", {"count": "Count must be between 1 and 12."})
    if not (1 <= count <= 12):
        raise ApiError(422, "validation", "Count must be between 1 and 12.", {"count": "Count must be between 1 and 12."})

    def fn(cursor):
        from darkframe.services.sky_engine.api import _site_object

        return _site_object(_site(cursor, who))
    site = db().run_in_transaction(fn)
    row = db().run_in_transaction(lambda cursor: cursor.execute("SELECT * FROM reminders WHERE imager_id=%s", (who,)).fetchone())
    local_time = row["local_time"] if row else "18:00"
    return JSONResponse({"occurrences": _upcoming(site, local_time, count, from_date=date_str)})


def _upcoming(site, local_time: str, count: int, from_date: Optional[str] = None) -> list[dict]:
    from darkframe.common.zones import localize_wall_time

    zone = pytz.timezone(site.time_zone)
    now = now_utc()
    if from_date:
        start_local = datetime.fromisoformat(from_date + "T00:00:00")
        start = zone.localize(start_local)
    else:
        start_local = to_site_local(now, site.time_zone).replace(hour=0, minute=0, second=0, microsecond=0)
        start = start_local
    new_moons = new_moons_between(start.astimezone(timezone.utc), count)
    out = []
    for nm in new_moons:
        out.append(_occurrence_body_with_time(nm, site, local_time))
    return out


def _occurrence_body_with_time(new_moon_utc: datetime, site, local_time: str) -> dict:
    from darkframe.common.zones import localize_wall_time

    local_date = to_site_local(new_moon_utc, site.time_zone)
    nm_local_date = local_date.date()
    saturdays = [nm_local_date + timedelta(days=d) for d in range(-3, 4) if (nm_local_date + timedelta(days=d)).weekday() == 5]
    saturday = min(saturdays, key=lambda d: abs((d - nm_local_date).days)) if saturdays else nm_local_date
    friday = saturday - timedelta(days=1)
    hh, mm = (int(local_time[:2]), int(local_time[3:5]))
    remind_local = localize_wall_time(site.time_zone, friday, hh, mm)
    return {
        "new_moon_utc": new_moon_utc.isoformat().replace("+00:00", "Z"),
        "new_moon_local_date": nm_local_date.isoformat(),
        "weekend_saturday": saturday.isoformat(),
        "remind_local": format_iso_local(remind_local, site.time_zone),
        "remind_utc": remind_local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
