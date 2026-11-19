"""Live delivery: one server-sent-events stream per open workspace, fed from the ``live_events`` table.

Every instance polls the table, so an event published through any instance reaches the connections held
by every other instance. Access is decided per receiver at the moment of delivery. A dispatcher tick
borrows one pooled database session and gives it back; an idle stream holds no session at all.
"""

from __future__ import annotations

import json
import logging
import queue
import threading
import time
from collections.abc import Iterator
from typing import Any

from flask import Response, g

from . import communities, db, messages, perms
from .router import route

log = logging.getLogger("hub.live")

POLL_SECONDS = 0.25
WINDOW_SECONDS = 20
LOOKBACK_IDS = 2000
PURGE_EVERY = 60.0
KEEP_MINUTES = 10
MESSAGE_EVENTS = ("message.created", "message.updated", "message.deleted")


class Connection:
    """One open /api/live stream: the member and token it belongs to and its outgoing frames."""

    def __init__(self, member_id: int, token_id: int):
        self.member_id = member_id
        self.token_id = token_id
        self.frames: queue.Queue[str | None] = queue.Queue()
        self.closed = threading.Event()

    def send(self, type_: str, data: dict[str, Any]) -> None:
        if not self.closed.is_set():
            self.frames.put(json.dumps({"type": type_, "data": data}, ensure_ascii=False))

    def close(self) -> None:
        self.closed.set()
        self.frames.put(None)


_connections: set[Connection] = set()
_lock = threading.Lock()
_started = threading.Event()


def _snapshot() -> list[Connection]:
    with _lock:
        return list(_connections)


def _frames(conn: Connection) -> Iterator[str]:
    try:
        while not conn.closed.is_set():
            try:
                frame = conn.frames.get(timeout=1.0)
            except queue.Empty:
                yield ": ping\n\n"
                continue
            if frame is None:
                return
            yield f"data: {frame}\n\n"
    finally:
        conn.closed.set()
        with _lock:
            _connections.discard(conn)


@route("GET", "/api/live", session="required")
def stream() -> Response:
    conn = Connection(g.member["id"], g.token_id)
    with _lock:
        _connections.add(conn)
    try:
        with db.tx() as cur:
            conn.send("ready", {"communities": communities.joined_communities(cur, conn.member_id)})
    except BaseException:
        conn.close()
        with _lock:
            _connections.discard(conn)
        raise
    return Response(_frames(conn), content_type="text/event-stream", headers={"X-Accel-Buffering": "no"})


# --- dispatcher ----------------------------------------------------------------------------------------------------

class _Tick:
    """Memoised lookups for one dispatcher pass, so a burst of events costs a handful of queries."""

    def __init__(self, cur: db.Cursor):
        self.cur = cur
        self._channels: dict[int, dict[str, Any] | None] = {}
        self._access: dict[tuple[int, int], perms.Access] = {}
        self._messages: dict[tuple[int, int], dict[str, Any] | None] = {}
        self._joined: dict[int, list[dict[str, Any]]] = {}
        self._members: dict[int, set[int]] = {}

    def channel(self, channel_id: int) -> dict[str, Any] | None:
        if channel_id not in self._channels:
            self.cur.execute(
                "SELECT c.*, k.owner_id FROM channels c JOIN communities k ON k.id = c.community_id WHERE c.id = %s",
                (channel_id,))
            self._channels[channel_id] = self.cur.fetchone()
        return self._channels[channel_id]

    def may_view(self, member_id: int, channel: dict[str, Any]) -> bool:
        key = (member_id, channel["community_id"])
        if key not in self._access:
            self._access[key] = perms.load_access(self.cur, member_id, channel["community_id"], channel["owner_id"])
        access = self._access[key]
        return access.is_member and access.can(channel["id"], "view_channel")

    def message(self, message_id: int, viewer_id: int) -> dict[str, Any] | None:
        key = (message_id, viewer_id)
        if key not in self._messages:
            self._messages[key] = messages.load_messages(self.cur, [message_id], viewer_id).get(message_id)
        return self._messages[key]

    def joined(self, member_id: int) -> list[dict[str, Any]]:
        if member_id not in self._joined:
            self._joined[member_id] = communities.joined_communities(self.cur, member_id)
        return self._joined[member_id]

    def members_of(self, community_id: int) -> set[int]:
        if community_id not in self._members:
            self.cur.execute("SELECT member_id FROM memberships WHERE community_id = %s", (community_id,))
            self._members[community_id] = {row["member_id"] for row in self.cur.fetchall()}
        return self._members[community_id]


def _deliver(tick: _Tick, event: dict[str, Any], conns: list[Connection]) -> None:
    kind, data = event["type"], event["data"]
    if kind in MESSAGE_EVENTS:
        channel = tick.channel(event["channel_id"]) if event["channel_id"] else None
        if channel is None:
            return
        for conn in conns:
            if not tick.may_view(conn.member_id, channel):
                continue
            if kind == "message.deleted":
                conn.send(kind, {"id": data["message_id"], "channel_id": channel["id"]})
            elif (shaped := tick.message(data["message_id"], conn.member_id)) is not None:
                conn.send(kind, {"message": shaped})
    elif kind == "access.changed":
        for conn in conns:
            if event["member_id"] == conn.member_id or (
                    event["member_id"] is None and conn.member_id in tick.members_of(event["community_id"])):
                conn.send(kind, {"communities": tick.joined(conn.member_id)})
                conn.send("notifications.changed", {})
    elif kind == "members.changed":
        for conn in conns:
            if conn.member_id in tick.members_of(event["community_id"]):
                conn.send(kind, {"community_id": event["community_id"]})
    elif kind == "notifications.changed":
        for conn in conns:
            if conn.member_id == event["member_id"]:
                conn.send(kind, {})
    elif kind == "timeout.changed":
        for conn in conns:
            if conn.member_id == event["member_id"] or (
                    event["member_id"] is None and conn.member_id in tick.members_of(event["community_id"])):
                conn.send(kind, {"community_id": event["community_id"]})


class _Dispatcher:
    def __init__(self) -> None:
        self.high = 0
        self.seen: dict[int, float] = {}
        self.purged = time.monotonic()

    def _fetch(self) -> list[dict[str, Any]]:
        rows = db.all_rows(
            "SELECT id, type, community_id, channel_id, member_id, data FROM live_events "
            "WHERE id > %s AND created_at > clock_timestamp() - make_interval(secs => %s) ORDER BY id",
            (max(self.high - LOOKBACK_IDS, 0), WINDOW_SECONDS))
        now = time.monotonic()
        fresh = [row for row in rows if row["id"] not in self.seen]
        for row in rows:
            self.seen[row["id"]] = now
            self.high = max(self.high, row["id"])
        self.seen = {i: t for i, t in self.seen.items() if now - t < 2 * WINDOW_SECONDS}
        return fresh

    def prime(self) -> None:
        self._fetch()

    def _close_revoked(self, conns: list[Connection]) -> list[Connection]:
        if not conns:
            return conns
        rows = db.all_rows("SELECT id FROM tokens WHERE id = ANY(%s) AND revoked_at IS NOT NULL",
                           ([c.token_id for c in conns],))
        revoked = {row["id"] for row in rows}
        for conn in conns:
            if conn.token_id in revoked:
                conn.close()
        return [c for c in conns if c.token_id not in revoked]

    def tick(self) -> None:
        fresh = self._fetch()
        conns = self._close_revoked(_snapshot())
        if conns and fresh:
            with db.tx() as cur:
                tick = _Tick(cur)
                for event in fresh:
                    _deliver(tick, event, conns)
        if time.monotonic() - self.purged > PURGE_EVERY:
            self.purged = time.monotonic()
            db.run("DELETE FROM live_events WHERE created_at < clock_timestamp() - make_interval(mins => %s)",
                   (KEEP_MINUTES,))


def _loop() -> None:
    dispatcher = _Dispatcher()
    while True:
        try:
            dispatcher.prime()
            break
        except Exception:  # noqa: BLE001 - keep trying until the database answers
            time.sleep(1)
    while True:
        try:
            dispatcher.tick()
        except Exception:  # noqa: BLE001 - one failed pass must not stop live delivery
            log.exception("live dispatch failed")
        time.sleep(POLL_SECONDS)


def start() -> None:
    if not _started.is_set():
        _started.set()
        threading.Thread(target=_loop, name="live-dispatcher", daemon=True).start()
