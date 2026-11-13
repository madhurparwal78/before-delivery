"""Desk and enquiry writes: drafts, edits, publication, ordinals, windows,
preview links, enquiries, sessions."""

from __future__ import annotations

import datetime as dt
import secrets

import core

from queries import (REF_COLUMNS, _fetchall, _fetchone, figures_of,
                     ensure_run, _live_order_sql, _has_hostile_chars)

def finnish_order_key(title: str, slug: str):
    return core.finnish_key(title, slug)


# ------------------------------------------------------------- sessions

def create_session(conn, account_id: int, now: dt.datetime) -> str:
    token = secrets.token_urlsafe(32)
    with conn.cursor() as cur:
        cur.execute("INSERT INTO session (token, account_id, expires_at) "
                    "VALUES (%s, %s, %s)",
                    (token, account_id, now + dt.timedelta(seconds=core.SESSION_SECONDS)))
    return token


def account_of_session(conn, token: str, now: dt.datetime) -> dict | None:
    """Authority is read from the stored account behind the token, never from
    anything copied at sign-in."""
    row = _fetchone(conn.cursor(),
        "SELECT a.id, a.email, a.role, a.programme_id, p.slug AS programme_slug, "
        "s.expires_at FROM session s JOIN account a ON a.id = s.account_id "
        "JOIN programme p ON p.id = a.programme_id WHERE s.token = %s",
        (token,))
    if row is None or row["expires_at"] is None or row["expires_at"] < now:
        return None
    return row


# ---------------------------------------------------------- desk reads

def desk_references(conn, programme_id: int, today: dt.date) -> list[dict]:
    """Live first by ordinal, then the rest in Finnish alphabetical order."""
    ensure_run(conn, programme_id, today)
    rows = _fetchall(conn.cursor(),
        f"SELECT {REF_COLUMNS} FROM reference_entry WHERE programme_id = %s",
        (programme_id,))
    with_state = []
    for row in rows:
        row = dict(row)
        row["state"] = core.state_of(row, today)
        row["figures"] = figures_of(conn, row["id"])
        with_state.append(row)
    live = sorted((r for r in with_state if r["state"] == core.LIVE),
                  key=lambda r: (r["ordinal"], r["id"]))
    rest = [r for r in with_state if r["state"] != core.LIVE]
    rest.sort(key=lambda r: finnish_order_key(r["title"], r["slug"]))
    return live + rest


def desk_reference(conn, programme_id: int, slug: str, today: dt.date,
                   for_update: bool = False) -> dict | None:
    if _has_hostile_chars(slug):
        return None
    suffix = " FOR UPDATE" if for_update else ""
    row = _fetchone(conn.cursor(),
        f"SELECT {REF_COLUMNS} FROM reference_entry "
        f"WHERE programme_id = %s AND slug = %s{suffix}", (programme_id, slug))
    if row is None:
        return None
    row = dict(row)
    row["state"] = core.state_of(row, today)
    row["figures"] = figures_of(conn, row["id"])
    return row


def desk_enquiries(conn, programme_id: int) -> list[dict]:
    return _fetchall(conn.cursor(),
        "SELECT id, email, phone, reference, created_at, agreed FROM enquiry "
        "WHERE programme_id = %s AND open ORDER BY created_at DESC, id DESC",
        (programme_id,))


def desk_totals(conn, programme_id: int, today: dt.date) -> dict:
    rows = desk_references(conn, programme_id, today)
    counts = {core.LIVE: 0, core.WITHHELD: 0, core.DRAFT: 0, core.RETIRED: 0}
    figure_count = 0
    for row in rows:
        counts[row["state"]] += 1
        figure_count += len(row["figures"])
    return {"live": counts[core.LIVE], "withheld": counts[core.WITHHELD],
            "drafts": counts[core.DRAFT], "retired": counts[core.RETIRED],
            "figures": figure_count}


# ---------------------------------------------------- figures comparison

def figures_equal(stored: list[dict], incoming: list[dict]) -> bool:
    if len(stored) != len(incoming):
        return False
    for a, b in zip(stored, incoming):
        if a["label"] != b["label"] or a["value"] != b["value"]:
            return False
    return True


def _write_figures(conn, reference_id: int, figures: list[dict]) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM figure WHERE reference_id = %s", (reference_id,))
        for position, fig in enumerate(figures, start=1):
            cur.execute("INSERT INTO figure (reference_id, label, value, position) "
                        "VALUES (%s, %s, %s, %s)",
                        (reference_id, fig["label"], fig["value"], position))


def _normalise_text(value):
    """A null-or-empty string is stored as null; other values pass through."""
    if value is None or value == "":
        return None
    return value


# ------------------------------------------------------------- create

def taken_slugs(conn, programme_id: int, exclude_reference_id: int | None = None
                ) -> set[str]:
    """Every current and earlier slug recorded for the programme."""
    slugs = {r["slug"] for r in _fetchall(conn.cursor(),
        "SELECT slug FROM reference_entry WHERE programme_id = %s",
        (programme_id,))}
    slugs |= {r["slug"] for r in _fetchall(conn.cursor(),
        "SELECT slug FROM slug_redirect WHERE programme_id = %s", (programme_id,))}
    return slugs


def own_earlier_slugs(conn, reference_id: int) -> set[str]:
    return {r["slug"] for r in _fetchall(conn.cursor(),
        "SELECT slug FROM slug_redirect WHERE reference_id = %s", (reference_id,))}


def create_reference(conn, programme_id: int, fields: dict, today: dt.date) -> dict:
    """A new reference is an unpublished draft with no ordinal and no window."""
    cur = conn.cursor()
    slug = core.slugify(fields["title"])
    taken = taken_slugs(conn, programme_id)
    base, recovered = core.slug_unique(slug, taken, set())
    cur.execute(
        "INSERT INTO reference_entry (programme_id, slug, sector, customer, "
        "title, summary, challenge, work, quote, quote_speaker, quote_role, "
        "title_fi, body_fi, published, version) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,FALSE,1) RETURNING id",
        (programme_id, base, fields["sector"], fields["customer"],
         fields["title"], fields["summary"], fields["challenge"],
         fields["work"], _normalise_text(fields.get("quote")),
         _normalise_text(fields.get("quote_speaker")),
         _normalise_text(fields.get("quote_role")),
         _normalise_text(fields.get("title_fi")),
         _normalise_text(fields.get("body_fi"))))
    reference_id = cur.fetchone()["id"]
    if fields.get("figures"):
        _write_figures(conn, reference_id, fields["figures"])
    return {"id": reference_id, "slug": base}


# --------------------------------------------------------------- edit

def edit_reference(conn, programme_id: int, reference: dict, fields: dict,
                   today: dt.date) -> dict:
    """Write only the editable fields. A change to the cleared content voids
    a recorded window in the same transaction.

    Values are compared after the empty-string rule: an empty string is the
    same as null, and figures compare by label and value in order.
    """
    cur = conn.cursor()
    reference_id = reference["id"]

    # The cleared content: figures, quote, quote speaker, quote role, customer.
    cleared_changed = False
    if "figures" in fields:
        cleared_changed = cleared_changed or not figures_equal(
            reference["figures"], fields["figures"])
    for key in ("quote", "quote_speaker", "quote_role", "customer"):
        if key in fields:
            old = reference[key]
            new = _normalise_text(fields[key])
            cleared_changed = cleared_changed or old != new

    something_written = cleared_changed

    if "title" in fields:
        new_slug = core.slugify(fields["title"])
        current_slug = reference["slug"]
        if new_slug != current_slug:
            taken = taken_slugs(conn, programme_id)
            own = own_earlier_slugs(conn, reference_id)
            new_slug, recovered = core.slug_unique(new_slug, taken, own,
                                                  current_slug)
            if recovered:
                cur.execute("DELETE FROM slug_redirect WHERE reference_id = %s "
                            "AND slug = %s", (reference_id, recovered))
            else:
                cur.execute("INSERT INTO slug_redirect (programme_id, slug, "
                            "reference_id) VALUES (%s, %s, %s)",
                            (programme_id, current_slug, reference_id))
            cur.execute("UPDATE reference_entry SET slug = %s WHERE id = %s",
                        (new_slug, reference_id))
        if fields["title"] != reference["title"]:
            cur.execute("UPDATE reference_entry SET title = %s WHERE id = %s",
                        (fields["title"], reference_id))
            something_written = True
    for key in ("summary", "challenge", "work", "sector", "customer"):
        if key in fields and fields[key] != reference[key]:
            cur.execute(f"UPDATE reference_entry SET {key} = %s WHERE id = %s",
                        (fields[key], reference_id))
            something_written = True
    for key in ("quote", "quote_speaker", "quote_role", "title_fi", "body_fi"):
        if key in fields:
            new = _normalise_text(fields[key])
            if new != reference[key]:
                cur.execute(f"UPDATE reference_entry SET {key} = %s WHERE id = %s",
                            (new, reference_id))
                something_written = True
    if "figures" in fields and not figures_equal(reference["figures"],
                                                 fields["figures"]):
        _write_figures(conn, reference_id, fields["figures"])

    voided = False
    if cleared_changed and (reference["clearance_from"] is not None
                            or reference["clearance_until"] is not None):
        cur.execute("UPDATE reference_entry SET clearance_from = NULL, "
                    "clearance_until = NULL, ordinal = NULL WHERE id = %s",
                    (reference_id,))
        voided = True
        _close_gaps(conn, programme_id, today)

    if something_written or voided:
        cur.execute("UPDATE reference_entry SET version = version + 1 "
                    "WHERE id = %s", (reference_id,))

    row = _fetchone(cur, "SELECT slug, version FROM reference_entry WHERE id = %s",
                    (reference_id,))
    return {"slug": row["slug"], "version": row["version"],
            "clearance_voided": voided}


# ------------------------------------------------------------ clearance

def record_clearance(conn, programme_id: int, reference: dict,
                     start: dt.date, until: dt.date, today: dt.date) -> dict:
    """A steward records a window. Narrowing withdraws a live reference at
    once; widening returns a withheld reference at the end of the run."""
    cur = conn.cursor()
    reference_id = reference["id"]
    was_live = core.state_of(reference, today) == core.LIVE
    cur.execute("UPDATE reference_entry SET clearance_from = %s, "
                "clearance_until = %s, version = version + 1 WHERE id = %s",
                (start, until, reference_id))
    live_now = core.window_contains(today, {"clearance_from": start,
                                             "clearance_until": until})
    if was_live and not live_now:
        cur.execute("UPDATE reference_entry SET ordinal = NULL WHERE id = %s",
                    (reference_id,))
        _close_gaps(conn, programme_id, today)
    elif not was_live and live_now and reference["published"]:
        _append_live(conn, programme_id, reference_id, today)
    row = _fetchone(cur, "SELECT slug, ordinal FROM reference_entry WHERE id = %s",
                    (reference_id,))
    return {"slug": row["slug"], "clearance_from": start.isoformat(),
            "clearance_until": until.isoformat(),
            "live": live_now and reference["published"]}


def _close_gaps(conn, programme_id: int, today: dt.date) -> None:
    rows = _fetchall(conn.cursor(), _live_order_sql(today),
                     (programme_id, today, today))
    for index, row in enumerate(rows, start=1):
        conn.cursor().execute("UPDATE reference_entry SET ordinal = %s WHERE id = %s",
                              (index, row["id"]))


def _append_live(conn, programme_id: int, reference_id: int, today: dt.date) -> None:
    rows = _fetchall(conn.cursor(), _live_order_sql(today),
                     (programme_id, today, today))
    position = len(rows) + 1 if all(r["id"] != reference_id for r in rows) else len(rows)
    conn.cursor().execute("UPDATE reference_entry SET ordinal = %s WHERE id = %s",
                          (position, reference_id))


# ------------------------------------------------------ publish and retire

def publish(conn, programme_id: int, reference: dict, today: dt.date) -> dict:
    """Publishing appends the reference at the end of the run, or makes it
    withheld when its window starts in the future. Any preview link minted
    for it is retired."""
    cur = conn.cursor()
    reference_id = reference["id"]
    live_now = core.window_contains(today, reference)
    cur.execute("UPDATE reference_entry SET published = TRUE, retired_at = NULL, "
                "version = version + 1 WHERE id = %s", (reference_id,))
    cur.execute("UPDATE preview_link SET retired = TRUE WHERE reference_id = %s",
                (reference_id,))
    ordinal = None
    if live_now:
        _append_live(conn, programme_id, reference_id, today)
        row = _fetchone(cur, "SELECT ordinal FROM reference_entry WHERE id = %s",
                       (reference_id,))
        ordinal = row["ordinal"]
    return {"slug": reference["slug"], "ordinal": ordinal}


def retire(conn, programme_id: int, reference: dict, now: dt.datetime,
           today: dt.date) -> dict:
    cur = conn.cursor()
    reference_id = reference["id"]
    cur.execute("UPDATE reference_entry SET retired_at = %s, ordinal = NULL, "
                "version = version + 1 WHERE id = %s", (now, reference_id))
    cur.execute("UPDATE preview_link SET retired = TRUE WHERE reference_id = %s",
                (reference_id,))
    _close_gaps(conn, programme_id, today)
    return {"slug": reference["slug"]}


def move_reference(conn, programme_id: int, reference: dict,
                   target: int, today: dt.date) -> list[dict]:
    """Place one live reference at the requested ordinal and shift the rest.
    An ordinal past the end places it last."""
    cur = conn.cursor()
    rows = _fetchall(cur, _live_order_sql(today), (programme_id, today, today))
    by_id = {r["id"]: r for r in rows}
    order = [r["id"] for r in rows]
    order.remove(reference["id"])
    target = min(max(target, 1), len(order) + 1)
    order.insert(target - 1, reference["id"])
    for index, ref_id in enumerate(order, start=1):
        cur.execute("UPDATE reference_entry SET ordinal = %s WHERE id = %s",
                    (index, ref_id))
    return [{"slug": by_id[ref_id]["slug"], "ordinal": i}
            for i, ref_id in enumerate(order, start=1)]


# --------------------------------------------------------- preview links

def mint_preview(conn, reference_id: int, expires_at: dt.datetime,
                 now: dt.datetime) -> dict:
    """A new link retires every earlier link for the reference."""
    cur = conn.cursor()
    cur.execute("UPDATE preview_link SET retired = TRUE WHERE reference_id = %s",
                (reference_id,))
    token = secrets.token_urlsafe(32)
    cur.execute("INSERT INTO preview_link (token, reference_id, expires_at, retired) "
                "VALUES (%s, %s, %s, FALSE)", (token, reference_id, expires_at))
    return {"token": token, "expires_at": expires_at}


def valid_preview(conn, reference: dict, token: str, now: dt.datetime) -> bool:
    """A link opens exactly its own unpublished reference."""
    if not isinstance(token, str) or not token:
        return False
    row = _fetchone(conn.cursor(),
        "SELECT reference_id, expires_at, retired FROM preview_link "
        "WHERE token = %s", (token,))
    if row is None or row["retired"]:
        return False
    if row["reference_id"] != reference["id"]:
        return False
    return row["expires_at"] >= now


# ------------------------------------------------------------ enquiries

def open_enquiry_of(conn, programme_id: int, email: str) -> dict | None:
    normalised = email.strip().lower()
    return _fetchone(conn.cursor(),
        "SELECT id, created_at FROM enquiry WHERE programme_id = %s AND open "
        "AND lower(email) = %s ORDER BY created_at ASC, id ASC LIMIT 1",
        (programme_id, normalised))


def record_enquiry(conn, programme_id: int, email: str, phone, reference,
                   agreed: bool, now: dt.datetime) -> dict:
    """A repeat from an address with an open enquiry joins it and keeps its
    first arrival time. Simultaneous repeats leave exactly one row."""
    cur = conn.cursor()
    normalised = email.strip().lower()
    # One advisory lock per programme and normalised address, so two arrivals
    # from one address never both write a row.
    cur.execute("SELECT pg_advisory_xact_lock(%s, hashtext(%s))",
                (programme_id, normalised))
    existing = open_enquiry_of(conn, programme_id, email)
    if existing is not None:
        return {"id": existing["id"], "joined": True}
    cur.execute("INSERT INTO enquiry (programme_id, email, phone, reference, "
                "created_at, agreed, open) VALUES (%s,%s,%s,%s,%s,%s,TRUE) "
                "RETURNING id",
                (programme_id, email.strip(), phone, reference, now, agreed))
    return {"id": cur.fetchone()["id"], "joined": False}


def delete_enquiry(conn, programme_id: int, enquiry_id: int,
                  check_only: bool = False) -> bool | None:
    """Deleting closes it: it leaves the queue and a later delete answers 404.

    With check_only the existence is reported without writing, so a role
    that may not act is refused without changing anything.
    """
    cur = conn.cursor()
    if check_only:
        row = _fetchone(cur,
            "SELECT id FROM enquiry WHERE id = %s AND programme_id = %s "
            "AND open", (enquiry_id, programme_id))
        return row is not None
    cur.execute("UPDATE enquiry SET open = FALSE WHERE id = %s AND programme_id = %s "
                "AND open RETURNING id", (enquiry_id, programme_id))
    return cur.fetchone() is not None
