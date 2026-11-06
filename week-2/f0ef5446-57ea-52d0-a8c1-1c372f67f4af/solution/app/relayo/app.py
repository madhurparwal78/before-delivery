"""The WSGI application: API, media files and pages on one origin."""

from __future__ import annotations

import logging
from collections.abc import Iterable
from typing import Any

from werkzeug.wrappers import Request

from . import api, boot, pages

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
}


def application(environ: dict[str, Any], start_response: Any) -> Iterable[bytes]:
    request = Request(environ)
    if request.path == "/api" or request.path.startswith("/api/"):
        response = api.dispatch(request)
    elif request.path.startswith("/media/"):
        response = pages.media_file(request)
    else:
        response = pages.dispatch(request)
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    return response(environ, start_response)


def start() -> None:
    """Called once in the serving process: prepare services, then deliver email in the background."""
    boot.start()
