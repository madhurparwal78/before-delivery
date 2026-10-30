"""Background loops: outbox delivery, held uploads, service health, escalation and the fit-note sweep.

Every instance of the app runs them against the shared database; rows are claimed with
FOR UPDATE SKIP LOCKED, so each email is sent once and any instance that can reach a service
completes the held work.
"""

import asyncio
import logging
from dataclasses import dataclass

import asyncpg

from . import db, leave, mail, sickness, storage
from .config import settings
from .projections import LEAVE_SQL


@dataclass(slots=True)
class Health:
    mail: str = "down"
    storage: str = "down"


health = Health()
_tasks: list[asyncio.Task] = []


log = logging.getLogger("tallow_cover.workers")
HELD = (("fit_notes", "content_type"), ("exports", "'text/csv'"))


async def _every(seconds: float, job) -> None:
    while True:
        try:
            await job()
        except (OSError, asyncpg.PostgresError, asyncpg.InterfaceError) as error:
            log.warning("%s failed, retrying in %ss: %s", job.__name__, seconds, error)
        await asyncio.sleep(seconds)


async def probe_services() -> None:
    health.mail = "up" if await mail.reachable() else "down"
    health.storage = "up" if await storage.reachable() else "down"


async def deliver_outbox() -> None:
    while True:
        async with db.pool.acquire() as conn, conn.transaction():
            row = await conn.fetchrow("SELECT * FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 1"
                                      " FOR UPDATE SKIP LOCKED")
            if row is None or not await mail.deliver(row):
                return
            await conn.execute("UPDATE outbox SET sent_at = now() WHERE id = $1", row["id"])


async def store_held() -> None:
    for table, content_type in HELD:
        while True:
            async with db.pool.acquire() as conn, conn.transaction():
                row = await conn.fetchrow(f"SELECT id, storage_key, held, {content_type} AS content_type"
                                          f" FROM {table} WHERE held IS NOT NULL LIMIT 1 FOR UPDATE SKIP LOCKED")
                if row is None or not await storage.put(row["storage_key"], row["held"], row["content_type"]):
                    break
                await conn.execute(f"UPDATE {table} SET held = NULL WHERE id = $1", row["id"])


async def escalate() -> None:
    """Requests still submitted ESCALATION_AFTER_SECONDS after submission move to escalated, emailing once."""
    move = leave.TRANSITIONS["escalate"]
    async with db.pool.acquire() as conn, conn.transaction():
        ids = [r["id"] for r in await conn.fetch(
            "UPDATE leave_requests SET status = $1 WHERE status = ANY($2::text[])"
            " AND submitted_at <= now() - make_interval(secs => $3) RETURNING id",
            move.target, list(move.sources), settings.escalation_after_seconds)]
        for request in await conn.fetch(LEAVE_SQL + " WHERE lr.id = ANY($1::text[])", ids):
            await mail.escalation(conn, request)


async def sweep_fit_notes() -> None:
    async with db.pool.acquire() as conn:
        await sickness.require_fit_notes(conn)


def start() -> None:
    for seconds, job in ((3, probe_services), (1, deliver_outbox), (3, store_held), (5, escalate),
                         (30, sweep_fit_notes)):
        _tasks.append(asyncio.create_task(_every(seconds, job)))


async def stop() -> None:
    for task in _tasks:
        task.cancel()
    await asyncio.gather(*_tasks, return_exceptions=True)
