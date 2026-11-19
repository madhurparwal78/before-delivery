"""Verdict outbox writes: the sky engine queues one row per verdict change (DP-51)."""
from __future__ import annotations

import secrets
from typing import Optional

from darkframe.services.sky_engine.api import _site, _site_object, build_plan, db, now_utc


def evaluate_and_maybe_push(ident: str, date_str: str) -> None:
    """Re-evaluate a night at minute 0 and queue a push on a verdict change."""
    plan = build_plan(ident, date_str, 0)
    verdict = plan["verdict"]

    def fn(cursor):
        row = cursor.execute("SELECT verdict FROM verdict_history WHERE imager_id=%s AND date=%s", (ident, date_str)).fetchone()
        if verdict in ("go", "no-go") and (not row or row["verdict"] != verdict):
            cursor.execute(
                "INSERT INTO verdict_outbox (id, imager_id, date, verdict, created_at) VALUES (%s,%s,%s,%s,%s)",
                ("out_" + secrets.token_hex(10), ident, date_str, verdict, now_utc()),
            )
        cursor.execute(
            "INSERT INTO verdict_history (imager_id, date, verdict, updated_at) VALUES (%s,%s,%s,%s)"
            " ON CONFLICT (imager_id, date) DO UPDATE SET verdict=EXCLUDED.verdict, updated_at=EXCLUDED.updated_at",
            (ident, date_str, verdict, now_utc()),
        )

    db().run_in_transaction(fn)


def evaluate_all(ident: Optional[str] = None) -> None:
    """Re-evaluate tonight for one or every imager."""
    imagers = [ident] if ident else _all_imagers()
    now = now_utc()
    for who in imagers:
        try:
            site = _site_object(_site_db(who))
            from darkframe.common.zones import observing_date_utc

            date_str = observing_date_utc(now, site.time_zone).strftime("%Y-%m-%d")
            evaluate_and_maybe_push(who, date_str)
        except Exception:
            continue


def _site_db(ident: str):
    return db().run_in_transaction(lambda cursor: _site(cursor, ident))


def _all_imagers() -> list[str]:
    rows = db().run_in_transaction(
        lambda cursor: cursor.execute("SELECT imager_id FROM sites").fetchall()
    )
    return [r["imager_id"] for r in rows]
