"""The sky engine's site, plan and conditions records."""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

import asyncpg

from ..config import CONFIG, LEDGER, SKY_ENGINE
from ..db import Database
from ..domain import horizon, night as night_rules, timeutil, verdict as verdict_rules
from ..domain.conditions import Conditions, HourEntry
from ..errors import not_found, service_unavailable
from ..httpclient import HttpError
from ..service import call_service
from .schema import SCHEMA_SQL

DATABASE = Database(SKY_ENGINE, SCHEMA_SQL)
DEFAULT_MIN_ALTITUDE_DEG = 20
MAX_PLAN_TARGETS = 8


async def site_row(imager_id: str) -> asyncpg.Record:
    row = await DATABASE.fetchrow(
        "select * from sky_engine.sites where imager_id = $1", imager_id
    )
    if row is None:
        raise not_found()
    return row


def site_body(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "label": row["label"],
        "latitude": row["latitude"],
        "longitude": row["longitude"],
        "elevation_m": row["elevation_m"],
        "time_zone": row["time_zone"],
        "min_altitude_deg": row["min_altitude_deg"],
        "push_topic": row["push_topic"],
    }


def site_facts(row: asyncpg.Record) -> night_rules.SiteFacts:
    return night_rules.SiteFacts(
        label=row["label"],
        latitude=row["latitude"],
        longitude=row["longitude"],
        elevation_m=row["elevation_m"],
        time_zone=row["time_zone"],
    )


async def create_site(imager_id: str, site: dict[str, Any]) -> None:
    await DATABASE.execute(
        """
        insert into sky_engine.sites (imager_id, label, latitude, longitude,
            elevation_m, time_zone, min_altitude_deg, push_topic, horizon_altitudes)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (imager_id) do nothing
        """,
        imager_id,
        site["label"],
        site["latitude"],
        site["longitude"],
        site["elevation_m"],
        site["time_zone"],
        site.get("min_altitude_deg", DEFAULT_MIN_ALTITUDE_DEG),
        site.get("push_topic"),
        site.get("horizon", horizon.default_mask()),
    )
    await DATABASE.execute(
        "insert into sky_engine.reminders (imager_id) values ($1) "
        "on conflict (imager_id) do nothing",
        imager_id,
    )


async def load_conditions(imager_id: str, observing_date: date) -> Conditions:
    row = await DATABASE.fetchrow(
        "select entered_at, hours from sky_engine.plan_conditions "
        "where imager_id = $1 and observing_date = $2",
        imager_id,
        observing_date,
    )
    if row is None:
        return Conditions(entered_at=None, entries=())
    stored = json.loads(row["hours"])
    return Conditions(
        entered_at=row["entered_at"],
        entries=tuple(
            HourEntry(
                hour_start=timeutil.parse_offset_instant(entry["hour_start"]),
                cloud_pct=entry["cloud_pct"],
                transparency=entry["transparency"],
                seeing=entry["seeing"],
            )
            for entry in stored
        ),
    )


async def save_conditions(
    imager_id: str, observing_date: date, hours: list[dict[str, Any]]
) -> None:
    if not hours:
        await DATABASE.execute(
            "delete from sky_engine.plan_conditions "
            "where imager_id = $1 and observing_date = $2",
            imager_id,
            observing_date,
        )
        return
    await DATABASE.execute(
        """
        insert into sky_engine.plan_conditions
            (imager_id, observing_date, entered_at, hours)
        values ($1, $2, $3, $4::jsonb)
        on conflict (imager_id, observing_date) do update
        set entered_at = excluded.entered_at, hours = excluded.hours
        """,
        imager_id,
        observing_date,
        timeutil.now_utc(),
        json.dumps(hours),
    )


async def plan_project_ids(imager_id: str, observing_date: date) -> list[str]:
    rows = await DATABASE.fetch(
        "select project_id from sky_engine.plan_targets "
        "where imager_id = $1 and observing_date = $2 order by added_at, project_id",
        imager_id,
        observing_date,
    )
    return [row["project_id"] for row in rows]


async def fetch_projects(imager_id: str, request_id: str) -> list[dict[str, Any]]:
    try:
        response = await call_service(
            CONFIG.base_url(LEDGER),
            "GET",
            "/internal/projects",
            imager_id=imager_id,
            request_id=request_id,
        )
    except HttpError:
        raise service_unavailable(LEDGER)
    if response.status != 200:
        raise service_unavailable(LEDGER)
    return json.loads(response.body)["projects"]


async def plan_inputs(
    imager_id: str,
    observing_date: date,
    minute: int | None,
    request_id: str,
    now: datetime | None = None,
) -> tuple[verdict_rules.PlanInputs, asyncpg.Record]:
    row = await site_row(imager_id)
    facts = site_facts(row)
    moment = now or timeutil.now_utc()
    night = night_rules.compute_night(facts, observing_date)
    chosen = (
        night_rules.current_minute(night, moment)
        if minute is None
        else minute
    )
    projects = {
        project["id"]: project for project in await fetch_projects(imager_id, request_id)
    }
    targets: list[verdict_rules.PlanTarget] = []
    for project_id in await plan_project_ids(imager_id, observing_date):
        project = projects.get(project_id)
        if project is None:
            continue
        targets.append(
            verdict_rules.PlanTarget(
                project_id=project["id"],
                project_name=project["name"],
                target_name=project["target_name"],
                ra_deg=project["ra_deg"],
                dec_deg=project["dec_deg"],
                counts=project["state"] == "active",
                total_integration_seconds=project["total_integration_seconds"],
                planned_filters=tuple(
                    verdict_rules.PlannedFilter(
                        filter=item["filter"],
                        planned_seconds=item["planned_seconds"],
                        logged_seconds=item["logged_seconds"],
                        owed_seconds=item["owed_seconds"],
                    )
                    for item in project["filters"]
                ),
            )
        )
    return (
        verdict_rules.PlanInputs(
            night=night,
            mask=list(row["horizon_altitudes"]),
            min_altitude_deg=row["min_altitude_deg"],
            targets=tuple(targets),
            conditions=await load_conditions(imager_id, observing_date),
            minute=chosen,
            now=moment,
            stale_seconds=CONFIG.conditions_stale_seconds,
        ),
        row,
    )


async def mark_for_evaluation(imager_id: str) -> None:
    await DATABASE.execute(
        "insert into sky_engine.pending_evaluation (imager_id, requested_at) "
        "values ($1, $2) on conflict (imager_id) do update "
        "set requested_at = excluded.requested_at",
        imager_id,
        timeutil.now_utc(),
    )
