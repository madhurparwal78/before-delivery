"""Server-rendered surfaces. Every page answers its own address with its data."""
import datetime as dt
from functools import wraps
from urllib.parse import quote, urlencode

from flask import Blueprint, Response, g, redirect, render_template, request

from . import auth, config, errors, identity, timeutil
from .db import row, rows, tx, value
from .domain import audit, budget, catalogue, guard, pieces, prefs, schedule, states
from .money import dollars

bp = Blueprint("views", __name__)

ROLE_LABELS = {
    "maker": "Maker",
    "licence_reviewer": "Licence reviewer",
    "access_reviewer": "Accessibility reviewer",
    "lead": "Clearance lead",
    "auditor": "Auditor",
}
SORT_OPTIONS = (
    ("newest", "Newest first"),
    ("oldest", "Oldest first"),
    ("title", "Title A to Z"),
    ("fee", "Fee high to low"),
)
ACTION_LABELS = {
    "submit": "Submit for clearance",
    "start_review": "Start review",
    "review:licence": "Record licence review",
    "review:accessibility": "Record accessibility review",
    "clear": "Clear for the wall",
    "return_for_changes": "Return for changes",
    "reject": "Reject",
    "schedule": "Schedule",
    "publish": "Publish now",
    "unschedule": "Unschedule",
    "withdraw": "Withdraw",
    "revise": "Revise",
}
RAIL_ORDER = (
    "submit",
    "start_review",
    "review:licence",
    "review:accessibility",
    "clear",
    "schedule",
    "publish",
    "unschedule",
    "withdraw",
    "return_for_changes",
    "reject",
    "revise",
)
REASON_ACTIONS = ("return_for_changes", "reject", "withdraw")
TAGLINE = "Small exhibits, cleared for the floor"
FOOTER_LINE = "Every piece here names its sources"


def staff(view):
    @wraps(view)
    def wrapped(**kwargs):
        if g.account is None:
            target = request.path
            if request.query_string:
                target += "?" + request.query_string.decode("utf-8")
            return redirect("/login?next=" + quote(target, safe="/"))
        return view(**kwargs)

    return wrapped


def whole_id(text):
    if not text.isdigit():
        raise errors.not_found()
    return int(text)


def page_number(text):
    return int(text) if (text or "").isdigit() and int(text) > 0 else 1


@bp.app_template_filter("money")
def money_filter(cents):
    return dollars(cents)


def settings_for_request():
    """The signed-in account's preferences, read once per request."""
    if not hasattr(g, "settings"):
        account = getattr(g, "account", None)
        if account is None:
            g.settings = dict(prefs.DEFAULTS)
        else:
            with tx() as conn:
                g.settings = prefs.get(conn, account["id"])
    return g.settings


@bp.app_template_filter("when")
def when_filter(moment):
    if not moment:
        return ""
    parsed = (
        moment
        if isinstance(moment, dt.datetime)
        else dt.datetime.fromisoformat(moment.replace("Z", "+00:00"))
    )
    if settings_for_request()["date_display"] == "absolute":
        return timeutil.stamp(parsed)
    return timeutil.relative(parsed)


@bp.app_template_filter("day")
def day_filter(moment):
    if not moment:
        return ""
    parsed = (
        moment
        if isinstance(moment, dt.datetime)
        else dt.datetime.fromisoformat(moment.replace("Z", "+00:00"))
    )
    return parsed.astimezone(dt.timezone.utc).strftime("%Y-%m-%d")


@bp.app_template_filter("stamp")
def stamp_filter(moment):
    parsed = (
        moment
        if isinstance(moment, dt.datetime)
        else dt.datetime.fromisoformat(moment.replace("Z", "+00:00"))
    )
    return timeutil.stamp(parsed)


@bp.get("/login")
def login_page():
    if g.account is not None:
        return redirect("/")
    return render_template(
        "login.html",
        next_path=auth.safe_next(request.args.get("next")),
        outage=None if identity.monitor.is_up() else errors.IDENTITY_DOWN,
    )


@bp.get("/")
@staff
def queue_page():
    settings = settings_for_request()
    with tx() as conn:
        state = request.args.get("state")
        result = pieces.queue(
            conn,
            g.account,
            state=state,
            mine=request.args.get("mine") == "1",
            needs=request.args.get("needs") == "1",
            q=request.args.get("q"),
            sort=request.args.get("sort", "newest"),
            page=page_number(request.args.get("page")),
            rows_per_page=settings["rows_per_page"],
        )
    return render_template(
        "queue.html",
        result=result,
        visible_total=sum(result["counts"].values()),
        state=state,
        mine=request.args.get("mine") == "1",
        needs=request.args.get("needs") == "1",
        q=request.args.get("q") or "",
        sort=request.args.get("sort", "newest"),
        sorts=SORT_OPTIONS,
        states=states.STATES,
    )


def _duplicate_marks(conn, piece_id, cited):
    flagged = catalogue.flagged_duplicates(conn, [obj["id"] for obj in cited])
    acked = {
        (entry["object_id"], entry["duplicate_object_id"]): entry["acknowledged_by_name"]
        for entry in pieces.acks_of(conn, piece_id)
    }
    marks = {}
    for object_id, duplicates in flagged.items():
        if not duplicates:
            continue
        names = [
            acked.get((object_id, duplicate["id"])) for duplicate in duplicates
        ]
        marks[object_id] = {
            "duplicates": duplicates,
            "acknowledged_by": names[0] if all(names) else None,
        }
    return marks


def rail_for(account, piece):
    offered = []
    for action in RAIL_ORDER:
        if action.startswith("review:"):
            kind = action.split(":", 1)[1]
            if piece["state"] != states.REVIEW_STATE:
                continue
            if piece["licence_review" if kind == "licence" else "accessibility_review"]:
                continue
            intent = action
        else:
            if not states.allows(action, piece["state"]):
                continue
            intent = "transition:" + action
        try:
            guard.may_act(account, intent, piece, piece["licence_reviewer_id"])
        except errors.Refusal:
            continue
        offered.append(action)
    return offered


def _next_in_queue(conn, piece_id):
    if g.account["role"] not in pieces.NEEDS:
        return None
    waiting = pieces.queue(
        conn, g.account, needs=True, rows_per_page=100
    )["rows"]
    ids = [found["id"] for found in waiting]
    if piece_id in ids:
        position = ids.index(piece_id)
        return ids[position + 1] if position + 1 < len(ids) else None
    return ids[0] if ids else None


@bp.get("/pieces/<piece_id>")
@staff
def piece_page(piece_id):
    with tx() as conn:
        piece = pieces.visible(conn, whole_id(piece_id), g.account)
        cited = pieces.cited_objects(conn, piece["id"])
        return render_template(
            "piece.html",
            piece=piece,
            cited=[(obj,) + catalogue.box(obj) for obj in cited],
            marks=_duplicate_marks(conn, piece["id"], cited),
            reviews={
                entry["kind"]: entry for entry in pieces.reviews_of(conn, piece["id"])
            },
            history=pieces.piece_audit(conn, piece["id"]),
            rail=rail_for(g.account, piece),
            labels=ACTION_LABELS,
            reason_actions=REASON_ACTIONS,
            next_piece=_next_in_queue(conn, piece["id"]),
            booked_day=schedule.day_of(conn, piece["id"]),
        )


def _board(found):
    """The deterministic board order: largest box first, catalogue order for ties."""
    drawn = [(obj,) + catalogue.box(obj) for obj in found]
    return sorted(
        enumerate(drawn), key=lambda pair: (-(pair[1][1] * pair[1][2]), pair[0])
    )


@bp.get("/catalogue")
@staff
def catalogue_page():
    seed = request.args.get("seed") or "1"
    seed = int(seed) if seed.isdigit() and 1 <= int(seed) <= catalogue.MAX_SEED else 1
    cursor = request.args.get("cursor")
    licence = request.args.get("license") or ""
    search = request.args.get("q") or ""
    with tx() as conn:
        found = catalogue.walk(
            conn, cursor, catalogue.MAX_LIMIT, seed, search, licence or None
        )
        previous = (
            catalogue.cursor_at(
                conn,
                seed,
                search,
                licence or None,
                found["offset"] - catalogue.MAX_LIMIT,
            )
            if found["offset"] > 0
            else None
        )
    return render_template(
        "catalogue.html",
        board=[item for _, item in _board(found["objects"])],
        found=found,
        seed=seed,
        cursor=cursor or "",
        previous=previous,
        licence=licence,
        licences=catalogue.ALLOWED_LICENCES,
        q=search,
        first=found["offset"] + 1 if found["objects"] else 0,
        last=found["offset"] + len(found["objects"]),
    )


@bp.get("/catalogue/<object_id>")
@staff
def object_page(object_id):
    with tx() as conn:
        obj = catalogue.get(conn, whole_id(object_id))
        if obj is None:
            raise errors.not_found()
        similar = catalogue.similar(conn, obj, limit=20)
        piece_id = request.args.get("piece")
        context = None
        if piece_id and piece_id.isdigit() and g.account["role"] == "licence_reviewer":
            candidate = row(
                conn,
                "select p.id, p.state from pieces p where p.id = %(id)s"
                + guard.visible_sql(account=g.account),
                {"id": int(piece_id), "viewer": g.account["id"]},
            )
            if (
                candidate
                and candidate["state"] == states.REVIEW_STATE
                and value(
                    conn,
                    "select 1 from piece_objects where piece_id = %s and object_id = %s",
                    (candidate["id"], obj["id"]),
                )
            ):
                context = candidate["id"]
        acked = {}
        if context:
            acked = {
                entry["duplicate_object_id"]: entry["acknowledged_by_name"]
                for entry in pieces.acks_of(conn, context)
                if entry["object_id"] == obj["id"]
            }
        return render_template(
            "object.html",
            obj=obj,
            box=catalogue.box(obj),
            similar=[
                (entry["object"], entry["score"]) + catalogue.box(entry["object"])
                for entry in similar
            ],
            threshold=catalogue.DUPLICATE_THRESHOLD,
            context=context,
            acked=acked,
        )


@bp.get("/schedule")
@staff
def schedule_page():
    month = request.args.get("month") or timeutil.current_month()
    span = timeutil.month_range(month)
    if span is None:
        raise errors.not_found()
    start, end = span
    today = timeutil.today()
    with tx() as conn:
        booked = {slot["day"]: slot for slot in schedule.month(conn, start, end)}
        cleared = rows(
            conn,
            "select p.id, p.title, a.name as owner_name, p.fee_cents from pieces p"
            " join accounts a on a.id = p.owner_id where p.state = 'cleared'"
            " order by p.title",
        )
        today_slot = schedule.slot_for_day(conn, today)
    lead = start.weekday()
    cells = [None] * lead
    day = start
    while day < end:
        cells.append(day)
        day += dt.timedelta(days=1)
    while len(cells) % 7:
        cells.append(None)
    return render_template(
        "schedule.html",
        month=month,
        month_name=timeutil.MONTH_NAMES[start.month - 1],
        year=start.year,
        weeks=[cells[index : index + 7] for index in range(0, len(cells), 7)],
        booked=booked,
        today=today,
        previous_month=timeutil.shift_month(month, -1),
        next_month=timeutil.shift_month(month, 1),
        cleared=cleared,
        today_slot=today_slot,
    )


@bp.get("/budget")
@staff
def budget_page():
    quarter = request.args.get("quarter") or timeutil.current_quarter()
    if timeutil.quarter_range(quarter) is None:
        raise errors.not_found()
    with tx() as conn:
        figures = budget.shape(conn, quarter)
    return render_template(
        "budget.html",
        figures=figures,
        year=quarter.split("-Q")[0],
        number=quarter.split("-Q")[1],
    )


@bp.get("/audit")
@staff
def audit_page():
    piece = request.args.get("piece") or ""
    actor = request.args.get("actor") or ""
    to_state = request.args.get("to") or ""
    since = request.args.get("from") or ""
    until = request.args.get("until") or ""
    page = request.args.get("page") or "1"
    settings = settings_for_request()
    with tx() as conn:
        trail = audit.trail(
            conn,
            g.account,
            piece=int(piece) if piece.isdigit() else None,
            actor=actor or None,
            to_state=to_state or None,
            since=timeutil.parse_day(since),
            until=(timeutil.parse_day(until) + dt.timedelta(days=1))
            if timeutil.parse_day(until)
            else None,
            page=page_number(page),
            rows_per_page=settings["rows_per_page"],
        )
    query = {
        key: value_
        for key, value_ in (
            ("piece", piece), ("actor", actor), ("to", to_state),
            ("from", since), ("until", until),
        )
        if value_
    }
    return render_template(
        "audit.html",
        trail=trail,
        piece=piece,
        actor=actor,
        to_state=to_state,
        since=since,
        until=until,
        states=states.STATES,
        export_query=("?" + urlencode(query)) if query else "",
    )


@bp.get("/settings")
@staff
def settings_page():
    return render_template("settings.html", settings=settings_for_request())


def _public_context(conn):
    return {
        "tagline": TAGLINE,
        "footer_line": FOOTER_LINE,
        "cleared_today": budget.cleared_today(conn),
    }


@bp.get("/wall")
def wall_page():
    with tx() as conn:
        published = rows(
            conn,
            "select p.*, a.name as owner_name from pieces p"
            " join accounts a on a.id = p.owner_id where p.state = 'published'"
            " order by p.published_at desc nulls last, p.id desc",
        )
        covers = {
            piece["id"]: [
                found["title"]
                for found in rows(
                    conn,
                    "select o.title from piece_objects po join objects o"
                    " on o.id = po.object_id where po.piece_id = %s"
                    " order by po.position limit 3",
                    (piece["id"],),
                )
            ]
            for piece in published
        }
        return render_template(
            "wall.html", published=published, covers=covers, **_public_context(conn)
        )


@bp.get("/wall/<piece_id>")
def plaque_page(piece_id):
    with tx() as conn:
        piece = row(
            conn,
            "select p.*, a.name as owner_name from pieces p"
            " join accounts a on a.id = p.owner_id"
            " where p.id = %s and p.state = 'published'",
            (whole_id(piece_id),),
        )
        if piece is None:
            raise errors.not_found()
        cleared_by = value(
            conn,
            "select ac.name from audit_entries e join accounts ac on ac.id = e.actor_id"
            " where e.piece_id = %s and (e.to_state = 'cleared' or e.from_state = '')"
            " order by e.created_at desc, e.id desc limit 1",
            (piece["id"],),
        )
        sources = pieces.cited_objects(conn, piece["id"])
        seen = request.cookies.get(config.VISIT_COOKIE, "")
        marks = [mark for mark in seen.split(".") if mark]
        fresh = str(piece["id"]) not in marks
        if fresh:
            schedule.count_visit(conn, piece["id"])
            marks.append(str(piece["id"]))
        body = render_template(
            "plaque.html",
            piece=piece,
            sources=sources,
            cover_titles=[obj["title"] for obj in sources[:3]],
            cleared_by=cleared_by,
            **_public_context(conn)
        )
    response = Response(body, content_type="text/html; charset=utf-8")
    if fresh:
        response.set_cookie(
            config.VISIT_COOKIE, ".".join(marks[-200:]), samesite="Lax", path="/"
        )
    return response



