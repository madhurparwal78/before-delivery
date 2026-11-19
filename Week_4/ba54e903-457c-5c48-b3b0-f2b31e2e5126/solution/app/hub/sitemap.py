"""/sitemap.xml and /robots.txt: exactly the public pages, on the app's own origin."""

from __future__ import annotations

from flask import Flask, Response
from xml.sax.saxutils import escape

from . import config, db
from .safety_data import ARTICLES
from .trending_data import GAMES

STATIC_PATHS = ("/", "/download", "/membership", "/servers", "/trending-games", "/listening-room", "/support",
                "/support/new", "/safety", "/safety-family-center", "/safety-library", "/safety-news",
                "/safety-teen-charter", "/safety-players-guide", "/safety-parents")


def public_paths() -> list[str]:
    communities = db.all_rows("SELECT slug FROM communities WHERE published ORDER BY slug")
    return [*STATIC_PATHS, *(f"/servers/{row['slug']}" for row in communities),
            *(f"/game/{slug}" for slug in GAMES), *(f"/safety-library/{a['slug']}" for a in ARTICLES)]


def sitemap() -> Response:
    entries = "".join(f"<url><loc>{escape(config.PUBLIC_ORIGIN + path)}</loc></url>" for path in public_paths())
    body = ('<?xml version="1.0" encoding="UTF-8"?>'
            f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entries}</urlset>')
    return Response(body, mimetype="application/xml")


def robots() -> Response:
    body = f"User-agent: *\nDisallow: /channels/\nDisallow: /settings\nSitemap: {config.PUBLIC_ORIGIN}/sitemap.xml\n"
    return Response(body, mimetype="text/plain")


def register(app: Flask) -> None:
    app.add_url_rule("/sitemap.xml", "sitemap", sitemap)
    app.add_url_rule("/robots.txt", "robots", robots)
