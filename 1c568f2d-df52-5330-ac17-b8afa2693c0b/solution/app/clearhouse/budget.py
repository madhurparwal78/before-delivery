"""The quarter budget: totals, single-fee adjustments and the quarter reset."""

import re

from . import rules
from .audit import record
from .db import Row, Tx, transaction
from .errors import invalid, not_found
from .money import format_cents
from .timefmt import quarter_bounds

ADJUST_FIELDS = ("piece_id", "delta_cents", "version")
RESET_FIELDS = ("reset",)


def valid_quarter(quarter: str) -> str:
    if not re.fullmatch(r"\d{4}-Q[1-4]", quarter or ""):
        raise not_found()
    return quarter


def view(tx: Tx, account: Row, quarter: str) -> dict:
    start, end = quarter_bounds(quarter)
    budget, committed = rules.budget_cents(tx, quarter), rules.committed_cents(tx, quarter)
    rows = tx.rows(
        "SELECT p.id, p.title, a.name AS owner_name, p.state, p.fee_cents, p.version FROM pieces p "
        f"JOIN accounts a ON a.id = p.owner_id WHERE p.cleared_at <@ tstzrange(:start, :end) "
        f"AND {rules.visible_clause(account)} ORDER BY p.cleared_at, p.id", start=start, end=end, me=account["id"])
    return {"quarter": quarter, "budget_cents": budget, "committed_cents": committed,
            "remaining_cents": budget - committed, "rows": rows}


def _change_fee(tx: Tx, account: Row, piece: Row, new_fee: int) -> None:
    tx.run("UPDATE pieces SET fee_cents = :f, version = version + 1, updated_at = clock_timestamp() WHERE id = :id",
           f=new_fee, id=piece["id"])
    record(tx, piece["id"], account["id"], piece["state"], piece["state"],
           f"Fee changed from {format_cents(piece['fee_cents'])} to {format_cents(new_fee)}")


def change(account: Row, quarter: str, body: object) -> dict:
    valid_quarter(quarter)
    with transaction() as tx:
        if isinstance(body, dict) and "reset" in body:
            reset(tx, account, quarter, body)
        else:
            adjust(tx, account, quarter, body)
        return view(tx, account, quarter)


def adjust(tx: Tx, account: Row, quarter: str, body: object) -> None:
    if not isinstance(body, dict):
        rules.only_published(body, ADJUST_FIELDS)
    piece, fields = rules.decide(tx, account, body.get("piece_id"), body, ADJUST_FIELDS, "adjust_fee",
                                 version_required=False)
    delta = fields.get("delta_cents")
    new_fee = rules.fee(piece["fee_cents"] + delta if type(delta) is int else None, "delta_cents")
    start, end = quarter_bounds(quarter)
    if piece["cleared_at"] is None or not start <= piece["cleared_at"] < end:
        raise invalid("piece_id", "That piece does not count against this quarter")
    rules.lock_quarter(tx, quarter)
    if piece["state"] in rules.COMMITTED_STATES:
        rules.check_budget(tx, quarter, new_fee - piece["fee_cents"], "Adjusting this fee")
    _change_fee(tx, account, piece, new_fee)


def reset(tx: Tx, account: Row, quarter: str, body: dict) -> None:
    rules.only_published(body, RESET_FIELDS)
    rules.check_actor(tx, account, None, "adjust_fee")
    if body["reset"] is not True:
        raise invalid("reset", "Send reset as true to return every fee to its submitted value")
    rules.lock_quarter(tx, quarter)
    start, end = quarter_bounds(quarter)
    changed = tx.rows("SELECT * FROM pieces WHERE cleared_at <@ tstzrange(:start, :end) "
                      "AND fee_cents <> submitted_fee_cents ORDER BY id FOR UPDATE", start=start, end=end)
    rules.check_budget(tx, quarter, sum(p["submitted_fee_cents"] - p["fee_cents"] for p in changed
                                        if p["state"] in rules.COMMITTED_STATES), "Resetting")
    for piece in changed:
        _change_fee(tx, account, piece, piece["submitted_fee_cents"])
