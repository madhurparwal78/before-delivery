"""The append-only trail: the one insert, the filtered listing and the spreadsheet-safe CSV export."""

import re
from datetime import date, timedelta

from . import shapes
from .db import Row, Tx
from .rules import visible_clause

CSV_HEADER = ("when", "piece_id", "piece_title", "actor", "role", "from_state", "to_state", "reason")
FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def record(tx: Tx, piece_id: int, actor_id: str, from_state: str | None, to_state: str, reason: str | None) -> None:
    """The only write to audit_entries; nothing updates or deletes an entry."""
    tx.run("INSERT INTO audit_entries (piece_id, actor_id, from_state, to_state, reason) VALUES (:p, :a, :f, :t, :r)",
           p=piece_id, a=actor_id, f=from_state, t=to_state, r=reason)


def _day(value: str | None) -> date | None:
    if not value or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def filters(args: dict) -> dict:
    """The filters a request carries, normalised; malformed values are ignored."""
    piece = args.get("piece") or ""
    return {"piece": int(piece) if piece.isdigit() else None, "actor": args.get("actor") or None,
            "to": args.get("to") or None, "from": _day(args.get("from")), "until": _day(args.get("until"))}


def _where(account: Row, chosen: dict) -> tuple[str, dict]:
    clauses, params = [visible_clause(account)], {"me": account["id"]}
    if chosen["piece"] is not None:
        clauses.append("e.piece_id = :piece")
        params["piece"] = chosen["piece"]
    if chosen["actor"]:
        clauses.append("e.actor_id = :actor")
        params["actor"] = chosen["actor"]
    if chosen["to"]:
        clauses.append("e.to_state = :to")
        params["to"] = chosen["to"]
    if chosen["from"]:
        clauses.append("e.created_at >= :from_day")
        params["from_day"] = chosen["from"]
    if chosen["until"]:
        clauses.append("e.created_at < :until_day")
        params["until_day"] = chosen["until"] + timedelta(days=1)
    return " WHERE " + " AND ".join(clauses), params


def listing(tx: Tx, account: Row, chosen: dict, *, page: int | None, per_page: int) -> tuple[list[Row], int]:
    where, params = _where(account, chosen)
    total = tx.value("SELECT count(*) FROM audit_entries e JOIN pieces p ON p.id = e.piece_id" + where, **params)
    paging = "" if page is None else f" LIMIT {per_page} OFFSET {(page - 1) * per_page}"
    rows = tx.rows(shapes.AUDIT_SELECT + where + " ORDER BY e.created_at DESC, e.id DESC" + paging, **params)
    return rows, total


def csv_cell(value: object) -> str:
    text = "" if value is None else str(value)
    if text.startswith(FORMULA_START):
        text = "'" + text
    return '"' + text.replace('"', '""') + '"' if any(c in text for c in '",\r\n') else text


def csv_text(rows: list[Row]) -> str:
    lines = [CSV_HEADER] + [(r["created_at"].strftime("%Y-%m-%dT%H:%M:%SZ"), r["piece_id"], r["piece_title"],
                             r["actor_name"], r["actor_role"], r["from_state"], r["to_state"], r["reason"])
                            for r in rows]
    return "".join(",".join(csv_cell(v) for v in line) + "\r\n" for line in lines)
