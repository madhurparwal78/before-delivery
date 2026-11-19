"""Page views: one row per reported view."""

from __future__ import annotations

from flask import g

from . import db
from .router import route

FIELD_LIMIT = 2048


@route("POST", "/api/analytics/pageview", body="json")
def pageview() -> None:
    path = g.body.string("path", min_length=1, max_length=FIELD_LIMIT)
    visitor_id = g.body.string("visitor_id", min_length=1, max_length=FIELD_LIMIT)
    db.run("INSERT INTO page_views (path, visitor_id) VALUES (%s, %s)", (path, visitor_id))
