"""The invented seed data, applied once against an empty database."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Callable

from . import clock, db, engine, passwords, signing, store
from .db import Cursor
from .domain import lots as lot_rules, states, timeline
from .domain.model import ACTUAL, CONFIRMED, ESTIMATED, MISSING, Site, WindowRecord
from .domain.sample import draw
from .domain.timeline import LocalHour
from .store import live_lines

PASSWORD = "hourproof-demo-1"

FIRMS = [("aldermoor", "Aldermoor Assurance"), ("brightlock", "Brightlock Prüfung & Söhne")]

USERS = [
    ("anouk", "anouk@verhoeven.example", "Anouk Visser", "analyst", None),
    ("joris", "joris@verhoeven.example", "Joris Bakker", "analyst", None),
    ("mirthe", "mirthe@verhoeven.example", "Mirthe Claes", "lead", None),
    ("vera", "vera@aldermoor.example", "Vera Lindqvist", "verifier", "aldermoor"),
    ("bram", "bram@brightlock.example", "Bram Okafor", "verifier", "brightlock"),
]

SITES = [
    Site("rtm", "Rotterdam Press Works", "RTM", "NL", "Europe/Amsterdam", "NL-RTM-01", "HOUR", 8000),
    Site("ein", "Eindhoven Casting Hall", "EIN", "NL", "Europe/Amsterdam", "NL-EIN-01", "MONTH", 9000),
    Site("tpe", "Tampere Foundry", "TPE", "FI", "Europe/Helsinki", "FI-TPE-01", "DAY", 5000),
    Site("vnl", "Venlo Coil Shop", "VNL", "NL", "Europe/Amsterdam", "NL-VNL-01", "HOUR", 5000),
]

SOLAR_QUANTITIES = [
    (range(1, 5), 8000000),
    (range(5, 12), 2000000),
    (range(12, 17), 6000000),
    (range(17, 19), 1000000),
    (range(19, 26), 2000000),
    (range(26, 32), 3000000),
]


def apply_seed() -> bool:
    """Seed an empty database; answers whether this call did the seeding."""
    with db.tx() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(8571)")
        if cursor.value("SELECT value FROM meta WHERE key = 'seeded'"):
            return False
        _seed(cursor)
        cursor.execute("INSERT INTO meta (key, value) VALUES ('seeded', %s)",
                       (clock.instant(clock.now()),))
    return True


def _seed(cursor: Cursor) -> None:
    now = clock.now()
    for firm_id, name in FIRMS:
        cursor.execute("INSERT INTO firms (id, name) VALUES (%s, %s)", (firm_id, name))
        private_raw, public_raw = signing.generate()
        cursor.execute(
            "INSERT INTO firm_keys (key_id, firm_id, private_key, public_key, created_at)"
            " VALUES (%s, %s, %s, %s, %s)",
            (signing.key_id(public_raw), firm_id, private_raw, public_raw, now),
        )
    stored_password = passwords.hash_password(PASSWORD)
    for user_id, email, name, role, firm_id in USERS:
        cursor.execute(
            "INSERT INTO users (id, email, name, role, firm_id, password_hash)"
            " VALUES (%s, %s, %s, %s, %s, %s)",
            (user_id, email, name, role, firm_id, stored_password),
        )
    for site in SITES:
        cursor.execute(
            "INSERT INTO sites (id, name, code, zone, time_zone, meter_id, target_grain,"
            " target_bp) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (
                site.id,
                site.name,
                site.code,
                site.zone,
                site.time_zone,
                site.meter_id,
                site.target_grain,
                site.target_bp,
            ),
        )
    sites = {site.id: site for site in SITES}
    _seed_rtm_october(cursor, sites["rtm"])
    _seed_eindhoven(cursor, sites["ein"])
    _seed_tampere(cursor, sites["tpe"])
    _seed_venlo(cursor, sites["vnl"])
    _seed_rtm_november(cursor, sites["rtm"])
    _seed_rtm_march(cursor, sites["rtm"])


# ---------------------------------------------------------------- window building


def _create_window(
    cursor: Cursor,
    window_id: str,
    site: Site,
    month: str,
    firm_id: str | None,
) -> WindowRecord:
    start_utc, end_utc = timeline.month_bounds(month, site.time_zone)
    cursor.execute(
        "INSERT INTO windows (id, base_id, site_id, month, state, revision, opens_at,"
        " start_utc, end_utc, verifier_firm_id, registry_reachable, created_at)"
        " VALUES (%s, %s, %s, %s, %s, 1, %s, %s, %s, %s, true, %s)",
        (
            window_id,
            window_id,
            site.id,
            month,
            states.RECONCILING,
            timeline.opens_at(end_utc),
            start_utc,
            end_utc,
            firm_id,
            clock.now(),
        ),
    )
    window = store.load_window(cursor, window_id)
    assert window is not None
    return window


def _write_hours(
    cursor: Cursor,
    window: WindowRecord,
    value_for: Callable[[datetime, LocalHour], int | None],
) -> None:
    rows = []
    for hour_utc in timeline.hours_between(window.start_utc, window.end_utc):
        local = timeline.local_hour(hour_utc, window.site.time_zone)
        value = value_for(hour_utc, local)
        quality = MISSING if value is None else ACTUAL
        rows.append((window.id, hour_utc, value, quality))
    cursor.many(
        "INSERT INTO window_hours (window_id, hour_utc, consumed_wh, quality)"
        " VALUES (%s, %s, %s, %s)",
        rows,
    )


def _mark_estimated(cursor: Cursor, window: WindowRecord, dates: set[str]) -> None:
    cursor.execute(
        "UPDATE window_hours SET quality = %s WHERE window_id = %s AND hour_utc = ANY(%s)",
        (
            ESTIMATED,
            window.id,
            [
                hour_utc
                for hour_utc in timeline.hours_between(window.start_utc, window.end_utc)
                if timeline.local_hour(hour_utc, window.site.time_zone).date in dates
            ],
        ),
    )


def _add_lot(
    cursor: Cursor,
    window: WindowRecord,
    lot_id: str,
    name: str,
    technology: str,
    zone: str,
    rank: int,
    battery_shifted: bool = False,
    production_month: str | None = None,
) -> None:
    month = production_month or window.month
    cursor.execute(
        "INSERT INTO lots (window_id, lot_id, name, technology, zone, rank, excluded,"
        " battery_shifted, production_month, cancel_by)"
        " VALUES (%s, %s, %s, %s, %s, %s, false, %s, %s, %s)",
        (
            window.id,
            lot_id,
            name,
            technology,
            zone,
            rank,
            battery_shifted,
            month,
            lot_rules.cancel_by(month),
        ),
    )


def _add_bundle(
    cursor: Cursor,
    window: WindowRecord,
    lot_id: str,
    gross_wh: int,
    production_hour: datetime,
    discharge_hour: datetime | None = None,
    suffix: str = "",
    range_start_wh: int = 0,
) -> None:
    bundle_id = f"{lot_id}-{production_hour.strftime('%Y%m%d%H')}{suffix}"
    cursor.execute(
        "INSERT INTO bundles (window_id, bundle_id, lot_id, battery_shifted,"
        " production_hour, discharge_hour, range_start_wh, range_end_wh)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (
            window.id,
            bundle_id,
            lot_id,
            discharge_hour is not None,
            production_hour,
            discharge_hour,
            range_start_wh,
            range_start_wh + gross_wh,
        ),
    )
    cursor.execute(
        "INSERT INTO bundle_claims (bundle_id, base_id, window_id) VALUES (%s, %s, %s)"
        " ON CONFLICT (bundle_id) DO NOTHING",
        (bundle_id, window.base_id, window.id),
    )


def _local_hours(
    window: WindowRecord, days: set[int] | None, clocks: set[int]
) -> list[tuple[datetime, LocalHour]]:
    """Every window hour whose local date and clock hour are wanted, repeats included."""
    found = []
    for hour_utc in timeline.hours_between(window.start_utc, window.end_utc):
        local = timeline.local_hour(hour_utc, window.site.time_zone)
        day = int(local.date[8:10])
        if days is not None and day not in days:
            continue
        if int(local.clock[0:2]) not in clocks:
            continue
        found.append((hour_utc, local))
    return found


def _deposit_bundles(cursor: Cursor, window: WindowRecord) -> None:
    for bundle in store.load_window(cursor, window.id).bundles:  # type: ignore[union-attr]
        store.movement(
            cursor,
            "deposit",
            "registry",
            "holdings",
            bundle.gross_wh,
            window.id,
            bundle.lot_id,
            bundle.bundle_id,
        )


def _reload(cursor: Cursor, window_id: str) -> WindowRecord:
    window = store.load_window(cursor, window_id)
    assert window is not None
    return window


def _finish(
    cursor: Cursor, window_id: str, as_of: datetime | None = None
) -> WindowRecord:
    """Deposit the holdings, run allocation and hand back the loaded window."""
    window = _reload(cursor, window_id)
    _deposit_bundles(cursor, window)
    engine.recompute(cursor, window, as_of=as_of)
    return _reload(cursor, window_id)


def _draw_sample(cursor: Cursor, window: WindowRecord, result: str | None) -> None:
    from .domain.allocation import digest

    digest_text = digest(live_lines(window))
    hours = [
        hour.hour_utc
        for hour in sorted(window.hours, key=lambda hour: hour.hour_utc)
        if (hour.consumed_wh or 0) > 0
    ]
    drawn = draw(window.id, digest_text, hours)
    store.write_sample(cursor, window.id, digest_text, drawn)
    if result is not None:
        cursor.execute(
            "UPDATE sample_hours SET result = %s WHERE window_id = %s",
            (result, window.id),
        )


def _confirm_every_line(cursor: Cursor, window: WindowRecord) -> None:
    for line in live_lines(window):
        store.set_line_status(
            cursor,
            line.line_id,
            CONFIRMED,
            submitted_at=clock.now(),
            confirmed_at=clock.now(),
        )
        store.movement(
            cursor,
            "cancel",
            "allocated",
            "cancelled",
            line.wh,
            window.id,
            line.lot_id,
            line.bundle_id,
            line.line_id,
        )


# ---------------------------------------------------------------- the nine windows


def _seed_rtm_october(cursor: Cursor, site: Site) -> None:
    missing = {
        ("2026-10-13", "05:00"),
        ("2026-10-13", "06:00"),
        ("2026-10-20", "04:00"),
        ("2026-10-20", "05:00"),
        ("2026-10-20", "06:00"),
        ("2026-10-20", "10:00"),
        ("2026-10-20", "11:00"),
        ("2026-10-20", "12:00"),
        ("2026-10-20", "13:00"),
        ("2026-10-20", "14:00"),
    }
    window = _create_window(cursor, "rtm-2026-10", site, "2026-10", "aldermoor")

    def consumption(hour_utc: datetime, local: LocalHour) -> int | None:
        if (local.date, local.clock) in missing:
            return None
        return 1200000 if 6 <= int(local.clock[0:2]) <= 21 else 800000

    _write_hours(cursor, window, consumption)
    _add_lot(cursor, window, "lot-rtm-solar-2026-10", "Maasvlakte Solar", "solar", "NL", 1)
    _add_lot(cursor, window, "lot-rtm-wind-2026-10", "Noordzee Wind", "wind", "NL", 2)
    _add_lot(
        cursor, window, "lot-rtm-battery-2026-10", "Zeeland Battery", "solar", "NL", 3,
        battery_shifted=True,
    )
    _add_lot(cursor, window, "lot-rtm-hydro-2026-10", "Ardennes Hydro", "hydro", "BE", 4)
    for hour_utc, local in _local_hours(window, None, {9, 10, 11, 12, 13, 14}):
        day = int(local.date[8:10])
        quantity = next(
            amount for days, amount in SOLAR_QUANTITIES if day in days
        )
        _add_bundle(cursor, window, "lot-rtm-solar-2026-10", quantity, hour_utc)
    for hour_utc, _ in _local_hours(window, None, {0, 1, 2, 3}):
        _add_bundle(cursor, window, "lot-rtm-wind-2026-10", 500000, hour_utc)
    for hour_utc, _ in _local_hours(window, set(range(5, 12)), {9}):
        _add_bundle(cursor, window, "lot-rtm-wind-2026-10", 1000000, hour_utc, suffix="-b")
    for hour_utc, _ in _local_hours(window, None, {19}):
        _add_bundle(
            cursor,
            window,
            "lot-rtm-battery-2026-10",
            1000001,
            hour_utc - timedelta(hours=6),
            discharge_hour=hour_utc,
        )
    for hour_utc, _ in _local_hours(window, None, {20}):
        _add_bundle(cursor, window, "lot-rtm-hydro-2026-10", 1000000, hour_utc)
    _finish(cursor, window.id)


def _seed_eindhoven(cursor: Cursor, site: Site) -> None:
    for month, firm, lot_name in [
        ("2026-10", "aldermoor", "Brabant Wind October"),
        ("2026-09", "aldermoor", "Brabant Wind September"),
        ("2026-08", "aldermoor", "Brabant Wind August"),
    ]:
        window_id = f"ein-{month}"
        window = _create_window(cursor, window_id, site, month, firm)
        _write_hours(cursor, window, lambda hour_utc, local: 1000000)
        if month == "2026-10":
            _mark_estimated(
                cursor,
                window,
                {"2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"},
            )
        lot_id = f"lot-ein-wind-{month}"
        _add_lot(cursor, window, lot_id, lot_name, "wind", "NL", 1)
        for hour_utc in timeline.hours_between(window.start_utc, window.end_utc):
            _add_bundle(cursor, window, lot_id, 900000, hour_utc)
        window = _finish(cursor, window_id)
        if month == "2026-09":
            store.set_state(cursor, window, states.IN_REVIEW)
            store.set_field(cursor, window, "submitted_at", clock.now())
            _draw_sample(cursor, window, None)
        if month == "2026-08":
            store.set_field(cursor, window, "submitted_at", clock.now())
            _draw_sample(cursor, window, "agree")
            _confirm_every_line(cursor, window)
            store.set_state(cursor, _reload(cursor, window_id), states.CANCELLED)


def _seed_tampere(cursor: Cursor, site: Site) -> None:
    october = _create_window(cursor, "tpe-2026-10", site, "2026-10", "brightlock")
    _write_hours(cursor, october, lambda hour_utc, local: 1000000)
    _add_lot(cursor, october, "lot-tpe-wind-2026-10", "Pirkanmaa Wind", "wind", "FI", 1)
    odd_days = {day for day in range(1, 32) if day % 2 == 1}
    for hour_utc, _ in _local_hours(october, odd_days, {2, 3, 4, 5}):
        _add_bundle(cursor, october, "lot-tpe-wind-2026-10", 8000000, hour_utc)
    _finish(cursor, october.id)

    september = _create_window(cursor, "tpe-2026-09", site, "2026-09", "brightlock")
    _write_hours(cursor, september, lambda hour_utc, local: 1000000)
    _add_lot(
        cursor, september, "lot-tpe-wind-2026-09", "Pirkanmaa Wind September", "wind", "FI", 1
    )
    start = 9007199254740993
    for index in range(3):
        _add_bundle(
            cursor,
            september,
            "lot-tpe-wind-2026-09",
            500000,
            clock.parse_instant(f"2026-09-10T0{index}:00:00Z"),
            range_start_wh=start + index * 500000,
        )
    window = _finish(cursor, september.id)
    store.set_field(cursor, window, "submitted_at", clock.now())
    _draw_sample(cursor, window, "agree")
    store.set_state(cursor, window, states.CANCELLING)


def _seed_venlo(cursor: Cursor, site: Site) -> None:
    missing = {
        ("2026-10-01", "00:00", False),
        ("2026-10-03", "08:00", False),
        ("2026-10-03", "09:00", False),
        ("2026-10-03", "10:00", False),
        ("2026-10-25", "02:00", True),
        ("2026-10-25", "03:00", False),
        ("2026-10-28", "08:00", False),
        ("2026-10-28", "09:00", False),
        ("2026-10-28", "10:00", False),
    }
    window = _create_window(cursor, "vnl-2026-10", site, "2026-10", None)

    def consumption(hour_utc: datetime, local: LocalHour) -> int | None:
        if (local.date, local.clock, local.again) in missing:
            return None
        day = int(local.date[8:10])
        value = 500000 + 1000 * day + 10 * int(local.clock[0:2])
        return value + 5 if local.again else value

    _write_hours(cursor, window, consumption)
    _finish(cursor, window.id)


def _seed_rtm_november(cursor: Cursor, site: Site) -> None:
    window = _create_window(cursor, "rtm-2026-11", site, "2026-11", "aldermoor")
    _write_hours(cursor, window, lambda hour_utc, local: None)
    store.set_state(cursor, window, states.AWAITING_METERS)
    _finish(cursor, window.id)


def _seed_rtm_march(cursor: Cursor, site: Site) -> None:
    window = _create_window(cursor, "rtm-2026-03", site, "2026-03", "aldermoor")
    _write_hours(cursor, window, lambda hour_utc, local: 1000000)
    _add_lot(
        cursor, window, "lot-rtm-solar-2026-03", "Maasvlakte Solar March", "solar", "NL", 1
    )
    for hour_utc, _ in _local_hours(window, None, {9, 10, 11, 12, 13, 14}):
        _add_bundle(cursor, window, "lot-rtm-solar-2026-03", 2000000, hour_utc)
    window = _finish(cursor, window.id, as_of=window.end_utc)
    store.set_field(cursor, window, "submitted_at", clock.now())
    _draw_sample(cursor, window, "agree")
    _confirm_every_line(cursor, window)
    window = _reload(cursor, window.id)
    store.set_state(cursor, window, states.CANCELLED)
    from .sealing import sign_window

    sign_window(cursor, window, "vera", "Vera Lindqvist")
