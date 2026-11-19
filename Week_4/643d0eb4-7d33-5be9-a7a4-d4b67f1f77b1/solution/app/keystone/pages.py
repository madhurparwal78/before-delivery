"""Server-rendered pages: the public surface and the signed-in console. Every page answers its real status."""
import hashlib

from jinja2 import Environment, FileSystemLoader, select_autoescape
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import HTMLResponse
from starlette.routing import Route

from . import api_access, auth, config, rules, snapshots
from .api_tables import log_page
from .ctx import Ctx, page, read
from .db import all_, one, tx
from .errors import Refusal, refuse
from .rules import load_table, tier_in_force
from .util import now, uint

env = Environment(loader=FileSystemLoader(config.ROOT / "templates"), autoescape=select_autoescape(["html"]),
                  trim_blocks=True, lstrip_blocks=True)
env.filters["n"] = lambda value: f"{int(value):,}"
env.filters["stamp"] = lambda value: value.strftime("%Y-%m-%d %H:%M:%S") if value else ""
env.filters["day"] = lambda value: value.strftime("%Y-%m-%d") if value else ""
_versions: dict[str, str] = {}


def asset(path: str) -> str:
    if path not in _versions:
        digest = hashlib.sha256((config.ROOT / "static" / path).read_bytes()).hexdigest()[:10]
        _versions[path] = f"/static/{path}?v={digest}"
    return _versions[path]


env.globals["asset"] = asset
env.globals["DEPARTMENTS"] = config.DEPARTMENTS

CONSOLE_LINKS = (("/console/tables", "Tables"), ("/console/snapshots", "Snapshots"), ("/console/requests", "Requests"),
                 ("/console/account", "Account"))


def viewer(conn, ctx: Ctx) -> dict | None:
    account = auth.current_account(conn, ctx)
    if account is None:
        return None
    roles = auth.roles_of(conn, account["email"])
    account["roles"] = roles
    account["is_steward"] = "steward" in roles.values()
    return account


def require_user(conn, ctx: Ctx) -> dict:
    user = viewer(conn, ctx)
    if user is None:
        refuse(401, "Sign in to open the console.", "authorization")
    return user


def render(ctx: Ctx, template: str, user: dict | None, status: int = 200, **data) -> HTMLResponse:
    links = list(CONSOLE_LINKS)
    if user and user["is_steward"]:
        links.append(("/console/administration", "Administration"))
    html = env.get_template(template).render(user=user, path=ctx.path, console_links=links, **data)
    return HTMLResponse(html, status_code=status, headers={"Cache-Control": "no-store"})


def simple(template: str):
    def handler(ctx: Ctx) -> HTMLResponse:
        with tx() as conn:
            user = viewer(conn, ctx)
        return render(ctx, template, user, form_token=auth.issue_form_token(), signed_out=ctx.query.get("signed_out") == "1",
                      tier=ctx.query.get("tier") if ctx.query.get("tier") in auth.TIERS else "starter")

    return handler


def plans(ctx: Ctx) -> HTMLResponse:
    with tx() as conn:
        user = viewer(conn, ctx)
        tiers = rules.all_tiers(conn)
    return render(ctx, "plans.html", user, tiers=tiers)


# ---- refusal and not-found pages -------------------------------------------------------------------------------------

def render_refusal(ctx: Ctx, exc: Refusal) -> HTMLResponse:
    with tx() as conn:
        user = viewer(conn, ctx)
    admin = ctx.path.startswith("/console/administration")
    if exc.status == 401:
        if admin:
            return render(ctx, "refusal.html", user, 401, heading="Stewards only", sentence=api_access.STEWARD_ONLY,
                          action=("/login", "Sign in"))
        return render(ctx, "refusal.html", user, 401, heading="Sign in to continue",
                      sentence="Your session has not started or has ended. Sign in to open the console.",
                      action=("/login", "Sign in"))
    if exc.status == 403:
        department = exc.meta.get("department")
        if exc.field == "department" and department:
            return render(ctx, "closed.html", user, 403, department=department)
        if admin:
            return render(ctx, "refusal.html", user, 403, heading="Stewards only", sentence=api_access.STEWARD_ONLY,
                          action=("/console/tables", "Back to your tables"))
        return render(ctx, "refusal.html", user, 403, heading="This action is not open to you",
                      sentence=exc.reason + ".", action=("/console/tables", "Back to your tables"))
    if exc.status == 404:
        return render(ctx, "notfound.html", user, 404)
    return render(ctx, "refusal.html", user, exc.status, heading="That did not work", sentence=exc.reason,
                  action=("/", "Back to the landing page"))


async def not_found_response(request: Request, status: int) -> HTMLResponse:
    ctx = await read(request)

    def build() -> HTMLResponse:
        with tx() as conn:
            user = viewer(conn, ctx)
        if status == 404:
            return render(ctx, "notfound.html", user, 404)
        return render(ctx, "refusal.html", user, status, heading="That did not work",
                      sentence="That method is not allowed here.", action=("/", "Back to the landing page"))

    return await run_in_threadpool(build)


# ---- console ---------------------------------------------------------------------------------------------------------

def console_tables(ctx: Ctx) -> HTMLResponse:
    with tx() as conn:
        user = require_user(conn, ctx)
        items = []
        for department in user["roles"]:
            tier = tier_in_force(conn, department)
            for table in all_(conn, "SELECT * FROM tables WHERE department = %s", (department,)):
                items.append({**table, "count": rules.row_count(conn, table["slug"]), "tier_name": tier["name"],
                              "role": user["roles"][department]})
        items.sort(key=lambda t: (t["name"], t["slug"]))
    return render(ctx, "console_tables.html", user, tables=items)


def console_table(ctx: Ctx) -> HTMLResponse:
    slug = ctx.params["slug"]
    with tx() as conn:
        user = require_user(conn, ctx)
        table = load_table(conn, slug)
        role = auth.require_role(conn, user, table["department"], "viewer", "read this table")
        figures = rules.table_answer(conn, table)
        initial = ctx.params.get("view")
        if initial and uint(initial) is not None:
            row = one(conn, "SELECT name FROM views WHERE table_slug = %s AND id = %s", (slug, uint(initial)))
            initial = row["name"] if row else initial
    rank = auth.RANK[role]
    boot = {"slug": slug, "name": table["name"], "columns": figures["columns"], "role": role,
            "canEdit": rank >= auth.RANK["editor"], "canViews": rank >= auth.RANK["analyst"],
            "canLock": rank >= auth.RANK["steward"], "lockedPeriod": table["locked_period"], "count": figures["count"],
            "allowance": figures["row_allowance"], "tier": figures["tier"], "initialView": initial,
            "email": user["email"]}
    return render(ctx, "console_table.html", user, table=table, figures=figures, boot=boot, role=role)


def console_log(ctx: Ctx) -> HTMLResponse:
    slug = ctx.params["slug"]
    with tx() as conn:
        user = require_user(conn, ctx)
        table = load_table(conn, slug)
        auth.require_role(conn, user, table["department"], "viewer", "read the change log")
        action = ctx.query.get("action") if ctx.query.get("action") in ("create", "update", "delete") else None
        who = (ctx.query.get("account") or "").strip().lower() or None
        number = max(1, uint(ctx.query.get("page"), 10**9) or 1)
        rows, total = log_page(conn, slug, action, who, number)
        tier = tier_in_force(conn, table["department"])
    pages = max(1, -(-total // config.LOG_PAGE))
    return render(ctx, "console_log.html", user, table=table, entries=rows, total=total, number=number, pages=pages,
                  action=action or "", who=who or "", tier=tier["name"])


def console_snapshots(ctx: Ctx) -> HTMLResponse:
    with tx() as conn:
        user = require_user(conn, ctx)
        departments = list(user["roles"])
        listed = snapshots.all_for_departments(conn, departments)
        summary = []
        for department in departments:
            tier = tier_in_force(conn, department)
            summary.append({"department": department, "tier": tier["name"], "retention": tier["retention"],
                            "count": tier["retention_periods"]})
        stewarded = [d for d, r in user["roles"].items() if r == "steward"]
        publishable = all_(conn, "SELECT slug, name FROM tables WHERE department = ANY(%s) ORDER BY slug", (stewarded,))
    return render(ctx, "console_snapshots.html", user, snapshots=listed, summary=summary, publishable=publishable)


def console_requests(ctx: Ctx) -> HTMLResponse:
    with tx() as conn:
        user = require_user(conn, ctx)
        stewarded = [d for d, r in user["roles"].items() if r == "steward"]
        rows = all_(conn, "SELECT * FROM requests WHERE account = %s OR department = ANY(%s) "
                          "ORDER BY (state = 'open') DESC, raised_at DESC, id DESC", (user["email"], stewarded))
        held = {r["department"] for r in all_(conn, "SELECT department FROM role_grants WHERE account = %s",
                                             (user["email"],))}
    open_departments = [d for d in config.DEPARTMENTS if d not in held]
    chosen = ctx.query.get("department") if ctx.query.get("department") in open_departments else None
    return render(ctx, "console_requests.html", user, requests=rows, stewarded=stewarded,
                  open_departments=open_departments, chosen=chosen)


def console_account(ctx: Ctx) -> HTMLResponse:
    with tx() as conn:
        user = require_user(conn, ctx)
        grants = all_(conn, "SELECT department, role, authorises_from FROM role_grants WHERE account = %s "
                            "ORDER BY department", (user["email"],))
        moment = now()
    return render(ctx, "console_account.html", user, grants=grants, moment=moment)


def console_admin(ctx: Ctx) -> HTMLResponse:
    with tx() as conn:
        user = require_user(conn, ctx)
        department = auth.steward_department(conn, user)
        if department is None:
            refuse(403, api_access.STEWARD_ONLY, "role")
        moment = now()
        grants = all_(conn, "SELECT * FROM role_grants WHERE department = %s ORDER BY id", (department,))
        queue = all_(conn, "SELECT * FROM requests WHERE department = %s ORDER BY (state = 'open') DESC, raised_at, id "
                           "LIMIT 20", (department,))
        attempts = all_(conn, "SELECT email, attempted_at, outcome FROM login_attempts ORDER BY attempted_at DESC, id DESC "
                              "LIMIT 25")
    return render(ctx, "console_admin.html", user, department=department, grants=grants, queue=queue,
                  attempts=attempts, moment=moment, phrase=config.BULK_PHRASE)


def console_unknown(ctx: Ctx) -> HTMLResponse:
    refuse(404, "That address is not part of Keystone Tables.", "path")


def page_routes() -> list[Route]:
    def route(path, fn):
        return Route(path, page(fn, render_refusal), methods=["GET"])

    return [
        route("/", simple("home.html")),
        route("/plans", plans),
        route("/enquiry", simple("enquiry.html")),
        route("/community", simple("community.html")),
        route("/developers", simple("developers.html")),
        route("/login", simple("login.html")),
        route("/signup", simple("signup.html")),
        route("/console", console_tables),
        route("/console/tables", console_tables),
        route("/console/tables/{slug}", console_table),
        route("/console/tables/{slug}/views/{view}", console_table),
        route("/console/tables/{slug}/log", console_log),
        route("/console/snapshots", console_snapshots),
        route("/console/requests", console_requests),
        route("/console/account", console_account),
        route("/console/administration", console_admin),
        route("/console/administration/{rest:path}", console_unknown),
    ]
