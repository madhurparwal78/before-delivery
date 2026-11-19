"""The invented data applied once, on the first serve against an empty database."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import asyncpg

from .cancellation import poll_confirmations, send_line
from .desk import Desk, User, hash_password
from .jsontypes import JsonObject
from .providers import ProviderDown
from .repository import Window, apply_allocation, load_window, load_windows, movement, record_ledger
from .rules import allocation_digest, draw_sample
from .sealing import generate_key, record_signature
from .timeutil import HOUR, UTC, cancel_by, window_hours

SEED_LOCK = 7340005
SEED_HISTORY_LOCK = 7340006
PASSWORD = "hourproof-demo-1"

USERS = [
    ("anouk", "Anouk Visser", "anouk@verhoeven.example", "analyst", None),
    ("joris", "Joris Bakker", "joris@verhoeven.example", "analyst", None),
    ("mirthe", "Mirthe Claes", "mirthe@verhoeven.example", "lead", None),
    ("vera", "Vera Lindqvist", "vera@aldermoor.example", "verifier", "aldermoor"),
    ("bram", "Bram Okafor", "bram@brightlock.example", "verifier", "brightlock"),
]
FIRMS = [("aldermoor", "Aldermoor Assurance"), ("brightlock", "Brightlock Prüfung & Söhne")]
SITES = [
    ("rtm", "Rotterdam Press Works", "RTM", "NL", "Europe/Amsterdam", "NL-RTM-01", "HOUR", 8000),
    ("ein", "Eindhoven Casting Hall", "EIN", "NL", "Europe/Amsterdam", "NL-EIN-01", "MONTH", 9000),
    ("tpe", "Tampere Foundry", "TPE", "FI", "Europe/Helsinki", "FI-TPE-01", "DAY", 5000),
    ("vnl", "Venlo Coil Shop", "VNL", "NL", "Europe/Amsterdam", "NL-VNL-01", "HOUR", 5000),
]
WINDOWS = [
    ("rtm-2026-10", "rtm", "2026-10", "Reconciling", "aldermoor"),
    ("ein-2026-10", "ein", "2026-10", "Reconciling", "aldermoor"),
    ("tpe-2026-10", "tpe", "2026-10", "Reconciling", "brightlock"),
    ("vnl-2026-10", "vnl", "2026-10", "Reconciling", None),
    ("rtm-2026-11", "rtm", "2026-11", "Awaiting meters", "aldermoor"),
    ("ein-2026-09", "ein", "2026-09", "In review", "aldermoor"),
    ("tpe-2026-09", "tpe", "2026-09", "Cancelling", "brightlock"),
    ("ein-2026-08", "ein", "2026-08", "Cancelling", "aldermoor"),
    ("rtm-2026-03", "rtm", "2026-03", "Cancelling", "aldermoor"),
]
RTM_MISSING = {(13, 5), (13, 6), (20, 4), (20, 5), (20, 6), (20, 10), (20, 11), (20, 12), (20, 13), (20, 14)}
VNL_MISSING = {(1, 0, 0), (3, 8, 0), (3, 9, 0), (3, 10, 0), (25, 2, 1), (25, 3, 0), (28, 8, 0), (28, 9, 0), (28, 10, 0)}
RTM_SOLAR_QUANTITY = [
    (4, 8_000_000),
    (11, 2_000_000),
    (16, 6_000_000),
    (18, 1_000_000),
    (25, 2_000_000),
    (31, 3_000_000),
]
TPE09_FIRST_RANGE = 9_007_199_254_740_993
TPE09_QUANTITY = 500_000
# These start Cancelling with every line Unsubmitted and reach Cancelled the way any window does, through the
# registry's own answers; the second is then signed by its verifier and sealed in the background.
REGISTRY_SEEDS = ("ein-2026-08", "rtm-2026-03")
SEED_SIGNATURE = ("rtm-2026-03", "vera")
SEND_CHUNK = 8


def hour_rows(
    window_id: str, zone: str, hours: list[datetime]
) -> list[tuple[str, datetime, int | None, str, int, None]]:
    rows = []
    for hour in hours:
        local = hour.astimezone(ZoneInfo(zone))
        value: int | None = 1_000_000
        quality = "Actual"
        if window_id == "rtm-2026-10":
            value = 1_200_000 if 6 <= local.hour <= 21 else 800_000
            if (local.day, local.hour) in RTM_MISSING:
                value, quality = None, "Missing"
        elif window_id == "vnl-2026-10":
            value = 500_000 + 1000 * local.day + 10 * local.hour + 5 * local.fold
            if (local.day, local.hour, local.fold) in VNL_MISSING:
                value, quality = None, "Missing"
        elif window_id == "ein-2026-10" and 15 <= local.day <= 18:
            quality = "Estimated"
        elif window_id == "rtm-2026-11":
            value, quality = None, "Missing"
        rows.append((window_id, hour, value, quality, 0, None))
    return rows


def bundle(
    lot_id: str, hour: datetime, quantity: int, *, suffix: str = "", discharge: datetime | None = None, start: int = 0
) -> JsonObject:
    return {
        "id": f"{lot_id}-{hour:%Y%m%d%H}{suffix}",
        "lot_id": lot_id,
        "production": hour,
        "discharge": discharge,
        "battery": discharge is not None,
        "start": start,
        "end": start + quantity,
    }


def seed_lots(window_id: str, zone: str, hours: list[datetime]) -> tuple[list[tuple], list[JsonObject]]:
    """Lots (id, name, technology, zone, rank) and their bundles for one seeded window."""
    tz = ZoneInfo(zone)
    local = [(hour, hour.astimezone(tz)) for hour in hours]
    if window_id == "rtm-2026-10":
        lots = [
            ("lot-rtm-solar-2026-10", "Maasvlakte Solar", "solar", "NL", 1),
            ("lot-rtm-wind-2026-10", "Noordzee Wind", "wind", "NL", 2),
            ("lot-rtm-battery-2026-10", "Zeeland Battery", "solar", "NL", 3),
            ("lot-rtm-hydro-2026-10", "Ardennes Hydro", "hydro", "BE", 4),
        ]
        bundles = []
        for hour, moment in local:
            if 9 <= moment.hour <= 14:
                quantity = next(q for limit, q in RTM_SOLAR_QUANTITY if moment.day <= limit)
                bundles.append(bundle("lot-rtm-solar-2026-10", hour, quantity))
            if moment.hour <= 3:
                bundles.append(bundle("lot-rtm-wind-2026-10", hour, 500_000))
            if moment.hour == 9 and 5 <= moment.day <= 11:
                bundles.append(bundle("lot-rtm-wind-2026-10", hour, 1_000_000, suffix="-b"))
            if moment.hour == 19:
                bundles.append(bundle("lot-rtm-battery-2026-10", hour - 6 * HOUR, 1_000_001, discharge=hour))
            if moment.hour == 20:
                bundles.append(bundle("lot-rtm-hydro-2026-10", hour, 1_000_000))
        return lots, bundles
    if window_id in ("ein-2026-10", "ein-2026-09", "ein-2026-08"):
        month = window_id[-7:]
        name = {"10": "October", "09": "September", "08": "August"}[month[-2:]]
        lot_id = f"lot-ein-wind-{month}"
        return [(lot_id, f"Brabant Wind {name}", "wind", "NL", 1)], [bundle(lot_id, hour, 900_000) for hour in hours]
    if window_id == "tpe-2026-10":
        lot_id = "lot-tpe-wind-2026-10"
        return (
            [(lot_id, "Pirkanmaa Wind", "wind", "FI", 1)],
            [
                bundle(lot_id, hour, 8_000_000)
                for hour, moment in local
                if moment.day % 2 == 1 and 2 <= moment.hour <= 5
            ],
        )
    if window_id == "tpe-2026-09":
        lot_id = "lot-tpe-wind-2026-09"
        first = datetime(2026, 9, 10, tzinfo=UTC)
        return (
            [(lot_id, "Pirkanmaa Wind September", "wind", "FI", 1)],
            [
                bundle(lot_id, first + HOUR * n, TPE09_QUANTITY, start=TPE09_FIRST_RANGE + n * TPE09_QUANTITY)
                for n in range(3)
            ],
        )
    if window_id == "rtm-2026-03":
        lot_id = "lot-rtm-solar-2026-03"
        return (
            [(lot_id, "Maasvlakte Solar March", "solar", "NL", 1)],
            [bundle(lot_id, hour, 2_000_000) for hour, moment in local if 9 <= moment.hour <= 14],
        )
    return [], []


async def seed(desk: Desk) -> bool:
    """Apply the seed once; returns whether this call applied it."""
    async with desk.pool.acquire() as connection:
        async with connection.transaction():
            await connection.execute("SELECT pg_advisory_xact_lock($1)", SEED_LOCK)
            if await connection.fetchval("SELECT count(*) FROM meta WHERE key = 'seeded'"):
                return False
            await _seed(desk, connection)
            await connection.execute("INSERT INTO meta (key, value) VALUES ('seeded', 'yes')")
    return True


async def _seed(desk: Desk, connection: asyncpg.Connection) -> None:
    now = desk.now()
    await connection.executemany("INSERT INTO firms (id, name) VALUES ($1, $2)", FIRMS)
    for firm_id, _ in FIRMS:
        key = generate_key()
        await connection.execute(
            "INSERT INTO firm_keys (key_id, firm_id, public_key, private_key) VALUES ($1,$2,$3,$4)",
            key["key_id"],
            firm_id,
            key["public_key"],
            key["private_key"],
        )
    await connection.executemany(
        "INSERT INTO users (id, name, email, role, firm_id, password_hash) VALUES ($1,$2,$3,$4,$5,$6)",
        [(uid, name, email, role, firm, hash_password(PASSWORD)) for uid, name, email, role, firm in USERS],
    )
    await connection.executemany(
        "INSERT INTO sites (id, name, code, zone, time_zone, meter_id, target_grain, target_bp) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        SITES,
    )
    sites = {site[0]: site for site in SITES}
    for window_id, site_id, month, state, firm in WINDOWS:
        _, _, code, zone, time_zone, *_ = sites[site_id]
        hours = window_hours(time_zone, month)
        await connection.execute(
            "INSERT INTO windows (id, site_id, month, base_id, chain_index, state, revision, firm_id) "
            "VALUES ($1,$2,$3,$1,1,$4,1,$5)",
            window_id,
            site_id,
            month,
            state,
            firm,
        )
        await connection.executemany(
            "INSERT INTO hours (window_id, hour_utc, consumed_wh, quality, version, reason) VALUES ($1,$2,$3,$4,$5,$6)",
            hour_rows(window_id, time_zone, hours),
        )
        lots, bundles = seed_lots(window_id, time_zone, hours)
        await connection.executemany(
            "INSERT INTO lots (window_id, id, name, technology, zone, rank, excluded, battery_shifted, production_month) "
            "VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8)",
            [
                (
                    window_id,
                    lid,
                    name,
                    tech,
                    lzone,
                    rank,
                    any(b["battery"] for b in bundles if b["lot_id"] == lid),
                    month,
                )
                for lid, name, tech, lzone, rank in lots
            ],
        )
        await connection.executemany(
            "INSERT INTO bundles (window_id, id, lot_id, production_hour, discharge_hour, battery_shifted, range_start, "
            "range_end) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            [
                (window_id, b["id"], b["lot_id"], b["production"], b["discharge"], b["battery"], b["start"], b["end"])
                for b in bundles
            ],
        )
        lot_names = {lid: name for lid, name, *_ in lots}
        await connection.executemany(
            "INSERT INTO claims (bundle_id, base_id, window_id) VALUES ($1,$2,$2) ON CONFLICT DO NOTHING",
            [(b["id"], window_id) for b in bundles],
        )
        await record_ledger(
            connection,
            [
                movement(
                    "deposit",
                    "registry",
                    "holdings",
                    b["end"] - b["start"],
                    window_id,
                    f"Deposit {lot_names[b['lot_id']]}",
                    lot_id=b["lot_id"],
                    bundle_id=b["id"],
                )
                for b in bundles
            ],
            now,
        )
        window = await load_window(connection, window_id)
        assert window is not None
        await apply_allocation(connection, window, window.bounds[1])
        window = await load_window(connection, window_id)
        assert window is not None
        if state in ("In review", "Cancelling"):
            await _draw_sample(connection, window, record_results=state != "In review")
        if state == "In review":
            unsent = {line.lot_id for line in window.lines}
            limits = [cancel_by(lot.production_month) for lot in window.lots if lot.id in unsent]
            deadline = min([now + timedelta(seconds=desk.settings.review_seconds), *limits])
            await connection.execute(
                "UPDATE windows SET submitted_at = $2, review_deadline = $3 WHERE id = $1", window_id, now, deadline
            )
    await connection.execute("INSERT INTO meta (key, value) VALUES ('seed_history', 'open')")


async def _draw_sample(connection: asyncpg.Connection, window: Window, *, record_results: bool) -> None:
    digest = allocation_digest(window.lines)
    drawn = draw_sample(window.id, digest, [row.hour for row in window.hours if (row.consumed or 0) > 0])
    await connection.executemany(
        "INSERT INTO samples (window_id, hour_utc, position, result) VALUES ($1,$2,$3,$4)",
        [(window.id, hour, position, "agree" if record_results else None) for position, hour in enumerate(drawn)],
    )
    await connection.execute("UPDATE windows SET sample_digest = $2 WHERE id = $1", window.id, digest)


async def finish_seed_history(desk: Desk) -> None:
    """Send the registry seeds' lines, poll their confirmations, then sign the seeded statement once its window
    reads Cancelled. Runs at serve and again from the workers until done; waits while the registry is down."""
    if not await desk.pool.fetchval("SELECT count(*) FROM meta WHERE key = 'seed_history'"):
        return
    async with desk.pool.acquire() as connection:
        # One sender across every process serving this database, so each line reaches the registry once.
        if not await connection.fetchval("SELECT pg_try_advisory_lock($1)", SEED_HISTORY_LOCK):
            return
        try:
            for window in await load_windows(connection, list(REGISTRY_SEEDS)):
                unsent = [line for line in window.lines if line.status == "Unsubmitted"]
                for start in range(0, len(unsent), SEND_CHUNK):
                    chunk = unsent[start : start + SEND_CHUNK]
                    await asyncio.gather(
                        *(send_line(desk, window.id, line, window.columns["site_name"]) for line in chunk)
                    )
        except ProviderDown:
            return
        finally:
            await connection.execute("SELECT pg_advisory_unlock($1)", SEED_HISTORY_LOCK)
    await poll_confirmations(desk)
    window_id, signer_id = SEED_SIGNATURE
    async with desk.pool.acquire() as connection:
        async with connection.transaction():
            states = {
                row["id"]: row["state"]
                for row in await connection.fetch(
                    "SELECT id, state FROM windows WHERE id = ANY($1) FOR UPDATE", list(REGISTRY_SEEDS)
                )
            }
            if "Cancelling" in states.values():
                return
            if states[window_id] == "Cancelled":
                window = await load_window(connection, window_id, lock=True)
                signer = User.from_row(await connection.fetchrow("SELECT * FROM users WHERE id = $1", signer_id))
                assert window is not None
                await record_signature(desk, connection, window, signer)
            await connection.execute("DELETE FROM meta WHERE key = 'seed_history'")
