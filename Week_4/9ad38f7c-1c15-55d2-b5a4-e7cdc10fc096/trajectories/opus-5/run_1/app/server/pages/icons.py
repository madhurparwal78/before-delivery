"""Original inline vector glyphs, drawn in the current text colour."""

from __future__ import annotations

from ..markup import Markup, fmt

_OPEN = (
    '<svg class="icon {}" viewBox="0 0 24 24" width="{}" height="{}" '
    'aria-hidden="true" focusable="false" fill="none" stroke="currentColor" '
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
)


def _icon(name: str, body: str, size: int = 20) -> Markup:
    return fmt(_OPEN + "{}</svg>", Markup(f"icon-{name}"), size, size, Markup(body))


def flag(size: int = 20) -> Markup:
    return _icon("flag", '<path d="M6 21V4"/><path d="M6 4h11l-2 4 2 4H6"/>', size)


def trophy(size: int = 20) -> Markup:
    return _icon(
        "trophy",
        '<path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 5H5v2a3 3 0 0 0 3 3"/>'
        '<path d="M16 5h3v2a3 3 0 0 1-3 3"/><path d="M12 13v4"/>'
        '<path d="M9 20h6"/><path d="M10 17h4l1 3H9Z"/>',
        size,
    )


def tick(size: int = 16) -> Markup:
    return _icon("tick", '<path d="M4 13l5 5L20 6"/>', size)


def cross(size: int = 18) -> Markup:
    return _icon("cross", '<path d="M6 6l12 12M18 6L6 18"/>', size)


def arrow_left(size: int = 18) -> Markup:
    return _icon("arrow-left", '<path d="M15 5l-7 7 7 7"/>', size)


def arrow_right(size: int = 18) -> Markup:
    return _icon("arrow-right", '<path d="M9 5l7 7-7 7"/>', size)


def magnifier(size: int = 20) -> Markup:
    return _icon(
        "magnifier", '<circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/>', size
    )


def bars(size: int = 22) -> Markup:
    return _icon("bars", '<path d="M4 7h16M4 12h16M4 17h16"/>', size)


def shield(size: int = 22) -> Markup:
    return _icon(
        "shield",
        '<path d="M12 3l7 3v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V6Z"/>'
        '<path d="M9 12l2 2 4-4"/>',
        size,
    )


def book(size: int = 20) -> Markup:
    return _icon(
        "book",
        '<path d="M4 5h7v14H4Z"/><path d="M13 5h7v14h-7Z"/><path d="M11 5v14"/>',
        size,
    )


def terminal(size: int = 20) -> Markup:
    return _icon(
        "terminal",
        '<rect x="3" y="5" width="18" height="14" rx="2"/>'
        '<path d="M7 10l2 2-2 2"/><path d="M12 14h5"/>',
        size,
    )


def spark(size: int = 20) -> Markup:
    return _icon(
        "spark",
        '<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z"/>',
        size,
    )


def graduation(size: int = 20) -> Markup:
    return _icon(
        "graduation",
        '<path d="M12 5l9 4-9 4-9-4Z"/><path d="M6 11v4c0 2 3 3 6 3s6-1 6-3v-4"/>',
        size,
    )


def briefcase(size: int = 20) -> Markup:
    return _icon(
        "briefcase",
        '<rect x="3" y="8" width="18" height="11" rx="2"/>'
        '<path d="M9 8V6h6v2"/><path d="M3 13h18"/>',
        size,
    )


def tag(size: int = 20) -> Markup:
    return _icon(
        "tag",
        '<path d="M4 11l7-7 9 9-7 7Z"/><circle cx="14" cy="10" r="1.4"/>',
        size,
    )


def badge(size: int = 20) -> Markup:
    return _icon(
        "badge",
        '<circle cx="12" cy="9" r="5"/><path d="M9 14l-1 7 4-2 4 2-1-7"/>',
        size,
    )


def logo(size: int = 34) -> Markup:
    """The NightWard mark: a cloud outline holding binary digits."""
    return fmt(
        '<svg class="logo-mark" viewBox="0 0 64 40" width="{}" height="{}" '
        'aria-hidden="true" focusable="false" fill="none" stroke="currentColor" '
        'stroke-width="2" stroke-linejoin="round">'
        '<path d="M16 32a9 9 0 0 1 0-18 11 11 0 0 1 21-3 8 8 0 0 1 11 8 '
        '7 7 0 0 1-1 13Z"/>'
        '<text x="20" y="27" font-size="9" fill="currentColor" stroke="none" '
        'font-family="Chakra Petch, monospace">1011</text></svg>',
        int(size * 1.6),
        size,
    )


def iso_badge() -> Markup:
    """The ISO27001 compliance badge, drawn as an original vector mark."""
    return fmt(
        '<svg class="iso-badge" viewBox="0 0 120 60" width="120" height="60" '
        'role="img" aria-label="ISO27001 compliant" fill="none" '
        'stroke="currentColor" stroke-width="2">'
        '<circle cx="30" cy="30" r="20"/>'
        '<path d="M22 30l6 6 12-13"/>'
        '<text x="58" y="27" font-size="13" fill="currentColor" stroke="none" '
        'font-family="Fira Sans, sans-serif">ISO</text>'
        '<text x="58" y="45" font-size="13" fill="currentColor" stroke="none" '
        'font-family="Fira Sans, sans-serif">27001</text></svg>'
    )
