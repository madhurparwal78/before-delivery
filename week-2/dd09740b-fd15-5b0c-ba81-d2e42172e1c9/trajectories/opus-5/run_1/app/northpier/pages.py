"""The server-rendered pages: the public site, the composer and the studio area."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

from flask import Blueprint, Response, make_response, redirect, render_template, request
from markupsafe import Markup
from werkzeug.wrappers.response import Response as WerkzeugResponse

from . import auth, errors, service, validation
from .calendar_rules import (
    STOCKHOLM,
    format_call_time,
    format_date,
    format_date_time,
    now_utc,
    time_since,
    to_stockholm,
)
from .covers import THEME_EYEBROWS, THEME_GROUNDS, THEME_INKS, cover_svg, glow_reel_svg
from .domain import (
    ACTION_LABELS,
    BUDGETS,
    DECLINE_REASONS,
    SERVICES,
    STATUS_LABELS,
    TIMELINES,
    allowed_actions,
    count_characters,
    first_name,
    status_line,
)
from .http_support import database, safe_next
from .records import studio_inquiry

pages = Blueprint("pages", __name__)

CONSENT_COOKIE = "np_consent"
CONSENT_MAX_AGE = 60 * 60 * 24 * 365
REYKJAVIK = ZoneInfo("Atlantic/Reykjavik")

NAV_LINKS: tuple[tuple[str, str, str], ...] = (
    ("Work", "/#work", "work"),
    ("Services", "/services", "services"),
    ("Start a project", "/start", "start"),
    ("Contact", "/contact", "contact"),
)

HERO_PHRASES = ("Intelligent products", "Brands with purpose", "Sites that move")

SERVICE_ROWS = (
    ("Strategy", "Find the opportunity and the plan to reach it."),
    ("Branding", "Identities that are clear, alive and easy to use."),
    ("Design", "Websites and products people enjoy coming back to."),
    ("Development", "Fast, accessible builds with motion where it matters."),
)

PRIVACY_PARAGRAPHS = (
    "When you send an inquiry we store what you tell us: your name, email, company, "
    "the services you need, budget, timeline and message. We use it only to answer you "
    "and to run your project conversation.",
    "We email you when we receive your inquiry and each time its status changes. Your "
    "private status link shows only your own inquiry.",
    "We set one first-party cookie to remember your cookie choice for a year. We load no "
    "analytics and no third-party content.",
)

STARTER_CARDS = (
    ("I have a project", "A new website or product, from scratch", ["design", "development"]),
    ("Refresh a brand", "A new identity and a site to match", ["branding", "design"]),
    ("Explore an idea", "Strategy for something that does not exist yet", ["strategy"]),
)

OFFICES = (
    ("Stockholm", "Hamngatan 41", "111 47 Stockholm, Sweden", "Stockholm time"),
    ("Reykjavík", "Laugavegur 27", "101 Reykjavík, Iceland", "Reykjavík time"),
)


# ---------------------------------------------------------------------------
# Template helpers
# ---------------------------------------------------------------------------


@pages.app_context_processor
def template_helpers() -> dict[str, Any]:
    return {
        "nav_links": NAV_LINKS,
        "status_labels": STATUS_LABELS,
        "service_labels": SERVICES,
        "budget_labels": BUDGETS,
        "timeline_labels": TIMELINES,
        "reason_labels": DECLINE_REASONS,
        "action_labels": ACTION_LABELS,
        "theme_grounds": THEME_GROUNDS,
        "theme_inks": THEME_INKS,
        "theme_eyebrows": THEME_EYEBROWS,
        "cover_svg": cover_svg,
        "glow_reel_svg": glow_reel_svg,
        "format_date": format_date,
        "format_date_time": format_date_time,
        "format_call_time": format_call_time,
        "time_since": time_since,
        "status_line": status_line,
        "count_characters": count_characters,
        "studio_email": "hello@northpier.studio",
    }


def chrome(
    *,
    current: str | None = None,
    ground: str = "pale",
    footer: bool = True,
    cookie_card: bool = True,
) -> dict[str, Any]:
    return {
        "nav_current": current,
        "ground": ground,
        "show_footer": footer,
        "show_cookie_card": cookie_card and request.cookies.get(CONSENT_COOKIE) is None,
        "year": to_stockholm(now_utc()).year,
    }


def _html(template: str, status: int = 200, **context: Any) -> Response:
    return make_response(render_template(template, **context), status)


def render_not_found() -> Response:
    return _html("not_found.html", 404, **chrome(ground="pale", footer=False))


def render_outage() -> Response:
    return _html(
        "outage.html",
        503,
        message=errors.OUTAGE_MESSAGE,
        **chrome(ground="pale", footer=False, cookie_card=False),
    )


# ---------------------------------------------------------------------------
# Public pages
# ---------------------------------------------------------------------------


@pages.get("/")
def landing() -> Response:
    with database() as conn:
        cases = service.list_cases(conn)
    return _html(
        "landing.html",
        cases=cases,
        hero_phrases=HERO_PHRASES,
        **chrome(current="work", ground="pale"),
    )


@pages.get("/work/<slug>")
def case_page(slug: str) -> Response:
    with database() as conn:
        cases = service.list_cases(conn)
        found = next((row for row in cases if row["slug"] == slug), None)
        if found is None:
            raise errors.not_found()
        more = service.more_cases(cases, slug)
    return _html(
        "case.html",
        case=found,
        more=more,
        **chrome(current="work", ground="theme"),
    )


@pages.get("/services")
def services_page() -> Response:
    with database() as conn:
        cases = service.list_cases(conn)
    return _html(
        "services.html",
        service_rows=SERVICE_ROWS,
        thumbnails=cases[:3],
        **chrome(current="services", ground="dark"),
    )


@pages.get("/contact")
def contact_page() -> Response:
    now = now_utc()
    greetings = {
        "Stockholm time": stockholm_greeting(now),
        "Reykjavík time": reykjavik_greeting(now),
    }
    return _html(
        "contact.html",
        offices=OFFICES,
        greetings=greetings,
        **chrome(current="contact", ground="pale"),
    )


@pages.get("/privacy-policy")
def privacy_page() -> Response:
    return _html(
        "privacy.html",
        paragraphs=PRIVACY_PARAGRAPHS,
        **chrome(ground="pale"),
    )


def stockholm_greeting(instant: datetime) -> str:
    local = instant.astimezone(STOCKHOLM)
    if local.hour < 12:
        greeting = "God morgon"
    elif local.hour < 18:
        greeting = "God eftermiddag"
    else:
        greeting = "God kväll"
    return f"{greeting}, klockan är {local.hour:02d}:{local.minute:02d}"


def reykjavik_greeting(instant: datetime) -> str:
    local = instant.astimezone(REYKJAVIK)
    if local.hour < 12:
        greeting = "Góðan daginn"
    elif local.hour < 18:
        greeting = "Góðan dag"
    else:
        greeting = "Gott kvöld"
    hour = local.hour % 12 or 12
    suffix = "AM" if local.hour < 12 else "PM"
    return f"{greeting}, klukkan er {hour}:{local.minute:02d} {suffix}"


# ---------------------------------------------------------------------------
# The composer
# ---------------------------------------------------------------------------


def _composer_context(
    form: dict[str, Any] | None = None,
    field_error: tuple[str | None, str] | None = None,
) -> dict[str, Any]:
    return {
        "starter_cards": STARTER_CARDS,
        "form": form
        or {
            "name": "",
            "email": "",
            "company": "",
            "services": [],
            "budget": "",
            "timeline": "",
            "message": "",
        },
        "error_field": field_error[0] if field_error else None,
        "error_message": field_error[1] if field_error else None,
        "form_key": service.mint_idempotency_key(),
        **chrome(current="start", ground="composer", footer=False),
    }


@pages.get("/start")
def composer() -> Response:
    return _html("start.html", **_composer_context())


@pages.post("/start")
def composer_submit() -> Response:
    form = {
        "name": request.form.get("name", ""),
        "email": request.form.get("email", ""),
        "company": request.form.get("company", ""),
        "services": request.form.getlist("services"),
        "budget": request.form.get("budget", ""),
        "timeline": request.form.get("timeline", ""),
        "message": request.form.get("message", ""),
    }
    raw_key = request.form.get("idempotency_key") or None
    try:
        key = validation.check_idempotency_key(raw_key)
        with database() as conn:
            _, payload = service.create_inquiry(conn, dict(form), key)
    except errors.Refusal as refusal:
        context = _composer_context(form, (refusal.field, refusal.message))
        context["form_key"] = raw_key or context["form_key"]
        return _html("start.html", refusal.status if refusal.status == 503 else 200, **context)
    return _html(
        "start.html",
        confirmation={
            "first_name": first_name(form["name"]),
            "reference": payload["reference"],
            "status_url": payload["status_url"],
            "status_path": f"/inquiry/{payload['status_token']}",
        },
        **_composer_context(),
    )


# ---------------------------------------------------------------------------
# The private status page
# ---------------------------------------------------------------------------


@pages.get("/inquiry/<token>")
def status_page(token: str) -> Response:
    with database() as conn:
        row = service.find_by_status_token(conn, token)
        if row is None:
            raise errors.not_found()
        events = service.history_of(conn, row["id"])
    return _html(
        "status.html",
        inquiry=row,
        token=token,
        status_text=status_line(row["status"], row["call_at"], row["decline_reason"]),
        submitted=format_date(row["created_at"]),
        history=[
            {"status": item["to_status"], "when": format_date_time(item["created_at"])}
            for item in events
        ],
        **chrome(ground="sand", footer=False),
    )


# ---------------------------------------------------------------------------
# The studio area
# ---------------------------------------------------------------------------


def _signin_redirect() -> WerkzeugResponse:
    target = request.path
    if request.query_string:
        target = f"{target}?{request.query_string.decode('utf-8')}"
    return redirect(f"/studio/signin?next={quote(target, safe='')}", code=302)


@pages.get("/studio/signin")
def signin_page() -> Response:
    return _html(
        "signin.html",
        next_path=request.args.get("next", ""),
        message=None,
        **chrome(ground="dark", footer=False, cookie_card=False),
    )


@pages.post("/studio/signin")
def signin_submit() -> Response | WerkzeugResponse:
    target = safe_next(request.form.get("next"))
    try:
        with database() as conn:
            token, _ = auth.sign_in(
                conn, request.form.get("email", ""), request.form.get("password", "")
            )
    except errors.Refusal as refusal:
        return _html(
            "signin.html",
            next_path=request.form.get("next", ""),
            message=refusal.message,
            email=request.form.get("email", ""),
            **chrome(ground="dark", footer=False, cookie_card=False),
        )
    response = redirect(target, code=302)
    response.set_cookie(
        auth.SESSION_COOKIE,
        token,
        httponly=True,
        samesite="Lax",
        path="/",
        max_age=60 * 60 * 24 * 30,
    )
    return response


@pages.post("/studio/signout")
def signout() -> WerkzeugResponse:
    token = request.cookies.get(auth.SESSION_COOKIE)
    if token:
        with database() as conn:
            auth.sign_out(conn, token)
    response = redirect("/studio/signin", code=302)
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return response


LABELS_JSON = json.dumps(
    {
        "status": STATUS_LABELS,
        "services": SERVICES,
        "budgets": BUDGETS,
        "timelines": TIMELINES,
        "reasons": DECLINE_REASONS,
        "actions": ACTION_LABELS,
    },
    ensure_ascii=False,
)


def _queue_context(conn, user: dict[str, Any]) -> dict[str, Any]:
    tab, query = validation.check_queue_params(
        request.args.get("status"), request.args.get("q")
    )
    listing = service.queue(conn, tab, query)
    return {
        "tab": tab,
        "query": query,
        "listing": listing,
        "user": user,
        "labels_json": Markup(LABELS_JSON),
        "tabs": [
            (name, STATUS_LABELS.get(name, "All"), listing["counts"][name])
            for name in ("new", "in_review", "call_booked", "won", "declined", "all")
        ],
    }


@pages.get("/studio")
def studio_queue_page() -> Response | WerkzeugResponse:
    with database() as conn:
        user = _studio_user(conn)
        if user is None:
            return _signin_redirect()
        context = _queue_context(conn, user)
    return _html(
        "studio_queue.html",
        inquiry=None,
        **context,
        **chrome(ground="dark", footer=False, cookie_card=False),
    )


@pages.get("/studio/inquiries/<inquiry_id>")
def studio_inquiry_page(inquiry_id: str) -> Response | WerkzeugResponse:
    with database() as conn:
        user = _studio_user(conn)
        if user is None:
            return _signin_redirect()
        numeric = service.parse_inquiry_id(inquiry_id)
        row = service.find_by_id(conn, numeric) if numeric is not None else None
        if row is None:
            raise errors.not_found()
        context = _queue_context(conn, user)
        detail = {
            **studio_inquiry(row),
            "row": row,
            "history": service.history_of(conn, row["id"]),
            "notes": service.notes_of(conn, row["id"]),
            "actions": allowed_actions(row["status"], user["role"]),
        }
    return _html(
        "studio_queue.html",
        inquiry=detail,
        **context,
        **chrome(ground="dark", footer=False, cookie_card=False),
    )


def _studio_user(conn) -> dict[str, Any] | None:
    token = request.cookies.get(auth.SESSION_COOKIE)
    if not token:
        return None
    return auth.resolve_session(conn, token)


# ---------------------------------------------------------------------------
# The cookie choice
# ---------------------------------------------------------------------------


@pages.post("/cookie-choice")
def cookie_choice() -> WerkzeugResponse:
    choice = "accepted" if request.form.get("choice") == "accept" else "rejected"
    back = request.form.get("back") or "/"
    if not back.startswith("/") or back.startswith("//"):
        back = "/"
    response = redirect(back, code=302)
    response.set_cookie(
        CONSENT_COOKIE,
        choice,
        max_age=CONSENT_MAX_AGE,
        samesite="Lax",
        path="/",
    )
    return response


def studio_query_string(tab: str, query: str) -> str:
    params = {"status": tab}
    if query:
        params["q"] = query
    return urlencode(params)


def queue_when(row: dict[str, Any], tab: str) -> str:
    """A row shows its call time on the Call booked tab and its age elsewhere."""
    if tab == "call_booked" and row["call_at"]:
        return format_call_time(datetime.fromisoformat(row["call_at"].replace("Z", "+00:00")))
    return time_since(datetime.fromisoformat(row["created_at"].replace("Z", "+00:00")))


pages.add_app_template_global(studio_query_string, "studio_query_string")
pages.add_app_template_global(queue_when, "queue_when")
