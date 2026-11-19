"""Sending cancellation lines to the registry, and polling it for what each line became."""

from __future__ import annotations

import asyncio

from .allocation import Line
from .clock import format_hour
from .desk import Desk, User
from .errors import ApiError
from .jsontypes import JsonObject
from .providers import ProviderDown
from .repository import load_window, movement, record_ledger
from .timeutil import cancel_by
from .views import line_json, sorted_lines

ANALYST = ("analyst",)
POLL_CHUNK = 8


async def reject_line(desk: Desk, window_id: str, line_id: str, reason: str | None) -> None:
    """A rejected line turns unmatched: reverse it and send an in-review or cancelling window back. New lines for
    the freed hour come from the analyst's next allocation, never from this refusal."""
    async with desk.pool.acquire() as connection:
        async with connection.transaction():
            window = await load_window(connection, window_id, lock=True)
            line = (
                next(
                    (
                        standing
                        for standing in window.lines
                        if standing.id == line_id and standing.status in ("Unsubmitted", "Pending")
                    ),
                    None,
                )
                if window
                else None
            )
            if window is None or line is None:
                return
            await connection.execute(
                "UPDATE lines SET status = 'Rejected', reason = $3 WHERE window_id = $1 AND id = $2",
                window_id,
                line_id,
                reason,
            )
            await record_ledger(
                connection,
                [
                    movement(
                        "return",
                        "allocated",
                        "holdings",
                        line.wh,
                        window_id,
                        f"Return {line.lot_name}",
                        lot_id=line.lot_id,
                        bundle_id=line.bundle_id,
                        line_id=line.id,
                    )
                ],
                desk.now(),
            )
            changes: JsonObject = {}
            if window.state == "In review":
                await connection.execute("DELETE FROM samples WHERE window_id = $1", window_id)
                changes = {"state": "Reconciling", "sample_digest": None, "review_deadline": None}
            elif window.state == "Cancelling":
                changes = {"state": "Reconciling"}
            await desk.bump(connection, window_id, None, **changes)


async def confirm_line(desk: Desk, window_id: str, line_id: str) -> None:
    async with desk.pool.acquire() as connection:
        async with connection.transaction():
            state = await connection.fetchval("SELECT state FROM windows WHERE id = $1 FOR UPDATE", window_id)
            line = await connection.fetchrow(
                "UPDATE lines l SET status = 'Confirmed' FROM lots o WHERE l.window_id = $1 AND l.id = $2 "
                "AND l.status = 'Pending' AND o.window_id = l.window_id AND o.id = l.lot_id "
                "RETURNING l.lot_id, l.bundle_id, l.range_start, l.range_end, o.name AS lot_name",
                window_id,
                line_id,
            )
            if line is None:
                return
            await record_ledger(
                connection,
                [
                    movement(
                        "cancel",
                        "allocated",
                        "cancelled",
                        line["range_end"] - line["range_start"],
                        window_id,
                        f"Cancel {line['lot_name']}",
                        lot_id=line["lot_id"],
                        bundle_id=line["bundle_id"],
                        line_id=line_id,
                    )
                ],
                desk.now(),
            )
            open_lines = await connection.fetchval(
                "SELECT count(*) FROM lines WHERE window_id = $1 AND status IN ('Unsubmitted', 'Pending')", window_id
            )
            if state == "Cancelling" and open_lines == 0:
                await desk.bump(connection, window_id, None, state="Cancelled")


async def send_line(desk: Desk, window_id: str, line: Line, beneficiary: str) -> None:
    """One registry cancellation request under the line id: accepted lines read Pending, refused ones Rejected.
    An unreachable registry raises ProviderDown and leaves the line Unsubmitted."""
    document = {
        "client_line_id": line.id,
        "bundle_id": line.bundle_id,
        "range_start_wh": line.start,
        "range_end_wh": line.end,
        "hour_utc": format_hour(line.hour),
        "beneficiary": beneficiary,
    }
    outcome, reason = await desk.registry.submit(line.id, document)
    if outcome == "Pending":
        await desk.pool.execute(
            "UPDATE lines SET status = 'Pending' WHERE window_id = $1 AND id = $2 AND status = 'Unsubmitted'",
            window_id,
            line.id,
        )
    else:
        await reject_line(desk, window_id, line.id, reason)


async def submit_cancellations(desk: Desk, user: User, window_id: str) -> JsonObject:
    """One registry request per Unsubmitted line, in hour order; concurrent presses are serialised."""
    async with desk.locks[f"cancel:{window_id}"]:
        expired = False
        async with desk.pool.acquire() as connection:
            async with connection.transaction():
                window = await desk.locked_window(connection, user, window_id, roles=ANALYST, states=("Cancelling",))
                now = desk.now()
                queue = sorted(
                    (line for line in window.lines if line.status == "Unsubmitted"),
                    key=lambda line: (line.hour, line.bundle_id, line.start),
                )
                late = {lot.id for lot in window.lots if now >= cancel_by(lot.production_month)}
                expired = any(line.lot_id in late for line in queue)
                if expired:
                    await desk.settle_write(connection, window_id, None, state="Reconciling")
                beneficiary = window.columns["site_name"]
        if expired:
            raise ApiError("LOT_EXPIRED")
        submitted = 0
        for line in queue:
            still = await desk.pool.fetchval(
                "SELECT status FROM lines WHERE window_id = $1 AND id = $2", window_id, line.id
            )
            if still != "Unsubmitted":
                continue
            try:
                await send_line(desk, window_id, line, beneficiary)
            except ProviderDown as error:
                raise ApiError("REGISTRY_UNAVAILABLE") from error
            submitted += 1
    async with desk.pool.acquire() as connection:
        window = await load_window(connection, window_id)
    assert window is not None
    return {
        "submitted": submitted,
        "lines": [line_json(line) for line in sorted_lines(window.lines)],
        "window": await desk.window_view(window_id),
    }


async def list_lines(desk: Desk, user: User, window_id: str) -> JsonObject:
    window = await desk.window_for_read(user, window_id)
    return {"lines": [line_json(line) for line in sorted_lines(window.lines)]}


async def poll_confirmations(desk: Desk) -> None:
    """One sweep: ask the registry about every Pending line; stop at the first sign it is unreachable."""
    rows = await desk.pool.fetch(
        "SELECT window_id, id FROM lines WHERE status = 'Pending' ORDER BY window_id, hour_utc, id"
    )
    for start in range(0, len(rows), POLL_CHUNK):
        chunk = rows[start : start + POLL_CHUNK]
        answers = await asyncio.gather(
            *(desk.registry.confirmation(row["id"]) for row in chunk), return_exceptions=True
        )
        down = False
        for row, answer in zip(chunk, answers, strict=False):
            if isinstance(answer, ProviderDown):
                down = True
            elif isinstance(answer, BaseException):
                raise answer
            elif answer[0] == "CONFIRMED":
                await confirm_line(desk, row["window_id"], row["id"])
            elif answer[0] == "REJECTED":
                await reject_line(desk, row["window_id"], row["id"], answer[1])
        if down:
            return
