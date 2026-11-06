"""Background loops: dependency status, mail delivery, sweeps and seeding."""

from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone

import psycopg2

from . import db, ledger, mail, seed, storage
from .config import CONFIG


def _loop(stop: threading.Event, every: float, work) -> None:
    while not stop.is_set():
        try:
            work()
        except (db.DatabaseUnavailable, psycopg2.Error, storage.StorageDown, OSError):
            pass
        stop.wait(every)


def status_work() -> None:
    storage.check_storage()
    mail.check_mail()


def sweep_work() -> None:
    now = datetime.now(timezone.utc)
    with db.tx() as cur:
        cur.execute(
            """
            SELECT id, user_id, created_at, last_activity_at FROM sessions
            WHERE state = 'active' AND (created_at < %s OR last_activity_at < %s)
            LIMIT 200
            """,
            (
                now - timedelta(seconds=CONFIG.session_ttl_seconds),
                now - timedelta(seconds=CONFIG.session_idle_seconds),
            ),
        )
        for row in cur.fetchall():
            reason = (
                "expired"
                if row["created_at"]
                < now - timedelta(seconds=CONFIG.session_ttl_seconds)
                else "idle"
            )
            cur.execute(
                "UPDATE sessions SET state = 'closed', closed_reason = %s WHERE id = %s",
                (reason, row["id"]),
            )
            ledger.append(
                cur,
                action="session.closed",
                actor_id=row["user_id"],
                session_id=row["id"],
                target=row["id"],
                detail={"reason": reason},
            )
    with db.tx() as cur:
        cur.execute(
            """
            SELECT * FROM grants
            WHERE state = 'active' AND expires_at IS NOT NULL AND expires_at <= now()
            LIMIT 200
            """
        )
        for row in cur.fetchall():
            ended = "lapsed" if row["kind"] == "grant" else "ended"
            cur.execute("UPDATE grants SET state = %s WHERE id = %s", (ended, row["id"]))
            if row["kind"] == "grant":
                ledger.append(
                    cur,
                    action="grant.lapsed",
                    actor_id="system",
                    session_id=None,
                    target=row["id"],
                    detail={
                        "compartment_id": row["compartment_id"],
                        "user_id": row["user_id"],
                    },
                )
            else:
                ledger.append(
                    cur,
                    action="break_glass.ended",
                    actor_id="system",
                    session_id=None,
                    target=row["id"],
                    detail={},
                )


def start(stop: threading.Event) -> list[threading.Thread]:
    threads = [
        threading.Thread(target=_loop, args=(stop, 5.0, status_work), daemon=True),
        threading.Thread(target=_loop, args=(stop, 5.0, sweep_work), daemon=True),
        threading.Thread(
            target=_loop, args=(stop, 5.0, mail.deliver_pending), daemon=True
        ),
        threading.Thread(target=_seed_loop, args=(stop,), daemon=True),
    ]
    for thread in threads:
        thread.start()
    return threads


def _seed_loop(stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            seed.seed_people()
            if seed.seed_records():
                return
        except (
            db.DatabaseUnavailable,
            psycopg2.Error,
            storage.StorageDown,
            OSError,
        ):
            pass
        stop.wait(3.0)
