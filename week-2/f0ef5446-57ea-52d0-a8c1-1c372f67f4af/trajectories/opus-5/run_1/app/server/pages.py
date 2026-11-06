"""The public pages, rendered from the seeded store on the server."""

from __future__ import annotations

import json
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlencode

from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup

from . import content
from .db import DATABASE
from .pagecopy import AGENTS, CAREERS_BANDS, HOME_SLIDES
from .seeddata import RESOURCE_BLOCKS
from .validation import (
    COMPANY_TYPES,
    CUSTOMER_SEGMENTS,
    EMPLOYEE_BANDS,
    MARKETS,
    PARTNERSHIP_INTERESTS,
    TEXT_LIMITS,
)
from .web import Request, Response, html_response

TEMPLATE_ROOT = Path(__file__).resolve().parent / "templates"

TEMPLATES = Environment(
    loader=FileSystemLoader(str(TEMPLATE_ROOT)),
    autoescape=select_autoescape(["html"]),
    trim_blocks=False,
    lstrip_blocks=False,
)

HOME_STRIP_SLUGS = (
    "huddleboard",
    "pipewell-crm",
    "datebook-calendar",
    "relayo-desktop",
    "relayo-mobile",
    "tabnote-extension",
    "vaultbox-drive",
    "signalgraph",
    "ringstead-dialer",
    "framecall-video",
)

_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)

_CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")


def format_date(day: date) -> str:
    return f"{day.day} {_MONTHS[day.month - 1]} {day.year}"


def results_copy(count: int, singular: str, plural: str) -> str:
    return f"{count} {singular}" if count == 1 else f"{count} {plural}"


def safe_return_address(raw: str | None, base: str) -> str:
    """The return-address check: only this list's own address is followed."""
    if raw is None:
        return base
    candidate = unquote(raw)
    if _CONTROL_CHARACTERS.search(candidate) or "\\" in candidate:
        return base
    if candidate == base or candidate.startswith(f"{base}?"):
        return candidate
    return base


def _json_block(payload: dict[str, Any]) -> Markup:
    """Page data as JSON that is safe to embed in a script element."""
    text = (
        json.dumps(payload, ensure_ascii=True)
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
    )
    return Markup(text)


def _render(
    template: str,
    *,
    route: str,
    title: str,
    description: str,
    page_data: dict[str, Any] | None = None,
    status: int = 200,
    **context: Any,
) -> Response:
    markup = TEMPLATES.get_template(template).render(
        route=route,
        page_title=title,
        page_description=description,
        page_data=_json_block(page_data or {}),
        **context,
    )
    return html_response(status, markup, headers=[("Cache-Control", "no-store")])


def not_found_page() -> Response:
    return _render(
        "not_found.html",
        route="not-found",
        title="Page not found",
        description="That address does not exist on the Relayo site.",
        status=404,
    )


def outage_page(heading: str, copy: str) -> Response:
    return _render(
        "outage.html",
        route="outage",
        title=heading,
        description=copy,
        status=503,
        heading=heading,
        copy=copy,
    )


async def home_page(request: Request) -> Response:
    async with DATABASE.acquire() as connection:
        items = await content.list_integrations(connection, None)
    by_slug = {item["slug"]: item for item in items}
    tools = [by_slug[slug] for slug in HOME_STRIP_SLUGS if slug in by_slug]
    return _render(
        "home.html",
        route="home",
        title="Relayo",
        description="Relayo joins your calls, takes the notes and hands your team the next steps.",
        slides=HOME_SLIDES,
        tools=tools,
        page_data={"slides": [slide["name"] for slide in HOME_SLIDES]},
    )


async def agent_page(request: Request, key: str) -> Response:
    agent = AGENTS[key]
    return _render(
        "agent.html",
        route=f"agent-{key}",
        title=f"Relayo {agent['name']}",
        description=agent["promise"],
        agent=agent,
    )


def _list_address(path: str, query: dict[str, str]) -> str:
    return f"{path}?{urlencode(query)}" if query else path


async def integrations_page(request: Request) -> Response:
    category = request.query.get("category", [None])[0]
    async with DATABASE.acquire() as connection:
        items = await content.list_integrations(connection, category)
    address = _list_address("/integrations", {"category": category} if category else {})
    return _render(
        "integrations.html",
        route="integrations",
        title="Integrations",
        description="Relayo writes meeting notes back into the tools your team already uses.",
        items=items,
        category=category,
        categories=content.INTEGRATION_CATEGORIES,
        return_to=quote(address, safe=""),
        results_copy=results_copy(len(items), "integration", "integrations"),
        page_data={"list": "integrations", "category": category, "count": len(items)},
    )


async def integration_detail_page(request: Request, slug: str) -> Response:
    async with DATABASE.acquire() as connection:
        item = await content.read_integration(connection, slug)
    if item is None:
        return not_found_page()
    back_href = safe_return_address(request.query.get("from", [None])[0], "/integrations")
    return _render(
        "integration_detail.html",
        route="integration-detail",
        title=item["name"],
        description=item["description"],
        item=item,
        back_href=back_href,
        page_data={"list": "integrations", "slug": slug},
    )


async def blog_page(request: Request) -> Response:
    category = request.query.get("category", [None])[0]
    async with DATABASE.acquire() as connection:
        items: list[dict[str, Any]] = []
        cursor = None
        while True:
            page, next_cursor = await content.list_articles(
                connection, category, content.MAX_LIMIT, cursor
            )
            items.extend(page)
            if next_cursor is None:
                break
            cursor = content.decode_cursor(next_cursor, content.BLOG_LIST, category)
    for item in items:
        item["published_on"] = format_date(_as_date(item["published_at"]))
    address = _list_address("/blog", {"category": category} if category else {})
    return _render(
        "blog.html",
        route="blog",
        title="Blog",
        description="Product news, call craft and notes from teams who run meetings.",
        items=items,
        category=category,
        categories=content.BLOG_CATEGORIES,
        return_to=quote(address, safe=""),
        results_copy=results_copy(len(items), "article", "articles"),
        page_data={"list": "blog", "category": category, "count": len(items)},
    )


async def article_page(request: Request, slug: str) -> Response:
    async with DATABASE.acquire() as connection:
        item = await content.read_article(connection, slug)
    if item is None:
        return not_found_page()
    item["published_on"] = format_date(_as_date(item["published_at"]))
    back_href = safe_return_address(request.query.get("from", [None])[0], "/blog")
    return _render(
        "article.html",
        route="article",
        title=item["title"],
        description=item["summary"],
        item=item,
        paragraphs=item["body"].split("\n\n"),
        back_href=back_href,
        page_data={"list": "blog", "slug": slug},
    )


def _as_date(moment: str) -> date:
    return datetime.fromisoformat(moment.replace("Z", "+00:00")).date()


def _press_page_number(raw: str | None) -> tuple[int, bool]:
    """The page from the address, and whether the address must be rewritten."""
    if raw is None:
        return 1, False
    if re.fullmatch(r"[0-9]+", raw) is None or int(raw) < 1:
        return 1, True
    page = int(raw)
    if page == 1:
        return 1, True
    return min(page, 1000), False


async def press_page(request: Request) -> Response:
    raw_category = request.query.get("category", [None])[0]
    category = None if raw_category in (None, "All") else raw_category
    page, rewrite = _press_page_number(request.query.get("page", [None])[0])
    async with DATABASE.acquire() as connection:
        items, cursors, has_next = await content.press_page(connection, category, page)
        total = await content.count_press(connection, category)
    for item in items:
        item["date_copy"] = format_date(date.fromisoformat(item["date"]))
    beyond_last = not items and page > 1
    return _render(
        "press.html",
        route="press",
        title="Press room",
        description="Announcements, coverage and releases from Relayo.",
        items=items,
        category=raw_category if raw_category not in (None, "All") else None,
        categories=content.PRESS_CATEGORIES,
        page=page,
        has_next=has_next,
        beyond_last=beyond_last,
        results_copy=results_copy(len(items), "press item", "press items"),
        page_data={
            "list": "press",
            "category": category,
            "page": page,
            "cursors": cursors,
            "hasNext": has_next,
            "count": len(items),
            "total": total,
            "beyondLast": beyond_last,
            "rewrite": rewrite,
        },
    )


async def resources_page(request: Request) -> Response:
    async with DATABASE.acquire() as connection:
        cards = await content.list_resource_cards(connection)
    for card in cards:
        card["date_copy"] = format_date(date.fromisoformat(card["date"]))
    blocks = [
        {"name": name, "cards": [card for card in cards if card["block"] == name]}
        for name in RESOURCE_BLOCKS
    ]
    return _render(
        "resources.html",
        route="resources",
        title="Resources",
        description="Guides, recordings and customer stories from Relayo.",
        blocks=blocks,
    )


async def careers_page(request: Request) -> Response:
    async with DATABASE.acquire() as connection:
        jobs = await content.list_open_jobs(connection)
    return _render(
        "careers.html",
        route="careers",
        title="Careers",
        description="Open positions and how the Relayo team works.",
        jobs=jobs,
        bands=CAREERS_BANDS,
    )


async def partner_page(request: Request) -> Response:
    return _render(
        "partner.html",
        route="partner-program",
        title="Partner program",
        description="Apply to build, refer or resell Relayo.",
        company_types=COMPANY_TYPES,
        employee_bands=EMPLOYEE_BANDS,
        markets=MARKETS,
        customer_segments=CUSTOMER_SEGMENTS,
        interests=PARTNERSHIP_INTERESTS,
        page_data={"limits": TEXT_LIMITS},
    )


async def review_page(request: Request) -> Response:
    return _render(
        "review.html",
        route="review",
        title="Partner application review",
        description="Staff sign-in and the partner application queue.",
    )
