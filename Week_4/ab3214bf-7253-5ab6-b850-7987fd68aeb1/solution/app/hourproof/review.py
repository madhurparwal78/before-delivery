"""The verifier's side of a window: reading the sample, recording results, returning and completing."""

from __future__ import annotations


from .clock import format_hour, parse_hour
from .desk import MAX_NOTE, MAX_REASON, Desk, User, field_errors, text_ok
from .errors import ApiError, wrong_state
from .jsontypes import JsonObject
from .views import line_json, sorted_lines

VERIFIER = ("verifier",)
RESULTS = ("agree", "exception")


async def read_sample(desk: Desk, user: User, window_id: str) -> JsonObject:
    window = await desk.window_for_read(user, window_id)
    async with desk.pool.acquire() as connection:
        rows = await connection.fetch(
            "SELECT hour_utc, result, note FROM samples WHERE window_id = $1 ORDER BY position", window_id
        )
    if not rows:
        raise wrong_state(window.state)
    buckets = {bucket.start: bucket for bucket in window.grains(desk.now()).by_grain["hour"]}
    hours = []
    for row in rows:
        bucket = buckets[row["hour_utc"]]
        lines = [
            line_json(line) for line in sorted_lines([line for line in window.lines if line.hour == row["hour_utc"]])
        ]
        hours.append(
            {
                "hour_utc": format_hour(row["hour_utc"]),
                "consumed_wh": bucket.consumed,
                "matched_wh": bucket.matched,
                "quality": bucket.quality,
                "lines": lines,
                "result": row["result"],
                "note": row["note"],
            }
        )
    return {"allocation_digest": window.columns["sample_digest"], "hours": hours}


async def record_result(desk: Desk, user: User, window_id: str, hour_text: str, body: JsonObject) -> JsonObject:
    hour = parse_hour(hour_text)
    async with desk.pool.acquire() as connection:
        async with connection.transaction():
            window = await desk.locked_window(connection, user, window_id, roles=VERIFIER)
            sampled = hour is not None and await connection.fetchval(
                "SELECT count(*) FROM samples WHERE window_id = $1 AND hour_utc = $2", window_id, hour
            )
            if not sampled:
                raise ApiError("NOT_FOUND")
            if window.state != "In review":
                raise wrong_state(window.state)
            result, note = body.get("result"), body.get("note")
            exception = result == "exception"
            field_errors(result=result in RESULTS, **({"note": text_ok(note, MAX_NOTE)} if exception else {}))
            stored = note if exception else None
            await connection.execute(
                "UPDATE samples SET result = $3, note = $4 WHERE window_id = $1 AND hour_utc = $2",
                window_id,
                hour,
                result,
                stored,
            )
    return {"hour_utc": hour_text, "result": result, "note": stored}


async def return_window(desk: Desk, user: User, window_id: str, body: JsonObject) -> JsonObject:
    async with desk.pool.acquire() as connection:
        async with connection.transaction():
            await desk.locked_window(connection, user, window_id, roles=VERIFIER, states=("In review",))
            field_errors(reason=text_ok(body.get("reason"), MAX_REASON))
            await desk.bump(connection, window_id, user, state="Returned", returned_reason=body["reason"])
    return await desk.window_view(window_id)


async def complete_review(desk: Desk, user: User, window_id: str) -> JsonObject:
    async with desk.pool.acquire() as connection:
        async with connection.transaction():
            window = await desk.locked_window(connection, user, window_id, roles=VERIFIER, states=("In review",))
            waiting = await connection.fetchval(
                "SELECT count(*) FROM samples WHERE window_id = $1 AND result IS NULL", window_id
            )
            if waiting:
                raise ApiError("SAMPLE_INCOMPLETE", f"{waiting} sampled hours still need a result.")
            unfinished = any(line.status in ("Unsubmitted", "Pending") for line in window.lines)
            await desk.bump(connection, window_id, user, state="Cancelling" if unfinished else "Cancelled")
    return await desk.window_view(window_id)
