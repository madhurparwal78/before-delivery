"""Live events. They travel through PostgreSQL, so every instance sees them."""

from __future__ import annotations

import asyncio

from .config import STREAM_POLL_SECONDS
from .db import DATABASE, DatabaseUnavailable, Transaction
from .jsonio import dump

SCORE = "score"
TEAM = "team"

_TRIM_EVERY_POLLS = 150


def publish(tx: Transaction, name: str, data: dict[str, object]) -> None:
    tx.execute(
        "INSERT INTO live_events (name, data) VALUES (%s, %s)",
        (name, dump(data).decode("utf-8")),
    )


def publish_score(
    tx: Transaction,
    team_id: int,
    team_name: str,
    scenario_slug: str,
    points: int,
    team_score: int,
) -> None:
    publish(
        tx,
        SCORE,
        {
            "team_id": team_id,
            "team_name": team_name,
            "scenario_slug": scenario_slug,
            "points": points,
            "team_score": team_score,
        },
    )


def publish_team(tx: Transaction, team_id: int) -> None:
    publish(tx, TEAM, {"team_id": team_id})


class Hub:
    """Fans published events out to the open streams on this instance."""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        self._last_id: int | None = None
        self._polls = 0

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    def _deliver(self, item: tuple[str, str] | None) -> None:
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(item)
            except asyncio.QueueFull:
                self.unsubscribe(queue)

    def close_all(self) -> None:
        self._deliver(None)
        self._subscribers.clear()

    async def run(self) -> None:
        while True:
            try:
                for name, data in await DATABASE.call(self._poll):
                    self._deliver((name, data))
            except DatabaseUnavailable:
                self._last_id = None
                self.close_all()
            except asyncio.CancelledError:
                raise
            await asyncio.sleep(STREAM_POLL_SECONDS)

    def _poll(self, tx: Transaction) -> list[tuple[str, str]]:
        if self._last_id is None:
            self._last_id = int(
                tx.value("SELECT COALESCE(max(id), 0) FROM live_events")
            )
            return []
        rows = tx.rows(
            "SELECT id, name, data FROM live_events WHERE id > %s ORDER BY id",
            (self._last_id,),
        )
        if rows:
            self._last_id = int(rows[-1][0])
        self._polls += 1
        if self._polls % _TRIM_EVERY_POLLS == 0:
            tx.execute(
                "DELETE FROM live_events WHERE created_at < now() - interval '10 minutes'"
            )
        return [(name, data) for _, name, data in rows]


HUB = Hub()
