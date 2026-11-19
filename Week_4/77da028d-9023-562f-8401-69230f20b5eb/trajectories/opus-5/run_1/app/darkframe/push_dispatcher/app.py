"""The push dispatcher: drains the sky engine's outbox and publishes to ntfy."""

from __future__ import annotations

import asyncio
from base64 import b64encode
from typing import Any

import asyncpg

from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from .. import ids
from ..config import CONFIG, PUSH_DISPATCHER
from ..db import Database
from ..domain import pushtext, timeutil
from ..httpclient import HttpError, request as http_request
from ..service import build_service, imager_of
from ..webkit import json_response
from .schema import SCHEMA_SQL

DATABASE = Database(PUSH_DISPATCHER, SCHEMA_SQL)
DRAIN_SECONDS = 1.0
QUEUED = "queued"
UNSENT = "unsent"
SENT = "sent"
LOOP_TASKS: list[asyncio.Task[None]] = []


async def read_pushes(request: Request) -> Response:
    rows = await DATABASE.fetch(
        "select * from push_dispatcher.pushes where imager_id = $1 "
        "order by created_at desc, outbox_id desc",
        imager_of(request),
    )
    return json_response(
        {
            "pushes": [
                {
                    "id": row["id"],
                    "kind": row["kind"],
                    "date": row["observing_date"].isoformat()
                    if row["observing_date"]
                    else None,
                    "title": row["title"],
                    "message": row["message"],
                    "status": row["status"],
                    "attempts": row["attempts"],
                    "last_attempt_at": timeutil.iso_utc(row["last_attempt_at"])
                    if row["last_attempt_at"]
                    else None,
                    "sent_at": timeutil.iso_utc(row["sent_at"])
                    if row["sent_at"]
                    else None,
                }
                for row in rows
            ]
        }
    )


async def _create_pushes() -> None:
    """Takes each outbox row once: the one allowed cross-schema read."""
    async with DATABASE.transaction() as connection:
        rows = await connection.fetch(
            """
            update sky_engine.verdict_outbox set claimed_at = now()
            where id in (
                select id from sky_engine.verdict_outbox
                where claimed_at is null order by id limit 50 for update skip locked
            )
            returning id, imager_id, kind, observing_date, topic, title, message
            """
        )
        for row in rows:
            await connection.execute(
                """
                insert into push_dispatcher.pushes (id, imager_id, outbox_id, kind,
                    observing_date, topic, title, message, status)
                values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                on conflict (outbox_id) do nothing
                """,
                ids.record_id("psh"),
                row["imager_id"],
                row["id"],
                row["kind"],
                row["observing_date"],
                row["topic"],
                row["title"],
                row["message"],
                QUEUED,
            )


async def _publish(row: Any) -> None:
    credentials = b64encode(
        f"{CONFIG.ntfy_username}:{CONFIG.ntfy_password}".encode()
    ).decode()
    await DATABASE.execute(
        "update push_dispatcher.pushes set attempts = attempts + 1, "
        "last_attempt_at = $2 where id = $1",
        row["id"],
        timeutil.now_utc(),
    )
    try:
        response = await http_request(
            "POST",
            f"{CONFIG.ntfy_url.rstrip('/')}/{row['topic']}",
            headers={
                "Authorization": f"Basic {credentials}",
                "Title": row["title"],
                "Tags": pushtext.NTFY_TAG,
                "Content-Type": "text/plain",
            },
            body=row["message"].encode(),
            timeout=5.0,
        )
    except HttpError:
        await _mark_unsent(row["id"])
        return
    if 200 <= response.status < 300:
        await DATABASE.execute(
            "update push_dispatcher.pushes set status = $2, sent_at = $3 "
            "where id = $1",
            row["id"],
            SENT,
            timeutil.now_utc(),
        )
    else:
        await _mark_unsent(row["id"])


async def _mark_unsent(push_id: str) -> None:
    await DATABASE.execute(
        "update push_dispatcher.pushes set status = $2 where id = $1",
        push_id,
        UNSENT,
    )


async def _deliver_due() -> None:
    rows = await DATABASE.fetch(
        """
        select * from push_dispatcher.pushes
        where status <> $1
          and (last_attempt_at is null
               or last_attempt_at <= now() - ($2 || ' seconds')::interval)
        order by created_at
        limit 20
        """,
        SENT,
        str(CONFIG.push_retry_seconds),
    )
    for row in rows:
        await _publish(row)


async def run_forever() -> None:
    while True:
        try:
            await _create_pushes()
            await _deliver_due()
        except (OSError, HttpError, asyncpg.PostgresError):
            pass
        await asyncio.sleep(DRAIN_SECONDS)


async def _start_worker() -> None:
    LOOP_TASKS.append(asyncio.create_task(run_forever()))


ROUTES = [Route("/internal/pushes", read_pushes, methods=["GET"])]

app = build_service("push-dispatcher", ROUTES, on_startup=[_start_worker])
