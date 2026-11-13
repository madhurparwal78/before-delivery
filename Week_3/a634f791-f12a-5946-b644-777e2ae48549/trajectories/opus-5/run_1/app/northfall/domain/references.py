"""The live set, the reference state, the ordinal run and its rollover.

Each of these rules is decided here and nowhere else, so the public pages, the
Finnish mirror, the read API and the desk all agree.
"""

from __future__ import annotations

import datetime as dt

from .slugs import finnish_key

COLUMNS = """id, programme_id, slug, ordinal, sector, customer, title, summary,
             challenge, work, title_fi, body_fi, published, retired_at, version,
             clearance_from, clearance_until, quote, quote_speaker, quote_role"""

DRAFT, LIVE, WITHHELD, RETIRED = "draft", "live", "withheld", "retired"


def window_contains(row, today: dt.date) -> bool:
    start, end = row["clearance_from"], row["clearance_until"]
    return start is not None and end is not None and start <= today <= end


def state_of(row, today: dt.date) -> str:
    if row["retired_at"] is not None:
        return RETIRED
    if not row["published"]:
        return DRAFT
    return LIVE if window_contains(row, today) else WITHHELD


def is_live(row, today: dt.date) -> bool:
    return state_of(row, today) == LIVE


def programme_id_for(conn, slug: str) -> int:
    row = conn.execute("SELECT id FROM programme WHERE slug = %s", (slug,)).fetchone()
    return int(row["id"])


def _all_of(conn, programme_id: int):
    return conn.execute(
        f"SELECT {COLUMNS} FROM reference_entry WHERE programme_id = %s ORDER BY id",
        (programme_id,),
    ).fetchall()


def renumber(conn, programme_id: int, today: dt.date) -> None:
    """Make the stored run the live set, numbered from one with no gap.

    Those already in the run keep their relative order; those joining are added
    at the end by clearance start and then by slug.
    """
    rows = _all_of(conn, programme_id)
    live = [row for row in rows if is_live(row, today)]
    standing = sorted((r for r in live if r["ordinal"] is not None), key=lambda r: r["ordinal"])
    joining = sorted(
        (r for r in live if r["ordinal"] is None),
        key=lambda r: (r["clearance_from"], r["slug"]),
    )
    _write_run(conn, rows, [r["id"] for r in standing + joining])


def _write_run(conn, rows, ordered_ids: list[int]) -> None:
    wanted = {ref_id: index + 1 for index, ref_id in enumerate(ordered_ids)}
    for row in rows:
        target = wanted.get(row["id"])
        if row["ordinal"] != target:
            conn.execute(
                "UPDATE reference_entry SET ordinal = %s WHERE id = %s", (target, row["id"])
            )


def place(conn, programme_id: int, today: dt.date, reference_id: int, ordinal: int) -> list[dict]:
    """Put one live reference at the requested ordinal and shift the others."""
    rows = _all_of(conn, programme_id)
    live = sorted(
        (r for r in rows if is_live(r, today) and r["ordinal"] is not None),
        key=lambda r: r["ordinal"],
    )
    order = [r["id"] for r in live]
    order.remove(reference_id)
    target = min(ordinal, len(order) + 1)
    order.insert(target - 1, reference_id)
    _write_run(conn, rows, order)
    by_id = {r["id"]: r for r in live}
    return [{"slug": by_id[ref_id]["slug"], "ordinal": index + 1} for index, ref_id in enumerate(order)]


def ensure_run(conn, today: dt.date) -> None:
    """Catch up the stored run of every programme when the Helsinki date moves."""
    row = conn.execute("SELECT last_rollover_date FROM service_clock WHERE id = 1").fetchone()
    if row["last_rollover_date"] == today:
        return
    from ..db import take_write_lock

    take_write_lock(conn)
    row = conn.execute("SELECT last_rollover_date FROM service_clock WHERE id = 1").fetchone()
    if row["last_rollover_date"] == today:
        return
    for prog in conn.execute("SELECT id FROM programme ORDER BY id").fetchall():
        renumber(conn, int(prog["id"]), today)
    conn.execute("UPDATE service_clock SET last_rollover_date = %s WHERE id = 1", (today,))


def live_set(conn, programme_id: int, today: dt.date, sector: str | None = None) -> list[dict]:
    rows = [r for r in _all_of(conn, programme_id) if is_live(r, today)]
    if sector is not None:
        rows = [r for r in rows if r["sector"] == sector]
    return sorted(rows, key=lambda r: r["ordinal"])


def live_sectors(conn, programme_id: int, today: dt.date) -> list[str]:
    return sorted({row["sector"] for row in live_set(conn, programme_id, today)})


def by_slug(conn, programme_id: int, slug: str) -> dict | None:
    return conn.execute(
        f"SELECT {COLUMNS} FROM reference_entry WHERE programme_id = %s AND slug = %s",
        (programme_id, slug),
    ).fetchone()


def by_id(conn, reference_id: int) -> dict | None:
    return conn.execute(
        f"SELECT {COLUMNS} FROM reference_entry WHERE id = %s", (reference_id,)
    ).fetchone()


def live_by_slug(conn, programme_id: int, today: dt.date, slug: str) -> dict | None:
    row = by_slug(conn, programme_id, slug)
    return row if row is not None and is_live(row, today) else None


def current_slug_for_earlier(conn, programme_id: int, today: dt.date, slug: str) -> str | None:
    """The address an earlier slug of a live reference redirects to."""
    row = conn.execute(
        "SELECT reference_id FROM slug_redirect WHERE programme_id = %s AND slug = %s",
        (programme_id, slug),
    ).fetchone()
    if row is None:
        return None
    target = by_id(conn, int(row["reference_id"]))
    if target is None or not is_live(target, today):
        return None
    return target["slug"]


def figures_of(conn, reference_id: int) -> list[dict]:
    return [
        {"label": row["label"], "value": row["value"]}
        for row in conn.execute(
            "SELECT label, value FROM figure WHERE reference_id = %s ORDER BY position",
            (reference_id,),
        )
    ]


def quote_of(row) -> dict | None:
    if row["quote"] is None:
        return None
    return {
        "text": row["quote"],
        "speaker": row["quote_speaker"],
        "role": row["quote_role"],
    }


def desk_order(rows: list[dict], today: dt.date) -> list[dict]:
    """Live first by ordinal, then the rest in Finnish alphabetical order."""
    live = sorted(
        (r for r in rows if is_live(r, today)), key=lambda r: r["ordinal"]
    )
    rest = sorted(
        (r for r in rows if not is_live(r, today)),
        key=lambda r: (finnish_key(r["title"]), r["slug"]),
    )
    return live + rest


def bump_version(conn, reference_id: int) -> int:
    row = conn.execute(
        "UPDATE reference_entry SET version = version + 1 WHERE id = %s RETURNING version",
        (reference_id,),
    ).fetchone()
    return int(row["version"])
