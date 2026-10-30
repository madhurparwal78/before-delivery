"""The server-rendered surfaces: the staff desk and the public wall."""

import calendar
import functools
from datetime import date, timedelta
from urllib.parse import urlencode

from flask import Blueprint, Response, g, redirect, render_template, request

from . import audit, auth, budget, catalogue, prefs, queue, rules, shapes
from .boundary import session_token
from .db import Row, Tx, transaction
from .errors import not_found
from .money import format_cents
from .timefmt import relative, stamp, today

pages = Blueprint("pages", __name__)
TONES = ("#e86f51", "#f2b134", "#4fa3a5", "#6a5bc4", "#d65a8c", "#5f9e4f",
         "#e0894a", "#3570b8", "#c4a23a", "#8a4fa8", "#4d8f8a", "#b84a2c")
LIGHT_CAPTION = {"#6a5bc4", "#3570b8", "#8a4fa8", "#b84a2c"}
NAV = (("Queue", "/"), ("Catalogue", "/catalogue"), ("Schedule", "/schedule"), ("Budget", "/budget"),
       ("Audit", "/audit"))
LICENCE_CHOICES = ("CC0", "Public domain", "CC BY 4.0", "CC BY-SA 4.0")
VISIT_COOKIE = "clearhouse_visits"
RAIL = (("submit", "Submit for clearance", True), ("start_review", "Start review", True),
        ("licence_review", "Record licence review", True), ("accessibility_review", "Record accessibility review", True),
        ("clear", "Clear for the wall", True), ("schedule", "Schedule", True), ("publish", "Publish now", True),
        ("revise", "Revise", True), ("unschedule", "Unschedule", False), ("return_for_changes", "Return for changes", False),
        ("reject", "Reject", False), ("withdraw", "Withdraw", False))


def html(template: str, status: int = 200, **context: object) -> Response:
    return Response(render_template(template, **chrome(), **context), status=status,
                    content_type="text/html; charset=utf-8")


def chrome() -> dict:
    account = getattr(g, "account", None)
    with transaction() as tx:
        chosen = prefs.load(tx, account["id"]) if account else dict(prefs.DEFAULTS)
        count = rules.cleared_today(tx)
    return {"account": account, "prefs": chosen, "cleared_today": count, "nav": NAV, "path": request.path}


def not_found_page() -> Response:
    if getattr(g, "account", None) is None:
        with transaction() as tx:
            g.account = auth.account_for_token(tx, session_token())
    return html("not_found.html", 404)


def staff(view):
    """Authentication before any lookup: no session redirects to sign-in with the path to return to."""
    @functools.wraps(view)
    def wrapper(**kwargs):
        with transaction() as tx:
            g.account = auth.account_for_token(tx, session_token())
        if g.account is None:
            target = request.full_path.rstrip("?")
            return redirect("/login?" + urlencode({"next": target}), 302)
        return view(**kwargs)
    return wrapper


# Template helpers ------------------------------------------------------------------------------------------

@pages.app_template_filter("money")
def money_filter(cents: int) -> str:
    return format_cents(cents)


@pages.app_template_filter("when")
def when_filter(moment, display: str = "relative") -> str:
    if moment is None:
        return ""
    return relative(moment) if display == "relative" else stamp(moment)


@pages.app_template_filter("stamp")
def stamp_filter(moment) -> str:
    return stamp(moment)


@pages.app_template_global()
def tone(object_id: int) -> dict:
    colour = TONES[object_id % 12]
    return {"fill": colour, "ink": "#ffffff" if colour in LIGHT_CAPTION else "#1b1d21"}


@pages.app_template_global()
def mark(result: str | None, waiting: bool = False) -> dict:
    if result == "pass":
        return {"word": "Passed", "icon": "check", "tone": "pass"}
    if result == "fail":
        return {"word": "Failed", "icon": "cross", "tone": "fail"}
    return {"word": "Not yet", "icon": "dash", "tone": "wait" if waiting else "none"}


@pages.app_template_global()
def usable(obj: Row) -> bool:
    return obj["license"] in rules.ALLOWED_LICENCES


def cover_titles(tx: Tx, piece_ids: list[int]) -> dict[int, list[Row]]:
    found: dict[int, list[Row]] = {pid: [] for pid in piece_ids}
    for row in tx.rows("SELECT po.piece_id, o.id, o.title FROM piece_objects po JOIN objects o ON o.id = po.object_id "
                       "WHERE po.piece_id = ANY(CAST(:ids AS bigint[])) AND po.position < 3 "
                       "ORDER BY po.piece_id, po.position", ids=piece_ids):
        found[row["piece_id"]].append(row)
    return found


# Sign in ----------------------------------------------------------------------------------------------------

@pages.get("/login")
def login() -> Response:
    with transaction() as tx:
        g.account = auth.account_for_token(tx, session_token())
    if g.account:
        return redirect("/", 302)
    return html("login.html", next_path=auth.safe_next(request.args.get("next")))


# The queue -------------------------------------------------------------------------------------------------

@pages.get("/")
@staff
def queue_page() -> Response:
    chosen = queue.options(request.args)
    with transaction() as tx:
        per_page = prefs.load(tx, g.account["id"])["rows_per_page"]
        rows, total = queue.search(tx, g.account, chosen, per_page)
        counts = queue.counts(tx, g.account)
    filtered = bool(chosen["state"] or chosen["mine"] or chosen["needs"] or len(chosen["q"]) >= 2)
    base = {k: v for k, v in (("q", chosen["q"]), ("sort", chosen["sort"]), ("state", chosen["state"]),
                              ("mine", "1" if chosen["mine"] else None), ("needs", "1" if chosen["needs"] else None))
            if v}
    pager = {"previous": f"/?{urlencode(base | {'page': chosen['page'] - 1})}" if chosen["page"] > 1 else None,
             "next": f"/?{urlencode(base | {'page': chosen['page'] + 1})}" if chosen["page"] * per_page < total
             else None}
    without_state = {k: v for k, v in base.items() if k != "state"}
    state_href = {s: "/?" + urlencode(without_state | ({} if chosen["state"] == s else {"state": s}))
                  for s in rules.STATES}
    return html("queue.html", rows=rows, total=total, all_total=sum(counts.values()), counts=counts, chosen=chosen,
                filtered=filtered, pager=pager, states=rules.STATES, state_href=state_href)


# The piece desk --------------------------------------------------------------------------------------------

@pages.get("/pieces/<int:piece_id>")
@staff
def desk(piece_id: int) -> Response:
    with transaction() as tx:
        piece = rules.find_piece(tx, g.account, piece_id, lock=False)
        detail = shapes.piece_row(tx, piece_id)
        objects = shapes.cited_objects(tx, piece_id)
        acks = shapes.acks(tx, piece_id)
        flagged = catalogue.flagged_pairs(tx, [o["id"] for o in objects])
        reviews = {r["kind"]: r for r in shapes.reviews(tx, piece_id)}
        history = shapes.piece_audit(tx, piece_id)
        actions = rules.rail_actions(tx, g.account, piece)
        needs = queue.needs_ids(tx, g.account)
        booked = rules.booked_day(tx, piece_id)
    duplicates = {}
    for obj in objects:
        mine = [dup for oid, dup in flagged if oid == obj["id"]]
        if mine:
            done = [a for a in acks if a["object_id"] == obj["id"] and a["duplicate_object_id"] in mine]
            duplicates[obj["id"]] = done[-1]["acknowledged_by_name"] if len(done) == len(mine) else None
    later = needs[needs.index(piece_id) + 1:] if piece_id in needs else needs
    return html("desk.html", piece=detail, objects=objects, layout=catalogue.board_layout(objects),
                duplicates=duplicates, reviews=reviews, history=history,
                rail=[(name, label, primary and index == 0) for index, (name, label, primary)
                      in enumerate(r for r in RAIL if r[0] in actions)],
                editable=g.account["role"] == "maker" and piece["owner_id"] == g.account["id"]
                and piece["state"] == "draft",
                next_piece=later[0] if later else None, booked=booked, today=today())


# The catalogue ---------------------------------------------------------------------------------------------

def walk_from_args(tx: Tx) -> tuple[dict, dict]:
    args = request.args
    chosen = {"seed": catalogue.whole(args.get("seed"), 1, 1, catalogue.SEED_MAX), "q": args.get("q") or "",
              "license": args.get("license") if args.get("license") in LICENCE_CHOICES else ""}
    page = catalogue.walk(tx, seed=chosen["seed"], cursor=args.get("cursor") or None, limit=catalogue.PAGE_LIMIT,
                          q=chosen["q"], licence=chosen["license"])
    return chosen, page


@pages.get("/catalogue")
@staff
def catalogue_page() -> Response:
    with transaction() as tx:
        chosen, page = walk_from_args(tx)

    def link(cursor: str | None) -> dict:
        return {k: v for k, v in (("seed", chosen["seed"]), ("q", chosen["q"]), ("license", chosen["license"]),
                                  ("cursor", cursor)) if v}
    return html("catalogue.html", chosen=chosen, page=page, layout=catalogue.board_layout(page["objects"]),
                first=page["offset"] + 1 if page["objects"] else 0, last=page["offset"] + len(page["objects"]),
                next_query=link(page["nextCursor"]),
                previous_query=link(page["previousCursor"]) if page["previousCursor"] else None,
                licences=LICENCE_CHOICES)


@pages.get("/catalogue/<int:object_id>")
@staff
def object_page(object_id: int) -> Response:
    with transaction() as tx:
        obj = tx.one("SELECT * FROM objects WHERE id = :id", id=object_id)
        if obj is None:
            raise not_found()
        found = catalogue.similar(tx, obj)
        context = None
        wanted = request.args.get("piece", "")
        if wanted.isdigit() and g.account["role"] == "licence_reviewer":
            context = tx.one(f"SELECT p.id, p.title FROM pieces p WHERE p.id = :id AND p.state = 'in_review' AND "
                             f"{rules.visible_clause(g.account)} AND EXISTS (SELECT 1 FROM piece_objects po "
                             "WHERE po.piece_id = p.id AND po.object_id = :o)", id=int(wanted), o=object_id,
                             me=g.account["id"])
        acked = {}
        if context:
            acked = {a["duplicate_object_id"]: a["acknowledged_by_name"] for a in shapes.acks(tx, context["id"])
                     if a["object_id"] == object_id}
    return html("object.html", obj=obj, similar=found, context=context, acked=acked,
                duplicate_score=catalogue.DUPLICATE_SCORE)


# Schedule, budget, audit, settings -------------------------------------------------------------------------

@pages.get("/schedule")
@staff
def schedule_page() -> Response:
    raw = request.args.get("month", "")
    current = today()
    try:
        first = date.fromisoformat(raw + "-01") if raw else current.replace(day=1)
    except ValueError:
        first = current.replace(day=1)
    with transaction() as tx:
        slots = {r["day"]: r for r in tx.rows(
            "SELECT s.day, s.view_count, p.id, p.title, p.state, p.version FROM schedule_slots s "
            "JOIN pieces p ON p.id = s.piece_id WHERE s.day >= :a AND s.day < :b",
            a=first - timedelta(days=7), b=first + timedelta(days=45))}
        cleared = tx.rows("SELECT p.id, p.title, p.fee_cents, p.version, a.name AS owner_name FROM pieces p "
                          "JOIN accounts a ON a.id = p.owner_id WHERE p.state = 'cleared' ORDER BY p.title")
        featured = tx.one("SELECT s.view_count, p.id, p.title, p.state, a.name AS owner_name FROM schedule_slots s "
                          "JOIN pieces p ON p.id = s.piece_id JOIN accounts a ON a.id = p.owner_id "
                          "WHERE s.day = :d", d=current)
    weeks = calendar.Calendar(firstweekday=0).monthdatescalendar(first.year, first.month)
    previous_month = (first - timedelta(days=1)).replace(day=1)
    next_month = (first + timedelta(days=32)).replace(day=1)
    return html("schedule.html", weeks=weeks, first=first, slots=slots, cleared=cleared, featured=featured,
                today=current, previous_month=previous_month.isoformat()[:7], next_month=next_month.isoformat()[:7],
                month_name=f"{calendar.month_name[first.month]} {first.year}")


@pages.get("/budget")
@staff
def budget_page() -> Response:
    quarter = rules.current_quarter()
    with transaction() as tx:
        view = budget.view(tx, g.account, quarter)
    return html("budget.html", view=view, heading=quarter.replace("-", " "))


@pages.get("/audit")
@staff
def audit_page() -> Response:
    chosen = audit.filters(request.args)
    page = catalogue.whole(request.args.get("page"), 1, 1)
    with transaction() as tx:
        per_page = prefs.load(tx, g.account["id"])["rows_per_page"]
        rows, total = audit.listing(tx, g.account, chosen, page=page, per_page=per_page)
        piece_options = tx.rows(f"SELECT p.id, p.title FROM pieces p WHERE {rules.visible_clause(g.account)} "
                                "ORDER BY lower(p.title), p.id", me=g.account["id"])
        actors = tx.rows("SELECT id, name, role FROM accounts ORDER BY created_at")
    query = {k: v for k, v in (("piece", chosen["piece"]), ("actor", chosen["actor"]), ("to", chosen["to"]),
                               ("from", chosen["from"] and chosen["from"].isoformat()),
                               ("until", chosen["until"] and chosen["until"].isoformat())) if v}
    pager = {"previous": f"/audit?{urlencode(query | {'page': page - 1})}" if page > 1 else None,
             "next": f"/audit?{urlencode(query | {'page': page + 1})}" if page * per_page < total else None}
    return html("audit.html", rows=rows, total=total, chosen=chosen, page=page, per_page=per_page, pager=pager,
                piece_options=piece_options, actors=actors, states=rules.STATES,
                export=f"/api/audit/export?{urlencode(query)}" if query else "/api/audit/export")


@pages.get("/settings")
@staff
def settings_page() -> Response:
    return html("settings.html")


# The public wall -------------------------------------------------------------------------------------------

@pages.get("/wall")
def wall() -> Response:
    with transaction() as tx:
        g.account = None
        shown = tx.rows("SELECT p.id, p.title, p.published_at, a.name AS owner_name FROM pieces p "
                        "JOIN accounts a ON a.id = p.owner_id WHERE p.state = 'published' "
                        "ORDER BY p.published_at DESC, p.id DESC")
        covers = cover_titles(tx, [p["id"] for p in shown])
    return html("wall.html", shown=shown, covers=covers)


@pages.get("/wall/<int:piece_id>")
def plaque(piece_id: int) -> Response:
    g.account = None
    seen = [v for v in request.cookies.get(VISIT_COOKIE, "").split("-") if v.isdigit()]
    with transaction() as tx:
        piece = tx.one("SELECT p.*, a.name AS owner_name FROM pieces p JOIN accounts a ON a.id = p.owner_id "
                       "WHERE p.id = :id AND p.state = 'published'", id=piece_id)
        if piece is None:
            raise not_found()
        sources = shapes.cited_objects(tx, piece_id)
        lead = tx.value(
            "SELECT a.name FROM audit_entries e JOIN accounts a ON a.id = e.actor_id WHERE e.piece_id = :id AND "
            "(e.to_state = 'cleared' OR coalesce(e.from_state, '') = '') ORDER BY e.created_at, e.id LIMIT 1",
            id=piece_id)
        first_visit = str(piece_id) not in seen
        if first_visit:
            tx.run("UPDATE schedule_slots SET view_count = view_count + 1 WHERE piece_id = :id", id=piece_id)
        covers = cover_titles(tx, [piece_id])
    response = html("plaque.html", piece=piece, sources=sources, lead=lead, covers=covers)
    if first_visit:
        response.set_cookie(VISIT_COOKIE, "-".join((seen + [str(piece_id)])[-200:]), httponly=True,
                            samesite="Lax", path="/wall")
    return response
