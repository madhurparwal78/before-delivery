"""The append-only trail and its spreadsheet-safe export."""
from .. import timeutil
from ..db import rows, value
from . import guard

JOINED = (
    "select e.id, e.piece_id, p.title as piece_title, e.from_state, e.to_state,"
    " e.reason, e.created_at, ac.id as actor_id, ac.name as actor_name,"
    " ac.role as actor_role from audit_entries e"
    " join pieces p on p.id = e.piece_id"
    " join accounts ac on ac.id = e.actor_id"
)
CSV_HEADER = "when,piece_id,piece_title,actor,role,from_state,to_state,reason"
RISKY_FIRST = ("=", "+", "-", "@", "\t", "\r")


def _filters(piece, actor, to_state, since, until, params):
    clause = ""
    if piece:
        clause += " and e.piece_id = %(piece)s"
        params["piece"] = piece
    if actor:
        clause += " and (ac.id = %(actor)s or ac.name ilike %(actor_like)s)"
        params["actor"] = actor
        params["actor_like"] = "%" + actor + "%"
    if to_state:
        clause += " and e.to_state = %(to_state)s"
        params["to_state"] = to_state
    if since:
        clause += " and e.created_at >= %(since)s"
        params["since"] = since
    if until:
        clause += " and e.created_at < %(until)s"
        params["until"] = until
    return clause


def shape(entry):
    return {
        "id": entry["id"],
        "piece_id": entry["piece_id"],
        "piece_title": entry["piece_title"],
        "from_state": entry["from_state"],
        "to_state": entry["to_state"],
        "reason": entry["reason"],
        "actor": {
            "id": entry["actor_id"],
            "name": entry["actor_name"],
            "role": entry["actor_role"],
        },
        "created_at": timeutil.iso(entry["created_at"]),
    }


def trail(conn, account, piece=None, actor=None, to_state=None, since=None, until=None,
          page=1, rows_per_page=50):
    params = {"viewer": account["id"]}
    where = guard.visible_sql(account) + _filters(
        piece, actor, to_state, since, until, params
    )
    total = value(
        conn, "select count(*) from (" + JOINED + " where true" + where + ") t", params
    )
    page = max(1, page)
    params["limit"] = rows_per_page
    params["offset"] = (page - 1) * rows_per_page
    found = rows(
        conn,
        JOINED + " where true" + where
        + " order by e.created_at desc, e.id desc limit %(limit)s offset %(offset)s",
        params,
    )
    return {
        "rows": [shape(entry) for entry in found],
        "total": total,
        "page": page,
        "rows_per_page": rows_per_page,
    }


def every_row(conn, account, piece=None, actor=None, to_state=None, since=None,
              until=None):
    params = {"viewer": account["id"]}
    where = guard.visible_sql(account) + _filters(
        piece, actor, to_state, since, until, params
    )
    return rows(
        conn, JOINED + " where true" + where + " order by e.created_at desc, e.id desc",
        params,
    )


def csv_field(text):
    """Prefixed against formula injection first, then quoted. One place only."""
    text = "" if text is None else str(text)
    if text[:1] in RISKY_FIRST:
        text = "'" + text
    if any(mark in text for mark in (",", '"', "\r", "\n")):
        text = '"' + text.replace('"', '""') + '"'
    return text


def csv_document(entries):
    lines = [CSV_HEADER]
    for entry in entries:
        lines.append(
            ",".join(
                csv_field(cell)
                for cell in (
                    timeutil.stamp(entry["created_at"]),
                    entry["piece_id"],
                    entry["piece_title"],
                    entry["actor_name"],
                    entry["actor_role"],
                    entry["from_state"],
                    entry["to_state"],
                    entry["reason"],
                )
            )
        )
    return "\r\n".join(lines) + "\r\n"
