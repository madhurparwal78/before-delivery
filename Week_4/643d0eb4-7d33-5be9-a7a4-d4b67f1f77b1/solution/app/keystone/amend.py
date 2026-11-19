"""The one write path. Every row create, update and delete passes `amend_row`, which checks in this order:
role, then the lock, then the allowances, then the row version, then the column types, and reports the first
failure only. Row and change log entries are written in one transaction."""
from psycopg.types.json import Jsonb

from . import auth, rules
from .db import one
from .errors import refuse
from .rules import append_log, check_allowance, columns_of, load_table, tier_in_force
from .util import now, uint
from .values import check_values

ACTIONS = {"create": "create rows", "update": "update rows", "delete": "delete rows"}


def row_answer(row: dict) -> dict:
    return {"id": row["id"], "version": row["version"], "values": row["cell_values"],
            "inserted_position": row["inserted_position"]}


def parse_version(header: str | None) -> int | None:
    if header is None:
        return None
    version = uint(header.strip(), 2**31)
    if version is None:
        refuse(422, "If-Match-Version must be a whole number", "version")
    return version


def amend_row(conn, account: dict, slug: str, action: str, *, row_id: int | None = None, values=None,
              if_match: int | None = None) -> tuple[dict | None, dict]:
    """Returns (row, table). `row` is the stored row after a create or update and None after a delete."""
    table = load_table(conn, slug)
    auth.require_role(conn, account, table["department"], "editor", ACTIONS[action])
    table = load_table(conn, slug, lock=True)  # the table row lock serialises writers, ordinals and allowances

    row = None
    if action != "create":
        row = one(conn, "SELECT * FROM rows WHERE id = %s AND table_slug = %s FOR UPDATE", (row_id, slug))
        if row is None:
            refuse(404, f"There is no row {row_id} in {slug}", "row")

    rules.refuse_if_locked(table)

    columns = columns_of(conn, slug)
    tier = tier_in_force(conn, table["department"])
    if action == "create":
        check_allowance(conn, "rows", table, tier)
    if action != "delete":
        check_allowance(conn, "content", table, tier, columns)

    if action == "update" and if_match is not None and if_match != row["version"]:
        refuse(409, "This row has moved on.", "version", current_version=row["version"])

    moment = now()
    if action == "delete":
        conn.execute("DELETE FROM rows WHERE id = %s", (row["id"],))
        append_log(conn, slug, action="delete", account=account["email"], recorded_at=moment,
                   before=row["cell_values"])
        return None, table

    if action == "create":
        stored = check_values(columns, values, partial=False)
        row = one(conn, "INSERT INTO rows (table_slug, cell_values) VALUES (%s, %s) RETURNING *",
                  (slug, Jsonb(stored)))
        append_log(conn, slug, action="create", account=account["email"], recorded_at=moment, after=stored)
        return row, table

    changes = check_values(columns, values, partial=True)
    held = row["cell_values"]
    if not changes:
        refuse(422, "Name at least one column to amend", "values")
    amended = changes  # every named column is amended and recorded, so an accepted amendment is never unrecorded
    merged = {**held, **amended}
    row = one(conn, "UPDATE rows SET cell_values = %s, version = version + 1 WHERE id = %s RETURNING *",
              (Jsonb(merged), row["id"]))
    for column in columns:  # one entry per amended column, in column order, sharing one recorded moment
        caption = column["caption"]
        if caption in amended:
            append_log(conn, slug, action="update", account=account["email"], recorded_at=moment, column=caption,
                       before=held.get(caption), after=amended[caption])
    return row, table
