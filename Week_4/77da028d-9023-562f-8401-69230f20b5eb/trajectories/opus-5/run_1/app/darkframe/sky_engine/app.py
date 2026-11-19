"""The sky engine: the site, the horizon mask, plans, verdicts and reminders."""

from __future__ import annotations

import asyncio
from datetime import date, time, timezone
from typing import Any

from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from ..domain import (
    horizon,
    newmoon,
    night as night_rules,
    timeutil,
    verdict as verdict_rules,
)
from ..errors import conflict, not_found, validation
from ..service import build_service, imager_of
from ..sitefields import read_site
from ..validate import Fields, parse_date_param
from ..webkit import json_response, read_json_body, request_id_of
from . import evaluator
from .seed import apply_seed
from .store import (
    DATABASE,
    MAX_PLAN_TARGETS,
    create_site,
    fetch_projects,
    mark_for_evaluation,
    plan_inputs,
    save_conditions,
    site_body,
    site_facts,
    site_row,
)

LOOP_TASKS: list[asyncio.Task[None]] = []
MAX_OCCURRENCE_COUNT = 12


async def read_site_route(request: Request) -> Response:
    return json_response(site_body(await site_row(imager_of(request))))


async def patch_site(request: Request) -> Response:
    imager_id = imager_of(request)
    body = await read_json_body(request)
    await site_row(imager_id)
    changes = read_site(body, required=False)
    columns = {
        "label": "label",
        "latitude": "latitude",
        "longitude": "longitude",
        "elevation_m": "elevation_m",
        "time_zone": "time_zone",
        "min_altitude_deg": "min_altitude_deg",
        "push_topic": "push_topic",
    }
    for name, value in changes.items():
        await DATABASE.execute(
            f"update sky_engine.sites set {columns[name]} = $2 where imager_id = $1",
            imager_id,
            value,
        )
    await mark_for_evaluation(imager_id)
    return json_response(site_body(await site_row(imager_id)))


async def read_horizon(request: Request) -> Response:
    row = await site_row(imager_of(request))
    return json_response({"altitudes": list(row["horizon_altitudes"])})


async def put_horizon(request: Request) -> Response:
    imager_id = imager_of(request)
    body = await read_json_body(request)
    await site_row(imager_id)
    altitudes = body.get("altitudes")
    if not horizon.valid_mask(altitudes):
        raise validation(
            {"altitudes": "Send exactly 72 whole numbers from 0 to 90."}
        )
    await DATABASE.execute(
        "update sky_engine.sites set horizon_altitudes = $2 where imager_id = $1",
        imager_id,
        altitudes,
    )
    await mark_for_evaluation(imager_id)
    return json_response({"altitudes": altitudes})


async def create_site_route(request: Request) -> Response:
    body = await read_json_body(request)
    site = read_site(body.get("site") or {}, prefix="site.", required=True)
    await create_site(body["imager_id"], site)
    await mark_for_evaluation(body["imager_id"])
    return Response(status_code=204)


async def read_night(request: Request) -> Response:
    row = await site_row(imager_of(request))
    observing_date = parse_date_param(request.query_params.get("date"))
    night = night_rules.compute_night(site_facts(row), observing_date)
    return json_response(night.body())


async def read_tonight(request: Request) -> Response:
    imager_id = imager_of(request)
    row = await site_row(imager_id)
    observing_date = timeutil.observing_date_of(
        timeutil.now_utc(), row["time_zone"]
    )
    inputs, _ = await plan_inputs(
        imager_id, observing_date, None, request_id_of(request)
    )
    return json_response(verdict_rules.build_plan(inputs))


async def read_plan(request: Request) -> Response:
    imager_id = imager_of(request)
    observing_date = parse_date_param(request.path_params["observing_date"])
    raw = request.query_params.get("minute", "0")
    if not raw.lstrip("-").isdigit():
        raise validation({"minute": "Use a whole number of minutes."})
    inputs, _ = await plan_inputs(
        imager_id, observing_date, int(raw), request_id_of(request)
    )
    if not 0 <= inputs.minute <= inputs.night.minutes:
        raise validation(
            {"minute": f"Use a minute from 0 to {inputs.night.minutes}."}
        )
    return json_response(verdict_rules.build_plan(inputs))


async def _plan_response(
    imager_id: str, observing_date: date, request_id: str
) -> Response:
    inputs, _ = await plan_inputs(imager_id, observing_date, 0, request_id)
    return json_response(verdict_rules.build_plan(inputs))


async def add_plan_target(request: Request) -> Response:
    imager_id = imager_of(request)
    observing_date = parse_date_param(request.path_params["observing_date"])
    body = await read_json_body(request)
    await site_row(imager_id)
    project_id = body.get("project_id")
    if not isinstance(project_id, str) or not project_id:
        raise validation({"project_id": "This field is required."})
    projects = {
        project["id"]: project
        for project in await fetch_projects(imager_id, request_id_of(request))
    }
    project = projects.get(project_id)
    if project is None:
        raise not_found()
    if project["state"] != "active":
        raise conflict(
            "project_not_active", "Only an active project can join a plan."
        )
    async with DATABASE.transaction() as connection:
        await connection.execute(
            "select pg_advisory_xact_lock(hashtext($1))",
            f"plan:{imager_id}:{observing_date.isoformat()}",
        )
        already = await connection.fetchval(
            "select 1 from sky_engine.plan_targets "
            "where imager_id = $1 and observing_date = $2 and project_id = $3",
            imager_id,
            observing_date,
            project_id,
        )
        if already:
            raise conflict(
                "already_planned", "That target is already in this night's plan."
            )
        count = await connection.fetchval(
            "select count(*) from sky_engine.plan_targets "
            "where imager_id = $1 and observing_date = $2",
            imager_id,
            observing_date,
        )
        if count >= MAX_PLAN_TARGETS:
            raise conflict(
                "plan_full", f"A night's plan holds at most {MAX_PLAN_TARGETS} targets."
            )
        await connection.execute(
            "insert into sky_engine.plan_targets "
            "(imager_id, observing_date, project_id) values ($1, $2, $3)",
            imager_id,
            observing_date,
            project_id,
        )
    await mark_for_evaluation(imager_id)
    response = await _plan_response(
        imager_id, observing_date, request_id_of(request)
    )
    response.status_code = 201
    return response


async def remove_plan_target(request: Request) -> Response:
    imager_id = imager_of(request)
    observing_date = parse_date_param(request.path_params["observing_date"])
    project_id = request.path_params["project_id"]
    await site_row(imager_id)
    removed = await DATABASE.fetchval(
        "delete from sky_engine.plan_targets "
        "where imager_id = $1 and observing_date = $2 and project_id = $3 "
        "returning project_id",
        imager_id,
        observing_date,
        project_id,
    )
    if removed is None:
        raise not_found()
    await mark_for_evaluation(imager_id)
    return await _plan_response(imager_id, observing_date, request_id_of(request))


async def put_conditions(request: Request) -> Response:
    imager_id = imager_of(request)
    observing_date = parse_date_param(request.path_params["observing_date"])
    body = await read_json_body(request)
    row = await site_row(imager_id)
    night = night_rules.compute_night(site_facts(row), observing_date)
    allowed = {
        hour.astimezone(timezone.utc) for hour in night.hour_starts()
    }
    raw = body.get("hours")
    if not isinstance(raw, list):
        raise validation({"hours": "Send a list of hourly conditions."})
    fields = Fields({})
    stored: list[dict[str, Any]] = []
    for index, entry in enumerate(raw):
        label = f"hours[{index}]"
        if not isinstance(entry, dict):
            fields.fail(label, "Send an object for each hour.")
            continue
        hour = Fields(entry, prefix=f"{label}.")
        instant = timeutil.parse_offset_instant(entry.get("hour_start"))
        if instant is None or instant not in allowed:
            hour.fail("hour_start", "Use one of this night's hours.")
        cloud = hour.whole("cloud_pct", 0, 100)
        transparency = hour.whole("transparency", 1, 5)
        seeing = hour.whole("seeing", 1, 5)
        fields.errors.update(hour.errors)
        if not hour.errors:
            stored.append(
                {
                    "hour_start": timeutil.iso_utc(instant),
                    "cloud_pct": cloud,
                    "transparency": transparency,
                    "seeing": seeing,
                }
            )
    fields.done()
    await save_conditions(imager_id, observing_date, stored)
    await mark_for_evaluation(imager_id)
    return await _plan_response(imager_id, observing_date, request_id_of(request))


async def reevaluate(request: Request) -> Response:
    body = await read_json_body(request)
    await mark_for_evaluation(body["imager_id"])
    return Response(status_code=204)


async def _reminder_body(imager_id: str) -> dict[str, Any]:
    row = await DATABASE.fetchrow(
        "select enabled, local_time from sky_engine.reminders where imager_id = $1",
        imager_id,
    )
    site = await site_row(imager_id)
    if row is None:
        raise not_found()
    upcoming = newmoon.occurrences(
        site["time_zone"], row["local_time"], timeutil.now_utc(), 4
    )
    return {
        "enabled": row["enabled"],
        "local_time": row["local_time"].strftime("%H:%M"),
        "upcoming": [
            occurrence.body(site["time_zone"])
            for occurrence in upcoming
            if occurrence.remind_local.astimezone(timezone.utc) > timeutil.now_utc()
        ][:3],
    }


async def read_reminder(request: Request) -> Response:
    return json_response(await _reminder_body(imager_of(request)))


async def put_reminder(request: Request) -> Response:
    imager_id = imager_of(request)
    body = await read_json_body(request)
    await site_row(imager_id)
    fields = Fields(body)
    enabled = fields.boolean("enabled")
    local_time = fields.clock("local_time")
    fields.done()
    async with DATABASE.transaction() as connection:
        held = await connection.fetchrow(
            "select enabled, enabled_at from sky_engine.reminders "
            "where imager_id = $1 for update",
            imager_id,
        )
        still_on = enabled and held is not None and held["enabled"]
        enabled_at = (
            held["enabled_at"]
            if still_on
            else (timeutil.now_utc() if enabled else None)
        )
        await connection.execute(
            """
            insert into sky_engine.reminders
                (imager_id, enabled, local_time, enabled_at)
            values ($1, $2, $3, $4)
            on conflict (imager_id) do update
            set enabled = excluded.enabled, local_time = excluded.local_time,
                enabled_at = excluded.enabled_at
            """,
            imager_id,
            enabled,
            local_time,
            enabled_at,
        )
    return json_response(await _reminder_body(imager_id))


async def read_occurrences(request: Request) -> Response:
    imager_id = imager_of(request)
    site = await site_row(imager_id)
    row = await DATABASE.fetchrow(
        "select local_time from sky_engine.reminders where imager_id = $1", imager_id
    )
    fields = Fields({})
    raw_from = request.query_params.get("from")
    start_date = timeutil.parse_date(raw_from) if raw_from else None
    if raw_from and start_date is None:
        fields.fail("from", "Use a date as YYYY-MM-DD.")
    raw_count = request.query_params.get("count", "3")
    if not raw_count.isdigit() or not 1 <= int(raw_count) <= MAX_OCCURRENCE_COUNT:
        fields.fail("count", f"Use a whole number from 1 to {MAX_OCCURRENCE_COUNT}.")
    fields.done()
    start = (
        timeutil.resolve_wall_time(start_date, time(0, 0), site["time_zone"])
        if start_date
        else timeutil.now_utc()
    )
    return json_response(
        {
            "occurrences": [
                occurrence.body(site["time_zone"])
                for occurrence in newmoon.occurrences(
                    site["time_zone"], row["local_time"], start, int(raw_count)
                )
            ]
        }
    )


async def seed(request: Request) -> Response:
    body = await read_json_body(request)
    await apply_seed(body["imagers"])
    return Response(status_code=204)


async def _start_evaluator() -> None:
    evaluator.start(LOOP_TASKS)


ROUTES = [
    Route("/internal/site", read_site_route, methods=["GET"]),
    Route("/internal/site", patch_site, methods=["PATCH"]),
    Route("/internal/site/horizon", read_horizon, methods=["GET"]),
    Route("/internal/site/horizon", put_horizon, methods=["PUT"]),
    Route("/internal/sites", create_site_route, methods=["POST"]),
    Route("/internal/sky/night", read_night, methods=["GET"]),
    Route("/internal/tonight", read_tonight, methods=["GET"]),
    Route("/internal/plans/{observing_date}", read_plan, methods=["GET"]),
    Route(
        "/internal/plans/{observing_date}/targets", add_plan_target, methods=["POST"]
    ),
    Route(
        "/internal/plans/{observing_date}/targets/{project_id}",
        remove_plan_target,
        methods=["DELETE"],
    ),
    Route(
        "/internal/plans/{observing_date}/conditions",
        put_conditions,
        methods=["PUT"],
    ),
    Route("/internal/reevaluate", reevaluate, methods=["POST"]),
    Route("/internal/reminders/new-moon", read_reminder, methods=["GET"]),
    Route("/internal/reminders/new-moon", put_reminder, methods=["PUT"]),
    Route(
        "/internal/reminders/new-moon/occurrences", read_occurrences, methods=["GET"]
    ),
    Route("/internal/seed", seed, methods=["POST"]),
]

app = build_service("sky-engine", ROUTES, on_startup=[_start_evaluator])
