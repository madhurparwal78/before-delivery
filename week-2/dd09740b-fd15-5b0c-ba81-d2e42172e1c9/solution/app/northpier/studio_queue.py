"""The studio queue: one tab's rows and every tab's count, both over the same literal search."""
from typing import Any

from northpier import db
from northpier.domain import QUEUE_TABS, STATUS_LABELS, char_count, check_characters, normalized
from northpier.errors import Refusal
from northpier.records import INQUIRY_COLUMNS

Q_MAX = 100
# q is matched with strpos, never LIKE, so %, _ and \ only ever match themselves.
_MATCH = ("(:q = '' OR strpos(lower(name), lower(:q)) > 0 OR strpos(lower(coalesce(company, '')), lower(:q)) > 0 "
          "OR strpos(lower(reference), lower(:q)) > 0 OR strpos(lower(split_part(email, '@', 1)), lower(:q)) > 0)")
_ORDER = {
    "new": "created_at ASC, id ASC", "in_review": "created_at ASC, id ASC", "call_booked": "call_at ASC, id ASC",
    "won": "updated_at DESC, id DESC", "declined": "updated_at DESC, id DESC", "all": "created_at DESC, id DESC",
}


def check_query(status: str, q: str) -> tuple[str, str]:
    """The tab and trimmed search, `status` checked before `q`."""
    if status not in QUEUE_TABS:
        raise Refusal("tab")
    check_characters("q", q)
    if char_count(q) > Q_MAX:
        raise Refusal("q_long")
    return status, normalized(q)


def queue(tx: db.Tx, status: str, q: str) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Rows of one tab in its pinned order and the counts of every tab, all narrowed by `q`."""
    where, params = (_MATCH, {"q": q}) if status == "all" else (f"status = :status AND {_MATCH}",
                                                                {"q": q, "status": status})
    rows = tx.rows(f"SELECT {INQUIRY_COLUMNS} FROM inquiries WHERE {where} ORDER BY {_ORDER[status]}", **params)
    grouped = {r["status"]: r["n"] for r in tx.rows(
        f"SELECT status, count(*) AS n FROM inquiries WHERE {_MATCH} GROUP BY status", q=q)}
    counts = {key: grouped.get(key, 0) for key in STATUS_LABELS}
    return rows, {**counts, "all": sum(counts.values())}
