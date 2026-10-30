"""The one icon set: line drawings after Lucide (ISC), each on a 24 px square at a 1.5 px stroke, never filled.

The page sprite and the browser tab icon are both drawn from these definitions.
"""

from urllib.parse import quote

from markupsafe import Markup

ICONS = {
    "shuffle": '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/>'
               '<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/>'
               '<path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/>',
    "caret": '<path d="m6 9 6 6 6-6"/>',
    "chevron": '<path d="m9 18 6-6-6-6"/>',
    "reviewer": '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    "arrow-next": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    "search": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    "check": '<path d="M20 6 9 17l-5-5"/>',
    "cross": '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    "dash": '<path d="M5 12h14"/>',
    "flag": '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    "lock": '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
}

ACTION_BLUE = "#2457c5"


def _drawing(name: str, stroke: str) -> str:
    return (f'<g fill="none" stroke="{stroke}" stroke-width="1.5" stroke-linecap="round" '
            f'stroke-linejoin="round">{ICONS[name]}</g>')


SPRITE = Markup(
    '<svg class="sprite" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">'
    + "".join(f'<symbol id="i-{name}" viewBox="0 0 24 24">{_drawing(name, "currentColor")}</symbol>'
              for name in ICONS)
    + "</svg>"
)

TAB_ICON = "data:image/svg+xml," + quote(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">{_drawing("check", ACTION_BLUE)}</svg>'
)
