"""Idempotent seed (DP-03). A freshly emptied database comes up with exactly these records."""
import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import asyncpg

from .clock import clock
from .db import ATR_TAILS, DHC_TAILS, ERJ_TAILS, SEED_USERS, STANDBY, seed_person_id

BASE_TZ = ZoneInfo("Europe/London")

ATR_MODEL, DHC_MODEL, ERJ_MODEL = "ATR72-212A", "DHC-8-402", "ERJ-170-200"

# Seeded work per directive: (registration, kind, person, day_offset, hour, certifier, cert_day, cert_hour)
EASA_SEED = [
    ("G-FNAA", "certified", "dara.okafor", -10, 10, "ines.varga", -10, 14),
    ("G-FNAB", "certified", "mika.hollis", -5, 10, "tomasz.wilk", -5, 15),
    ("G-FNAC", "inspected", "sol.brennan", -2, 9, "ines.varga", None, None),
    ("G-FNAD", "claimed", "dara.okafor", None, None, None, None, None),
    ("G-FNAE", "claimed", "mika.hollis", None, None, None, None, None),
]
UKCA_SEED = [
    ("G-FNBA", "certified", "sol.brennan", -12, 9, "priya.raman", -12, 13),
    ("G-FNBB", "deferred", "avery.lund", -1, 16, None, None, None),
    ("G-FNBC", "claimed", "jun.teller", None, None, None, None, None),
]
EMBRAER_SEED = [
    ("G-FNCA", "certified", "mika.hollis", -30, 8, "priya.raman", -30, 12),
    ("G-FNCB", "inspected", "dara.okafor", -3, 11, "tomasz.wilk", None, None),
]


async def seed(database_url: str) -> None:
    conn = await asyncpg.connect(database_url)
    try:
        await conn.execute(
            "CREATE TABLE IF NOT EXISTS seed_markers (key text PRIMARY KEY, value timestamptz NOT NULL)"
        )
        row = await conn.fetchrow("SELECT value FROM seed_markers WHERE key = 'seed_day'")
        if row is None:
            seed_at = clock().now()
            await conn.execute(
                "INSERT INTO seed_markers (key, value) VALUES ('seed_day', $1)", seed_at)
        else:
            seed_at = row["value"]
        async with conn.transaction():
            await _seed_people(conn)
            await _seed_standby(conn)
            await _seed_tails(conn)
            await _seed_directives(conn, seed_at)
    finally:
        await conn.close()


async def _seed_people(conn):
    for username, passcode, display_name, role, contractor, licence, email, scope in SEED_USERS:
        person_id = "per_system" if username == "__system__" else seed_person_id(username)
        await conn.execute(
            """INSERT INTO people (id, username, role, contractor, display_name, licence, email,
               passcode, scope, erased, signer_token)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, NULL)
               ON CONFLICT (id) DO NOTHING""",
            person_id, username, role, contractor, display_name, licence, email,
            passcode, json.dumps(scope) if scope else None,
        )


async def _seed_standby(conn):
    for model, names in STANDBY.items():
        for position, name in enumerate(names, start=1):
            await conn.execute(
                "INSERT INTO standby (model, position, person_id) VALUES ($1, $2, $3) "
                "ON CONFLICT (model, position) DO NOTHING",
                model, position, seed_person_id(name.lower().replace(" ", ".")),
            )


async def _seed_tails(conn):
    for registration, msn, total in ATR_TAILS:
        await conn.execute(
            "INSERT INTO tails (registration, model, msn, total_hours, daily_utilisation) "
            "VALUES ($1, $2, $3, $4, 6.0) ON CONFLICT (registration) DO NOTHING",
            registration, ATR_MODEL, msn, total,
        )
    for registration, msn, total in DHC_TAILS:
        await conn.execute(
            "INSERT INTO tails (registration, model, msn, total_hours, daily_utilisation) "
            "VALUES ($1, $2, $3, $4, 7.0) ON CONFLICT (registration) DO NOTHING",
            registration, DHC_MODEL, msn, total,
        )
    for registration, msn, total in ERJ_TAILS:
        await conn.execute(
            "INSERT INTO tails (registration, model, msn, total_hours, daily_utilisation) "
            "VALUES ($1, $2, $3, $4, 8.0) ON CONFLICT (registration) DO NOTHING",
            registration, ERJ_MODEL, msn, total,
        )


def _at(seed_at: datetime, days_offset: int, hour: int, minute: int = 0) -> datetime:
    day = (seed_at.astimezone(BASE_TZ) + timedelta(days=days_offset)).date()
    moment = datetime(day.year, day.month, day.day, hour, minute, tzinfo=BASE_TZ)
    return moment.astimezone(timezone.utc)


async def _seed_directives(conn, seed_at: datetime):
    ingested_at = _at(seed_at, 0, 6)
    avery = seed_person_id("avery.lund")
    card_number = 10001
    directives = [
        ("dir_easa_2026-0142", "EASA", "2026-0142",
         "Main landing gear side brace lower link — detailed visual inspection",
         -20, 180, 600.0, ATR_MODEL, 1100, 1250, -120.0,
         "Inspect the lower link lugs for cracks using a 10x glass; replace the link if any crack is found.",
         EASA_SEED),
        ("dir_ukca_g-2026-0007", "UK CAA", "G-2026-0007",
         "Propeller de-icer boot bonding — detailed check",
         -160, 180, 900.0, DHC_MODEL, 4380, 4499, -300.0,
         "Check boot bond edges per the maintenance manual; repair any lift greater than 3 mm.",
         UKCA_SEED),
        ("dir_embraer_e170-28-0042", "Embraer", "E170-28-0042",
         "Fuel quantity probe harness connector — replacement",
         -200, 199, 1200.0, ERJ_MODEL, 17000500, 17000590, -100.0,
         "Replace the connector with the improved part and perform a fuel quantity indication test.",
         EMBRAER_SEED),
        ("dir_atr_atr72-27-1088", "ATR", "ATR72-27-1088",
         "Aileron trim tab actuator rod end — inspection",
         -5, 365, 2000.0, ATR_MODEL, 1000, 1999, -30.0,
         "Measure rod end play; replace the rod end if play exceeds the manual limit.",
         []),
    ]
    for (lineage_id, authority, number, title, eff_off, cal_days, fh_interval,
         model, msn_from, msn_to, baseline_off, method, states) in directives:
        exists = await conn.fetchval("SELECT 1 FROM lineages WHERE id = $1", lineage_id)
        if exists:
            continue
        effective_date = (seed_at.astimezone(BASE_TZ) + timedelta(days=eff_off)).date()
        await conn.execute(
            "INSERT INTO lineages (id, authority, number, revision, status, title) "
            "VALUES ($1, $2, $3, 1, 'active', $4)",
            lineage_id, authority, number, title,
        )
        await conn.execute(
            """INSERT INTO revisions (lineage_id, revision, title, method, effective_date,
               calendar_days, fh_interval, applicability, prior_credit, document_key,
               ingested_at, ingested_by)
               VALUES ($1, 1, $2, $3, $4, $5, $6, $7, false, NULL, $8, $9)""",
            lineage_id, title, method, effective_date, cal_days, fh_interval,
            json.dumps([{"model": model, "msn_from": msn_from, "msn_to": msn_to}]),
            ingested_at, avery,
        )
        await _seed_threads(conn, lineage_id, model, msn_from, msn_to, baseline_off,
                            fh_interval, effective_date, cal_days, title, method,
                            ingested_at, states, seed_at, card_number)
        card_number += await _tail_count(conn, model, msn_from, msn_to)


async def _tail_count(conn, model, msn_from, msn_to) -> int:
    return await conn.fetchval(
        "SELECT count(*) FROM tails WHERE model = $1 AND msn BETWEEN $2 AND $3",
        model, msn_from, msn_to,
    )


async def _seed_threads(conn, lineage_id, model, msn_from, msn_to, baseline_off, fh_interval,
                        effective_date, cal_days, title, method, ingested_at, states,
                        seed_at, card_start):
    deadline_date = effective_date + timedelta(days=cal_days)
    tails = await conn.fetch(
        "SELECT registration, msn, total_hours FROM tails WHERE model = $1 AND msn BETWEEN $2 AND $3 "
        "ORDER BY registration",
        model, msn_from, msn_to,
    )
    short = lineage_id.split("_", 1)[1]
    for index, (registration, msn, total_hours) in enumerate(tails):
        baseline = round(float(total_hours) + baseline_off, 1)
        threshold = round(baseline + fh_interval, 1)
        thread_id = f"thr_{short}_{registration.replace('-', '')}"
        await conn.execute(
            """INSERT INTO threads (id, lineage_id, registration, stage, revision, pinned_revision,
               fh_baseline, threshold, deadline_date, created_at)
               VALUES ($1, $2, $3, 'open', 1, NULL, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING""",
            thread_id, lineage_id, registration, baseline, threshold, deadline_date, ingested_at,
        )
        await conn.execute(
            """INSERT INTO history_entries (thread_id, lineage_id, revision, entered_at, outcome,
               fh_baseline, threshold, deadline_date, title, method)
               VALUES ($1, $2, 1, $3, 'current', $4, $5, $6, $7, $8)""",
            thread_id, lineage_id, ingested_at, baseline, threshold, deadline_date, title, method,
        )
        await conn.execute(
            "INSERT INTO work_cards (thread_id, card_id) VALUES ($1, $2) "
            "ON CONFLICT (thread_id) DO NOTHING",
            thread_id, f"WC-{card_start + index:05d}",
        )

    for registration, kind, person, day_off, hour, certifier, cert_off, cert_hour in states:
        thread_id = f"thr_{short}_{registration.replace('-', '')}"
        person_id = seed_person_id(person)
        if kind == "certified":
            inspected_at = _at(seed_at, day_off, hour)
            certified_at = _at(seed_at, cert_off, cert_hour)
            await conn.execute(
                "UPDATE threads SET stage = 'certified', pinned_revision = 1, claimed_at = $1, "
                "holder_id = $2, certifier_id = $3 WHERE id = $4",
                inspected_at, person_id, seed_person_id(certifier), thread_id,
            )
            await _seed_signature(conn, f"sig_{thread_id}_insp", thread_id, "inspection",
                                  person_id, inspected_at)
            await _seed_signature(conn, f"sig_{thread_id}_cert", thread_id, "countersignature",
                                  seed_person_id(certifier), certified_at)
        elif kind == "inspected":
            inspected_at = _at(seed_at, day_off, hour)
            await conn.execute(
                "UPDATE threads SET stage = 'inspected', claimed_at = $1, holder_id = $2, "
                "certifier_id = $3 WHERE id = $4",
                inspected_at, person_id, seed_person_id(certifier), thread_id,
            )
            await _seed_signature(conn, f"sig_{thread_id}_insp", thread_id, "inspection",
                                  person_id, inspected_at)
        elif kind == "claimed":
            claimed_at = _at(seed_at, 0, 8)
            await conn.execute(
                "UPDATE threads SET stage = 'claimed', claimed_at = $1, holder_id = $2 WHERE id = $3",
                claimed_at, person_id, thread_id,
            )
        elif kind == "deferred":
            granted_at = _at(seed_at, day_off, hour)
            await conn.execute(
                "UPDATE threads SET stage = 'deferred' WHERE id = $1", thread_id)
            await conn.execute(
                "INSERT INTO deferrals (thread_id, granted_by, granted_at, reason, revision) "
                "VALUES ($1, $2, $3, $4, 1)",
                thread_id, person_id, granted_at, "Awaiting de-icer boot kit")
            await conn.execute(
                "UPDATE threads SET deadline_date = deadline_date + 7, threshold = threshold + 25.0 "
                "WHERE id = $1", thread_id)


async def _seed_signature(conn, signature_id, thread_id, kind, signer_id, committed_at):
    await conn.execute(
        """INSERT INTO signatures (id, thread_id, kind, signer_id, revision, committed_at,
           timeliness, method_ref, findings, status)
           VALUES ($1, $2, $3, $4, 1, $5, 'on_time', 'AMM task', 'No defects found', 'valid')""",
        signature_id, thread_id, kind, signer_id, committed_at,
    )
