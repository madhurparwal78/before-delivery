"""Server-rendered pages, the return address, the media files and the site's own static files."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import quote

from jinja2 import Environment, FileSystemLoader, select_autoescape
from werkzeug.exceptions import NotFound
from werkzeug.utils import send_from_directory
from werkzeug.wrappers import Request, Response

from . import db, media, public, validation
from .content import AGENT_ORDER, AGENTS, OUTBOUND, PLANS
from .http import error_response

HERE = Path(__file__).parent
STATIC = HERE / "static"
templates = Environment(loader=FileSystemLoader(HERE / "templates"), autoescape=select_autoescape(["html"]),
                        trim_blocks=True, lstrip_blocks=True)
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December")
MEDIA_PATH = re.compile(r"/media/(integrations|articles)/([a-z0-9]+(?:-[a-z0-9]+)*)\.svg")
RESOURCE_BLOCKS = ("Updates", "Case Studies", "Webinars", "Guides", "Videos")
COOKIE_CHOICE = "relayo_cookie_choice"


def calendar_date(value: str) -> str:
    """A calendar date with its four-digit year, from an ISO date or UTC timestamp."""
    day = date.fromisoformat(value[:10])
    return f"{day.day} {MONTHS[day.month - 1]} {day.year}"


templates.filters["calendar_date"] = calendar_date


def render(request: Request, name: str, status: int = 200, **context: Any) -> Response:
    page = templates.get_template(name).render(agents=AGENTS, agent_order=AGENT_ORDER, outbound=OUTBOUND, plans=PLANS,
                                               cookie_choice=request.cookies.get(COOKIE_CHOICE), **context)
    return Response(page, status=status, content_type="text/html; charset=utf-8")


def not_found(request: Request) -> Response:
    return render(request, "not_found.html", 404, page="not-found", title="Page not found")


def return_address(raw: str | None, list_path: str) -> str:
    """The return link follows `from` only when it names that list itself; anything else gets the plain list."""
    if raw is None or "\\" in raw or any(ord(char) < 0x20 or ord(char) == 0x7F for char in raw):
        return list_path
    return raw if raw == list_path or raw.startswith(list_path + "?") else list_path


def list_address(path: str, category: str | None, page: int = 1) -> str:
    query = []
    if category is not None:
        query.append("category=" + quote(category, safe=""))
    if page > 1:
        query.append(f"page={page}")
    return path + ("?" + "&".join(query) if query else "")


def detail_href(base: str, slug: str, from_address: str) -> str:
    return f"{base}/{slug}?from={quote(from_address, safe='')}"


# Pages -----------------------------------------------------------------------------------------------

def home(request: Request) -> Response:
    with db.connection() as conn:
        tools = public.integrations(conn, None)
    return render(request, "home.html", page="home", title="Relayo, the meeting assistant for teams", tools=tools)


def agent_page(key: str) -> Callable[[Request], Response]:
    def show(request: Request) -> Response:
        agent = AGENTS[key]
        return render(request, "agent.html", page="agent", title=f"Relayo {agent['name']}", agent=agent, agent_key=key)
    return show


def integrations_page(request: Request) -> Response:
    category = request.args.get("category")
    here = list_address("/integrations", category)
    with db.connection() as conn:
        items = public.integrations(conn, category)
    return render(request, "integrations.html", page="integrations", title="Integrations", category=category,
                  categories=public.INTEGRATION_CATEGORIES, items=items, here=here,
                  href=lambda slug: detail_href("/integration", slug, here))


def integration_detail(request: Request, slug: str) -> Response:
    with db.connection() as conn:
        row = public.public_integration(conn, slug)
    if row is None:
        return not_found(request)
    return render(request, "integration.html", page="integration", title=row["name"], item=row,
                  back=return_address(request.args.get("from"), "/integrations"))


def blog_page(request: Request) -> Response:
    category = request.args.get("category")
    here = list_address("/blog", category)
    with db.connection() as conn:
        items = public.whole_blog(conn, category)
    return render(request, "blog.html", page="blog", title="Blog", category=category, categories=public.BLOG_CATEGORIES,
                  items=items, here=here, href=lambda slug: detail_href("/blog", slug, here))


def article_page(request: Request, slug: str) -> Response:
    with db.connection() as conn:
        row = public.public_article(conn, slug)
    if row is None:
        return not_found(request)
    return render(request, "article.html", page="article", title=row["title"], article=public.article_item(row),
                  paragraphs=row["body"].split("\n\n"), back=return_address(request.args.get("from"), "/blog"))


def press_page(request: Request) -> Response:
    category = request.args.get("category")
    raw_page = request.args.get("page")
    page = int(raw_page) if raw_page and re.fullmatch(r"[1-9][0-9]{0,4}", raw_page) else 1
    with db.connection() as conn:
        items, cursors = public.press_pages(conn, category, page)
    known = category is None or category == "All" or category in public.PRESS_CATEGORIES
    return render(request, "press.html", page="press", title="Press", category=category,
                  categories=public.PRESS_CATEGORIES, items=items, known=known, page_number=page,
                  has_next=len(cursors) > page and cursors[page] is not None,
                  cursors=json.dumps(cursors))


def careers_page(request: Request) -> Response:
    with db.connection() as conn:
        jobs = public.open_jobs(conn)
    return render(request, "careers.html", page="careers", title="Careers", jobs=jobs)


def resources_page(request: Request) -> Response:
    with db.connection() as conn:
        cards = public.resource_cards(conn)
    groups = [(block, [card for card in cards if card["block"] == block]) for block in RESOURCE_BLOCKS]
    return render(request, "resources.html", page="resources", title="Resources", groups=groups)


def partner_page(request: Request) -> Response:
    return render(request, "partner_program.html", page="partner", title="Partner program",
                  limits=validation.TEXT_LIMITS, company_types=validation.COMPANY_TYPES,
                  employee_bands=validation.EMPLOYEE_BANDS, markets=validation.MARKETS,
                  segments=validation.CUSTOMER_SEGMENTS, interests=validation.PARTNERSHIP_INTERESTS,
                  rules=json.dumps(validation.client_rules()))


def review_page(request: Request) -> Response:
    return render(request, "review.html", page="review", title="Partner applications",
                  rules=json.dumps(validation.client_rules()))


PAGES: dict[str, Callable[[Request], Response]] = {
    "/": home,
    **{f"/{key}-agent": agent_page(key) for key in AGENT_ORDER},
    "/integrations": integrations_page,
    "/resources": resources_page,
    "/careers": careers_page,
    "/press": press_page,
    "/blog": blog_page,
    "/partner-program": partner_page,
    "/review": review_page,
}
DETAILS: list[tuple[re.Pattern[str], Callable[[Request, str], Response]]] = [
    (re.compile(r"/integration/([^/]+)"), integration_detail),
    (re.compile(r"/blog/([^/]+)"), article_page),
]


def _page(request: Request) -> Response:
    if request.method not in ("GET", "HEAD"):
        return not_found(request)
    if request.path.startswith("/static/"):
        try:
            response = send_from_directory(STATIC, request.path.removeprefix("/static/"), request.environ)
        except NotFound:
            return not_found(request)
        response.headers["Cache-Control"] = "no-cache"
        return response
    if request.path in PAGES:
        return PAGES[request.path](request)
    for pattern, handler in DETAILS:
        found = pattern.fullmatch(request.path)
        if found:
            return handler(request, found.group(1))
    return not_found(request)


def dispatch(request: Request) -> Response:
    try:
        return _page(request)
    except db.DatabaseUnavailable:
        return render(request, "outage.html", 503, page="outage", title="Temporarily unavailable")


def media_file(request: Request) -> Response:
    """Icons and covers answer only at their exact published path, checked on every request."""
    raw_path = request.environ.get("RAW_URI", request.full_path).split("?", 1)[0]
    found = MEDIA_PATH.fullmatch(raw_path)
    if request.method not in ("GET", "HEAD") or not found:
        return not_found(request)
    kind, slug = found.groups()
    try:
        with db.connection() as conn:
            if kind == "integrations":
                row = public.public_integration(conn, slug)
                drawing = row and media.integration_icon(row["slug"], row["name"], row["category"])
            else:
                row = public.public_article(conn, slug)
                drawing = row and media.article_cover(row["slug"], row["title"], row["category"])
    except db.DatabaseUnavailable:
        return error_response(503, "service_unavailable")
    if not drawing:
        return not_found(request)
    return Response(drawing, content_type="image/svg+xml", headers={"Cache-Control": "no-cache"})
