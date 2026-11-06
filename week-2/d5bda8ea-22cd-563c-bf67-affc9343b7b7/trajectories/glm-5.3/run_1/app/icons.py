"""Original thin line-drawing icons, drawn by the app in the current text colour."""

from markupsafe import Markup

SPARKLE = (
    '<svg class="icon" {attrs} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
    '<path d="M12 1.6c.9 3.9 1.6 4.6 5.5 5.5-3.9.9-4.6 1.6-5.5 5.5-.9-3.9-1.6-4.6-5.5-5.5'
    ' 3.9-.9 4.6-1.6 5.5-5.5zM18.6 13.7c.5 2.1.9 2.5 3 3-2.1.5-2.5.9-3 3-.5-2.1-.9-2.5-3-3'
    ' 2.1-.5 2.5-.9 3-3zM6.3 15.1c.4 1.7.7 2 2.4 2.4-1.7.4-2 .7-2.4 2.4-.4-1.7-.7-2-2.4-2.4'
    ' 1.7-.4 2-.7 2.4-2.4z"/></svg>'
)

PIN = (
    '<svg class="icon" {attrs} viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/>'
    '<circle cx="12" cy="10" r="2.6"/></svg>'
)

CHEVRON = (
    '<svg class="icon" {attrs} viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    ' stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    '<path d="M9 5l7 7-7 7"/></svg>'
)

HASH = (
    '<svg class="icon" {attrs} viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    '<path d="M9.5 3.5L7.5 20.5M16.5 3.5l-2 17M4 8.7h16M3.2 15.3h16"/></svg>'
)

UPRIGHT = (
    '<svg class="icon" {attrs} viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    '<path d="M7 17L17 7M9 7h8v8"/></svg>'
)


class Icons:
    """Template helper: Icons.sparkle('id') renders an inline icon.

    The icon strings are static SVG, so they are marked safe for Jinja;
    authored text is still escaped wherever it is rendered.
    """

    @staticmethod
    def sparkle(attrs=""):
        return Markup(SPARKLE.format(attrs=('id="%s"' % attrs) if attrs else ""))

    @staticmethod
    def pin(attrs=""):
        return Markup(PIN.format(attrs=('id="%s"' % attrs) if attrs else ""))

    @staticmethod
    def chevron(attrs=""):
        return Markup(CHEVRON.format(attrs=('id="%s"' % attrs) if attrs else ""))

    @staticmethod
    def hash(attrs=""):
        return Markup(HASH.format(attrs=('id="%s"' % attrs) if attrs else ""))

    @staticmethod
    def upright(attrs=""):
        return Markup(UPRIGHT.format(attrs=('id="%s"' % attrs) if attrs else ""))
