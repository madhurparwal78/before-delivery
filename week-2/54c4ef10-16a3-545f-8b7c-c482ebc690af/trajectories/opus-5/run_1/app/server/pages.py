"""The page shell: signed-out redirects and the bootstrap the browser shares."""

from __future__ import annotations

import json
import re
import urllib.parse
from typing import TYPE_CHECKING

from . import copy as published_copy
from .config import JSON_BODY_LIMIT, UPLOAD_BODY_LIMIT
from .domain.exposure import LOG10_2, MARKED_APERTURES
from .domain.frames import FORMAT_IMAGE_WIDTH_MM, FORMAT_PITCH_MM
from .validate import (
    MAX_EMAIL,
    MAX_NAME,
    MAX_NOTE,
    MAX_PASSWORD,
    MAX_STOCK,
    MAX_TITLE,
    MIN_PASSWORD,
)

if TYPE_CHECKING:
    from .web import Request, Response

UUID_PATTERN = r"[0-9a-fA-F-]{36}"
PUBLIC_PAGES = ("/", "/signin", "/signup")

PAGE_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        r"/",
        r"/signin",
        r"/signup",
        r"/archive",
        r"/curves",
        r"/log",
        r"/rolls/new",
        rf"/rolls/{UUID_PATTERN}",
        rf"/rolls/{UUID_PATTERN}/edit",
        rf"/rolls/{UUID_PATTERN}/scans/{UUID_PATTERN}",
    )
)


def bootstrap() -> dict[str, object]:
    """Everything the browser needs to agree with the server."""
    return {
        "apertures": list(MARKED_APERTURES),
        "log10_2": LOG10_2,
        "copy": published_copy.browser_copy(),
        "formats": [
            {"value": "35mm", "label": "35mm"},
            {"value": "120-6x6", "label": "120 6×6"},
            {"value": "120-6x7", "label": "120 6×7"},
        ],
        "pitch_mm": FORMAT_PITCH_MM,
        "image_width_mm": FORMAT_IMAGE_WIDTH_MM,
        "limits": {
            "note": MAX_NOTE,
            "title": MAX_TITLE,
            "name": MAX_NAME,
            "stock": MAX_STOCK,
            "email": MAX_EMAIL,
            "password_min": MIN_PASSWORD,
            "password_max": MAX_PASSWORD,
            "upload_bytes": UPLOAD_BODY_LIMIT,
            "json_bytes": JSON_BODY_LIMIT,
        },
    }


SHELL = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Edgeprint</title>
<link rel="stylesheet" href="/static/app.css">
<script type="application/json" id="bootstrap">__BOOTSTRAP__</script>
<script type="module" src="/static/js/main.js"></script>
</head>
<body>
<div id="app"></div>
<noscript>Edgeprint needs JavaScript to read negatives.</noscript>
</body>
</html>
"""


def render(request: "Request") -> "Response":
    from .web import Response

    path = request.path
    known = any(pattern.fullmatch(path) for pattern in PAGE_PATTERNS)
    if known and path not in PUBLIC_PAGES and request.account is None:
        target = path
        if request.query:
            target += "?" + urllib.parse.urlencode(request.query)
        next_value = urllib.parse.quote(target, safe="")
        return Response(
            status=302,
            body=b"",
            content_type="text/html; charset=utf-8",
            headers=[("Location", f"/signin?next={next_value}")],
        )
    body = SHELL.replace("__BOOTSTRAP__", json.dumps(bootstrap())).encode()
    return Response(
        status=200 if known else 404,
        body=body,
        content_type="text/html; charset=utf-8",
        headers=[("Cache-Control", "no-store")],
    )
