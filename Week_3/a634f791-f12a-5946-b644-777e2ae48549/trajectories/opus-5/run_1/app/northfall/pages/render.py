"""The shared chrome of every page: addresses, language links and the footer."""

from __future__ import annotations

import datetime as dt

from flask import render_template, request
from markupsafe import escape

from ..config import settings
from ..db import DatabaseUnavailable, transaction
from ..domain.clock import HELSINKI_TZ, helsinki_date, service_now
from ..http import raw_query
from ..strings import table

PATHS = {
    "home": "",
    "references": "/references",
    "programme": "/programme",
    "story": "/story",
    "notes": "/notes",
    "contact": "/contact",
    "privacy": "/privacy",
    "terms": "/terms",
}


def locale_of_path(path: str) -> str:
    return "fi" if path == "/fi" or path.startswith("/fi/") else "en"


def path_for(locale: str, route: str, slug: str | None = None) -> str:
    tail = f"/references/{slug}" if route == "detail" else PATHS[route]
    if locale == "fi":
        return f"/fi{tail}"
    return tail or "/"


def other_language_path(path: str) -> str:
    if locale_of_path(path) == "fi":
        rest = path[3:]
        return rest or "/"
    return "/fi" if path == "/" else f"/fi{path}"


def _with_query(path: str, query: str) -> str:
    return f"{path}?{query}" if query else path


def _sitemap_labels(t: dict) -> list[tuple[str, str]]:
    return [("home", t["not_found_home"])] + list(t["nav"]) + [("contact", t["enquire"])]


def _year() -> int:
    try:
        with transaction() as conn:
            return helsinki_date(service_now(conn)).year
    except DatabaseUnavailable:
        return dt.datetime.now(tz=HELSINKI_TZ).year


def chrome(
    locale: str,
    *,
    route: str | None,
    title: str,
    description: str,
    year: int,
    noindex: bool = False,
) -> dict:
    t = table(locale)
    query = raw_query()
    switch = _with_query(other_language_path(request.path), query)
    return {
        "t": t,
        "locale": locale,
        "route": route,
        "nav": [
            {
                "href": path_for(locale, name),
                "label": label,
                "current": name == route,
            }
            for name, label in t["nav"]
        ],
        "sitemap": [
            {"href": path_for(locale, name), "label": label}
            for name, label in _sitemap_labels(t)
        ],
        "home_href": path_for(locale, "home"),
        "index_href": path_for(locale, "references"),
        "contact_href": path_for(locale, "contact"),
        "privacy_href": path_for(locale, "privacy"),
        "terms_href": path_for(locale, "terms"),
        "switch_href": switch,
        "alternate_href": switch,
        "canonical": f"{settings.public_origin}{request.path}",
        "og_image": f"{settings.public_origin}/static/img/social-preview.svg",
        "page_title": title,
        "description": description,
        "noindex": noindex,
        "year": year,
    }


def echo(value: str | None) -> str:
    """A query value echoed into the page, with NUL and undecodable bytes dropped."""
    kept = "".join(char for char in (value or "") if char not in ("\x00", "\ufffd"))
    return str(escape(kept))


def unknown_address_page(locale: str):
    t = table(locale)
    context = chrome(
        locale,
        route=None,
        title=f"{t['not_found_heading']} \u2014 Northfall",
        description=t["not_found_heading"],
        year=_year(),
        noindex=True,
    )
    return render_template("not_found.html", **context), 404


def outage_page(locale: str):
    t = table(locale)
    context = chrome(
        locale,
        route=None,
        title=f"{t['outage_page']} \u2014 Northfall",
        description=t["outage_page"],
        year=dt.datetime.now(tz=HELSINKI_TZ).year,
        noindex=True,
    )
    return render_template("outage.html", **context), 503
