"""Seed data: applied once, on the first serve against an empty database.

Every seeded person, business, site, firm and lot is invented. Allocation for
every seeded window is computed by the same rule the app uses.
"""
from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import asyncpg
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding, NoEncryption, PrivateFormat, PublicFormat,
)

from . import clock
from .api.passwords import hash_password
from .domain.rules import cancel_by_for
from .domain.timeline import is_repeated_hour, month_hours_utc

PASSWORD = "hourproof-demo-1"

USERS = [
    ("u-anouk", "anouk@verhoeven.example", "Anouk Visser", "analyst", None),
    ("u-joris", "joris@verhoeven.example", "Joris Bakker", "analyst", None),
    ("u-mirthe", "mirthe@verhoeven.example", "Mirthe Claes", "lead", None),
    ("u-vera", "vera@aldermoor.example", "Vera Lindqvist", "verifier", "aldermoor"),
    ("u-bram", "bram@brightlock.example", "Bram Okafor", "verifier", "brightlock"),
]

FIRMS = [
    ("aldermoor", "Aldermoor Assurance"),
    ("brightlock", "Brightlock Prüfung & Söhne"),
]

SITES = [
    ("rtm", "Rotterdam Press Works", "RTM", "NL", "Europe/Amsterdam", "NL-RTM-01", "HOUR", 8000),
    ("ein", "Eindhoven Casting Hall", "EIN", "NL", "Europe/Amsterdam", "NL-EIN-01", "MONTH", 9000),
    ("tpe", "Tampere Foundry", "TPE", "FI", "Europe/Helsinki", "FI-TPE-01", "DAY", 5000),
    ("vnl", "Venlo Coil Shop", "VNL", "NL", "Europe/Amsterdam", "NL-VNL-01", "HOUR", 5000),
]


def opens_at_for(month: str, tz: ZoneInfo) -> datetime:
    hours = month_hours_utc(month, tz)
    return hours[-1] + timedelta(hours=1) + timedelta(hours=48)


def generate_firm_key() -> tuple[str, str, str]:
    private = Ed25519PrivateKey.generate()
    pem = private.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode()
    raw = private.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    public_b64 = base64.b64encode(raw).decode()
    key_id = hashlib.sha256(raw).hexdigest()[:16]
    return pem, public_b64, key_id


def bundle_id_for(lot_id: str, utc_hour: datetime, suffix: str = "") -> str:
    return f"{lot_id}-{utc_hour.strftime('%Y%m%d%H')}{suffix}"


def rtm_oct_consumption(hour_utc: datetime, tz: ZoneInfo) -> int:
    local = hour_utc.astimezone(tz)
    return 1_200_000 if 6 <= local.hour <= 21 else 800_000


def rtm_oct_missing_hours(tz: ZoneInfo) -> set[datetime]:
    missing: set[datetime] = set()
    for h in month_hours_utc("2026-10", tz):
        local = h.astimezone(tz)
        if local.strftime("%Y-%m-%d") == "2026-10-13" and local.hour in (5, 6):
            missing.add(h)
        if local.strftime("%Y-%m-%d") == "2026-10-20" and local.hour in (4, 5, 6, 10, 11, 12, 13, 14):
            missing.add(h)
    return missing


def rtm_oct_solar_quantity(local: datetime) -> int:
    day = local.day
    if day <= 4:
        return 8_000_000
    if day <= 11:
        return 2_000_000
    if day <= 16:
        return 6_000_000
    if day <= 18:
        return 1_000_000
    if day <= 25:
        return 2_000_000
    return 3_000_000


def vnl_is_missing(h: datetime, tz: ZoneInfo) -> bool:
    local = h.astimezone(tz)
    date = local.strftime("%Y-%m-%d")
    if date == "2026-10-01" and local.hour == 0:
        return True
    if date == "2026-10-03" and local.hour in (8, 9, 10):
        return True
    if date == "2026-10-25":
        if local.hour == 3:
            return True
        if local.hour == 2 and is_repeated_hour(h, tz):
            return True
        return False
    if date == "2026-10-28" and local.hour in (8, 9, 10):
        return True
    return False


async def seed(conn: asyncpg.Connection) -> None:
    already = await conn.fetchval("SELECT value FROM meta WHERE key = 'seeded'")
    if already is not None:
        return
    now = clock.now()

    for firm_id, firm_name in FIRMS:
        await conn.execute("INSERT INTO firms (id, name) VALUES ($1,$2)", firm_id, firm_name)
        pem, public_b64, key_id = generate_firm_key()
        await conn.execute(
            "INSERT INTO firm_keys (key_id, firm_id, private_key_pem, public_key_b64, created_at)"
            " VALUES ($1,$2,$3,$4,$5)", key_id, firm_id, pem, public_b64, now,
        )
        await conn.execute(
            "UPDATE firms SET current_key_id = $1 WHERE id = $2", key_id, firm_id
        )
    for user_id, email, name, role, firm_id in USERS:
        await conn.execute(
            "INSERT INTO users (id, email, name, password_hash, role, firm_id)"
            " VALUES ($1,$2,$3,$4,$5,$6)",
            user_id, email, name, hash_password(PASSWORD), role, firm_id,
        )
    for site in SITES:
        await conn.execute(
            "INSERT INTO sites (id, name, code, zone, time_zone, meter_id, target_grain,"
            " target_bp) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", *site,
        )

    tzs = {site[0]: ZoneInfo(site[4]) for site in SITES}
    window_specs = [
        ("rtm-2026-10", "rtm", "2026-10", "Reconciling", "aldermoor"),
        ("ein-2026-10", "ein", "2026-10", "Reconciling", "aldermoor"),
        ("tpe-2026-10", "tpe", "2026-10", "Reconciling", "brightlock"),
        ("vnl-2026-10", "vnl", "2026-10", "Reconciling", None),
        ("rtm-2026-11", "rtm", "2026-11", "Awaiting meters", "aldermoor"),
        ("ein-2026-09", "ein", "2026-09", "In review", "aldermoor"),
        ("tpe-2026-09", "tpe", "2026-09", "Cancelling", "brightlock"),
        ("ein-2026-08", "ein", "2026-08", "Cancelled", "aldermoor"),
        ("rtm-2026-03", "rtm", "2026-03", "Signed", "aldermoor"),
    ]
    for win_id, site_id, month, state, firm_id in window_specs:
        tz = tzs[site_id]
        await conn.execute(
            "INSERT INTO windows (id, site_id, month, state, revision, opens_at,"
            " verifier_firm_id, seal_status, statement_code, base_window_id, created_at,"
            " signatures_count, submitted_at, review_deadline)"
            " VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,1,$11,$12)",
            win_id, site_id, month, state, opens_at_for(month, tz), firm_id,
            "held_press" if win_id == "rtm-2026-03" else None,
            "HP-2026-03-RTM-1" if win_id == "rtm-2026-03" else None,
            win_id, now, now if win_id == "rtm-2026-03" else None,
            now if win_id == "rtm-2026-03" else None,
        )

    await seed_hours(conn, tzs)
    await seed_lots(conn, tzs)
    await conn.execute("INSERT INTO meta (key, value) VALUES ('seeded', '1')")


async def seed_hours(conn: asyncpg.Connection, tzs: dict[str, ZoneInfo]) -> None:
    tz_rtm = tzs["rtm"]
    missing = rtm_oct_missing_hours(tz_rtm)
    for h in month_hours_utc("2026-10", tz_rtm):
        quality = "Missing" if h in missing else "Actual"
        consumed = None if quality == "Missing" else rtm_oct_consumption(h, tz_rtm)
        await conn.execute(
            "INSERT INTO hours (window_id, hour_utc, consumed_wh, quality, correction_version)"
            " VALUES ($1,$2,$3,$4,0)", "rtm-2026-10", h, consumed, quality,
        )
    for month, win_id in (("2026-10", "ein-2026-10"), ("2026-09", "ein-2026-09"),
                          ("2026-08", "ein-2026-08")):
        tz = tzs["ein"]
        for h in month_hours_utc(month, tz):
            quality = "Actual"
            local = h.astimezone(tz)
            if month == "2026-10" and local.strftime("%Y-%m-%d") in (
                "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18",
            ):
                quality = "Estimated"
            await conn.execute(
                "INSERT INTO hours (window_id, hour_utc, consumed_wh, quality, correction_version)"
                " VALUES ($1,$2,$3,$4,0)", win_id, h, 1_000_000, quality,
            )
    for month, win_id in (("2026-10", "tpe-2026-10"), ("2026-09", "tpe-2026-09")):
        for h in month_hours_utc(month, tzs["tpe"]):
            await conn.execute(
                "INSERT INTO hours (window_id, hour_utc, consumed_wh, quality, correction_version)"
                " VALUES ($1,$2,$3,$4,0)", win_id, h, 1_000_000, "Actual",
            )
    tz_vnl = tzs["vnl"]
    for h in month_hours_utc("2026-10", tz_vnl):
        local = h.astimezone(tz_vnl)
        value = 500_000 + 1_000 * local.day + 10 * local.hour
        if is_repeated_hour(h, tz_vnl):
            value += 5
        quality = "Actual"
        if vnl_is_missing(h, tz_vnl):
            quality = "Missing"
            value = None
        await conn.execute(
            "INSERT INTO hours (window_id, hour_utc, consumed_wh, quality, correction_version)"
            " VALUES ($1,$2,$3,$4,0)", "vnl-2026-10", h, value, quality,
        )
    for h in month_hours_utc("2026-11", tzs["rtm"]):
        await conn.execute(
            "INSERT INTO hours (window_id, hour_utc, consumed_wh, quality, correction_version)"
            " VALUES ($1,$2,$3,$4,0)", "rtm-2026-11", h, None, "Missing",
        )
    for h in month_hours_utc("2026-03", tzs["rtm"]):
        await conn.execute(
            "INSERT INTO hours (window_id, hour_utc, consumed_wh, quality, correction_version)"
            " VALUES ($1,$2,$3,$4,0)", "rtm-2026-03", h, 1_000_000, "Actual",
        )


async def seed_lots(conn: asyncpg.Connection, tzs: dict[str, ZoneInfo]) -> None:
    now = clock.now()

    async def add_lot(lot_id: str, window_id: str, name: str, tech: str, zone: str,
                      rank: int, battery: bool, production_month: str,
                      cancel_by: datetime | None = None) -> None:
        await conn.execute(
            "INSERT INTO lots (id, window_id, name, technology, zone, rank, excluded,"
            " battery_shifted, production_month, cancel_by, created_at)"
            " VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9,$10)",
            lot_id, window_id, name, tech, zone, rank, battery, production_month,
            cancel_by if cancel_by is not None else cancel_by_for(production_month), now,
        )

    async def add_bundle(window_id: str, lot_id: str, bundle_id: str,
                         production_hour: datetime | None, discharge_hour: datetime | None,
                         start: int, end: int) -> None:
        await conn.execute(
            "INSERT INTO bundles (id, window_id, lot_id, bundle_id, production_hour,"
            " discharge_hour, range_start_wh, range_end_wh) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            f"{window_id}::{bundle_id}", window_id, lot_id, bundle_id,
            production_hour, discharge_hour, str(start), str(end),
        )
        await conn.execute(
            "INSERT INTO bundle_claims (bundle_id, window_id, created_at)"
            " VALUES ($1,$2,$3) ON CONFLICT (bundle_id) DO NOTHING",
            bundle_id, window_id, now,
        )

    tz = tzs["rtm"]
    await add_lot("lot-rtm-solar-2026-10", "rtm-2026-10", "Maasvlakte Solar", "solar", "NL", 1, False, "2026-10")
    await add_lot("lot-rtm-wind-2026-10", "rtm-2026-10", "Noordzee Wind", "wind", "NL", 2, False, "2026-10")
    await add_lot("lot-rtm-battery-2026-10", "rtm-2026-10", "Zeeland Battery", "solar", "NL", 3, True, "2026-10")
    await add_lot("lot-rtm-hydro-2026-10", "rtm-2026-10", "Ardennes Hydro", "hydro", "BE", 4, False, "2026-10")
    cursor_wh = 0
    for h in month_hours_utc("2026-10", tz):
        local = h.astimezone(tz)
        if 9 <= local.hour <= 14:
            qty = rtm_oct_solar_quantity(local)
            await add_bundle("rtm-2026-10", "lot-rtm-solar-2026-10",
                             bundle_id_for("lot-rtm-solar-2026-10", h), h, None,
                             cursor_wh, cursor_wh + qty)
            cursor_wh += qty
        if local.hour <= 3:
            await add_bundle("rtm-2026-10", "lot-rtm-wind-2026-10",
                             bundle_id_for("lot-rtm-wind-2026-10", h), h, None, 0, 500_000)
        if 5 <= local.day <= 11 and local.hour == 9:
            await add_bundle("rtm-2026-10", "lot-rtm-wind-2026-10",
                             bundle_id_for("lot-rtm-wind-2026-10", h, "-b"), h, None,
                             0, 1_000_000)
        if local.hour == 19:
            await add_bundle("rtm-2026-10", "lot-rtm-battery-2026-10",
                             bundle_id_for("lot-rtm-battery-2026-10", h),
                             h - timedelta(hours=6), h, 0, 1_000_001)
        if local.hour == 20:
            await add_bundle("rtm-2026-10", "lot-rtm-hydro-2026-10",
                             bundle_id_for("lot-rtm-hydro-2026-10", h), h, None,
                             0, 1_000_000)

    for month, lot_id, name in (
        ("2026-10", "lot-ein-wind-2026-10", "Brabant Wind October"),
        ("2026-09", "lot-ein-wind-2026-09", "Brabant Wind September"),
        ("2026-08", "lot-ein-wind-2026-08", "Brabant Wind August"),
    ):
        win_id = f"ein-{month}"
        await add_lot(lot_id, win_id, name, "wind", "NL", 1, False, month)
        for h in month_hours_utc(month, tzs["ein"]):
            await add_bundle(win_id, lot_id, bundle_id_for(lot_id, h), h, None, 0, 900_000)

    await add_lot("lot-tpe-wind-2026-10", "tpe-2026-10", "Pirkanmaa Wind", "wind", "FI", 1, False, "2026-10")
    for h in month_hours_utc("2026-10", tzs["tpe"]):
        local = h.astimezone(tzs["tpe"])
        if local.day % 2 == 1 and local.hour in (2, 3, 4, 5):
            await add_bundle("tpe-2026-10", "lot-tpe-wind-2026-10",
                            bundle_id_for("lot-tpe-wind-2026-10", h), h, None, 0, 8_000_000)

    await add_lot("lot-tpe-wind-2026-09", "tpe-2026-09", "Pirkanmaa Wind September",
                  "wind", "FI", 1, False, "2026-09")
    ranges = [(9007199254740993, 9007199255240993),
              (9007199255240993, 9007199255740993),
              (9007199255740993, 9007199256240993)]
    for i, (start, end) in enumerate(ranges):
        h = datetime(2026, 9, 10, i, tzinfo=timezone.utc)
        await add_bundle("tpe-2026-09", "lot-tpe-wind-2026-09",
                         bundle_id_for("lot-tpe-wind-2026-09", h), h, None, start, end)

    await add_lot("lot-rtm-solar-2026-03", "rtm-2026-03", "Maasvlakte Solar March",
                  "solar", "NL", 1, False, "2026-03")
    for h in month_hours_utc("2026-03", tzs["rtm"]):
        local = h.astimezone(tzs["rtm"])
        if 9 <= local.hour <= 14:
            await add_bundle("rtm-2026-03", "lot-rtm-solar-2026-03",
                             bundle_id_for("lot-rtm-solar-2026-03", h), h, None,
                             0, 2_000_000)
