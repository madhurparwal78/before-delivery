"""The signed-in workspace page: GET /channels/<community_id>/<channel_id>.

The page is a shell. The browser reads everything else from the API and the live stream, so every
answer is decided by the same rules that guard the API.
"""

from __future__ import annotations

from pathlib import Path

from flask import Flask, Response, make_response, render_template, request

from . import pages

STATIC = Path(__file__).resolve().parent.parent / "static"
LOCALES = ("en-US", "en-GB", "de-DE", "nl-NL")
INT_MAX = 2147483647


def _version() -> str:
    files = [*STATIC.glob("js/workspace*.js"), STATIC / "css" / "workspace.css", STATIC / "css" / "tokens.css",
             STATIC / "js" / "core.js"]
    return str(max((int(p.stat().st_mtime) for p in files if p.is_file()), default=0))


def _identifier(text: str) -> int | None:
    if text.isascii() and text.isdigit() and 1 <= int(text) <= INT_MAX:
        return int(text)
    return None


def register(app: Flask) -> None:
    @app.get("/channels/<community_id>/<channel_id>")
    def workspace(community_id: str, channel_id: str) -> Response:
        community, channel = _identifier(community_id), _identifier(channel_id)
        if community is None or channel is None:
            return pages.not_found_page(404)
        locale = request.cookies.get("hub_locale", "en-US")
        response = make_response(render_template(
            "workspace.html", community_id=community, channel_id=channel, version=_version(),
            lang=locale if locale in LOCALES else "en-US"))
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Robots-Tag"] = "noindex"
        return response
