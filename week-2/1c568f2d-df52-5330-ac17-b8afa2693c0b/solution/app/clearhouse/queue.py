"""The clearance queue: counts over every piece this account may see, filters, search, sort and paging."""

from . import shapes
from .db import Row, Tx
from .rules import STATES, needs_clause, visible_clause

SORTS = {"newest": "p.created_at DESC, p.id DESC", "oldest": "p.created_at, p.id",
         "title": "lower(p.title), p.id", "fee": "p.fee_cents DESC, p.id"}


def options(args: dict) -> dict:
    page = args.get("page") or "1"
    return {"state": args.get("state") if args.get("state") in STATES else None,
            "mine": args.get("mine") in ("1", "true", "on"), "needs": args.get("needs") in ("1", "true", "on"),
            "q": (args.get("q") or "").strip(), "sort": args.get("sort") if args.get("sort") in SORTS else "newest",
            "page": int(page) if page.isdigit() and int(page) > 0 else 1}


def counts(tx: Tx, account: Row) -> dict[str, int]:
    found = {r["state"]: r["n"] for r in tx.rows(
        f"SELECT p.state, count(*) AS n FROM pieces p WHERE {visible_clause(account)} GROUP BY p.state",
        me=account["id"])}
    return {state: found.get(state, 0) for state in STATES}


def search(tx: Tx, account: Row, chosen: dict, per_page: int) -> tuple[list[Row], int]:
    clauses, params = [visible_clause(account)], {"me": account["id"]}
    if chosen["state"]:
        clauses.append("p.state = :state")
        params["state"] = chosen["state"]
    if chosen["mine"]:
        clauses.append("p.owner_id = :me")
    if chosen["needs"]:
        clauses.append(needs_clause(account))
    if len(chosen["q"]) >= 2:
        escaped = chosen["q"].lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        clauses.append("(lower(p.title) LIKE :pattern ESCAPE '\\' OR lower(a.name) LIKE :pattern ESCAPE '\\')")
        params["pattern"] = f"%{escaped}%"
    where = " WHERE " + " AND ".join(clauses)
    total = tx.value("SELECT count(*) FROM pieces p JOIN accounts a ON a.id = p.owner_id" + where, **params)
    rows = tx.rows(shapes.PIECE_SELECT + where + f" ORDER BY {SORTS[chosen['sort']]} "
                   f"LIMIT {per_page} OFFSET {(chosen['page'] - 1) * per_page}", **params)
    return rows, total


def needs_ids(tx: Tx, account: Row) -> list[int]:
    return [r["id"] for r in tx.rows(f"SELECT p.id FROM pieces p WHERE {needs_clause(account)} "
                                     f"ORDER BY {SORTS['newest']}", me=account["id"])]
