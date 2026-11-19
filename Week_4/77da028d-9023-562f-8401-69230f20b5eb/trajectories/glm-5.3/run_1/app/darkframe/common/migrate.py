"""Idempotent migrations and seed data, applied at every serve start."""
from __future__ import annotations

import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone

import psycopg
import pytz

from darkframe.common.db import SCHEMA_SQL

SEED_MARK_KEY = "seed_v1"


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def apply_migrations(url: str) -> None:
    """Create every schema and table; safe to run on every serve start."""
    with psycopg.connect(url, autocommit=True) as conn:
        for schema in ("gateway", "sky_engine", "ledger", "push_dispatcher"):
            conn.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")
            conn.execute(f"SET search_path TO {schema}")
            conn.execute(SCHEMA_SQL[schema])


def _seed_marker(conn) -> bool:
    row = conn.execute(
        "SELECT to_regclass('gateway.seed_markers') IS NOT NULL"
    ).fetchone()
    if not row or not row[0]:
        return False
    exists = conn.execute("SELECT 1 FROM gateway.seed_markers WHERE key = %s", (SEED_MARK_KEY,)).fetchone()
    return bool(exists)


def seed(url: str) -> None:
    """Seed the two sample imagers once; never over existing data."""
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(
            "CREATE SCHEMA IF NOT EXISTS gateway; CREATE TABLE IF NOT EXISTS gateway.seed_markers (key TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL)"
        )
        if _seed_marker(conn):
            return
        now = datetime.now(timezone.utc)
        _seed_imager_one(conn, now)
        _seed_imager_two(conn, now)
        conn.execute(
            "INSERT INTO gateway.seed_markers (key, at) VALUES (%s, %s)",
            (SEED_MARK_KEY, now),
        )


def _seed_imager_one(conn, now: datetime) -> None:
    zone = pytz.timezone("Europe/London")
    local_today = datetime.now(timezone.utc).astimezone(zone).date()
    ines = "imager_ines"
    conn.execute(
        "INSERT INTO gateway.workspaces (imager_id, name, key_hash, created_at) VALUES (%s,%s,%s,%s)",
        (ines, "Ines Okafor", _hash_key("dfk_ines_7c41a9e2"), now),
    )
    conn.execute(
        "INSERT INTO sky_engine.sites (imager_id, label, latitude, longitude, elevation_m, time_zone, min_altitude_deg, push_topic, updated_at)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (ines, "Back garden", 52.2053, 0.1218, 15, "Europe/London", 25, "darkframe-ines-5d2e", now),
    )
    mask = [15] * 72
    for i in range(18, 28):
        mask[i] = 35
    for i in range(30, 42):
        mask[i] = 8
    conn.execute(
        "INSERT INTO sky_engine.horizons (imager_id, altitudes, updated_at) VALUES (%s,%s,%s)",
        (ines, json.dumps(mask), now),
    )
    conn.execute(
        "INSERT INTO sky_engine.reminders (imager_id, enabled, local_time) VALUES (%s,%s,%s)",
        (ines, True, "18:00"),
    )
    heart = "proj_heart_sho"
    andromeda = "proj_andromeda_lrgb"
    veil = "proj_veil_bicolour"
    conn.execute(
        "INSERT INTO ledger.projects (id, imager_id, name, target_name, ra_deg, dec_deg, state, created_at) VALUES"
        " (%s,%s,%s,%s,%s,%s,%s,%s),(%s,%s,%s,%s,%s,%s,%s,%s),(%s,%s,%s,%s,%s,%s,%s,%s)",
        (
            heart, ines, "Heart Nebula in SHO", "IC 1805", 38.175, 61.45, "active", now,
            andromeda, ines, "Andromeda LRGB", "M31", 10.6847, 41.2690, "active", now,
            veil, ines, "Veil bicolour", "NGC 6960", 311.4083, 30.7167, "draft", now,
        ),
    )
    _allot(conn, ines, heart, "Ha", 0, 36000, now)
    _allot(conn, ines, heart, "OIII", 0, 36000, now)
    _allot(conn, ines, heart, "SII", 0, 36000, now)
    _allot(conn, ines, andromeda, "L", 0, 21600, now)
    _allot(conn, ines, andromeda, "R", 0, 7200, now)
    _allot(conn, ines, andromeda, "G", 0, 7200, now)
    _allot(conn, ines, andromeda, "B", 0, 7200, now)
    _allot(conn, ines, veil, "Ha", 0, 28800, now)
    _allot(conn, ines, veil, "OIII", 0, 28800, now)

    darks300 = "cal_darks300"
    darks180 = "cal_darks180"
    flats_ha = "cal_flats_ha"
    today_minus = lambda days: (local_today - timedelta(days=days)).isoformat()
    sets = [
        (darks300, "Darks 300 s gain 100 at -10 C", "dark", "Umbra 26M", 100, 50, 300, -10.0, 1, None, 40, today_minus(75), "ready"),
        (darks180, "Darks 180 s gain 100 at -10 C (old)", "dark", "Umbra 26M", 100, 50, 180, -10.0, 1, None, 40, today_minus(200), "ready"),
        (flats_ha, "Flats Ha", "flat", "Umbra 26M", 100, 50, None, -10.0, 1, "Ha", 30, today_minus(10), "ready"),
    ]
    for sid, name, kind, camera, gain, offset, exposure, temp, binning, filt, frames, captured, status in sets:
        master = {
            "filename": "master.fits",
            "size_bytes": len(f"DARKFRAME-SEED-MASTER {name}"),
            "sha256": __import__("hashlib").sha256(f"DARKFRAME-SEED-MASTER {name}".encode()).hexdigest(),
        }
        conn.execute(
            'INSERT INTO ledger.calibration_sets (id, imager_id, name, kind, camera, gain, "offset", exposure_s, temperature_c, binning, filter, frame_count, captured_on, status, version, current_master, created_at, updated_at)'
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (sid, ines, name, kind, camera, gain, offset, exposure, temp, binning, filt, frames, captured, status, 1, json.dumps(master), now, now),
        )
        fields = {"name": name, "kind": kind, "camera": camera, "gain": gain, "offset": offset,
                  "exposure_s": exposure, "temperature_c": temp, "binning": binning, "filter": filt,
                  "frame_count": frames, "captured_on": captured}
        conn.execute(
            "INSERT INTO ledger.calibration_versions (id, set_id, version, fields, master, created_at) VALUES (%s,%s,%s,%s,%s,%s)",
            (secrets.token_hex(8), sid, 1, json.dumps(fields), json.dumps(master), now),
        )

    session_id = "sess_heart_oct14"
    conn.execute(
        "INSERT INTO ledger.sessions (id, imager_id, project_id, state, previous_state, observing_date, started_at, logged_at, notes, created_at)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (session_id, ines, heart, "logged", None, "2026-10-14",
         zone.localize(datetime(2026, 10, 14, 21, 5)), zone.localize(datetime(2026, 10, 15, 2, 0)),
         "Oak blocked the east until 22:40. Dew heater on 3.", now),
    )
    batch_id = "batch_heart_ha1"
    conn.execute(
        'INSERT INTO ledger.batches (id, imager_id, session_id, idx, filter, sub_count, exposure_s, camera, gain, "offset", temperature_c, binning, created_at)'
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (batch_id, ines, session_id, 1, "Ha", 60, 300, "Umbra 26M", 100, 50, -10.0, 1, now),
    )
    _log_batch(conn, ines, heart, session_id, batch_id, "Ha", 18000, now)
    conn.execute(
        "INSERT INTO ledger.calibration_links (batch_id, kind, calibration_set_id, created_at) VALUES (%s,%s,%s,%s),(%s,%s,%s,%s)",
        (batch_id, "dark", darks300, now, batch_id, "flat", flats_ha, now),
    )
    conn.execute(
        "INSERT INTO ledger.integration_cache (project_id, logged_seconds, updated_at) VALUES (%s,%s,%s) ON CONFLICT (project_id) DO NOTHING",
        (heart, 18000, now),
    )
    # Seed masters live in MinIO; uploaded lazily on first download when absent.


def _seed_imager_two(conn, now: datetime) -> None:
    zone = pytz.timezone("Europe/Madrid")
    tomasz = "imager_tomasz"
    conn.execute(
        "INSERT INTO gateway.workspaces (imager_id, name, key_hash, created_at) VALUES (%s,%s,%s,%s)",
        (tomasz, "Tomasz Brandt", _hash_key("dfk_tomasz_3e8b52d0"), now),
    )
    conn.execute(
        "INSERT INTO sky_engine.sites (imager_id, label, latitude, longitude, elevation_m, time_zone, min_altitude_deg, push_topic, updated_at)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (tomasz, "Rooftop", 37.1773, -3.5986, 690, "Europe/Madrid", 20, "darkframe-tomasz-91af", now),
    )
    mask = [10] * 72
    conn.execute(
        "INSERT INTO sky_engine.horizons (imager_id, altitudes, updated_at) VALUES (%s,%s,%s)",
        (tomasz, json.dumps(mask), now),
    )
    conn.execute(
        "INSERT INTO sky_engine.reminders (imager_id, enabled, local_time) VALUES (%s,%s,%s)",
        (tomasz, False, "18:00"),
    )
    orion = "proj_orion_hargb"
    conn.execute(
        "INSERT INTO ledger.projects (id, imager_id, name, target_name, ra_deg, dec_deg, state, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        (orion, tomasz, "Orion Nebula HaRGB", "M42", 83.8221, -5.3911, "active", now),
    )
    _allot(conn, tomasz, orion, "Ha", 0, 14400, now)
    _allot(conn, tomasz, orion, "R", 0, 3600, now)
    _allot(conn, tomasz, orion, "G", 0, 3600, now)
    _allot(conn, tomasz, orion, "B", 0, 3600, now)
    darks120 = "cal_darks120_tomasz"
    local_today = datetime.now(timezone.utc).astimezone(zone).date()
    captured = (local_today - timedelta(days=30)).isoformat()
    name = "Darks 120 s gain 0 at 0 C"
    master = {
        "filename": "master.fits",
        "size_bytes": len(f"DARKFRAME-SEED-MASTER {name}"),
        "sha256": __import__("hashlib").sha256(f"DARKFRAME-SEED-MASTER {name}".encode()).hexdigest(),
    }
    conn.execute(
        'INSERT INTO ledger.calibration_sets (id, imager_id, name, kind, camera, gain, "offset", exposure_s, temperature_c, binning, filter, frame_count, captured_on, status, version, current_master, created_at, updated_at)'
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (darks120, tomasz, name, "dark", "Umbra 6M", 0, 10, 120, 0.0, 1, None, 25, captured, "ready", 1, json.dumps(master), now, now),
    )
    fields = {"name": name, "kind": "dark", "camera": "Umbra 6M", "gain": 0, "offset": 10,
              "exposure_s": 120, "temperature_c": 0.0, "binning": 1, "filter": None,
              "frame_count": 25, "captured_on": captured}
    conn.execute(
        "INSERT INTO ledger.calibration_versions (id, set_id, version, fields, master, created_at) VALUES (%s,%s,%s,%s,%s,%s)",
        (secrets.token_hex(8), darks120, 1, json.dumps(fields), json.dumps(master), now),
    )
    session_id = "sess_orion_oct20"
    conn.execute(
        "INSERT INTO ledger.sessions (id, imager_id, project_id, state, previous_state, observing_date, started_at, logged_at, notes, created_at)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (session_id, tomasz, orion, "logged", None, "2026-10-20",
         zone.localize(datetime(2026, 10, 21, 1, 10)), zone.localize(datetime(2026, 10, 21, 3, 0)),
         "Neighbour's floodlight on until 01:00.", now),
    )
    batch_id = "batch_orion_r1"
    conn.execute(
        'INSERT INTO ledger.batches (id, imager_id, session_id, idx, filter, sub_count, exposure_s, camera, gain, "offset", temperature_c, binning, created_at)'
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (batch_id, tomasz, session_id, 1, "R", 30, 120, "Umbra 6M", 0, 10, 0.0, 1, now),
    )
    _log_batch(conn, tomasz, orion, session_id, batch_id, "R", 3600, now)
    conn.execute(
        "INSERT INTO ledger.integration_cache (project_id, logged_seconds, updated_at) VALUES (%s,%s,%s) ON CONFLICT (project_id) DO NOTHING",
        (orion, 3600, now),
    )


def _allot(conn, imager: str, project: str, filt: str, before: int, after: int, now: datetime) -> None:
    if after == before:
        return
    delta = after - before
    mid = "mov_" + secrets.token_hex(8)
    conn.execute(
        "INSERT INTO ledger.entries (id, movement_id, movement_kind, project_id, imager_id, filter, account, seconds, session_id, batch_id, reverses_movement_id, created_at)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,NULL,NULL,NULL,%s),(%s,%s,%s,%s,%s,%s,%s,%s,NULL,NULL,NULL,%s)",
        (
            secrets.token_hex(8), mid, "allot", project, imager, filt, "owed", delta, now,
            secrets.token_hex(8), mid, "allot", project, imager, filt, "allotment", -delta, now,
        ),
    )


def _log_batch(conn, imager: str, project: str, session_id: str, batch_id: str, filt: str,
               seconds: int, now: datetime) -> None:
    mid = "mov_" + secrets.token_hex(8)
    conn.execute(
        "INSERT INTO ledger.entries (id, movement_id, movement_kind, project_id, imager_id, filter, account, seconds, session_id, batch_id, reverses_movement_id, created_at)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NULL,%s),(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NULL,%s)",
        (
            secrets.token_hex(8), mid, "log", project, imager, filt, "owed", -seconds, session_id, batch_id, now,
            secrets.token_hex(8), mid, "log", project, imager, filt, "integrated", seconds, session_id, batch_id, now,
        ),
    )
