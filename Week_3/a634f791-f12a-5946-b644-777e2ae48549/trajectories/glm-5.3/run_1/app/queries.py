"""Every read and write of the store, and the domain rules they decide.

One place per rule: the live set, the ordinal run and its rollover, the
reference state, the clearance void, preview links, enquiries, sessions.
"""

from __future__ import annotations

import datetime as dt

REF_COLUMNS = ("id, programme_id, slug, ordinal, sector, customer, title, "
               "summary, challenge, work, title_fi, body_fi, published, "
               "retired_at, version, clearance_from, clearance_until, "
               "quote, quote_speaker, quote_role")


# --------------------------------------------------------------- helpers

def _fetchall(cur, sql, params=()):
    cur.execute(sql, params)
    return cur.fetchall()


def _fetchone(cur, sql, params=()):
    cur.execute(sql, params)
    return cur.fetchone()


def _has_hostile_chars(text) -> bool:
    """A slug holding NUL or a lone surrogate never reaches the store."""
    if not isinstance(text, str):
        return False
    if "\x00" in text:
        return True
    return any(0xD800 <= ord(ch) <= 0xDFFF for ch in text)


def _clean_sector(text: str) -> str:
    """The sector echo's rule: NUL characters and undecodable bytes are
    dropped from the value, so the same cleaned value filters the rows."""
    if not isinstance(text, str):
        return ""
    cleaned = text.replace("\x00", "")
    return "".join(ch for ch in cleaned if not 0xD800 <= ord(ch) <= 0xDFFF)


# --------------------------------------------------- rollover and the run

def _live_order_sql(today_param: dt.date):
    """Live rows of a programme by stored ordinal; a stored null ordinal is a
    bug guard that never occurs because the run is always rewritten before a
    request answers."""
    return ("SELECT {cols} FROM reference_entry WHERE programme_id = %s "
            "AND published AND retired_at IS NULL "
            "AND clearance_from IS NOT NULL AND clearance_until IS NOT NULL "
            "AND clearance_from <= %s AND clearance_until >= %s "
            "ORDER BY ordinal NULLS LAST, id").format(cols=REF_COLUMNS)


def rollover(conn, today: dt.date) -> None:
    """The first request after today changes updates the stored run.

    References leaving the live set are removed, those that stay keep their
    relative order and are renumbered from 1, and references joining are
    added at the end ordered by clearance_from then slug.
    """
    for programme_id in [row["id"] for row in _fetchall(
            conn.cursor(), "SELECT id FROM programme")]:
        _rollover_programme(conn, programme_id, today)


def _rollover_programme(conn, programme_id: int, today: dt.date) -> None:
    cur = conn.cursor()
    live_now = _fetchall(cur, _live_order_sql(today), (programme_id, today, today))
    # references that stay keep their relative order; references joining are
    # added at the end ordered by clearance_from then slug
    keep_ids = [r["id"] for r in live_now if r["ordinal"] is not None]
    joined_ids = [r["id"] for r in live_now if r["ordinal"] is None]
    if keep_ids:
        cur.execute(
            "UPDATE reference_entry SET ordinal = NULL "
            "WHERE programme_id = %s AND ordinal IS NOT NULL "
            "AND id <> ALL(%s)",
            (programme_id, keep_ids))
    else:
        cur.execute(
            "UPDATE reference_entry SET ordinal = NULL "
            "WHERE programme_id = %s AND ordinal IS NOT NULL", (programme_id,))
    final = keep_ids + joined_ids
    for index, ref_id in enumerate(final, start=1):
        cur.execute("UPDATE reference_entry SET ordinal = %s WHERE id = %s",
                    (index, ref_id))


def ensure_run(conn, programme_id: int, today: dt.date) -> None:
    """Guarantee the stored run matches the live set for this request.

    Decides the rollover by comparing the stored run against the live set:
    a mismatch means today changed since the last write.
    """
    cur = conn.cursor()
    live_now = _fetchall(cur, _live_order_sql(today), (programme_id, today, today))
    stored = [r for r in _fetchall(
        cur, "SELECT id, ordinal FROM reference_entry "
        "WHERE programme_id = %s AND ordinal IS NOT NULL ORDER BY ordinal",
        (programme_id,))]
    live_ids = [r["id"] for r in live_now]
    stored_ids = [r["id"] for r in stored]
    if live_ids == stored_ids and all(
            r["ordinal"] == i for i, r in enumerate(stored, start=1)):
        return
    _rollover_programme(conn, programme_id, today)


# ------------------------------------------------------------ public reads

def live_references(conn, programme_slug: str, today: dt.date,
                    sector: str | None = None) -> list[dict]:
    """The live set governs every public read; the stored run is made to
    match the live set whenever a request answers. A sector of None means no
    filter; any other value, including one whose hostile characters have
    been dropped to nothing, filters and matches no live reference."""
    programme_id = programme_id_of(conn, programme_slug)
    ensure_run(conn, programme_id, today)
    where = ""
    params: list = [programme_id, today, today]
    if sector is not None:
        cleaned = _clean_sector(sector)
        where = " AND sector = %s"
        params.append(cleaned)
    sql = ("SELECT {cols} FROM reference_entry WHERE programme_id = %s "
           "AND published AND retired_at IS NULL "
           "AND clearance_from IS NOT NULL AND clearance_until IS NOT NULL "
           "AND clearance_from <= %s AND clearance_until >= %s{where} "
           "ORDER BY ordinal NULLS LAST, id").format(
               cols=REF_COLUMNS, where=where)
    return _fetchall(conn.cursor(), sql, tuple(params))


def programme_id_of(conn, slug: str) -> int:
    row = _fetchone(conn.cursor(), "SELECT id FROM programme WHERE slug = %s", (slug,))
    return row["id"]


def reference_by_slug(conn, programme_id: int, slug: str) -> dict | None:
    if _has_hostile_chars(slug):
        return None
    return _fetchone(conn.cursor(),
        f"SELECT {REF_COLUMNS} FROM reference_entry "
        "WHERE programme_id = %s AND slug = %s", (programme_id, slug))


def redirect_target(conn, programme_id: int, slug: str) -> dict | None:
    """The current reference of an earlier slug, if it is live."""
    if _has_hostile_chars(slug):
        return None
    row = _fetchone(conn.cursor(),
        "SELECT r.id AS redirect_id, ref.slug AS current_slug, ref.published, "
        "ref.retired_at FROM slug_redirect r "
        "JOIN reference_entry ref ON ref.id = r.reference_id "
        "WHERE r.programme_id = %s AND r.slug = %s",
        (programme_id, slug))
    if row is None or not row["published"] or row["retired_at"] is not None:
        return None
    return row


def figures_of(conn, reference_id: int) -> list[dict]:
    return _fetchall(conn.cursor(),
        "SELECT label, value, position FROM figure WHERE reference_id = %s "
        "ORDER BY position", (reference_id,))


def live_sectors(conn, programme_slug: str, today: dt.date) -> list[str]:
    programme_id = programme_id_of(conn, programme_slug)
    ensure_run(conn, programme_id, today)
    rows = _fetchall(conn.cursor(),
        "SELECT DISTINCT sector FROM reference_entry WHERE programme_id = %s "
        "AND published AND retired_at IS NULL "
        "AND clearance_from <= %s AND clearance_until >= %s "
        "AND clearance_from IS NOT NULL AND clearance_until IS NOT NULL "
        "ORDER BY sector", (programme_id, today, today))
    return [r["sector"] for r in rows]


def notes(conn, programme_slug: str) -> list[dict]:
    programme_id = programme_id_of(conn, programme_slug)
    return _fetchall(conn.cursor(),
        "SELECT slug, title, preview, published_on FROM note "
        "WHERE programme_id = %s AND published_on IS NOT NULL "
        "ORDER BY published_on DESC", (programme_id,))
