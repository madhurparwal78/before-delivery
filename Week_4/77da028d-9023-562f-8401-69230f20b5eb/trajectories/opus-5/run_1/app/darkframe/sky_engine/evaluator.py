"""Re-evaluates plans, and writes verdict and reminder rows to the outbox."""

from __future__ import annotations

import asyncio
import contextlib
from datetime import date, timedelta
from typing import Any

from ..domain import newmoon, pushtext, timeutil, verdict as verdict_rules
from ..errors import ApiError
from ..httpclient import HttpError
from .store import DATABASE, plan_inputs, site_row

TICK_SECONDS = 1.0
FULL_SWEEP_SECONDS = 60.0
PUSHABLE = (verdict_rules.GO, verdict_rules.NO_GO)


async def run_forever() -> None:
    last_sweep = 0.0
    while True:
        try:
            now = asyncio.get_running_loop().time()
            if now - last_sweep >= FULL_SWEEP_SECONDS:
                last_sweep = now
                for imager_id in await _all_imagers():
                    await _evaluate_imager(imager_id)
                    await _queue_reminders(imager_id)
            for imager_id in await _claim_pending():
                await _evaluate_imager(imager_id)
        except (OSError, HttpError, ApiError):
            pass
        await asyncio.sleep(TICK_SECONDS)


async def _all_imagers() -> list[str]:
    rows = await DATABASE.fetch("select imager_id from sky_engine.sites")
    return [row["imager_id"] for row in rows]


async def _claim_pending() -> list[str]:
    rows = await DATABASE.fetch(
        "delete from sky_engine.pending_evaluation returning imager_id"
    )
    return [row["imager_id"] for row in rows]


async def _affected_dates(imager_id: str, today: date) -> list[date]:
    rows = await DATABASE.fetch(
        """
        select distinct observing_date from (
            select observing_date from sky_engine.plan_targets where imager_id = $1
            union
            select observing_date from sky_engine.plan_conditions where imager_id = $1
        ) as dates where observing_date >= $2
        """,
        imager_id,
        today - timedelta(days=1),
    )
    dates = {row["observing_date"] for row in rows}
    dates.add(today)
    return sorted(dates)


async def _evaluate_imager(imager_id: str) -> None:
    row = await site_row(imager_id)
    now = timeutil.now_utc()
    today = timeutil.observing_date_of(now, row["time_zone"])
    for observing_date in await _affected_dates(imager_id, today):
        inputs, _ = await plan_inputs(
            imager_id, observing_date, 0, "sky-engine-evaluation", now
        )
        plan = verdict_rules.build_plan(inputs)
        await _record_verdict(imager_id, observing_date, plan, row)


async def _record_verdict(
    imager_id: str, observing_date: date, plan: dict[str, Any], site: Any
) -> None:
    verdict = str(plan["verdict"])
    async with DATABASE.transaction() as connection:
        previous = await connection.fetchval(
            "select verdict from sky_engine.verdict_history "
            "where imager_id = $1 and observing_date = $2 for update",
            imager_id,
            observing_date,
        )
        if previous == verdict:
            return
        await connection.execute(
            """
            insert into sky_engine.verdict_history
                (imager_id, observing_date, verdict, recorded_at)
            values ($1, $2, $3, $4)
            on conflict (imager_id, observing_date) do update
            set verdict = excluded.verdict, recorded_at = excluded.recorded_at
            """,
            imager_id,
            observing_date,
            verdict,
            timeutil.now_utc(),
        )
        if verdict not in PUSHABLE or not site["push_topic"]:
            return
        title, message = _verdict_text(observing_date, plan, site)
        await connection.execute(
            """
            insert into sky_engine.verdict_outbox
                (imager_id, kind, observing_date, topic, title, message)
            values ($1, 'verdict', $2, $3, $4, $5)
            """,
            imager_id,
            observing_date,
            site["push_topic"],
            title,
            message,
        )


def _verdict_text(
    observing_date: date, plan: dict[str, Any], site: Any
) -> tuple[str, str]:
    best = plan["best"]
    window = plan["clear_window"]
    if plan["verdict"] == verdict_rules.GO and best is not None and window is not None:
        return pushtext.go_push(
            observing_date,
            site["label"],
            site["latitude"],
            site["longitude"],
            best["target_name"],
            best["filter"],
            timeutil.hhmm(
                timeutil.parse_offset_instant(window["start"]), site["time_zone"]
            ),
            timeutil.hhmm(
                timeutil.parse_offset_instant(window["end"]), site["time_zone"]
            ),
            best["usable_minutes"],
        )
    return pushtext.no_go_push(
        observing_date, site["label"], site["latitude"], site["longitude"]
    )


async def _queue_reminders(imager_id: str) -> None:
    row = await DATABASE.fetchrow(
        "select enabled, local_time, enabled_at, last_queued_utc "
        "from sky_engine.reminders where imager_id = $1",
        imager_id,
    )
    if row is None or not row["enabled"] or row["enabled_at"] is None:
        return
    site = await site_row(imager_id)
    if not site["push_topic"]:
        return
    now = timeutil.now_utc()
    floor = max(row["enabled_at"], row["last_queued_utc"] or row["enabled_at"])
    start = row["enabled_at"] - timedelta(days=60)
    for occurrence in newmoon.occurrences(
        site["time_zone"], row["local_time"], start, 6
    ):
        remind_utc = occurrence.remind_local.astimezone(now.tzinfo)
        if not row["enabled_at"] <= remind_utc <= now or remind_utc <= floor:
            continue
        title, message = pushtext.reminder_push(
            occurrence.new_moon_local_date,
            site["label"],
            occurrence.weekend_saturday,
        )
        await DATABASE.execute(
            """
            insert into sky_engine.verdict_outbox
                (imager_id, kind, observing_date, topic, title, message)
            values ($1, 'reminder', $2, $3, $4, $5)
            """,
            imager_id,
            occurrence.new_moon_local_date,
            site["push_topic"],
            title,
            message,
        )
        await DATABASE.execute(
            "update sky_engine.reminders set last_queued_utc = $2 where imager_id = $1",
            imager_id,
            remind_utc,
        )


def start(loop_tasks: list[asyncio.Task[None]]) -> None:
    loop_tasks.append(asyncio.create_task(run_forever()))


async def stop(loop_tasks: list[asyncio.Task[None]]) -> None:
    for task in loop_tasks:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    loop_tasks.clear()
