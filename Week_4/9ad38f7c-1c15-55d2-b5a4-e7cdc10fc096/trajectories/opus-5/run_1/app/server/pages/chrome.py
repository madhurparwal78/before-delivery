"""The document shell: skip link, header, footer and the cookie panel."""

from __future__ import annotations

from ..markup import Markup, fmt, join
from . import icons

NAVIGATION = (
    ("Learn", "/hacktivities", icons.book),
    ("Practice", "/hacktivities", icons.terminal),
    ("Compete", "/downtime", icons.trophy),
    ("AI Upskilling", "/aisecurity", icons.spark),
    ("Education", "/classrooms", icons.graduation),
    ("Business", "/business", icons.briefcase),
    ("Pricing", "/pricing", icons.tag),
    ("Downtime", "/downtime", icons.flag),
    ("Certifications", "/certifications", icons.badge),
)

FOOTER_COLUMNS = (
    (
        "Learning",
        (
            ("Hands-on labs", "/hacktivities"),
            ("For Business", "/business"),
            ("For Education", "/classrooms"),
            ("Competitive Hacking", "/downtime"),
            ("Certifications", "/certifications"),
        ),
    ),
    (
        "Resources",
        (
            ("About Us", "/about"),
            ("Newsroom", "/about"),
            ("Blog", "/about"),
            ("Glossary", "/glossary"),
            ("Work at NightWard", "/about"),
            ("Careers in Cyber", "/cyber-security-careers"),
            ("Swag Shop", "/community"),
            ("Community", "/community"),
        ),
    ),
    (
        "Privacy & Legal",
        (
            ("Privacy Policy", "/about"),
            ("Terms of Use", "/about"),
            ("AI Terms of Use", "/aisecurity"),
            ("Acceptable Use Policy", "/about"),
            ("Cookie Policy", "/about"),
        ),
    ),
    (
        "Get in touch",
        (
            ("Contact Us", "/community"),
            ("Affiliates", "/community"),
            ("Student Discount", "/pricing"),
        ),
    ),
)

CONSENT_COPY = (
    "We use cookies to ensure you get the best user experience. For more "
    "information see our cookie policy."
)


def live_region(name: str, extra_class: str = "") -> Markup:
    return fmt(
        '<p class="live-region {}" role="status" aria-live="polite" '
        'aria-label="{}" data-region="{}"></p>',
        Markup(extra_class),
        name,
        name,
    )


def solved_word(word: str, solved: bool) -> Markup:
    """A tick glyph sits immediately before every solved word, never colour alone."""
    if not solved:
        return fmt('<span class="state-word">{}</span>', word)
    return fmt(
        '<span class="state-word is-solved">{}<span class="state-text">{}</span></span>',
        icons.tick(),
        word,
    )


def sound_toggle(extra_class: str = "") -> Markup:
    return fmt(
        '<button type="button" class="sound-toggle {}" data-sound-toggle '
        'aria-pressed="false" aria-label="Sound off">'
        '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" '
        'focusable="false" fill="none" stroke="currentColor" stroke-width="1.8">'
        '<path d="M4 9h3l5-4v14l-5-4H4Z"/>'
        '<path class="sound-wave" d="M16 9a4 4 0 0 1 0 6"/></svg>'
        '<span class="sound-label" aria-hidden="true">Sound</span></button>',
        Markup(extra_class),
    )


def header() -> Markup:
    items = join(
        fmt(
            '<li><a class="nav-item" href="{}">{}<span>{}</span></a></li>',
            target,
            glyph(),
            label,
        )
        for label, target, glyph in NAVIGATION
    )
    return fmt(
        """
<header class="site-header">
  <div class="header-inner">
    <a class="logo" href="/">{logo}<span class="wordmark"><span>NIGHT</span>
      <span>WARD</span></span></a>
    <button type="button" class="menu-toggle" data-menu-toggle aria-label="Menu"
      aria-expanded="false" aria-controls="site-navigation">{bars}</button>
    <nav id="site-navigation" class="site-nav" aria-label="Main">
      <ul>{items}</ul>
    </nav>
    <div class="header-actions">
      <button type="button" class="icon-button search-button" aria-label="Search"
        aria-describedby="search-tooltip">{magnifier}</button>
      <span role="tooltip" id="search-tooltip" class="tooltip">Search is not part
        of this event</span>
      <span class="session-links" data-session-links>
        <a class="button button-outline" href="/login">Log In</a>
        <a class="button button-lime" href="/signup">Join for FREE</a>
      </span>
      <span class="session-player" data-session-player hidden>
        <span class="player-name" data-player-name></span>
        <button type="button" class="button button-outline" data-logout>Log out</button>
      </span>
      {sound}
    </div>
  </div>
</header>
""",
        logo=icons.logo(),
        bars=icons.bars(),
        items=items,
        magnifier=icons.magnifier(),
        sound=sound_toggle(),
    )


def footer() -> Markup:
    columns = join(
        fmt(
            '<div class="footer-column"><h2>{}</h2><ul>{}</ul></div>',
            title,
            join(
                fmt('<li><a href="{}">{}</a></li>', target, label)
                for label, target in links
            ),
        )
        for title, links in FOOTER_COLUMNS
    )
    return fmt(
        """
<footer class="site-footer">
  <div class="footer-columns">{columns}</div>
  <p class="footer-line">We're a gamified, hands-on cyber security training
    platform that you can access through your browser.</p>
  <div class="footer-bottom">
    <p class="copyright">&copy; 2026 NightWard. All rights reserved.</p>
    {badge}
  </div>
</footer>
""",
        columns=columns,
        badge=icons.iso_badge(),
    )


def consent_panel() -> Markup:
    return fmt(
        """
<div class="consent-panel" data-consent-panel hidden>
  <p>{copy}</p>
  <div class="consent-actions">
    <button type="button" class="button button-outline" data-consent-settings>Cookie
      Settings</button>
    <button type="button" class="button button-lime" data-consent-allow>Allow
      All</button>
  </div>
</div>
<dialog class="dialog" data-dialog="cookies" aria-labelledby="cookie-dialog-title">
  <form method="dialog" class="dialog-form">
    <h2 id="cookie-dialog-title">Cookie settings</h2>
    <p>Essential cookies keep you signed in and remember your sound and cookie
      choices. Nothing else is stored.</p>
    <div class="dialog-actions">
      <button type="button" class="button button-lime" data-consent-essential>Essential
        only</button>
      <button type="button" class="button button-outline" data-dialog-close>Cancel</button>
    </div>
    <button type="button" class="dialog-close" data-dialog-close
      aria-label="Close dialog">{cross}</button>
  </form>
</dialog>
""",
        copy=CONSENT_COPY,
        cross=icons.cross(),
    )


def document(title: str, page: str, body: Markup, body_class: str = "") -> str:
    return str(
        fmt(
            """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="Downtime: Strange &amp; Unusual Activity, a free
five-day defensive security CTF event from NightWard.">
<link rel="stylesheet" href="/static/app.css">
</head>
<body data-page="{page}" class="{body_class}">
<a class="skip-link" href="#main">Skip to main content</a>
{header}
<main id="main">
{body}
</main>
{footer}
{consent}
<script type="module" src="/static/{page}.js"></script>
</body>
</html>
""",
            title=title,
            page=Markup(page),
            body_class=Markup(body_class),
            header=header(),
            body=body,
            footer=footer(),
            consent=consent_panel(),
        )
    )
