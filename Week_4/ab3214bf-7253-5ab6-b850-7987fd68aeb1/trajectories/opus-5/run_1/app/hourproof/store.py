"""Reading and writing the desk's records."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable

from . import clock
from .db import Cursor
from .domain.model import (
    REJECTED,
    Bundle,
    Hour,
    Line,
    Lot,
    Site,
    WindowRecord,
)

WINDOW_COLUMNS = """
    id, base_id, site_id, month, state, revision, opens_at, start_utc, end_utc,
    verifier_firm_id, submitted_at, returned_reason, frozen_target_grain,
    frozen_target_bp, frozen_opinion, registry_reachable, seal_status, predecessor_id, successor_id,
    last_writer_name, wrote_at
"""


def site_from_row(row: dict[str, Any]) -> Site:
    return Site(
        id=row["id"],
        name=row["name"],
        code=row["code"],
        zone=row["zone"],
        time_zone=row["time_zone"],
        meter_id=row["meter_id"],
        target_grain=row["target_grain"],
        target_bp=row["target_bp"],
    )


def load_site(cursor: Cursor, site_id: str) -> Site | None:
    row = cursor.one("SELECT * FROM sites WHERE id = %s", (site_id,))
    return site_from_row(row) if row else None


def load_sites(cursor: Cursor) -> list[Site]:
    rows = cursor.all("SELECT * FROM sites ORDER BY name")
    return [site_from_row(row) for row in rows]


def _window_from_row(row: dict[str, Any], site: Site) -> WindowRecord:
    return WindowRecord(
        id=row["id"],
        base_id=row["base_id"],
        site=site,
        month=row["month"],
        state=row["state"],
        revision=row["revision"],
        opens_at=row["opens_at"],
        start_utc=row["start_utc"],
        end_utc=row["end_utc"],
        verifier_firm_id=row["verifier_firm_id"],
        submitted_at=row["submitted_at"],
        returned_reason=row["returned_reason"],
        frozen_target_grain=row["frozen_target_grain"],
        frozen_target_bp=row["frozen_target_bp"],
        frozen_opinion=row["frozen_opinion"],
        registry_reachable=row["registry_reachable"],
        seal_status=row["seal_status"],
        predecessor_id=row["predecessor_id"],
        successor_id=row["successor_id"],
        last_writer_name=row["last_writer_name"],
        wrote_at=row["wrote_at"],
    )


def load_window(cursor: Cursor, window_id: str, lock: bool = False) -> WindowRecord | None:
    row = cursor.one(
        f"SELECT {WINDOW_COLUMNS} FROM windows WHERE id = %s"
        + (" FOR UPDATE" if lock else ""),
        (window_id,),
    )
    if row is None:
        return None
    site = load_site(cursor, row["site_id"])
    assert site is not None
    window = _window_from_row(row, site)
    _attach_parts(cursor, [window])
    return window


def load_windows(cursor: Cursor, window_ids: Iterable[str] | None = None) -> list[WindowRecord]:
    """Windows in the published order: month newest first, site name, id descending."""
    sites = {site.id: site for site in load_sites(cursor)}
    if window_ids is None:
        rows = cursor.all(f"SELECT {WINDOW_COLUMNS} FROM windows")
    else:
        ids = list(window_ids)
        if not ids:
            return []
        rows = cursor.all(
            f"SELECT {WINDOW_COLUMNS} FROM windows WHERE id = ANY(%s)", (ids,)
        )
    windows = [_window_from_row(row, sites[row["site_id"]]) for row in rows]
    windows.sort(key=lambda window: window.id, reverse=True)
    windows.sort(key=lambda window: window.site.name)
    windows.sort(key=lambda window: window.month, reverse=True)
    _attach_parts(cursor, windows)
    return windows


def _attach_parts(cursor: Cursor, windows: list[WindowRecord]) -> None:
    if not windows:
        return
    ids = [window.id for window in windows]
    by_id = {window.id: window for window in windows}
    for row in cursor.all(
        "SELECT * FROM window_hours WHERE window_id = ANY(%s) ORDER BY hour_utc", (ids,)
    ):
        by_id[row["window_id"]].hours.append(
            Hour(
                hour_utc=row["hour_utc"],
                consumed_wh=row["consumed_wh"],
                quality=row["quality"],
                substitution_reason=row["substitution_reason"],
                correction_version=row["correction_version"],
            )
        )
    for row in cursor.all(
        "SELECT * FROM lots WHERE window_id = ANY(%s) ORDER BY rank, lot_id", (ids,)
    ):
        by_id[row["window_id"]].lots.append(
            Lot(
                lot_id=row["lot_id"],
                name=row["name"],
                technology=row["technology"],
                zone=row["zone"],
                rank=row["rank"],
                excluded=row["excluded"],
                battery_shifted=row["battery_shifted"],
                production_month=row["production_month"],
                cancel_by=row["cancel_by"],
            )
        )
    for row in cursor.all(
        "SELECT * FROM bundles WHERE window_id = ANY(%s) ORDER BY bundle_id", (ids,)
    ):
        by_id[row["window_id"]].bundles.append(
            Bundle(
                bundle_id=row["bundle_id"],
                lot_id=row["lot_id"],
                battery_shifted=row["battery_shifted"],
                production_hour=row["production_hour"],
                discharge_hour=row["discharge_hour"],
                range_start_wh=row["range_start_wh"],
                range_end_wh=row["range_end_wh"],
            )
        )
    for row in cursor.all(
        "SELECT * FROM lines WHERE window_id = ANY(%s) ORDER BY hour_utc, bundle_id", (ids,)
    ):
        by_id[row["window_id"]].lines.append(
            Line(
                line_id=row["line_id"],
                hour_utc=row["hour_utc"],
                lot_id=row["lot_id"],
                bundle_id=row["bundle_id"],
                range_start_wh=row["range_start_wh"],
                range_end_wh=row["range_end_wh"],
                wh=row["wh"],
                status=row["status"],
                reason=row["reason"],
            )
        )


def live_lines(window: WindowRecord) -> list[Line]:
    return [line for line in window.lines if line.status != REJECTED]


def bump_revision(cursor: Cursor, window: WindowRecord, writer_name: str | None) -> None:
    """Every analyst write and every state change raises the revision once."""
    window.revision += 1
    if writer_name is not None:
        window.last_writer_name = writer_name
    window.wrote_at = clock.now()
    cursor.execute(
        "UPDATE windows SET revision = %s, last_writer_name = %s, wrote_at = %s"
        " WHERE id = %s",
        (window.revision, window.last_writer_name, window.wrote_at, window.id),
    )


def set_state(cursor: Cursor, window: WindowRecord, state: str) -> None:
    window.state = state
    cursor.execute("UPDATE windows SET state = %s WHERE id = %s", (state, window.id))


def set_field(cursor: Cursor, window: WindowRecord, field: str, value: Any) -> None:
    setattr(window, field, value)
    cursor.execute(f"UPDATE windows SET {field} = %s WHERE id = %s", (value, window.id))


def write_hour(cursor: Cursor, window: WindowRecord, hour: Hour) -> None:
    cursor.execute(
        "UPDATE window_hours SET consumed_wh = %s, quality = %s,"
        " substitution_reason = %s, correction_version = %s"
        " WHERE window_id = %s AND hour_utc = %s",
        (
            hour.consumed_wh,
            hour.quality,
            hour.substitution_reason,
            hour.correction_version,
            window.id,
            hour.hour_utc,
        ),
    )
    for existing in window.hours:
        if existing.hour_utc == hour.hour_utc:
            existing.consumed_wh = hour.consumed_wh
            existing.quality = hour.quality
            existing.substitution_reason = hour.substitution_reason
            existing.correction_version = hour.correction_version


def insert_line(cursor: Cursor, window_id: str, line: Line) -> None:
    cursor.execute(
        "INSERT INTO lines (line_id, window_id, hour_utc, lot_id, bundle_id,"
        " range_start_wh, range_end_wh, wh, status, reason)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            line.line_id,
            window_id,
            line.hour_utc,
            line.lot_id,
            line.bundle_id,
            line.range_start_wh,
            line.range_end_wh,
            line.wh,
            line.status,
            line.reason,
        ),
    )


def delete_line(cursor: Cursor, line_id: str) -> None:
    cursor.execute("DELETE FROM lines WHERE line_id = %s", (line_id,))


def set_line_status(
    cursor: Cursor,
    line_id: str,
    status: str,
    reason: str | None = None,
    submitted_at: datetime | None = None,
    confirmed_at: datetime | None = None,
) -> None:
    cursor.execute(
        "UPDATE lines SET status = %s, reason = COALESCE(%s, reason),"
        " submitted_at = COALESCE(%s, submitted_at),"
        " confirmed_at = COALESCE(%s, confirmed_at) WHERE line_id = %s",
        (status, reason, submitted_at, confirmed_at, line_id),
    )


def movement(
    cursor: Cursor,
    kind: str,
    debit: str,
    credit: str,
    wh: int,
    window_id: str,
    lot_id: str | None = None,
    bundle_id: str | None = None,
    line_id: str | None = None,
) -> None:
    """One movement: an equal pair of entries, debit first."""
    number = cursor.value("SELECT nextval('movement_seq')")
    movement_id = f"mv-{int(number):012d}"
    at = clock.now()
    rows = [
        (movement_id, kind, debit, -wh, window_id, lot_id, bundle_id, line_id, at),
        (movement_id, kind, credit, wh, window_id, lot_id, bundle_id, line_id, at),
    ]
    cursor.many(
        "INSERT INTO ledger_entries (movement_id, kind, account, wh, window_id,"
        " lot_id, bundle_id, line_id, at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        rows,
    )


def account_balances(cursor: Cursor, window_id: str) -> dict[str, int]:
    rows = cursor.all(
        "SELECT account, SUM(wh) AS total FROM ledger_entries WHERE window_id = %s"
        " GROUP BY account",
        (window_id,),
    )
    return {row["account"]: int(row["total"]) for row in rows}


def bundle_loss_standing(cursor: Cursor, window_id: str) -> set[str]:
    rows = cursor.all(
        "SELECT bundle_id, SUM(wh) AS total FROM ledger_entries"
        " WHERE window_id = %s AND account = 'loss' GROUP BY bundle_id",
        (window_id,),
    )
    return {row["bundle_id"] for row in rows if int(row["total"]) > 0}


def stored_factors(cursor: Cursor, zone: str, hours: list[datetime]) -> dict[datetime, int]:
    if not hours:
        return {}
    rows = cursor.all(
        "SELECT hour_utc, factor_e4 FROM grid_factors WHERE zone = %s"
        " AND hour_utc >= %s AND hour_utc <= %s",
        (zone, min(hours), max(hours)),
    )
    return {row["hour_utc"]: int(row["factor_e4"]) for row in rows}


def save_factors(cursor: Cursor, zone: str, factors: dict[datetime, int]) -> None:
    cursor.many(
        "INSERT INTO grid_factors (zone, hour_utc, factor_e4) VALUES (%s, %s, %s)"
        " ON CONFLICT (zone, hour_utc) DO NOTHING",
        [(zone, hour_utc, value) for hour_utc, value in sorted(factors.items())],
    )


def sample_rows(cursor: Cursor, window_id: str) -> list[dict[str, Any]]:
    return cursor.all(
        "SELECT * FROM sample_hours WHERE window_id = %s ORDER BY draw_index",
        (window_id,),
    )


def clear_sample(cursor: Cursor, window_id: str) -> None:
    cursor.execute("DELETE FROM sample_hours WHERE window_id = %s", (window_id,))


def write_sample(
    cursor: Cursor, window_id: str, digest: str, hours: list[datetime]
) -> None:
    clear_sample(cursor, window_id)
    cursor.many(
        "INSERT INTO sample_hours (window_id, hour_utc, draw_index, allocation_digest)"
        " VALUES (%s, %s, %s, %s)",
        [(window_id, hour_utc, index, digest) for index, hour_utc in enumerate(hours)],
    )


def firm(cursor: Cursor, firm_id: str | None) -> dict[str, Any] | None:
    if firm_id is None:
        return None
    return cursor.one("SELECT id, name FROM firms WHERE id = %s", (firm_id,))


def key_in_force(cursor: Cursor, firm_id: str) -> dict[str, Any]:
    row = cursor.one(
        "SELECT * FROM firm_keys WHERE firm_id = %s ORDER BY created_at DESC, key_id DESC"
        " LIMIT 1",
        (firm_id,),
    )
    assert row is not None
    return row


def signature_for(cursor: Cursor, window_id: str) -> dict[str, Any] | None:
    return cursor.one("SELECT * FROM signatures WHERE window_id = %s", (window_id,))


def signature_by_code(cursor: Cursor, code: str) -> dict[str, Any] | None:
    return cursor.one("SELECT * FROM signatures WHERE statement_code = %s", (code,))
