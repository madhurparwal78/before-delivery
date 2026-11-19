"""Live delivery: every event travels through the database, so any instance serves it.

Access is checked for each receiver at the moment of delivery, never remembered from
the handshake.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any

import asyncpg

from .db import DB
from .permissions import channel_permissions, load_member_state
from .serialize import message_json

TICK_SECONDS = 0.4
QUEUE_LIMIT = 500
RETENTION_MINUTES = 10


async def publish(
    conn: asyncpg.Connection,
    event_type: str,
    payload: dict[str, Any],
    *,
    community_id: int | None = None,
    channel_id: int | None = None,
    recipient_id: int | None = None,
) -> None:
    """Record one live event in the same transaction as the change it reports."""
    await conn.execute(
        """
        INSERT INTO live_events (type, community_id, channel_id, recipient_id, payload)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        """,
        event_type,
        community_id,
        channel_id,
        recipient_id,
        json.dumps(payload, ensure_ascii=False),
    )


@dataclass(eq=False)
class Subscriber:
    """One open live connection on this instance."""

    member_id: int
    token_digest: str
    queue: asyncio.Queue[str | None] = field(default_factory=lambda: asyncio.Queue(QUEUE_LIMIT))

    def offer(self, event_type: str, data: dict[str, Any]) -> None:
        if self.queue.full():
            return
        self.queue.put_nowait(json.dumps({"type": event_type, "data": data}, ensure_ascii=False))

    def end(self) -> None:
        if not self.queue.full():
            self.queue.put_nowait(None)


class Dispatcher:
    """Reads new events for this instance and hands them to its own connections."""

    def __init__(self) -> None:
        self._subscribers: set[Subscriber] = set()
        self._last_id = 0
        self._started = False

    def add(self, subscriber: Subscriber) -> None:
        self._subscribers.add(subscriber)

    def remove(self, subscriber: Subscriber) -> None:
        self._subscribers.discard(subscriber)

    async def run(self) -> None:
        ticks = 0
        while True:
            await asyncio.sleep(TICK_SECONDS)
            ticks += 1
            try:
                await self._tick(sweep=ticks % 150 == 0)
            except (asyncpg.PostgresError, OSError, ConnectionError, asyncio.TimeoutError):
                continue

    async def _tick(self, *, sweep: bool = False) -> None:
        if not DB.ready:
            return
        async with DB.connection() as conn:
            if not self._started:
                self._last_id = int(await conn.fetchval(
                    "SELECT COALESCE(max(id), 0) FROM live_events"
                ))
                self._started = True
            if sweep:
                await conn.execute(
                    """
                    DELETE FROM live_events
                    WHERE created_at < now() - make_interval(mins => $1)
                    """,
                    RETENTION_MINUTES,
                )
            if not self._subscribers:
                self._last_id = int(await conn.fetchval(
                    "SELECT COALESCE(max(id), 0) FROM live_events"
                ))
                return
            await self._close_revoked(conn)
            rows = await conn.fetch(
                """
                SELECT id, type, community_id, channel_id, recipient_id, payload
                FROM live_events WHERE id > $1 ORDER BY id LIMIT 500
                """,
                self._last_id,
            )
            if not rows:
                return
            self._last_id = int(rows[-1]["id"])
            viewers: dict[tuple[int, int], bool] = {}
            members: dict[tuple[int, int], bool] = {}
            for row in rows:
                await self._fan_out(conn, row, viewers, members)

    async def _close_revoked(self, conn: asyncpg.Connection) -> None:
        digests = {subscriber.token_digest for subscriber in self._subscribers}
        if not digests:
            return
        rows = await conn.fetch(
            """
            SELECT token_digest FROM sessions
            WHERE token_digest = ANY($1::text[]) AND revoked_at IS NULL
            """,
            list(digests),
        )
        alive = {row["token_digest"] for row in rows}
        for subscriber in list(self._subscribers):
            if subscriber.token_digest not in alive:
                subscriber.end()
                self.remove(subscriber)

    async def _fan_out(
        self,
        conn: asyncpg.Connection,
        row: asyncpg.Record,
        viewers: dict[tuple[int, int], bool],
        members: dict[tuple[int, int], bool],
    ) -> None:
        payload = json.loads(row["payload"])
        for subscriber in list(self._subscribers):
            if row["recipient_id"] is not None:
                if subscriber.member_id != row["recipient_id"]:
                    continue
            elif row["channel_id"] is not None:
                if not await self._may_view(
                    conn, subscriber.member_id, row["community_id"], row["channel_id"], viewers
                ):
                    continue
            elif row["community_id"] is not None:
                if not await self._is_member(
                    conn, subscriber.member_id, row["community_id"], members
                ):
                    continue
            data = await self._for_receiver(conn, row["type"], payload, subscriber.member_id)
            subscriber.offer(row["type"], data)

    async def _may_view(
        self,
        conn: asyncpg.Connection,
        member_id: int,
        community_id: int,
        channel_id: int,
        cache: dict[tuple[int, int], bool],
    ) -> bool:
        key = (member_id, channel_id)
        if key not in cache:
            state = await load_member_state(conn, community_id, member_id)
            if state is None:
                cache[key] = False
            else:
                permissions = await channel_permissions(conn, channel_id, state)
                cache[key] = "view_channel" in permissions
        return cache[key]

    async def _is_member(
        self,
        conn: asyncpg.Connection,
        member_id: int,
        community_id: int,
        cache: dict[tuple[int, int], bool],
    ) -> bool:
        key = (member_id, community_id)
        if key not in cache:
            cache[key] = bool(
                await conn.fetchval(
                    "SELECT 1 FROM memberships WHERE member_id = $1 AND community_id = $2",
                    member_id,
                    community_id,
                )
            )
        return cache[key]

    async def _for_receiver(
        self,
        conn: asyncpg.Connection,
        event_type: str,
        payload: dict[str, Any],
        member_id: int,
    ) -> dict[str, Any]:
        """Each receiver gets their own view of an event, never another caller's."""
        if event_type in {"message_create", "message_update"}:
            message = await message_json(conn, payload["message_id"], member_id)
            if message is None:
                return payload
            return {"message": message}
        if event_type == "reaction_update":
            message = await message_json(conn, payload["message_id"], member_id)
            if message is None:
                return payload
            return {
                "message_id": message["id"],
                "channel_id": message["channel_id"],
                "reactions": message["reactions"],
            }
        return payload


DISPATCHER = Dispatcher()
