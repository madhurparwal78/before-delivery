"""The /api surface for tables, rows, columns, views, the change log, locks, tiers and department grants."""
import base64
import binascii
import hashlib
import json
from datetime import timedelta

from psycopg.types.json import Jsonb
from starlette.responses import JSONResponse, Response

from . import amend, auth, config, rowsq, rules
from .ctx import Ctx
from .db import all_, one, tx
from .errors import refuse
from .rules import columns_of, load_table, refuse_if_locked, tier_in_force
from .values import column_spec
from .util import dumps, iso, now, norm_email, uint


def readable_departments(conn, account: dict) -> list[str]:
    return list(auth.roles_of(conn, account["email"]))


def read_access(conn, ctx: Ctx, slug: str, verb: str = "read this table", minimum: str = "viewer"):
    """Sign-in, table lookup (404), then the department boundary (403)."""
    account = auth.require_account(conn, ctx)
    table = load_table(conn, slug)
    auth.require_role(conn, account, table["department"], minimum, verb)
    return account, table


def int_param(ctx: Ctx, name: str, default: int, minimum: int = 1) -> int:
    raw = ctx.query.get(name)
    if raw is None or raw == "":
        return default
    value = uint(raw.strip(), 10**9)
    if value is None:
        refuse(422, f"{name} must be a whole number", name)
    if value < minimum:
        refuse(422, f"{name} must be at least {minimum}", name)
    return value


# ---- open addresses ----------------------------------------------------------------------------------------------

def health(ctx: Ctx) -> Response:
    with tx() as conn:
        one(conn, "SELECT 1 AS ok")
    return JSONResponse({"status": "ok"})


def tiers(ctx: Ctx) -> Response:
    with tx() as conn:
        return JSONResponse([rules.tier_answer(t) for t in rules.all_tiers(conn)])


def department_grants(ctx: Ctx) -> Response:
    slug = ctx.params["slug"]
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        if one(conn, "SELECT 1 AS ok FROM departments WHERE slug = %s", (slug,)) is None:
            refuse(404, f"There is no department {slug}", "department")
        auth.require_role(conn, account, slug, "viewer", "read the tier grants")
        rows = all_(conn, "SELECT * FROM department_grants WHERE department = %s ORDER BY effective_at", (slug,))
        moment = now()
        current = max((r["effective_at"] for r in rows if r["effective_at"] <= moment), default=None)
        return JSONResponse([{"id": r["id"], "department": r["department"], "tier": r["tier"],
                              "effective_at": iso(r["effective_at"]), "in_force": r["effective_at"] == current}
                             for r in rows])


# ---- tables and columns ------------------------------------------------------------------------------------------

def tables_list(ctx: Ctx) -> Response:
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        out = []
        for department in readable_departments(conn, account):
            tier = tier_in_force(conn, department)
            for table in all_(conn, "SELECT * FROM tables WHERE department = %s", (department,)):
                out.append({"id": table["id"], "slug": table["slug"], "name": table["name"],
                            "department": department, "tier": tier["name"], "row_allowance": tier["row_allowance"],
                            "allowance": tier["row_allowance"], "locked_period": table["locked_period"],
                            "count": rules.row_count(conn, table["slug"])})
        out.sort(key=lambda t: (t["name"], t["slug"]))
        return JSONResponse(out)


def table_detail(ctx: Ctx) -> Response:
    with tx() as conn:
        _, table = read_access(conn, ctx, ctx.params["slug"])
        return JSONResponse(rules.table_answer(conn, table))


def column_create(ctx: Ctx) -> Response:
    slug = ctx.params["slug"]
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        body = ctx.object()
        table = load_table(conn, slug)
        auth.require_role(conn, account, table["department"], "steward", "change the columns")
        table = load_table(conn, slug, lock=True)
        refuse_if_locked(table)
        caption, kind, options = column_spec(body)
        if one(conn, "SELECT 1 AS ok FROM columns WHERE table_slug = %s AND caption = %s", (slug, caption)):
            refuse(409, f"{slug} already has a column {caption}", "caption")
        position = one(conn, "SELECT COALESCE(max(position), 0) + 1 AS n FROM columns WHERE table_slug = %s",
                       (slug,))["n"]
        col = one(conn, "INSERT INTO columns (table_slug, caption, position, type, options) "
                        "VALUES (%s, %s, %s, %s, %s) RETURNING id, caption, position, type, options",
                  (slug, caption, position, kind, None if options is None else Jsonb(options)))
        return JSONResponse(rules.column_answer(col), status_code=201)


def column_delete(ctx: Ctx) -> Response:
    slug, column_id = ctx.params["slug"], ctx.params["column_id"]
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        table = load_table(conn, slug)
        auth.require_role(conn, account, table["department"], "steward", "change the columns")
        table = load_table(conn, slug, lock=True)
        refuse_if_locked(table)
        col = one(conn, "SELECT * FROM columns WHERE id = %s AND table_slug = %s",
                  (_id(column_id, "column"), slug))
        if col is None:
            refuse(404, f"There is no column {column_id} in {slug}", "column")
        conn.execute("SET CONSTRAINTS ALL DEFERRED")
        conn.execute("DELETE FROM columns WHERE id = %s", (col["id"],))
        conn.execute("UPDATE columns SET position = position - 1 WHERE table_slug = %s AND position > %s",
                     (slug, col["position"]))
        conn.execute("UPDATE rows SET cell_values = cell_values - %s WHERE table_slug = %s", (col["caption"], slug))
        return Response(status_code=204)


# ---- rows --------------------------------------------------------------------------------------------------------

def _cursor(slug: str, **fields) -> str:
    return base64.urlsafe_b64encode(dumps({"t": slug, **fields}).encode()).decode().rstrip("=")


def _read_cursor(raw: str, slug: str) -> dict:
    try:
        data = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    except (ValueError, binascii.Error, UnicodeDecodeError):
        refuse(422, "This cursor is not valid.", "cursor")
    if not isinstance(data, dict) or not isinstance(data.get("t"), str):
        refuse(422, "This cursor is not valid.", "cursor")
    if data["t"] != slug:
        refuse(422, "This cursor belongs to another table.", "cursor")
    if (uint(data.get("p")) is None) == (uint(data.get("o")) is None):
        refuse(422, "This cursor is not valid.", "cursor")
    return data


def find_view(conn, account: dict, slug: str, ident: str) -> dict:
    view = one(conn, "SELECT * FROM views WHERE table_slug = %s AND id = %s", (slug, _id(ident, "view")))
    if view is None or (view["visibility"] == "private" and view["owner"] != account["email"]):
        refuse(404, f"There is no view {ident} on {slug}", "view")
    return view


def rows_list(ctx: Ctx) -> Response:
    slug = ctx.params["slug"]
    with tx() as conn:
        account, table = read_access(conn, ctx, slug, "read rows")
        per_page = int_param(ctx, "per_page", config.PAGE_DEFAULT)
        if per_page > config.PAGE_CAP:
            refuse(422, f"A page carries at most {config.PAGE_CAP} rows.", "per_page")
        page = int_param(ctx, "page", 1)
        columns = columns_of(conn, slug)
        filters, sorts = [], []
        if ctx.query.get("view"):
            view = find_view(conn, account, slug, ctx.query["view"])
            filters, sorts = view["filters"], view["sorts"]
        if ctx.query.get("sort"):
            sorts = [{"column": ctx.query["sort"], "direction": "asc"}]
        where, wparams, order, oparams = rowsq.where_and_order(columns, filters, sorts)
        base = "FROM rows WHERE table_slug = %s" + (f" AND {where}" if where else "")
        total = int(one(conn, f"SELECT count(*) AS n {base}", (slug, *wparams))["n"])
        keyset = not filters and not sorts
        cursor = _read_cursor(ctx.query["cursor"], slug) if ctx.query.get("cursor") else None
        if cursor is not None and keyset and "p" in cursor:
            rows = all_(conn, f"SELECT * {base} AND inserted_position > %s ORDER BY inserted_position, id LIMIT %s",
                        (slug, *wparams, cursor["p"], per_page + 1))
            more = len(rows) > per_page
            rows = rows[:per_page]
        else:
            offset = cursor["o"] if cursor is not None and "o" in cursor else (page - 1) * per_page
            rows = all_(conn, f"SELECT * {base} ORDER BY {order} LIMIT %s OFFSET %s",
                        (slug, *wparams, *oparams, per_page, offset))
            more = offset + len(rows) < total
        following = ""
        if more and rows:
            if keyset:
                following = _cursor(slug, p=rows[-1]["inserted_position"])
            else:
                following = _cursor(slug, o=offset + len(rows))
        return JSONResponse([amend.row_answer(r) for r in rows],
                            headers={"X-Total-Count": str(total), "X-Next-Cursor": following})


def row_detail(ctx: Ctx) -> Response:
    slug, row_id = ctx.params["slug"], ctx.params["row_id"]
    with tx() as conn:
        read_access(conn, ctx, slug, "read rows")
        row = one(conn, "SELECT * FROM rows WHERE id = %s AND table_slug = %s", (_id(row_id), slug))
        if row is None:
            refuse(404, f"There is no row {row_id} in {slug}", "row")
        return JSONResponse(amend.row_answer(row))


def _fingerprint(slug: str, body) -> str:
    return hashlib.sha256(json.dumps([slug, body], sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode()).hexdigest()


def row_create(ctx: Ctx) -> Response:
    slug = ctx.params["slug"]
    key = ctx.headers.get("idempotency-key")
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        body = ctx.object()
        fingerprint = _fingerprint(slug, body)
        if key:
            conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"{account['email']}|{key}",))
            conn.execute("DELETE FROM idempotency_keys WHERE account = %s AND key = %s AND created_at < %s",
                         (account["email"], key, now() - timedelta(hours=config.IDEMPOTENCY_HOURS)))
            seen = one(conn, "SELECT * FROM idempotency_keys WHERE account = %s AND key = %s",
                       (account["email"], key))
            if seen is not None:
                if seen["fingerprint"] != fingerprint:
                    refuse(409, "This idempotency key was used for another request.", "idempotency_key")
                return Response(content=seen["body"], status_code=seen["status"], media_type="application/json")
        row, _ = amend.amend_row(conn, account, slug, "create", values=body.get("values"))
        text = dumps(amend.row_answer(row))
        if key:
            conn.execute("INSERT INTO idempotency_keys (account, key, fingerprint, status, body, created_at) "
                         "VALUES (%s, %s, %s, 201, %s, %s)", (account["email"], key, fingerprint, text, now()))
        return Response(content=text, status_code=201, media_type="application/json")


def row_update(ctx: Ctx) -> Response:
    slug, row_id = ctx.params["slug"], ctx.params["row_id"]
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        body = ctx.object()
        version = amend.parse_version(ctx.headers.get("if-match-version"))
        row, _ = amend.amend_row(conn, account, slug, "update", row_id=_id(row_id), values=body.get("values"),
                                 if_match=version)
        return JSONResponse(amend.row_answer(row))


def row_delete(ctx: Ctx) -> Response:
    slug, row_id = ctx.params["slug"], ctx.params["row_id"]
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        amend.amend_row(conn, account, slug, "delete", row_id=_id(row_id))
        return Response(status_code=204)


def _id(raw: str, what: str = "row") -> int:
    value = uint(raw)
    if value is None:
        refuse(404, f"There is no {what} {raw}", what)
    return value


# ---- saved views -------------------------------------------------------------------------------------------------

def view_answer(view: dict) -> dict:
    return {"id": view["id"], "table": view["table_slug"], "name": view["name"], "owner": view["owner"],
            "visibility": view["visibility"], "filters": view["filters"], "sorts": view["sorts"]}


def views_list(ctx: Ctx) -> Response:
    slug = ctx.params["slug"]
    with tx() as conn:
        account, _ = read_access(conn, ctx, slug, "read views")
        rows = all_(conn, "SELECT * FROM views WHERE table_slug = %s AND (visibility = 'shared' OR owner = %s) "
                          "ORDER BY name, id", (slug, account["email"]))
        return JSONResponse([view_answer(v) for v in rows])


def _view_fields(body: dict, columns: list[dict], current: dict | None = None) -> dict:
    name = body.get("name", current["name"] if current else None)
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
        refuse(422, "Give the view a name of up to 80 characters", "name")
    visibility = body.get("visibility", current["visibility"] if current else "private")
    if visibility not in ("private", "shared"):
        refuse(422, "visibility is private or shared", "visibility")
    filters = body.get("filters", current["filters"] if current else [])
    sorts = body.get("sorts", current["sorts"] if current else [])
    rowsq.validate_view(columns, filters, sorts)
    return {"name": name.strip(), "visibility": visibility, "filters": filters, "sorts": sorts}


def view_create(ctx: Ctx) -> Response:
    slug = ctx.params["slug"]
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        body = ctx.object()
        table = load_table(conn, slug)
        auth.require_role(conn, account, table["department"], "analyst", "manage views")
        table = load_table(conn, slug, lock=True)
        columns = columns_of(conn, slug)
        fields = _view_fields(body, columns)
        if one(conn, "SELECT 1 AS ok FROM views WHERE table_slug = %s AND name = %s", (slug, fields["name"])):
            refuse(409, f"{slug} already has a view named {fields['name']}", "name")
        if fields["visibility"] == "shared":
            rules.check_allowance(conn, "views", table, tier_in_force(conn, table["department"]))
        view = one(conn, "INSERT INTO views (table_slug, name, owner, visibility, filters, sorts) "
                         "VALUES (%s, %s, %s, %s, %s, %s) RETURNING *",
                   (slug, fields["name"], account["email"], fields["visibility"], Jsonb(fields["filters"]),
                    Jsonb(fields["sorts"])))
        return JSONResponse(view_answer(view), status_code=201)


def _editable_view(conn, account: dict, table: dict, ident: str) -> dict:
    auth.require_role(conn, account, table["department"], "analyst", "manage views")
    view = find_view(conn, account, table["slug"], ident)
    return view


def view_update(ctx: Ctx) -> Response:
    slug = ctx.params["slug"]
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        body = ctx.object()
        table = load_table(conn, slug)
        view = _editable_view(conn, account, table, ctx.params["view_id"])
        table = load_table(conn, slug, lock=True)
        fields = _view_fields(body, columns_of(conn, slug), view)
        clash = one(conn, "SELECT 1 AS ok FROM views WHERE table_slug = %s AND name = %s AND id <> %s",
                    (slug, fields["name"], view["id"]))
        if clash:
            refuse(409, f"{slug} already has a view named {fields['name']}", "name")
        if fields["visibility"] == "shared" and view["visibility"] != "shared":
            rules.check_allowance(conn, "views", table, tier_in_force(conn, table["department"]))
        view = one(conn, "UPDATE views SET name = %s, visibility = %s, filters = %s, sorts = %s WHERE id = %s "
                         "RETURNING *", (fields["name"], fields["visibility"], Jsonb(fields["filters"]),
                                         Jsonb(fields["sorts"]), view["id"]))
        return JSONResponse(view_answer(view))


def view_delete(ctx: Ctx) -> Response:
    slug = ctx.params["slug"]
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        table = load_table(conn, slug)
        view = _editable_view(conn, account, table, ctx.params["view_id"])
        conn.execute("DELETE FROM views WHERE id = %s", (view["id"],))
        return Response(status_code=204)


# ---- the change log: read by every role, amended by none -------------------------------------------------------

def log_page(conn, slug: str, action: str | None, account: str | None, page: int, size: int = config.LOG_PAGE):
    clauses, params = ["table_slug = %s"], [slug]
    if action:
        clauses.append("action = %s")
        params.append(action)
    if account:
        clauses.append("account = %s")
        params.append(account)
    where = " AND ".join(clauses)
    total = int(one(conn, f"SELECT count(*) AS n FROM log_entries WHERE {where}", params)["n"])
    rows = all_(conn, f"SELECT * FROM log_entries WHERE {where} ORDER BY ordinal DESC LIMIT %s OFFSET %s",
                (*params, size, (page - 1) * size))
    return rows, total


def log_list(ctx: Ctx) -> Response:
    slug = ctx.params["slug"]
    with tx() as conn:
        read_access(conn, ctx, slug, "read the change log")
        action = ctx.query.get("action") or None
        if action and action not in ("create", "update", "delete"):
            refuse(422, "action is create, update or delete", "action")
        rows, total = log_page(conn, slug, action, norm_email(ctx.query.get("account")) or None,
                               int_param(ctx, "page", 1))
        return JSONResponse([rules.log_answer(r) for r in rows], headers={"X-Total-Count": str(total)})


def no_role_amends(what: str):
    def handler(ctx: Ctx) -> Response:
        with tx() as conn:
            auth.require_account(conn, ctx)
        refuse(403, f"No role amends {what}", "role")

    handler.__name__ = "refuse_amend_" + what.split()[-1]
    return handler


# ---- locks -------------------------------------------------------------------------------------------------------

def lock_table(ctx: Ctx) -> Response:
    slug = ctx.params["slug"]
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        body = ctx.object()
        table = load_table(conn, slug)
        auth.require_role(conn, account, table["department"], "steward", "lock a table")
        load_table(conn, slug, lock=True)
        period = body.get("period")
        if not isinstance(period, str) or not period.strip() or len(period.strip()) > 64:
            refuse(422, "Name the reporting period to lock the table for", "period")
        conn.execute("UPDATE tables SET locked_period = %s WHERE slug = %s", (period.strip(), slug))
        return JSONResponse(rules.table_answer(conn, load_table(conn, slug)))


def unlock_table(ctx: Ctx) -> Response:
    slug = ctx.params["slug"]
    with tx() as conn:
        account = auth.require_account(conn, ctx)
        table = load_table(conn, slug)
        auth.require_role(conn, account, table["department"], "steward", "unlock a table")
        load_table(conn, slug, lock=True)
        conn.execute("UPDATE tables SET locked_period = NULL WHERE slug = %s", (slug,))
        return JSONResponse(rules.table_answer(conn, load_table(conn, slug)))
