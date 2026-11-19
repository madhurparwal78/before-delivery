"""The sky engine's HTTP API: site, horizon, night, plans, conditions, reminders."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

import pytz
from starlette.requests import Request
from starlette.responses import JSONResponse

from darkframe.common import astro
from darkframe.common.db import Database
from darkframe.common.http import ApiError, build_app, env_int, read_json
from darkframe.common.sky import (
    Night, Site, compute_night, condition_for, current_minute, filter_window,
    minute_instant, moon_clear, position_status, round_half, sky_clear,
)
from darkframe.common.validate import FILTERS, is_int
from darkframe.common.zones import (
    format_iso_local, format_local_hm, observing_date_utc, to_site_local,
)

VERSION = "1.0.0"
DB: Optional[Database] = None


def db() -> Database:
    assert DB is not None
    return DB


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def imager(request: Request) -> str:
    return request.headers.get("x-imager-id", "")


def _site(cursor, ident: str) -> dict:
    row = cursor.execute("SELECT * FROM sites WHERE imager_id=%s", (ident,)).fetchone()
    if not row:
        raise ApiError(404, "not_found", "There is no site for this workspace yet.")
    return dict(row)


def _horizon(cursor, ident: str) -> list[int]:
    row = cursor.execute("SELECT altitudes FROM horizons WHERE imager_id=%s", (ident,)).fetchone()
    if not row:
        return [0] * 72
    stored = row["altitudes"]
    if isinstance(stored, str):
        stored = json.loads(stored)
    return [int(v) for v in stored]


def _site_object(row: dict) -> Site:
    return Site(row["label"], float(row["latitude"]), float(row["longitude"]),
                int(row["elevation_m"]), row["time_zone"], int(row["min_altitude_deg"]))


async def get_site(request: Request):
    ident = imager(request)

    def fn(cursor):
        row = _site(cursor, ident)
        return {
            "label": row["label"], "latitude": float(row["latitude"]),
            "longitude": float(row["longitude"]), "elevation_m": int(row["elevation_m"]),
            "time_zone": row["time_zone"], "min_altitude_deg": int(row["min_altitude_deg"]),
            "push_topic": row["push_topic"],
        }
    return JSONResponse(db().run_in_transaction(fn))


async def patch_site(request: Request):
    ident = imager(request)
    body = await read_json(request)
    fields: dict[str, str] = {}
    updates: dict[str, Any] = {}
    if "label" in body:
        if not isinstance(body["label"], str) or not (1 <= len(body["label"]) <= 60):
            fields["label"] = "Site label must be between 1 and 60 characters."
        else:
            updates["label"] = body["label"]
    if "latitude" in body:
        v = body["latitude"]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not (-90 <= v <= 90):
            fields["latitude"] = "Latitude must be between -90 and 90."
        else:
            updates["latitude"] = float(v)
    if "longitude" in body:
        v = body["longitude"]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not (-180 <= v <= 180):
            fields["longitude"] = "Longitude must be between -180 and 180."
        else:
            updates["longitude"] = float(v)
    if "elevation_m" in body:
        v = body["elevation_m"]
        if not is_int(v) or not (-500 <= v <= 9000):
            fields["elevation_m"] = "Elevation must be a whole number between -500 and 9,000 metres."
        else:
            updates["elevation_m"] = v
    if "time_zone" in body:
        try:
            pytz.timezone(body["time_zone"])
        except Exception:
            fields["time_zone"] = "Choose a valid time zone."
        else:
            updates["time_zone"] = body["time_zone"]
    if "min_altitude_deg" in body:
        v = body["min_altitude_deg"]
        if not is_int(v) or not (0 <= v <= 60):
            fields["min_altitude_deg"] = "Minimum altitude must be a whole number between 0 and 60."
        else:
            updates["min_altitude_deg"] = v
    if "push_topic" in body:
        v = body["push_topic"]
        if v is not None and (not isinstance(v, str) or not (1 <= len(v) <= 64)
                              or not all(c.isalnum() or c in "_-" for c in v)):
            fields["push_topic"] = "Push topic must be letters, digits, underscores or hyphens."
        else:
            updates["push_topic"] = v
    if fields:
        raise ApiError(422, "validation", "Check the highlighted fields.", fields)

    def fn(cursor):
        _site(cursor, ident)
        for key, value in updates.items():
            cursor.execute(f"UPDATE sites SET {key}=%s, updated_at=%s WHERE imager_id=%s", (value, now_utc(), ident))
        row = _site(cursor, ident)
        return {
            "label": row["label"], "latitude": float(row["latitude"]),
            "longitude": float(row["longitude"]), "elevation_m": int(row["elevation_m"]),
            "time_zone": row["time_zone"], "min_altitude_deg": int(row["min_altitude_deg"]),
            "push_topic": row["push_topic"],
        }
    return JSONResponse(db().run_in_transaction(fn))


async def get_horizon(request: Request):
    ident = imager(request)

    def fn(cursor):
        return {"altitudes": _horizon(cursor, ident)}
    return JSONResponse(db().run_in_transaction(fn))


async def put_horizon(request: Request):
    ident = imager(request)
    body = await read_json(request)
    values = body.get("altitudes")
    if not isinstance(values, list) or len(values) != 72 or not all(
        is_int(v) and 0 <= v <= 90 for v in values
    ):
        raise ApiError(422, "validation", "Send exactly 72 whole altitudes between 0 and 90.", {"altitudes": "Send exactly 72 whole altitudes between 0 and 90."})

    def fn(cursor):
        _site(cursor, ident)
        cursor.execute(
            "INSERT INTO horizons (imager_id, altitudes, updated_at) VALUES (%s,%s,%s)"
            " ON CONFLICT (imager_id) DO UPDATE SET altitudes=EXCLUDED.altitudes, updated_at=EXCLUDED.updated_at",
            (ident, json.dumps(values), now_utc()),
        )
        return {"altitudes": values}
    return JSONResponse(db().run_in_transaction(fn))


# ---------------------------------------------------------------------------
# Night and plans


def night_body(night: Night, site: Site) -> dict:
    zone = site.time_zone
    return {
        "date": night.date,
        "has_astronomical_night": night.has_astronomical_night,
        "dusk": format_iso_local(night.dusk, zone) if night.dusk else None,
        "dawn": format_iso_local(night.dawn, zone) if night.dawn else None,
        "minutes": night.minutes,
        "narrowband_start": format_iso_local(night.narrowband_start, zone) if night.narrowband_start else None,
        "narrowband_end": format_iso_local(night.narrowband_end, zone) if night.narrowband_end else None,
        "moon_illumination": night.moon_illumination,
        "utc_offset_at_dusk": night.utc_offset_at_dusk,
    }


def _sun_at(t: datetime, site: Site) -> tuple[float, float]:
    jd = astro.julian_day(t)
    ra, dec = astro.sun_ra_dec(jd)
    lst = astro.local_sidereal_time_deg(t, site.longitude)
    return astro._alt_az(ra, dec, lst, site.latitude)


def _moon_at(t: datetime, site: Site) -> tuple[float, float, float, float]:
    jd = astro.julian_day(t)
    alt, az, dist = astro.topocentric_moon(jd, t, site.latitude, site.longitude, site.elevation_m)
    illum = round_half(astro.moon_illumination(jd), 2)
    return alt, az, illum, dist


def _target_at(t: datetime, site: Site, ra: float, dec: float) -> tuple[float, float]:
    jd = astro.julian_day(t)
    pra, pdec = astro.precess_ra_dec(ra, dec, jd)
    lst = astro.local_sidereal_time_deg(t, site.longitude)
    return astro._alt_az(pra, pdec, lst, site.latitude)


def _hours_body(night: Night, site: Site) -> list[str]:
    """The night's hour starts as ISO site-local instants (repeats keep distinct offsets)."""
    return [format_iso_local(h, site.time_zone) for h in night.hours]


def _condition_entries(cursor, ident: str, date_str: str) -> list[dict]:
    rows = cursor.execute(
        "SELECT * FROM conditions WHERE imager_id=%s AND date=%s ORDER BY hour_start",
        (ident, date_str),
    ).fetchall()
    return [
        {
            "hour_start": r["hour_start"],
            "cloud_pct": int(r["cloud_pct"]),
            "transparency": int(r["transparency"]),
            "seeing": int(r["seeing"]),
            "hour_start_utc": r["hour_start"],
        }
        for r in rows
    ]


def _conditions_body(cursor, ident: str, date_str: str, site: Site) -> dict:
    header = cursor.execute(
        "SELECT * FROM condition_headers WHERE imager_id=%s AND date=%s", (ident, date_str)
    ).fetchone()
    entries = _condition_entries(cursor, ident, date_str)
    entered_at = header["entered_at"] if header else None
    stale = False
    if entered_at:
        stale = (now_utc() - entered_at).total_seconds() > env_int("CONDITIONS_STALE_SECONDS", 10800)
    labels = {e["hour_start"]: e for e in entries}
    return {
        "entered_at": entered_at.isoformat().replace("+00:00", "Z") if entered_at else None,
        "stale": stale,
        "hours": [
            {
                "hour_start": format_iso_local(e["hour_start"], site.time_zone),
                "cloud_pct": e["cloud_pct"],
                "transparency": e["transparency"],
                "seeing": e["seeing"],
            }
            for e in entries
        ],
    }


def _sky_clear_at(entries: list[dict], t: datetime) -> bool:
    entry = condition_for(entries, t)
    return sky_clear(entry)


def _plan_targets(cursor, ident: str, date_str: str) -> list[dict]:
    rows = cursor.execute(
        "SELECT p.project_id, p.added_at FROM plans p WHERE p.imager_id=%s AND p.date=%s ORDER BY p.added_at",
        (ident, date_str),
    ).fetchall()
    out = []
    for r in rows:
        project = cursor.execute("SELECT * FROM ledger.projects WHERE id=%s", (r["project_id"],)).fetchone()
        if project:
            out.append(dict(project))
    return out


def _project_filters(cursor, project_id: str) -> list[dict]:
    rows = cursor.execute(
        "SELECT filter, COALESCE(-SUM(seconds) FILTER (WHERE account='allotment'),0) AS planned,"
        " COALESCE(SUM(seconds) FILTER (WHERE account='integrated'),0) AS logged,"
        " COALESCE(SUM(seconds) FILTER (WHERE account='owed'),0) AS owed"
        " FROM ledger.entries WHERE project_id=%s GROUP BY filter",
        (project_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def _target_positions(site: Site, night: Night, ra: float, dec: float) -> list[tuple[int, float, float]]:
    """(minute, altitude, azimuth) every 5 minutes plus the last minute."""
    out = []
    if night.minutes == 0:
        alt, az = _target_at(minute_instant(night, 0), site, ra, dec)
        return [(0, round_half(alt, 1), round_half(az, 1))]
    for m in list(range(0, night.minutes + 1, 5)) + ([night.minutes] if (night.minutes % 5) else []):
        t = minute_instant(night, m)
        alt, az = _target_at(t, site, ra, dec)
        out.append((m, round_half(alt, 1), round_half(az, 1)))
    return out


def build_plan(ident: str, date_str: str, minute: int, now: Optional[datetime] = None) -> dict:
    """The whole plan body for a date and minute, the single source of the verdict."""
    now = now or now_utc()

    def fn(cursor):
        site_row = _site(cursor, ident)
        site = _site_object(site_row)
        night = compute_night(date_str, site)
        if minute < 0 or minute > night.minutes:
            raise ApiError(422, "validation", "Choose a minute inside the night.", {"minute": "Choose a minute inside the night."})
        mask = _horizon(cursor, ident)
        is_tonight = observing_date_utc(now, site.time_zone).strftime("%Y-%m-%d") == date_str
        cur_minute = current_minute(night, now) if is_tonight else 0
        stamp = minute_instant(night, minute)
        sun_alt, sun_az = _sun_at(stamp, site)
        moon_alt, moon_az, illum, _ = _moon_at(stamp, site)
        lst = astro.local_sidereal_time_deg(stamp, site.longitude)
        conditions = _conditions_body(cursor, ident, date_str, site)
        entries = _condition_entries(cursor, ident, date_str)
        targets = _plan_targets(cursor, ident, date_str)
        target_out: list[dict] = []
        best_candidates: list[tuple[int, int, int, dict, dict]] = []
        filter_runs_by_project: dict[str, dict[str, list[tuple[int, int]]]] = {}
        counting_any = False
        total_integration = 0

        for project in targets:
            filters = _project_filters(cursor, project["id"])
            by_filter = {f["filter"]: f for f in filters}
            counts = project["state"] == "active"
            ra = float(project["ra_deg"])
            dec = float(project["dec_deg"])
            arcs = _target_positions(site, night, ra, dec)
            dot_alt, dot_az = _target_at(stamp, site, ra, dec)
            dot_alt_r = round_half(dot_alt, 1)
            dot_az_r = round_half(dot_az, 1)
            mask_bin = int(dot_az_r // 5) % 72
            status = position_status(dot_alt_r, mask[mask_bin], site.min_altitude_deg)
            sep = astro.angular_separation_altaz(dot_alt, dot_az, moon_alt, moon_az)
            sep_r = round_half(sep, 1)
            clear_minutes = 0
            if night.minutes > 0:
                for m in range(minute, night.minutes):
                    t = minute_instant(night, m)
                    alt, az = _target_at(t, site, ra, dec)
                    bin_i = int(az // 5) % 72
                    if position_status(alt, mask[bin_i], site.min_altitude_deg) == "clear":
                        clear_minutes += 1
            filter_rows: list[dict] = []
            filter_runs: dict[str, list[tuple[int, int]]] = {}
            if night.minutes > 0:
                # Position and Moon state per minute, shared by every filter.
                positions: list[tuple[bool, tuple[float, float, float], float]] = []
                lowest_start = -30
                for m in range(lowest_start, night.minutes + 30):
                    t = minute_instant(night, m)
                    alt, az = _target_at(t, site, ra, dec)
                    bin_i = int(az // 5) % 72
                    clear_pos = position_status(alt, mask[bin_i], site.min_altitude_deg) == "clear"
                    m_alt, m_az, m_illum, _ = _moon_at(t, site)
                    sep_t = astro.angular_separation_altaz(alt, az, m_alt, m_az)
                    positions.append((clear_pos, (m_alt, m_illum, sep_t), alt))
                for name in FILTERS:
                    row = by_filter.get(name)
                    if not row or int(row["planned"]) <= 0:
                        continue
                    owed = int(row["owed"])
                    narrowband = name in ("Ha", "OIII", "SII")
                    start, end = filter_window(night, narrowband)
                    count_from = start if minute == 0 else minute
                    usable = 0
                    run_start: Optional[int] = None
                    runs: list[tuple[int, int]] = []
                    for m in range(count_from, end):
                        clear_pos, moon_state, _alt = positions[m - lowest_start]
                        if not clear_pos:
                            if run_start is not None:
                                runs.append((run_start, m))
                            run_start = None
                            continue
                        m_alt, m_illum, sep_t = moon_state
                        if not moon_clear(m_alt, m_illum, sep_t, name) or not _sky_clear_at(entries, minute_instant(night, m)):
                            if run_start is not None:
                                runs.append((run_start, m))
                            run_start = None
                            continue
                        usable += 1
                        if run_start is None:
                            run_start = m
                    if run_start is not None:
                        runs.append((run_start, end))
                    filter_runs[name] = runs
                    filter_rows.append({
                        "filter": name,
                        "owed_seconds": owed,
                        "usable_minutes": usable,
                        "owed_after_tonight_seconds": max(0, owed - 60 * usable),
                    })
                filter_runs_by_project[project["id"]] = filter_runs
            if counts:
                counting_any = True
                total_integration += sum(int(f["logged"]) for f in filters)
            target_out.append({
                "project_id": project["id"],
                "project_name": project["name"],
                "target_name": project["target_name"],
                "counts": counts,
                "altitude_deg": dot_alt_r,
                "azimuth_deg": dot_az_r,
                "moon_separation_deg": sep_r,
                "position_status": status,
                "clear_minutes": clear_minutes,
                "filters": filter_rows,
                "arc": [{"minute": m, "altitude_deg": a, "azimuth_deg": az} for m, a, az in arcs],
            })
            for row in filter_rows:
                if counts and row["owed_seconds"] > 0:
                    candidate = (-row["usable_minutes"], len(target_out) - 1, FILTERS.index(row["filter"]), row, target_out[-1])
                    best_candidates.append(candidate)

        # Choose best: most usable minutes, then earliest-added target, then filter order.
        best: Optional[dict] = None
        clear_window = None
        if best_candidates:
            best_candidates.sort(key=lambda c: (c[0], c[1], c[2]))
            chosen, target = best_candidates[0][3], best_candidates[0][4]
            runs = filter_runs_by_project.get(target["project_id"], {}).get(chosen["filter"], [])
            best = {
                "project_id": target["project_id"],
                "target_name": target["target_name"],
                "filter": chosen["filter"],
                "usable_minutes": chosen["usable_minutes"],
            }
            if runs:
                start_m, end_m = runs[0]
                start_t = minute_instant(night, start_m)
                end_t = minute_instant(night, end_m)
                starts_in = None
                if is_tonight:
                    starts_in = max(0, int((start_t - now).total_seconds() // 60))
                clear_window = {
                    "start": format_iso_local(start_t, site.time_zone),
                    "end": format_iso_local(end_t, site.time_zone),
                    "start_minute": start_m,
                    "end_minute": end_m,
                    "starts_in_minutes": starts_in,
                }

        # Verdict
        if night.minutes == 0:
            verdict = "no-go"
            reason = "no-astronomical-night"
        elif not conditions["hours"]:
            verdict = "unknown"
            reason = "no-conditions"
        elif not best_candidates:
            verdict = "no-go"
            reason = "no-targets"
        elif best and best["usable_minutes"] >= 60:
            verdict = "go"
            reason = "go"
        else:
            verdict = "no-go"
            reason = "under-60-minutes"

        site_body = {
            "label": site_row["label"], "time_zone": site_row["time_zone"],
        }
        return {
            "date": date_str,
            "is_tonight": is_tonight,
            "server_time": now.isoformat().replace("+00:00", "Z"),
            "minute": minute,
            "time_local": format_local_hm(stamp, site.time_zone),
            "night": night_body(night, site),
            "site": site_body,
            "min_altitude_deg": site.min_altitude_deg,
            "sun": {"altitude_deg": round_half(sun_alt, 1), "azimuth_deg": round_half(sun_az, 1)},
            "local_sidereal_time_deg": round_half(lst, 1),
            "moon": {
                "altitude_deg": round_half(moon_alt, 1),
                "azimuth_deg": round_half(moon_az, 1),
                "illumination": illum,
            },
            "hours": _hours_body(night, site),
            "conditions": conditions,
            "targets": target_out,
            "verdict": verdict,
            "verdict_reason": reason,
            "best": best,
            "clear_window": clear_window,
            "total_integration_seconds": total_integration,
        }
    return db().run_in_transaction(fn)
