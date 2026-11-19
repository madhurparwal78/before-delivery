"""Safety library search: plain-text matching on title and summary, filters ignoring case."""

from __future__ import annotations

from typing import Any

from flask import g

from .errors import invalid
from .router import route
from .safety_data import ARTICLES

QUERY_LIMIT = 256


@route("GET", "/api/safety/articles")
def articles() -> dict[str, Any]:
    text = g.query.string("q", "")
    if len(text) > QUERY_LIMIT:
        raise invalid("q")
    needle = text.strip().casefold()
    category = g.query.string("category", "").casefold()
    topic = g.query.string("topic", "").casefold()
    return {"data": [
        {key: article[key] for key in ("slug", "title", "category", "topic", "summary")}
        for article in ARTICLES
        if (not needle or needle in article["title"].casefold() or needle in article["summary"].casefold())
        and (not category or article["category"].casefold() == category)
        and (not topic or article["topic"].casefold() == topic)]}
