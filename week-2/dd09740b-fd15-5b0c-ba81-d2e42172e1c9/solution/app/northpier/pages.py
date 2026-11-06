"""Server-rendered pages: every visitor page arrives complete; scripts only enhance."""
import datetime as dt
import mimetypes
import random
from collections.abc import Callable
from functools import wraps
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from django.http import FileResponse, HttpRequest, HttpResponse, HttpResponseRedirect
from django.template.loader import render_to_string
from django.utils.html import escape
from django.utils.safestring import SafeString, mark_safe

from northpier import api, auth, db, inquiries
from northpier.bodies import KEY_PATTERN
from northpier.domain import (BUDGETS, DECLINE_REASONS, QUEUE_TABS, SERVICES, STATUS_LABELS, TAB_LABELS, TIMELINES,
                              TRANSITIONS_BY_ACTION, allowed_actions, char_count, first_name, status_line)
from northpier.errors import MESSAGES, Refusal
from northpier.records import history_rows, inquiry_by_id, inquiry_by_token, note_rows
from northpier.studio_queue import check_query, queue
from northpier.studio_time import STOCKHOLM, call_label, date_label, stamp_label

STATIC = Path(__file__).parent / "static"
CONSENT_COOKIE = "np_consent"
DARK_THEMES = {"ink"}
REYKJAVIK = ZoneInfo("Atlantic/Reykjavik")
View = Callable[..., HttpResponse]


def page_methods(*allowed: str) -> Callable[[View], View]:
    def decorate(view: View) -> View:
        @wraps(view)
        def wrapper(request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
            if request.method not in allowed:
                raise Refusal("method", allow=", ".join(allowed))
            return view(request, *args, **kwargs)
        return wrapper
    return decorate


def render(request: HttpRequest, template: str, context: dict[str, Any], status: int = 200, *,
           ground: str = "ground", dark: bool = False, nav: str | None = None, chrome: str = "visitor",
           title: str | None = None) -> HttpResponse:
    consent = request.COOKIES.get(CONSENT_COOKIE) in ("accepted", "rejected")
    base = {"ground": ground, "dark": dark, "nav": nav, "chrome": chrome, "consent": consent, "title": title,
            "year": dt.datetime.now(STOCKHOLM).year, "path": request.get_full_path()}
    return HttpResponse(render_to_string(template, {**base, **context}, request), status=status)


def outage_page(request: HttpRequest) -> HttpResponse:
    studio = request.path.startswith("/studio")
    return render(request, "message.html", {"message": MESSAGES["outage"].text}, 503,
                  ground="ink-bg" if studio else "ground", dark=studio, chrome="bare" if studio else "visitor")


def page_refusal(request: HttpRequest, refusal: Refusal) -> HttpResponse:
    if refusal.kind == "not_found":
        return render(request, "not_found.html", {}, 404, title="Lost at sea")
    response = render(request, "message.html", {"message": refusal.message.text}, refusal.message.status,
                      chrome="bare")
    if refusal.kind == "method":
        response["Allow"] = refusal.allow
    return response


# Covers: a field of the theme colour, one soft white glow and two to four faint bands placed by the seed.
THEME_FILL = {"orange": "#d8813e", "violet": "#a08cff", "lemon": "#f6fc69", "clay": "#c9b9b3", "sand": "#eae5df",
              "ink": "#0a0a0b", "mist": "#e3e5ea"}


def cover(case: dict[str, Any], variant: int = 0, label: bool = False) -> SafeString:
    rng = random.Random(case["cover_seed"] * 31 + variant)
    gid = f"g-{case['slug']}-{variant}"
    glow_x, glow_y, glow_r = rng.uniform(30, 75), rng.uniform(20, 60), rng.uniform(38, 60)
    bands = []
    for _ in range(rng.randint(2, 4)):
        y, height, angle = rng.uniform(5, 90), rng.uniform(4, 16), rng.uniform(-14, 14)
        bands.append(f'<rect x="-20" y="{y:.1f}" width="200" height="{height:.1f}" fill="#000" '
                     f'fill-opacity="{rng.uniform(0.04, 0.09):.3f}" transform="rotate({angle:.1f} 80 50)"/>')
    initials = "".join(word[0] for word in case["client"].split()[:2]).upper()
    ink = "#ffffff" if case["theme"] in DARK_THEMES else "#0a0a0b"
    labelled = (f'role="img" aria-label="{escape(case["client"])} cover"' if label else 'aria-hidden="true"')
    return mark_safe(
        f'<svg class="cover" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" {labelled} '
        f'focusable="false"><defs><radialGradient id="{gid}" cx="{glow_x:.1f}%" cy="{glow_y:.1f}%" r="{glow_r:.1f}%">'
        f'<stop offset="0" stop-color="#fff" stop-opacity="0.78"/><stop offset="0.55" stop-color="#fff" '
        f'stop-opacity="0.16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>'
        f'<rect width="160" height="100" fill="{THEME_FILL[case["theme"]]}"/>{"".join(bands)}'
        f'<rect width="160" height="100" fill="url(#{gid})"/></svg>'
        f'<span class="initials" style="color:{ink}" aria-hidden="true">{escape(initials)}</span>')


def with_cover(case: dict[str, Any], variant: int = 0, label: bool = False) -> dict[str, Any]:
    return {**case, "cover": cover(case, variant, label)}


@page_methods("GET", "HEAD")
def landing(request: HttpRequest) -> HttpResponse:
    with db.transaction() as tx:
        cases = [with_cover(c) for c in api.all_cases(tx)]
    return render(request, "landing.html", {"cases": cases, "phrases": PHRASES})


PHRASES = ("Intelligent products", "Brands with purpose", "Sites that move")


@page_methods("GET", "HEAD")
def case_page(request: HttpRequest, slug: str) -> HttpResponse:
    with db.transaction() as tx:
        case, more = api.case_with_more(tx, slug)
    context = {"case": with_cover(case, 0, label=True), "frames": [cover(case, 1), cover(case, 2)],
               "more": [with_cover(c) for c in more]}
    return render(request, "case.html", context, ground=f"theme-{case['theme']}", dark=case["theme"] in DARK_THEMES,
                  nav="work", title=case["client"])


@page_methods("GET", "HEAD")
def services(request: HttpRequest) -> HttpResponse:
    with db.transaction() as tx:
        cases = [with_cover(c) for c in api.all_cases(tx)[:3]]
    return render(request, "services.html", {"cases": cases}, ground="ink-bg", dark=True, nav="services",
                  title="Services")


def greetings(now: dt.datetime) -> dict[str, str]:
    """The offices' greetings at `now`, as the server renders them before any script runs."""
    stockholm, reykjavik = now.astimezone(STOCKHOLM), now.astimezone(REYKJAVIK)
    sv = "God morgon" if stockholm.hour < 12 else "God eftermiddag" if stockholm.hour < 18 else "God kväll"
    is_ = "Góðan daginn" if reykjavik.hour < 12 else "Góðan dag" if reykjavik.hour < 18 else "Gott kvöld"
    twelve = reykjavik.hour % 12 or 12
    return {"stockholm": f"{sv}, klockan är {stockholm:%H:%M}",
            "reykjavik": f"{is_}, klukkan er {twelve}:{reykjavik:%M} {'AM' if reykjavik.hour < 12 else 'PM'}"}


@page_methods("GET", "HEAD")
def contact(request: HttpRequest) -> HttpResponse:
    return render(request, "contact.html", {"greetings": greetings(dt.datetime.now(dt.timezone.utc))},
                  nav="contact", title="Contact")


@page_methods("GET", "HEAD")
def privacy(request: HttpRequest) -> HttpResponse:
    return render(request, "privacy.html", {}, title="Privacy policy")


def composer_context(values: dict[str, Any], key: str) -> dict[str, Any]:
    return {"values": values, "key": key, "count": char_count(values.get("message", "")), "services": SERVICES,
            "budgets": BUDGETS, "timelines": TIMELINES,
            "starters": STARTERS}


STARTERS = (("I have a project", "A new website or product, from scratch", ("design", "development")),
            ("Refresh a brand", "A new identity and a site to match", ("branding", "design")),
            ("Explore an idea", "Strategy for something that does not exist yet", ("strategy",)))


@page_methods("GET", "HEAD", "POST")
def start(request: HttpRequest) -> HttpResponse:
    page = {"ground": "composer", "dark": True, "nav": "start", "title": "Start a project"}
    if request.method != "POST":
        return render(request, "start.html", composer_context({"services": []}, inquiries.new_key()), **page)
    form = request.POST
    body = {"name": form.get("name", ""), "email": form.get("email", ""), "company": form.get("company", ""),
            "services": form.getlist("services"), "budget": form.get("budget", ""),
            "timeline": form.get("timeline", ""), "message": form.get("message", "")}
    key = form.get("idempotency_key", "")
    key = key if KEY_PATTERN.fullmatch(key) else inquiries.new_key()
    try:
        _status, sent = inquiries.submit(body, key)
    except Refusal as refusal:
        message = refusal.message
        context = composer_context(body, key)
        context["error"] = {"field": message.field if message.status == 422 else None, "text": message.text}
        return render(request, "start.html", context, message.status, **page)
    context = {"sent": sent, "first_name": first_name(body["name"])}
    return render(request, "start.html", {**composer_context(body, key), **context}, **page)


def history_items(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Studio history lines: what happened, its detail, when and by whom."""
    items = []
    for row in rows:
        detail = (call_label(row["call_at"]) if row["call_at"] else
                  DECLINE_REASONS[row["decline_reason"]] if row["decline_reason"] else "")
        items.append({"title": TRANSITIONS_BY_ACTION[row["action"]].label if row["action"] else "Inquiry received",
                      "status": row["to_status"], "detail": detail, "when": stamp_label(row["created_at"]),
                      "who": row["actor_name"] or "Visitor"})
    return items


@page_methods("GET", "HEAD")
def status_page(request: HttpRequest, token: str) -> HttpResponse:
    with db.transaction() as tx:
        row = inquiry_by_token(tx, token)
        if row is None:
            raise Refusal("not_found")
        history = history_rows(tx, row["id"])
    context = {
        "inquiry": {key: row[key] for key in ("reference", "status", "version", "company", "message")},
        "label": STATUS_LABELS[row["status"]],
        "line": status_line(row["status"], row["call_at"], row["decline_reason"]),
        "submitted": date_label(row["created_at"]),
        "service_labels": ", ".join(SERVICES[s] for s in row["services"]),
        "budget": BUDGETS[row["budget"]], "timeline": TIMELINES[row["timeline"]],
        "history": [{"label": STATUS_LABELS[h["to_status"]], "status": h["to_status"],
                     "when": stamp_label(h["created_at"])} for h in history],
    }
    return render(request, "status.html", context, ground="sand", title=f"Inquiry {row['reference']}")


@page_methods("GET", "HEAD")
def not_found_page(request: HttpRequest) -> HttpResponse:
    raise Refusal("not_found")


@page_methods("POST")
def consent(request: HttpRequest) -> HttpResponse:
    """The cookie card's no-script path: remember the choice for a year, then return to the page."""
    choice = request.POST.get("choice")
    back = auth.safe_path(request.POST.get("back"))
    response = HttpResponseRedirect(back, status=303)
    if choice in ("accepted", "rejected"):
        response.set_cookie(CONSENT_COOKIE, choice, max_age=365 * 86400, samesite="Lax")
    return response


@page_methods("GET", "HEAD")
def static_file(request: HttpRequest, path: str) -> HttpResponse:
    target = (STATIC / path).resolve()
    if STATIC.resolve() not in target.parents or not target.is_file():
        raise Refusal("not_found")
    response = FileResponse(target.open("rb"), content_type=mimetypes.guess_type(target.name)[0])
    response["Cache-Control"] = "public, max-age=3600"
    return response


# Studio pages


def _studio_user(request: HttpRequest) -> dict[str, Any] | None:
    token, _from_cookie = auth.request_token(request)
    return auth.session_user(token)


def _to_signin(request: HttpRequest) -> HttpResponse:
    return HttpResponseRedirect("/studio/signin?" + urlencode({"next": request.get_full_path()}))


@page_methods("GET", "HEAD", "POST")
def signin(request: HttpRequest) -> HttpResponse:
    page = {"ground": "ink-bg", "dark": True, "chrome": "studio", "title": "Studio sign in"}
    next_path = request.POST.get("next") if request.method == "POST" else request.GET.get("next")
    if request.method != "POST":
        return render(request, "signin.html", {"next": next_path or "", "email": ""}, **page)
    email = request.POST.get("email", "")
    try:
        token, _user = auth.sign_in({"email": email, "password": request.POST.get("password", "")})
    except Refusal as refusal:
        context = {"next": next_path or "", "email": email, "error": refusal.message.text}
        response = render(request, "signin.html", context, refusal.message.status, **page)
        if refusal.retry_after is not None:
            response["Retry-After"] = str(refusal.retry_after)
        return response
    response = HttpResponseRedirect(auth.safe_next(next_path), status=303)
    response.set_cookie(auth.SESSION_COOKIE, token, httponly=True, samesite="Lax")
    return response


@page_methods("POST")
def signout(request: HttpRequest) -> HttpResponse:
    token, from_cookie = auth.request_token(request)
    if from_cookie and auth.own_origin(request) and auth.session_user(token):
        auth.sign_out(token)
    response = HttpResponseRedirect("/studio/signin", status=303)
    response.delete_cookie(auth.SESSION_COOKIE, samesite="Lax")
    return response


def _list_query(status: str, q: str) -> str:
    return urlencode({"status": status, "q": q} if q else {"status": status})


def queue_context(tx: db.Tx, request: HttpRequest, selected: int | None = None) -> tuple[dict[str, Any], int]:
    """The queue column: tabs with counts, the search and rows, narrowed as the address says."""
    status, q, error = request.GET.get("status", "new"), request.GET.get("q", ""), None
    try:
        status, q = check_query(status, q)
    except Refusal as refusal:
        error, status, q = refusal.message.text, status if status in QUEUE_TABS else "new", ""
    rows, counts = queue(tx, status, q)
    now = tx.clock()
    query = _list_query(status, q)
    items = [{
        "id": r["id"], "reference": r["reference"], "name": r["name"], "company": r["company"],
        "services": ", ".join(SERVICES[s] for s in r["services"]), "budget": BUDGETS[r["budget"]],
        "status": r["status"], "selected": r["id"] == selected, "href": f"/studio/inquiries/{r['id']}?{query}",
        "when": (call_label(r["call_at"]) if status == "call_booked" else
                 _since(now - r["created_at"]) if status in ("new", "in_review", "all") else ""),
    } for r in rows]
    tabs = [{"key": key, "label": TAB_LABELS[key], "count": counts[key], "selected": key == status,
             "href": f"/studio?{_list_query(key, request.GET.get('q', '') if error is None else '')}"}
            for key in QUEUE_TABS]
    return {"tabs": tabs, "rows": items, "q": request.GET.get("q", ""), "status": status, "query": query,
            "queue_error": error}, 422 if error else 200


def _since(age: dt.timedelta) -> str:
    minutes = int(age.total_seconds() // 60)
    if minutes < 1:
        return "Just now"
    if minutes < 60:
        return f"{minutes} min ago"
    if minutes < 24 * 60:
        return f"{minutes // 60} h ago"
    days = minutes // (24 * 60)
    return f"{days} day ago" if days == 1 else f"{days} days ago"


@page_methods("GET", "HEAD")
def studio_queue_page(request: HttpRequest) -> HttpResponse:
    user = _studio_user(request)
    if user is None:
        return _to_signin(request)
    with db.transaction() as tx:
        context, status = queue_context(tx, request)
    return render(request, "queue.html", {**context, "user": user}, status, ground="ink-bg", dark=True,
                  chrome="studio", title="Inquiries")


@page_methods("GET", "HEAD")
def studio_inquiry_page(request: HttpRequest, raw_id: str) -> HttpResponse:
    user = _studio_user(request)
    if user is None:
        return _to_signin(request)
    if not raw_id.isascii() or not raw_id.isdigit() or int(raw_id) > api.BIGINT_MAX:
        raise Refusal("not_found")
    with db.transaction() as tx:
        row = inquiry_by_id(tx, int(raw_id))
        if row is None:
            raise Refusal("not_found")
        context, _status = queue_context(tx, request, selected=row["id"])
        history = history_items(history_rows(tx, row["id"]))
        notes = [{**n, "when": stamp_label(n["created_at"])} for n in note_rows(tx, row["id"])]
    actions = allowed_actions(row["status"], user["role"])
    context.update({
        "user": user, "inquiry": row, "history": history, "notes": notes, "actions": actions,
        "back": f"/studio?{context['query']}",
        "submitted": date_label(row["created_at"]), "call": call_label(row["call_at"]) if row["call_at"] else "",
        "service_labels": ", ".join(SERVICES[s] for s in row["services"]), "budget": BUDGETS[row["budget"]],
        "timeline": TIMELINES[row["timeline"]], "reasons": DECLINE_REASONS, "label": STATUS_LABELS[row["status"]],
    })
    return render(request, "inquiry.html", context, ground="ink-bg", dark=True, chrome="studio",
                  title=row["reference"])
