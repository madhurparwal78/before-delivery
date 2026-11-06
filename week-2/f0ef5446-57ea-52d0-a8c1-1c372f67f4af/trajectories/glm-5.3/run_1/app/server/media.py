"""Public media: integration icons and article covers, each served only
while its row is public, checked against the database on every request."""
from __future__ import annotations

from . import db

_PREFIXES = ("/media/integrations/", "/media/articles/")
SVG_HEADERS = {"Content-Type": "image/svg+xml", "Cache-Control": "no-cache"}


class NotFound(Exception):
    """The requested media file is not public."""


def serve(path: str) -> tuple[bytes, dict[str, str]]:
    """The stored media bytes for a published slug, or NotFound."""
    for prefix in _PREFIXES:
        if not path.startswith(prefix):
            continue
        remainder = path[len(prefix):]
        if remainder.endswith(".svg") and "/" not in remainder:
            slug = remainder[: -len(".svg")]
            if prefix == "/media/integrations/":
                condition = (
                    "SELECT icon_ref FROM integrations WHERE slug = %s"
                    " AND published = TRUE"
                )
            else:
                condition = (
                    "SELECT cover_ref FROM articles WHERE slug = %s"
                    " AND published = TRUE AND published_at <= now()"
                )
            with db.connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(condition, (slug,))
                    row = cur.fetchone()
            if row is None:
                raise NotFound()
            return render(slug), dict(SVG_HEADERS)
    raise NotFound()


def render(slug: str) -> bytes:
    """One original vector file per slug: a rounded panel, a bold disc and
    the slug's initials, coloured from the slug itself."""
    hue = sum(ord(ch) for ch in slug) * 137 % 360
    initials = "".join(
        part[0].upper() for part in slug.split("-") if part
    )[:2] or "R"
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160"'
        ' role="img" aria-label="' + initials + '">'
        '<rect width="240" height="160" rx="28" fill="hsl(' + str(hue) +
        ', 30%, 96%)"/>'
        '<circle cx="120" cy="72" r="34" fill="hsl(' + str(hue) +
        ', 45%, 82%)"/>'
        '<circle cx="120" cy="72" r="20" fill="#ffffff" opacity="0.7"/>'
        '<text x="120" y="80" font-family="system-ui, sans-serif"'
        ' font-size="20" font-weight="700" fill="#12233f"'
        ' text-anchor="middle">' + initials + '</text>'
        '<rect x="24" y="120" width="192" height="6" rx="3"'
        ' fill="hsl(' + str(hue) + ', 60%, 80%)"/>'
        '</svg>'
    )
    return svg.encode("utf-8")
