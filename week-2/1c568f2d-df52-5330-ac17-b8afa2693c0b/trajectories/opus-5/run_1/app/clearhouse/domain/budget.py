"""The quarter budget. Committed is summed here and nowhere else."""
from .. import timeutil
from ..db import row, rows, value
from ..errors import Refusal
from ..money import dollars
from .fields import FEE_MESSAGE

DEFAULT_BUDGET_CENTS = 500000
COMMITTED_STATES = ("cleared", "scheduled", "published")
OUTSIDE_QUARTER = "That piece does not count against this quarter"


def _lock(conn, quarter):
    """Every write that can change committed is decided after the others."""
    conn.execute("select pg_advisory_xact_lock(hashtext(%s))", (quarter,))


def budget_cents(conn, quarter):
    found = row(conn, "select budget_cents from budgets where quarter = %s", (quarter,))
    return found["budget_cents"] if found else DEFAULT_BUDGET_CENTS


def committed_cents(conn, quarter, ignore_piece_id=None):
    start, end = timeutil.quarter_range(quarter)
    return value(
        conn,
        "select coalesce(sum(fee_cents), 0) from pieces where state = any(%s)"
        " and cleared_at >= %s and cleared_at < %s and (%s::bigint is null or id <> %s::bigint)",
        (list(COMMITTED_STATES), start, end, ignore_piece_id, ignore_piece_id),
    )


def quarter_rows(conn, quarter):
    start, end = timeutil.quarter_range(quarter)
    return rows(
        conn,
        "select p.id, p.title, a.name as owner_name, p.state, p.fee_cents, p.version"
        " from pieces p join accounts a on a.id = p.owner_id"
        " where p.cleared_at >= %s and p.cleared_at < %s order by p.cleared_at, p.id",
        (start, end),
    )


def shape(conn, quarter):
    budget = budget_cents(conn, quarter)
    committed = committed_cents(conn, quarter)
    return {
        "quarter": quarter,
        "budget_cents": budget,
        "committed_cents": committed,
        "remaining_cents": budget - committed,
        "rows": quarter_rows(conn, quarter),
    }


def check_clear(conn, piece):
    quarter = timeutil.current_quarter()
    _lock(conn, quarter)
    budget = budget_cents(conn, quarter)
    committed = committed_cents(conn, quarter)
    over = committed + piece["fee_cents"] - budget
    if over > 0:
        raise Refusal(
            409,
            "Clearing this piece would exceed the quarter budget by {}".format(
                dollars(over)
            ),
        )


def adjust(conn, account, quarter, piece, delta_cents):
    from .pieces import append_audit

    _lock(conn, quarter)
    start, end = timeutil.quarter_range(quarter)
    if piece["cleared_at"] is None or not start <= piece["cleared_at"] < end:
        raise Refusal(400, OUTSIDE_QUARTER, field="piece_id")
    if isinstance(delta_cents, bool) or not isinstance(delta_cents, int):
        raise Refusal(400, FEE_MESSAGE, field="delta_cents")
    wanted = piece["fee_cents"] + delta_cents
    if not 0 <= wanted <= 500000:
        raise Refusal(400, FEE_MESSAGE, field="delta_cents")
    if piece["state"] in COMMITTED_STATES:
        over = committed_cents(conn, quarter, piece["id"]) + wanted - budget_cents(
            conn, quarter
        )
        if over > 0:
            raise Refusal(
                409,
                "Adjusting this fee would exceed the quarter budget by {}".format(
                    dollars(over)
                ),
            )
    conn.execute(
        "update pieces set fee_cents = %s, version = version + 1, updated_at = now()"
        " where id = %s",
        (wanted, piece["id"]),
    )
    append_audit(
        conn,
        piece["id"],
        account["id"],
        piece["state"],
        piece["state"],
        "Fee changed from {} to {}".format(dollars(piece["fee_cents"]), dollars(wanted)),
    )


def reset(conn, account, quarter):
    from .pieces import append_audit

    _lock(conn, quarter)
    start, end = timeutil.quarter_range(quarter)
    wanted = rows(
        conn,
        "select id, state, fee_cents, submitted_fee_cents from pieces"
        " where cleared_at >= %s and cleared_at < %s order by id",
        (start, end),
    )
    total = sum(
        found["submitted_fee_cents"]
        for found in wanted
        if found["state"] in COMMITTED_STATES
    )
    over = total - budget_cents(conn, quarter)
    if over > 0:
        raise Refusal(
            409, "Resetting would exceed the quarter budget by {}".format(dollars(over))
        )
    for found in wanted:
        if found["fee_cents"] == found["submitted_fee_cents"]:
            continue
        conn.execute(
            "update pieces set fee_cents = submitted_fee_cents, version = version + 1,"
            " updated_at = now() where id = %s",
            (found["id"],),
        )
        append_audit(
            conn,
            found["id"],
            account["id"],
            found["state"],
            found["state"],
            "Fee changed from {} to {}".format(
                dollars(found["fee_cents"]), dollars(found["submitted_fee_cents"])
            ),
        )


def cleared_today(conn):
    """The public count: pieces whose first clearing fell on the current UTC day."""
    return value(
        conn,
        "select count(*) from pieces where cleared_at >= date_trunc('day', now())"
        " and cleared_at < date_trunc('day', now()) + interval '1 day'",
    )
