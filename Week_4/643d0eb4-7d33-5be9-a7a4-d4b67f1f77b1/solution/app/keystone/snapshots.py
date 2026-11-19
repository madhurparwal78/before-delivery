"""Frozen snapshots: publication, retention ranked at the read, and the /api/snapshots handlers."""
import psycopg.errors
from starlette.responses import JSONResponse

from . import auth, rules
from .ctx import Ctx
from .db import all_, one, tx
from .errors import refuse
from .rules import columns_of, load_table, tier_in_force
from .util import business_day, iso, now, uint

META = ("id, table_slug, department, period, account, published_at, business_day, sequence, tier, row_allowance, "
        "content_allowance_kilobytes, retention, row_count, content_bytes")


def ranked(conn, slug: str) -> list[dict]:
    """A table's snapshots, newest published first, each with `retained` decided now from its table's tier."""
    table = one(conn, "SELECT department FROM tables WHERE slug = %s", (slug,))
    allowed = tier_in_force(conn, table["department"])["retention_periods"]
    rows = all_(conn, f"SELECT {META} FROM snapshots WHERE table_slug = %s ORDER BY published_at DESC, id DESC",
                (slug,))
    for rank, row in enumerate(rows, start=1):
        row["retained"] = allowed is None or rank <= allowed
    return rows


def snapshot_answer(row: dict) -> dict:
    return {"id": row["id"], "table": row["table_slug"], "table_slug": row["table_slug"],
            "department": row["department"], "period": row["period"], "account": row["account"],
            "published_at": iso(row["published_at"]), "business_day": row["business_day"].isoformat(),
            "sequence": row["sequence"], "tier": row["tier"], "row_allowance": row["row_allowance"],
            "content_allowance_kilobytes": row["content_allowance_kilobytes"], "retention": row["retention"],
            "row_count": row["row_count"], "content_bytes": row["content_bytes"], "retained": row["retained"]}


def all_for_departments(conn, departments: list[str]) -> list[dict]:
    """Every snapshot of the given departments' tables, retained or expired, newest first."""
    out = []
    for table in all_(conn, "SELECT slug FROM tables WHERE department = ANY(%s) ORDER BY slug", (departments,)):
        out.extend(ranked(conn, table["slug"]))
    out.sort(key=lambda r: (r["published_at"], r["id"]), reverse=True)
    return out


def publish(conn, account: dict, slug: str, period) -> dict:
    table = load_table(conn, slug)
    auth.require_role(conn, account, table["department"], "steward", "publish a snapshot")
    table = load_table(conn, slug, lock=True)
    if not isinstance(period, str) or not period.strip() or len(period.strip()) > 64:
        refuse(422, "Name the reporting period to publish for", "period")
    period = period.strip()
    if one(conn, "SELECT 1 AS ok FROM snapshots WHERE table_slug = %s AND period = %s", (slug, period)):
        refuse(409, f"{slug} already has a snapshot for {period}", "period")
    conn.execute("SELECT 1 FROM departments WHERE slug = %s FOR UPDATE", (table["department"],))
    sequence = one(conn, "SELECT COALESCE(max(sequence), 0) + 1 AS n FROM snapshots WHERE department = %s",
                   (table["department"],))["n"]
    tier = tier_in_force(conn, table["department"])
    columns = columns_of(conn, slug)
    moment = now()
    size = rules.content_bytes(conn, slug, columns)
    try:
        row = one(conn, f"""
            INSERT INTO snapshots (table_slug, department, period, account, published_at, business_day, sequence,
                                   tier, row_allowance, content_allowance_kilobytes, retention, row_count,
                                   content_bytes, rows)
            SELECT %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, count(*), %s,
                   COALESCE(jsonb_agg(jsonb_build_object('id', id, 'version', version, 'values', cell_values)
                                      ORDER BY inserted_position, id), '[]'::jsonb)
            FROM rows WHERE table_slug = %s
            RETURNING {META}""",
                  (slug, table["department"], period, account["email"], moment, business_day(moment), sequence,
                   tier["name"], tier["row_allowance"], tier["content_allowance_kilobytes"], tier["retention"], size,
                   slug))
    except psycopg.errors.UniqueViolation:
        refuse(409, f"{slug} already has a snapshot for {period}", "period")
    return row


def publish_snapshot(ctx: Ctx):
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        body = ctx.object()
        slug = body.get("table")
        if not isinstance(slug, str) or not slug:
            refuse(422, "Name the table to publish", "table")
        row = publish(conn, account, slug, body.get("period"))
        row["retained"] = next(r["retained"] for r in ranked(conn, slug) if r["id"] == row["id"])
        return JSONResponse(snapshot_answer(row), status_code=201)


def list_snapshots(ctx: Ctx):
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        wanted = ctx.query.get("table")
        if wanted:
            table = load_table(conn, wanted)
            auth.require_role(conn, account, table["department"], "viewer", "read snapshots")
            rows = ranked(conn, wanted)
        else:
            rows = all_for_departments(conn, list(auth.roles_of(conn, account["email"])))
        return JSONResponse([snapshot_answer(r) for r in rows if r["retained"]])


def get_snapshot(ctx: Ctx):
    raw = ctx.params["snapshot_id"]
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        ident = uint(raw)
        found = one(conn, f"SELECT {META}, rows FROM snapshots WHERE id = %s", (ident,)) if ident is not None else None
        if found is None:
            refuse(404, f"There is no snapshot {raw}", "snapshot")
        auth.require_role(conn, account, found["department"], "viewer", "read snapshots")
        current = next(r for r in ranked(conn, found["table_slug"]) if r["id"] == found["id"])
        if not current["retained"]:
            refuse(410, f"The {found['period']} snapshot is beyond its retention", "retained")
        found["retained"] = True
        answer = snapshot_answer(found)
        answer["rows"] = found["rows"]
        return JSONResponse(answer)


def refuse_snapshot_amend(ctx: Ctx):
    with tx() as conn:
        auth.require_account(conn, ctx)
    refuse(403, "No role amends a snapshot", "role")
