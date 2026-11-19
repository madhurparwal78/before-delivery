"""Cross-instance live fan-out through the database, delivered over SSE (DP-90)."""
from __future__ import annotations

import asyncio
import json
import threading
import time
from typing import Optional

from .config import Config
from .db import Database
from .rules import iso_seconds


class LiveHub:
    """Delivers events from the shared event table to SSE connections on any instance."""

    def __init__(self, config: Config, db: Database) -> None:
        self.config = config
        self.db = db
        self._subscribers: dict[int, list] = {}
        self._lock = threading.Lock()
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._started = False

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run_poller, daemon=True, name="hub-live")
        self._thread.start()
        self._started = True

    def _run_poller(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    def subscribe(self, member_id: int, token_hash: str, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop) -> None:
        with self._lock:
            self._subscribers.setdefault((member_id, token_hash), []).append((queue, loop))

    def unsubscribe(self, member_id: int, token_hash: str, queue: asyncio.Queue) -> None:
        with self._lock:
            key = (member_id, token_hash)
            lst = self._subscribers.get(key)
            if lst:
                self._subscribers[key] = [entry for entry in lst if entry[0] is not queue]
                if not self._subscribers[key]:
                    del self._subscribers[key]

    def publish_local(self, member_id: int, event: dict) -> None:
        """Queue an event for local subscribers; the poller delivers cross-instance rows."""
        with self._lock:
            for (mid, thash), entries in list(self._subscribers.items()):
                if mid == member_id:
                    for queue, loop in entries:
                        loop.call_soon_threadsafe(queue.put_nowait, event)

    def deliver_row(self, row: dict) -> None:
        """A row from the shared events table; project person objects as public users."""
        with self._lock:
            for (mid, thash), entries in list(self._subscribers.items()):
                if mid == row.get("recipient_id"):
                    event = json.loads(row["payload"])
                    for queue, loop in entries:
                        loop.call_soon_threadsafe(queue.put_nowait, event)

    def poll_pending_rows(self, limit: int = 200) -> list:
        """Claim pending event rows for local subscribers, oldest first."""
        with self._lock:
            known = set(self._subscribers.keys())
        if not known:
            return []
        try:
            with self.db.session() as conn:
                rows = conn.execute(
                    """SELECT id, recipient_id, payload FROM live_events
                       WHERE delivered = FALSE ORDER BY id ASC LIMIT %s""",
                    (limit,),
                ).fetchall()
                if not rows:
                    return []
                conn.execute(
                    "UPDATE live_events SET delivered = TRUE WHERE id = ANY(%s)",
                    ([r["id"] for r in rows],),
                )
            return rows
        except Exception:
            return []

    def drop_local(self, member_id: int, token_hash: str) -> None:
        """Close every local connection opened with a revoked token (ended sessions)."""
        import asyncio as _aio
        with self._lock:
            key = (member_id, token_hash)
            entries = self._subscribers.get(key)
            if entries:
                for queue, loop in entries:
                    loop.call_soon_threadsafe(queue.put_nowait, {"type": "__session_ended__", "data": {}})

    def revoked_tokens(self) -> set:
        """Tokens revoked since the last poll, for cross-instance session endings."""
        try:
            with self.db.session() as conn:
                rows = conn.execute(
                    """SELECT t.token_hash, t.member_id FROM tokens t
                       WHERE t.revoked_at IS NOT NULL AND t.revoked_at > now() - INTERVAL '15 seconds'"""
                ).fetchall()
            return {(r["token_hash"], r["member_id"]) for r in rows}
        except Exception:
            return set()

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run_poller, daemon=True, name="hub-live")
        self._thread.start()
        self._started = True

    def _run_poller(self) -> None:
        """Poll shared event rows and revoked tokens so every instance agrees."""
        seen_tokens: set = set()
        while True:
            try:
                if not self.db.ready:
                    time.sleep(2)
                    continue
                rows = self.poll_pending_rows()
                for row in rows:
                    self.deliver_row(row)
                for token_hash, member_id in self.revoked_tokens():
                    if (member_id, token_hash) not in seen_tokens:
                        seen_tokens.add((member_id, token_hash))
                        self.drop_local(member_id, token_hash)
                time.sleep(0.25)
            except Exception:
                time.sleep(1)

    def stop(self) -> None:
        pass
