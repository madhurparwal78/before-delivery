"""Assets for the site, served from this origin only."""
from __future__ import annotations

import os

_ROOT = "/app/site"
_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


def serve(path: str) -> tuple[bytes, str | None, int]:
    """A site asset, or 404. Paths never escape the site directory."""
    relative = path.lstrip("/")
    candidate = os.path.normpath(os.path.join(_ROOT, relative))
    root = os.path.normpath(_ROOT)
    if not candidate.startswith(root + os.sep):
        return b"", None, 404
    if not os.path.isfile(candidate):
        return b"", None, 404
    with open(candidate, "rb") as handle:
        content = handle.read()
    extension = os.path.splitext(candidate)[1].lower()
    return content, _TYPES.get(extension), 200
