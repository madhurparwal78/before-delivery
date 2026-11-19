"""Static files: styles, scripts, fonts, the two media files and the captions."""

from __future__ import annotations

from pathlib import Path

from .http import Response

APP_ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = APP_ROOT / "server" / "static"
MEDIA_DIR = APP_ROOT / "server" / "media"
ASSETS_DIR = APP_ROOT / "assets"

FILM_NAME = "moths-drawn-to-park-lights-246f8064.webm"
SOUNDTRACK_NAME = "john-bartmann-breathing-down-my-neck-master-90c3b95a.ogg"
CAPTIONS_PATH = "/media/briefing.vtt"
FILM_PATH = f"/assets/{FILM_NAME}"
SOUNDTRACK_PATH = f"/assets/{SOUNDTRACK_NAME}"

CONTENT_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".webm": "video/webm",
    ".ogg": "audio/ogg",
    ".vtt": "text/vtt; charset=utf-8",
}


def _resolve(path: str) -> Path | None:
    if path == CAPTIONS_PATH:
        return MEDIA_DIR / "briefing.vtt"
    if path in (FILM_PATH, SOUNDTRACK_PATH):
        return ASSETS_DIR / path.removeprefix("/assets/")
    if path.startswith("/static/"):
        candidate = (STATIC_DIR / path.removeprefix("/static/")).resolve()
        if STATIC_DIR in candidate.parents and candidate.suffix in CONTENT_TYPES:
            return candidate
    return None


def serve(path: str, range_header: str | None) -> Response | None:
    file = _resolve(path)
    if file is None or not file.is_file():
        return None
    data = file.read_bytes()
    content_type = CONTENT_TYPES[file.suffix]
    headers = [
        ("Cache-Control", "public, max-age=300"),
        ("Accept-Ranges", "bytes"),
    ]
    span = _requested_range(range_header, len(data))
    if span is None:
        return Response(body=data, content_type=content_type, headers=headers)
    first, last = span
    headers.append(("Content-Range", f"bytes {first}-{last}/{len(data)}"))
    return Response(
        status=206,
        body=data[first : last + 1],
        content_type=content_type,
        headers=headers,
    )


def _requested_range(header: str | None, size: int) -> tuple[int, int] | None:
    if not header or not header.startswith("bytes=") or "," in header:
        return None
    first_text, _, last_text = header.removeprefix("bytes=").partition("-")
    if not first_text.isdigit():
        return None
    first = int(first_text)
    last = int(last_text) if last_text.isdigit() else size - 1
    if first > last or first >= size:
        return None
    return first, min(last, size - 1)
