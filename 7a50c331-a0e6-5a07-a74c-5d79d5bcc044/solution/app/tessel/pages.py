"""Server-rendered pages: the public site and its markdown twins, the sign-in, reset and contact forms (which work
as plain documents), and the console pages."""
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, quote, urlencode

from jinja2 import Environment, FileSystemLoader, select_autoescape
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response

from . import api, billing, db, graph, routes_account, text, writelog
from .content import CONTACT_PAGE, LANDING
from .fields import validate
from .refusals import ApiError

COOKIE = "tessel_session"
env = Environment(loader=FileSystemLoader(Path(__file__).parent / "templates"), autoescape=select_autoescape(["html"]),
                  trim_blocks=True, lstrip_blocks=True)
env.filters.update(dollars=text.dollars, count=text.count, ts=text.ts)
NAVIGATION_TAIL = ["---", "", "## Navigation", "- [Architecture](/#architecture)", "- [Benchmarks](/#benchmarks)",
                   "- [Pricing](/#pricing)", "- [FAQs Common questions](/#faq)", "- [Contact](/contact)"]
NOTICES = {"ended": "Your session has ended. Sign in again.",
           "reset": "Your password was reset. Sign in with the new one."}
PASSWORD_MISMATCH = "The passwords do not match"


def render(name: str, status: int = 200, headers: dict | None = None, **context) -> HTMLResponse:
    return HTMLResponse(env.get_template(name).render(**context), status_code=status, headers=headers)


def unavailable() -> HTMLResponse:
    return render("unavailable.html", 503, title="Try again · Tessel", description="Tessel cannot answer right now.")


def not_found() -> HTMLResponse:
    return render("not_found.html", 404, title="Page not found · Tessel", description="This address holds no page.")


# ---- markdown twins -----------------------------------------------------------------------------

class _Twin(HTMLParser):
    """The page's <main> as markdown: headings with one # per level, paragraphs as lines, links as [text](href)."""

    BLOCKS = {"p", "li", "dt", "dd", "figcaption", "caption", "tr", "summary", "blockquote", "button", "label"}
    VOID = {"br", "img", "input", "meta", "link", "hr", "source", "wbr", "path", "line", "rect", "circle", "polyline"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.lines, self.buf, self.in_main, self.skip, self.link, self.heading = [], [], 0, 0, None, 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "main":
            self.in_main += 1
            return
        if not self.in_main or tag in self.VOID:
            return
        if self.skip or a.get("data-md") == "skip" or "hidden" in a or tag in ("script", "style", "svg", "template"):
            self.skip += 1
            return
        if re.fullmatch(r"h[1-6]", tag):
            self.flush()
            self.heading = int(tag[1])
        elif tag in self.BLOCKS:
            self.flush()
        elif tag == "a":
            self.link = (a.get("href") or "", len(self.buf))
        elif tag in ("td", "th"):
            self.buf.append(" | " if self.buf else "")

    def handle_endtag(self, tag):
        if tag == "main":
            self.flush()
            self.in_main -= 1
            return
        if not self.in_main or tag in self.VOID:
            return
        if self.skip:
            self.skip -= 1
            return
        if tag == "a" and self.link:
            href, start = self.link
            inner = " ".join("".join(self.buf[start:]).split())
            del self.buf[start:]
            self.buf.append(f"[{inner}]({href})" if inner else "")
            self.link = None
        elif re.fullmatch(r"h[1-6]", tag) or tag in self.BLOCKS:
            self.flush()

    def handle_data(self, data):
        if self.in_main and not self.skip:
            self.buf.append(data)

    def flush(self):
        line = " ".join("".join(self.buf).split()).strip(" |")
        self.buf = []
        if line:
            self.lines.append(("#" * self.heading + " " + line) if self.heading else line)
        self.heading = 0


def markdown_twin(page: str, title: str, description: str) -> str:
    parser = _Twin()
    parser.feed(page)
    return "\n".join(["---", f'title: "{title}"', f"description: {description}", "---", "", *parser.lines, "",
                      *NAVIGATION_TAIL]) + "\n"


def public_page(request: Request, template: str, content: dict, status: int = 200, **context) -> Response:
    title, description = content["title"], content["description"]
    page = env.get_template(template).render(path=request.url.path, reader_open=request.query_params.get("view") == "ai",
                                             **content, **context)
    if "md" in request.query_params or "text/markdown" in (request.headers.get("accept") or ""):
        return Response(markdown_twin(page, title, description), media_type="text/markdown; charset=utf-8",
                        headers={"Vary": "Accept"})
    return HTMLResponse(page, status_code=status, headers={"Vary": "Accept"})


def landing(request: Request, form: dict) -> Response:
    return public_page(request, "landing.html", LANDING)


def _form_ctx(request: Request) -> api.Ctx:
    return api.Ctx("", request.headers, {}, {})


def contact_page(request: Request, form: dict) -> Response:
    """GET shows the form; a plain-document POST stores (or traps) and thanks, or refuses beside the field."""
    if request.method != "POST":
        return public_page(request, "contact.html", CONTACT_PAGE)
    typed = {k: form.get(k, "") for k in ("email", "message", "website")}
    try:
        with db.tx() as t:
            routes_account.store_contact(t, validate(routes_account.CONTACT, typed))
    except ApiError as err:
        return public_page(request, "contact.html", CONTACT_PAGE, err.status, typed=typed, error=err)
    return public_page(request, "contact.html", CONTACT_PAGE, thanks=True)


# ---- signing in ---------------------------------------------------------------------------------

CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def safe_next(value: str | None) -> str:
    """The return-path rule: a plain /console path, else /console."""
    if not value or not (value == "/console" or value.startswith(("/console/", "/console?"))):
        return "/console"
    path = value.split("?", 1)[0]
    if "\\" in value or "//" in value or CONTROL.search(value) or \
            any(segment in (".", "..") for segment in path.split("/")):
        return "/console"
    return value


def _cookie_principal(request: Request) -> api.Principal | None:
    token = request.cookies.get(COOKIE)
    p = api.principal_for(token) if token else None
    return p if p and p.kind == "member" else None


def _login_view(status: int = 200, **context) -> HTMLResponse:
    return render("login.html", status, title="Sign in · Tessel", description="Sign in to the Tessel console.",
                  **context)


def login_page(request: Request, form: dict) -> Response:
    if request.method != "POST":
        q = request.query_params
        return _login_view(next=q.get("next", ""), notice=NOTICES.get(next((k for k in NOTICES if k in q), "")),
                           recovery="recovery" in q)
    if form.get("intent") == "signout":
        return _sign_out(request)
    email, nxt = form.get("email", ""), form.get("next", "")
    recovery = "recovery_code" in form
    try:
        with db.tx() as t:
            token, _ = routes_account.sign_in(t, email, form.get("password", ""), form.get("totp") or None,
                                              form.get("recovery_code") or None)
    except ApiError as err:
        step_two = err.code in ("TOTP_REQUIRED", "BAD_TOTP")
        return _login_view(err.status, headers=err.headers, next=nxt, email=email, error=err, step_two=step_two,
                           recovery=recovery)
    response = RedirectResponse(safe_next(nxt), 303)
    response.set_cookie(COOKIE, token, httponly=True, samesite="lax", path="/")
    return response


def _sign_out(request: Request) -> Response:
    p = _cookie_principal(request)
    if p:
        with db.tx() as t:
            routes_account.end_session(t, p.session_id)
    response = RedirectResponse("/", 303)
    response.delete_cookie(COOKIE, path="/")
    return response


def forgot_page(request: Request, form: dict) -> Response:
    context = {"title": "Reset your password · Tessel", "description": "Ask for a link to set a new Tessel password."}
    if request.method != "POST":
        return render("forgot.html", **context)
    try:
        ctx = _form_ctx(request)
        with db.tx() as t:
            ctx.tx = t
            routes_account.request_reset(ctx, validate(routes_account.FORGOT, {"email": form.get("email", "")})["email"])
        for action in ctx.after:
            action()
    except ApiError as err:
        return render("forgot.html", err.status, error=err, email=form.get("email", ""), **context)
    return render("forgot.html", sent=True, **context)


def reset_page(request: Request, form: dict) -> Response:
    context = {"title": "Set a new password · Tessel", "description": "Choose a new Tessel password."}
    token = (form if request.method == "POST" else request.query_params).get("token", "")
    with db.tx() as t:
        valid = bool(token) and routes_account.reset_member(t, token) is not None
    if not valid:
        return render("reset.html", 400 if request.method == "POST" else 200, valid=False,
                      message=ApiError("RESET_TOKEN_INVALID").message, **context)
    if request.method != "POST":
        return render("reset.html", valid=True, token=token, **context)
    password, confirm = form.get("password", ""), form.get("confirm", "")
    if password != confirm:
        return render("reset.html", 400, valid=True, token=token, mismatch=PASSWORD_MISMATCH, **context)
    try:
        ctx = _form_ctx(request)
        with db.tx() as t:
            ctx.tx = t
            body = validate(routes_account.RESET, {"token": token, "password": password})
            routes_account.reset_password(ctx, body["token"], body["password"])
        for action in ctx.after:
            action()
    except ApiError as err:
        return render("reset.html", err.status, valid=True, token=token, error=err, **context)
    return RedirectResponse("/login?reset=1", 303)


# ---- the console --------------------------------------------------------------------------------

def _to_login(request: Request) -> Response:
    target = request.url.path + (f"?{request.url.query}" if request.url.query else "")
    query = {"next": target, **({"ended": "1"} if request.cookies.get(COOKIE) else {})}
    return RedirectResponse("/login?" + urlencode(query, quote_via=quote), 303)


def _console(request: Request, template: str, title: str, active: str, status: int = 200, **context) -> Response:
    response = render(template, status, title=f"{title} · Tessel", description="The Tessel console.", active=active,
                      token=request.cookies.get(COOKIE), **context)
    response.headers["Cache-Control"] = "no-store"
    return response


def console_page(request: Request, form: dict, match: re.Match) -> Response:
    p = _cookie_principal(request)
    if not p:
        return _to_login(request)
    view = CONSOLE_VIEWS[match.group("view")]
    return view(request, p)


def _databases_view(request: Request, p: api.Principal) -> Response:
    with db.tx() as t:
        rows = writelog.visible(t, p)
        counts = {r["database_id"]: r for r in t.rows(
            "SELECT c.database_id, count(DISTINCT c.name) AS collections, count(s.id) FILTER (WHERE NOT s.deleted) "
            "AS sources FROM collections c LEFT JOIN sources s ON s.database_id = c.database_id AND "
            "s.collection = c.name JOIN databases d ON d.id = c.database_id WHERE d.organization_id = :o "
            "GROUP BY c.database_id", o=p.org_id)}
    databases = [{"name": r["name"], "status": writelog.status_of(r), "collections": counts[r["id"]]["collections"],
                  "sources": counts[r["id"]]["sources"], "pending": r["last_lsn"] - r["indexed_lsn"],
                  "generation": r["index_generation"], "created_at": text.ts(r["created_at"])} for r in rows]
    return _console(request, "console_list.html", "Databases", "databases", me=p, databases=databases)


def workspace_page(request: Request, form: dict, match: re.Match) -> Response:
    p = _cookie_principal(request)
    if not p:
        return _to_login(request)
    with db.tx() as t:
        row = t.one("SELECT * FROM databases WHERE organization_id = :o AND name = :n", o=p.org_id,
                    n=match.group("name"))
        g = graph.Graph.load(t, row["id"]) if row else None
    if not row:
        return _console(request, "console_missing.html", "Database not found", "databases", 404, me=p)
    tab = request.query_params.get("tab")
    workspace = {"database": row["name"], "role": p.role, "moments": g.moments(), "predicates": g.predicates()}
    return _console(request, "workspace.html", row["name"], "databases", me=p, database=row["name"],
                    tab=tab if tab in WORKSPACE_TABS else "sources", tabs=WORKSPACE_TABS,
                    workspace_json=json.dumps(workspace).replace("<", "\\u003c"))


WORKSPACE_TABS = {"sources": "Sources", "graph": "Graph query", "search": "Search", "entity": "Entity",
                  "stats": "Stats", "explore": "Explore"}


def _settings_view(request: Request, p: api.Principal) -> Response:
    with db.tx() as t:
        members = routes_account.members_of(t, p.org_id)
        totp_on = t.one("SELECT totp_enabled FROM members WHERE id = :m", m=p.member_id)["totp_enabled"]
    return _console(request, "settings.html", "Members", "settings", me=p, members=members, totp_on=totp_on,
                    panel="members")


def _owner_only(view):
    def guarded(request: Request, p: api.Principal) -> Response:
        if p.role != "owner":
            return _console(request, "no_access.html", "No access", "settings", 403, me=p, panel=None)
        return view(request, p)
    return guarded


@_owner_only
def _keys_view(request: Request, p: api.Principal) -> Response:
    with db.tx() as t:
        keys = [{**routes_account.key_view(k), "databases": routes_account.key_scope(t, k)}
                for k in routes_account.keys_of(t, p.org_id)]
        names = [r["name"] for r in writelog.visible(t, p)]
    return _console(request, "keys.html", "API keys", "settings", me=p, keys=keys, database_names=names, panel="keys")


@_owner_only
def _billing_view(request: Request, p: api.Principal) -> Response:
    with db.tx() as t:
        plan = routes_account.current_plan(t, p.org_id)
        bill = billing.usage(t, p.org_id, plan)
        daily = billing.daily(t, p.org_id)
    tallest = max([d["tokens"] for d in daily["days"]] + [1])
    return _console(request, "billing.html", "Plan and usage", "settings", me=p, plan=plan, bill=bill,
                    days=daily["days"], tallest=tallest, plan_title=billing.PLAN_TITLE, panel="billing")


@_owner_only
def _audit_view(request: Request, p: api.Principal) -> Response:
    q = {k: v for k, v in request.query_params.items() if k in ("action", "actor")}
    try:
        _, action, actor = routes_account.audit_filters(q)
    except ApiError:
        action, actor = None, None
    with db.tx() as t:
        page = routes_account.audit_page(t, p.org_id, 20, action, actor)
    return _console(request, "audit.html", "Audit log", "settings", me=p, page=page, actions=routes_account.AUDIT_ACTIONS,
                    action=action or "", actor=q.get("actor", ""), panel="audit")


CONSOLE_VIEWS = {"": _databases_view, "/settings": _settings_view, "/settings/keys": _keys_view,
                 "/settings/billing": _billing_view, "/settings/audit": _audit_view}

PAGES = [
    ({"GET"}, re.compile(r"^/$"), landing),
    ({"GET", "POST"}, re.compile(r"^/contact$"), contact_page),
    ({"GET", "POST"}, re.compile(r"^/login$"), login_page),
    ({"GET", "POST"}, re.compile(r"^/forgot$"), forgot_page),
    ({"GET", "POST"}, re.compile(r"^/reset$"), reset_page),
    ({"GET"}, re.compile(r"^/console(?P<view>|/settings|/settings/keys|/settings/billing|/settings/audit)$"),
     console_page),
    ({"GET"}, re.compile(r"^/console/db/(?P<name>[^/]+)$"), workspace_page),
]


async def handle(request: Request) -> Response:
    method = "GET" if request.method == "HEAD" else request.method
    for methods, pattern, page in PAGES:
        match = pattern.match(request.url.path)
        if match and method in methods:
            form = {}
            if method == "POST":
                form = {k: v[0] for k, v in parse_qs((await request.body()).decode("utf-8", "replace"),
                                                      keep_blank_values=True).items()}
            args = (request, form, match) if pattern.groups else (request, form)
            return await run_in_threadpool(page, *args)
    return not_found()

