"""Background work: polling the registry and finishing held seals."""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor

from . import clock, db, engine, sealing, store
from .db import Cursor
from .domain import states
from .domain.model import PENDING, REJECTED, CONFIRMED
from .services import registry
from .services.http import ProviderUnavailable

POLL_SECONDS = 2
POLL_THREADS = 8
SEAL_SECONDS = 5


def start() -> None:
    threading.Thread(target=_poll_loop, name="registry-poll", daemon=True).start()
    threading.Thread(target=_seal_loop, name="seal-retry", daemon=True).start()


def _poll_loop() -> None:
    while True:
        time.sleep(POLL_SECONDS)
        try:
            poll_pending_lines()
        except Exception:
            continue


def _seal_loop() -> None:
    while True:
        time.sleep(SEAL_SECONDS)
        try:
            finish_held_seals()
        except Exception:
            continue


def poll_pending_lines() -> None:
    """Ask the registry about every Pending line, in every window state."""
    with db.tx() as cursor:
        rows = cursor.all(
            "SELECT line_id, window_id FROM lines WHERE status = %s"
            " ORDER BY window_id, hour_utc",
            (PENDING,),
        )
    if not rows:
        return
    with ThreadPoolExecutor(max_workers=POLL_THREADS) as pool:
        for row in rows:
            pool.submit(_poll_one, row["window_id"], row["line_id"])


def _poll_one(window_id: str, line_id: str) -> None:
    try:
        answer = registry.confirmation(line_id)
    except ProviderUnavailable:
        with db.tx() as cursor:
            cursor.execute(
                "UPDATE windows SET registry_reachable = false WHERE id = %s",
                (window_id,),
            )
        return
    with db.tx() as cursor:
        state = cursor.value(
            "SELECT state FROM windows WHERE id = %s FOR UPDATE", (window_id,)
        )
        if state is None:
            return
        cursor.execute(
            "UPDATE windows SET registry_reachable = true WHERE id = %s", (window_id,)
        )
        line = cursor.one(
            "SELECT * FROM lines WHERE line_id = %s AND status = %s",
            (line_id, PENDING),
        )
        if line is None:
            return
        if answer.status == registry.CONFIRMED:
            _confirm(cursor, window_id, state, line)
        elif answer.status == registry.REJECTED:
            _reject(cursor, window_id, line, answer.reason)


def _confirm(cursor: Cursor, window_id: str, state: str, line: dict) -> None:
    store.set_line_status(
        cursor, line["line_id"], CONFIRMED, confirmed_at=clock.now()
    )
    store.movement(
        cursor,
        "cancel",
        "allocated",
        "cancelled",
        int(line["wh"]),
        window_id,
        line["lot_id"],
        line["bundle_id"],
        line["line_id"],
    )
    outstanding = cursor.value(
        "SELECT COUNT(*) FROM lines WHERE window_id = %s AND status <> %s AND status <> %s",
        (window_id, CONFIRMED, REJECTED),
    )
    if state == states.CANCELLING and int(outstanding) == 0:
        window = store.load_window(cursor, window_id)
        assert window is not None
        store.set_state(cursor, window, states.CANCELLED)
        store.bump_revision(cursor, window, None)


def _reject(cursor: Cursor, window_id: str, line: dict, reason: str | None) -> None:
    store.set_line_status(cursor, line["line_id"], REJECTED, reason=reason)
    store.movement(
        cursor,
        "return",
        "allocated",
        "holdings",
        int(line["wh"]),
        window_id,
        line["lot_id"],
        line["bundle_id"],
        line["line_id"],
    )
    window = store.load_window(cursor, window_id)
    assert window is not None
    if states.clears_sample_on_rejection(window.state):
        store.clear_sample(cursor, window.id)
    store.set_state(cursor, window, states.after_rejected_line(window.state))
    store.bump_revision(cursor, window, None)
    engine.recompute(cursor, window)


def finish_held_seals() -> None:
    with db.tx() as cursor:
        rows = cursor.all(
            "SELECT id FROM windows WHERE state = %s ORDER BY id", (states.SIGNED,)
        )
    for row in rows:
        with db.tx() as cursor:
            window = store.load_window(cursor, row["id"], lock=True)
            if window is None or window.state != states.SIGNED:
                continue
            sealing.advance_seal(cursor, window)
