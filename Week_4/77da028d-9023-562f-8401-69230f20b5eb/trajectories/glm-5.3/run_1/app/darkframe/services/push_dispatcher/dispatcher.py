"""The push dispatcher: durable pushes to ntfy and new-moon reminders (DP-51..53)."""
from __future__ import annotations

import math
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
import psycopg
import psycopg.rows

from darkframe.common.http import env_int
from darkframe.common.newmoon import new_moons_between
from darkframe.common.zones import format_iso_local, to_site_local

VERSION = "1.0.0"
URL = ""
DB_URL = ""
NTFY_URL = ""
NTFY_USERNAME = ""
NTFY_PASSWORD = ""


def connect() -> psycopg.Connection:
    return psycopg.connect(DB_URL, autocommit=True,
                           options="-c search_path=push_dispatcher,sky_engine",
                           row_factory=psycopg.rows.dict_row)


def grid_coord(value: float) -> float:
    """Round to the nearest multiple of 0.5, halves away from zero."""
    scaled = value / 0.5
    floor = math.floor(scaled)
    frac = scaled - floor
    if frac > 0.5 or (frac == 0.5 and floor % 2 != 0):
        floor += 1
    result = floor * 0.5
    if result == 0:
        return 0.0
    return result


def publish(topic: str, title: str, message: str) -> bool:
    """One ntfy message; True only when ntfy answers 2xx."""
    if not NTFY_URL or not topic:
        return False
    try:
        response = httpx.post(
            NTFY_URL.rstrip("/") + "/" + topic,
            content=message.encode(),
            headers={"Title": title, "Tags": "telescope"},
            auth=(NTFY_USERNAME, NTFY_PASSWORD) if NTFY_USERNAME else None,
            timeout=5.0,
        )
        return 200 <= response.status_code < 300
    except Exception:
        return False


def _site_of(conn, ident: str) -> Optional[dict]:
    row = conn.execute(
        "SELECT label, latitude, longitude, time_zone, push_topic FROM sky_engine.sites WHERE imager_id=%s",
        (ident,),
    ).fetchone()
    return dict(row) if row else None


def dispatch_loop(stop: threading.Event) -> None:
    """Take outbox rows once, deliver them, retry failures (DP-52)."""
    while not stop.is_set():
        try:
            worked = once()
        except Exception:
            worked = False
        time.sleep(2 if worked else 5)


def once() -> bool:
    """One dispatch pass over the outbox and due reminders."""
    worked = False
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM sky_engine.verdict_outbox ORDER BY created_at LIMIT 20"
        ).fetchall()
        for row in rows:
            site = _site_of(conn, row["imager_id"])
            if not site or not site["push_topic"]:
                conn.execute("DELETE FROM sky_engine.verdict_outbox WHERE id=%s", (row["id"],))
                continue
            facts = _verdict_facts(row["imager_id"], row["date"])
            if facts is None:
                continue
            verdict = row["verdict"]
            title, message = _verdict_push_text(site, facts, verdict)
            push_id = "push_" + secrets.token_hex(10)
            conn.execute(
                "INSERT INTO pushes (id, imager_id, kind, date, title, message, status, attempts, last_attempt_at, sent_at, outbox_id, created_at)"
                " VALUES (%s,%s,'verdict',%s,%s,%s,'queued',0,NULL,NULL,%s,%s)",
                (push_id, row["imager_id"], row["date"], title, message, row["id"], datetime.now(timezone.utc)),
            )
            conn.execute("DELETE FROM sky_engine.verdict_outbox WHERE id=%s", (row["id"],))
            worked = True
        # Reminders: one push per occurrence whose remind time has passed.
        for ident, site in _enabled_reminders(conn):
            for occurrence in _due_reminders(conn, ident, site):
                title = "Darkframe: new-moon weekend"
                message = (
                    f"New Moon {occurrence['new_moon_local_date']}. Dark weekend from {site['label']}"
                    f" starts Saturday {occurrence['weekend_saturday']}."
                )
                push_id = "push_" + secrets.token_hex(10)
                conn.execute(
                    "INSERT INTO pushes (id, imager_id, kind, date, title, message, status, attempts, created_at)"
                    " VALUES (%s,%s,'reminder',%s,%s,%s,'queued',0,%s)",
                    (push_id, ident, occurrence["weekend_saturday"], title, message, datetime.now(timezone.utc)),
                )
                conn.execute(
                    "INSERT INTO reminder_sent (imager_id, occurrence_key, created_at) VALUES (%s,%s,%s)"
                    " ON CONFLICT DO NOTHING",
                    (ident, occurrence["key"], datetime.now(timezone.utc)),
                )
                worked = True
        # Retry unsent pushes.
        retry = env_int("PUSH_RETRY_SECONDS", 10)
        unsent = conn.execute(
            "SELECT * FROM pushes WHERE status='unsent' ORDER BY created_at LIMIT 20"
        ).fetchall()
        now = datetime.now(timezone.utc)
        for row in unsent:
            last = row["last_attempt_at"] or row["created_at"]
            if (now - last).total_seconds() < retry:
                continue
            site = _site_of(conn, row["imager_id"])
            if not site or not site["push_topic"]:
                continue
            ok = publish(site["push_topic"], row["title"], row["message"])
            mark(conn, row["id"], ok)
            worked = True
        # Publish queued pushes within 10 seconds.
        queued = conn.execute(
            "SELECT * FROM pushes WHERE status='queued' ORDER BY created_at LIMIT 20"
        ).fetchall()
        for row in queued:
            site = _site_of(conn, row["imager_id"])
            if not site or not site["push_topic"]:
                conn.execute("UPDATE pushes SET status='unsent', attempts=attempts+1, last_attempt_at=%s WHERE id=%s",
                             (now, row["id"]))
                continue
            ok = publish(site["push_topic"], row["title"], row["message"])
            mark(conn, row["id"], ok)
            worked = True
    return worked


def mark(conn, push_id: str, ok: bool) -> None:
    now = datetime.now(timezone.utc)
    if ok:
        conn.execute(
            "UPDATE pushes SET status='sent', attempts=attempts+1, last_attempt_at=%s, sent_at=%s WHERE id=%s",
            (now, now, push_id),
        )
    else:
        conn.execute(
            "UPDATE pushes SET status='unsent', attempts=attempts+1, last_attempt_at=%s WHERE id=%s",
            (now, push_id),
        )


def _verdict_facts(ident: str, date_str: str) -> Optional[dict]:
    """Ask the sky engine for the plan facts that fill a push message."""
    import httpx as httpx_mod

    port = env_int("APP_PUBLIC_PORT", 4173)
    try:
        response = httpx_mod.get(
            f"http://127.0.0.1:{port + 100}/plans/{date_str}",
            headers={"x-imager-id": ident},
            timeout=5.0,
        )
        if response.status_code != 200:
            return None
        return response.json()
    except Exception:
        return None


def _verdict_push_text(site: dict, plan: dict, verdict: str) -> tuple[str, str]:
    lat = grid_coord(float(site["latitude"]))
    lon = grid_coord(float(site["longitude"]))
    date_str = plan["date"]
    if verdict == "go":
        best = plan.get("best") or {}
        window = plan.get("clear_window") or {}
        start = hm_of(window.get("start"))
        end = hm_of(window.get("end"))
        title = f"Darkframe: go for {date_str}"
        message = (
            f"{site['label']} near {lat}, {lon}: {best.get('target_name','')} in {best.get('filter','')},"
            f" clear window {start}-{end}, {best.get('usable_minutes',0)} usable minutes."
        )
    else:
        title = f"Darkframe: no-go for {date_str}"
        message = f"{site['label']} near {lat}, {lon}: no clear window of 60 minutes."
    return title, message


def hm_of(iso: str) -> str:
    """The HH:MM part of a site-local ISO instant."""
    if not isinstance(iso, str) or "T" not in iso:
        return "00:00"
    return iso.split("T", 1)[1][:5]


def _enabled_reminders(conn) -> list[tuple[str, dict]]:
    rows = conn.execute("SELECT * FROM sky_engine.reminders WHERE enabled = TRUE").fetchall()
    out = []
    for row in rows:
        site = _site_of(conn, row["imager_id"])
        if site and site["push_topic"]:
            out.append((row["imager_id"], {**site, "local_time": row["local_time"]}))
    return out


def _due_reminders(conn, ident: str, site: dict) -> list[dict]:
    """Occurrences whose remind time has passed and are not yet recorded."""
    from darkframe.common.zones import localize_wall_time

    now = datetime.now(timezone.utc)
    moons = new_moons_between(now - timedelta(days=1), 3)
    out = []
    for nm in moons:
        occurrence = _occurrence(nm, site)
        already = conn.execute(
            "SELECT 1 FROM reminder_sent WHERE imager_id=%s AND occurrence_key=%s",
            (ident, occurrence["key"]),
        ).fetchone()
        if already:
            continue
        if occurrence["remind_utc"] <= now:
            out.append(occurrence)
    return out


def _occurrence(new_moon_utc: datetime, site: dict) -> dict:
    from darkframe.common.zones import localize_wall_time

    zone_name = site["time_zone"]
    local_date = to_site_local(new_moon_utc, zone_name)
    nm_local_date = local_date.date()
    saturdays = [nm_local_date + timedelta(days=d) for d in range(-3, 4)
                 if (nm_local_date + timedelta(days=d)).weekday() == 5]
    saturday = min(saturdays, key=lambda d: abs((d - nm_local_date).days)) if saturdays else nm_local_date
    friday = saturday - timedelta(days=1)
    hh, mm = int(site["local_time"][:2]), int(site["local_time"][3:5])
    remind_local = localize_wall_time(zone_name, friday, hh, mm)
    return {
        "key": f"{nm_local_date.isoformat()}@{site['local_time']}",
        "new_moon_local_date": nm_local_date.isoformat(),
        "weekend_saturday": saturday.isoformat(),
        "remind_local": format_iso_local(remind_local, zone_name),
        "remind_utc": remind_local.astimezone(timezone.utc),
    }


def main() -> None:
    global URL, DB_URL, NTFY_URL, NTFY_USERNAME, NTFY_PASSWORD
    from darkframe.config import load_config

    config = load_config()
    DB_URL = config.database_url
    NTFY_URL = config.ntfy_url
    NTFY_USERNAME = config.ntfy_username
    NTFY_PASSWORD = config.ntfy_password
    stop = threading.Event()
    dispatch_loop(stop)


if __name__ == "__main__":
    main()
