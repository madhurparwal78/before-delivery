"""Background workers: registry confirmation polling, held seal retries and
the review deadline. Each recovers with no restart.
"""
from __future__ import annotations

import asyncio

from . import clock
from .domain.states import CANCELLING, IN_REVIEW, RECONCILING
from .providers.services import REGISTRY, ProviderUnavailable

POLL_SECONDS = 2.0
SEAL_RETRY_SECONDS = 5.0


async def _poll_window(conn, window_id: str) -> None:
    pending = await conn.fetch(
        "SELECT * FROM lines WHERE window_id = $1 AND status = 'Pending'", window_id
    )
    for line in pending:
        try:
            answer = await REGISTRY.confirm(line["line_id"])
        except ProviderUnavailable:
            await conn.execute(
                "UPDATE windows SET registry_reachable = false WHERE id = $1", window_id
            )
            return
        await conn.execute(
            "UPDATE windows SET registry_reachable = true WHERE id = $1", window_id
        )
        if answer["status"] == "CONFIRMED":
            async with conn.transaction():
                await conn.execute(
                    "UPDATE lines SET status = 'Confirmed' WHERE line_id = $1",
                    line["line_id"],
                )
                movement_id = f"cxl-{line['line_id']}"
                exists = await conn.fetchval(
                    "SELECT 1 FROM ledger_entries WHERE movement_id = $1", movement_id
                )
                if exists is None:
                    now = clock.now()
                    for account, amount in (("allocated", -line["wh"]), ("cancelled", line["wh"])):
                        await conn.execute(
                            "INSERT INTO ledger_entries (movement_id, kind, account, wh,"
                            " window_id, lot_id, bundle_id, line_id, label, at)"
                            " VALUES ($1,'cancel',$2,$3,$4,$5,$6,$7,'Cancel',$8)",
                            movement_id, account, amount, window_id, line["lot_id"],
                            line["bundle_id"], line["line_id"], now,
                        )
        elif answer["status"] == "REJECTED":
            async with conn.transaction():
                await conn.execute(
                    "UPDATE lines SET status = 'Rejected', reason = $1 WHERE line_id = $2",
                    answer.get("reason"), line["line_id"],
                )
                movement_id = f"ret-{line['line_id']}"
                exists = await conn.fetchval(
                    "SELECT 1 FROM ledger_entries WHERE movement_id = $1", movement_id
                )
                if exists is None:
                    now = clock.now()
                    for account, amount in (("allocated", -line["wh"]), ("holdings", line["wh"])):
                        await conn.execute(
                            "INSERT INTO ledger_entries (movement_id, kind, account, wh,"
                            " window_id, lot_id, bundle_id, line_id, label, at)"
                            " VALUES ($1,'return',$2,$3,$4,$5,$6,$7,'Return',$8)",
                            movement_id, account, amount, window_id, line["lot_id"],
                            line["bundle_id"], line["line_id"], now,
                        )
                state = await conn.fetchval(
                    "SELECT state FROM windows WHERE id = $1", window_id
                )
                if state in (CANCELLING, IN_REVIEW):
                    await conn.execute(
                        "UPDATE windows SET state = $1 WHERE id = $2",
                        RECONCILING, window_id,
                    )
                    await conn.execute(
                        "DELETE FROM sample_hours WHERE window_id = $1", window_id
                    )
                    await conn.execute(
                        "UPDATE windows SET revision = revision + 1 WHERE id = $1",
                        window_id,
                    )
                elif state == RECONCILING:
                    await conn.execute(
                        "UPDATE windows SET revision = revision + 1 WHERE id = $1",
                        window_id,
                    )
    state = await conn.fetchval("SELECT state FROM windows WHERE id = $1", window_id)
    if state == CANCELLING:
        unconfirmed = await conn.fetchval(
            "SELECT COUNT(*) FROM lines WHERE window_id = $1 AND status != 'Confirmed'",
            window_id,
        )
        if unconfirmed == 0:
            confirmed = await conn.fetchval(
                "SELECT COUNT(*) FROM lines WHERE window_id = $1 AND status = 'Confirmed'",
                window_id,
            )
            if confirmed > 0:
                await conn.execute(
                    "UPDATE windows SET state = 'Cancelled' WHERE id = $1", window_id
                )


async def poll_confirmations() -> None:
    from .db import pool
    while True:
        try:
            async with pool().acquire() as conn:
                window_ids = [r["window_id"] for r in await conn.fetch(
                    "SELECT DISTINCT window_id FROM lines WHERE status = 'Pending'"
                )]
                for window_id in window_ids:
                    await _poll_window(conn, window_id)
        except Exception:
            pass
        await asyncio.sleep(POLL_SECONDS)


async def retry_seals() -> None:
    from .db import pool
    from .api.app import Ctx
    from .api.verifier import _try_seal
    while True:
        try:
            async with pool().acquire() as conn:
                held = await conn.fetch(
                    "SELECT * FROM windows WHERE seal_status IN ('held_press','held_store')"
                )
                for window in held:
                    code = window["statement_code"]
                    if not code:
                        continue
                    ctx = Ctx(None, {}, conn, "POST")
                    await _try_seal(ctx, window["id"], code)
        except Exception:
            pass
        await asyncio.sleep(SEAL_RETRY_SECONDS)


def start_workers() -> list[asyncio.Task]:
    return [
        asyncio.create_task(poll_confirmations()),
        asyncio.create_task(retry_seals()),
    ]
