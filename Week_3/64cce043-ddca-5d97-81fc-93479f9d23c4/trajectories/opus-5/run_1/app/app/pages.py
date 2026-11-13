"""Server-rendered shells and the published static pages."""
from __future__ import annotations

import html
import urllib.parse
from typing import Final

from starlette.responses import HTMLResponse

from .errors import ERRORS

SHELL: Final = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — Strongroom Ledger</title>
<link rel="stylesheet" href="/static/fonts/fonts.css">
<link rel="stylesheet" href="/static/css/app.css">
</head>
<body data-screen="{screen}">
<div id="outage"></div>
<div id="screen">{body}</div>
<script type="module" src="/static/js/main.js"></script>
</body>
</html>
"""

WORDMARK: Final = '<p class="wordmark">Hollowmere</p>'


def shell(screen: str, title: str, body: str = "", status_code: int = 200) -> HTMLResponse:
    return HTMLResponse(
        SHELL.format(screen=screen, title=html.escape(title), body=body),
        status_code=status_code,
    )


def landing_page(next_path: str | None) -> HTMLResponse:
    target = "/auth/login"
    if next_path:
        # The sign-in link carries the same value, encoded as one query value.
        target = f"/auth/login?next={urllib.parse.quote(next_path, safe='')}"
    body = f"""<main class="landing">
{WORDMARK}
<h1>Strongroom Ledger</h1>
<p class="lede">A private vault that records which companies hold which pieces of your
personal data, grades how sensitive each one is, and turns a breach into an ordered
recovery plan.</p>
<a class="button primary" href="{target}">Sign in</a>
</main>"""
    return shell("static", "Sign in", body)


def not_found_page() -> HTMLResponse:
    body = f"""<main class="notice">
{WORDMARK}
<h1>Not found</h1>
<p>This record does not exist or is not in your view.</p>
<a class="button" href="/vault">Back to ledger</a>
</main>"""
    return shell("static", "Not found", body, status_code=404)


def signin_failed_page() -> HTMLResponse:
    body = f"""<main class="notice">
{WORDMARK}
<h1>Sign-in failed</h1>
<p>Sign-in could not be completed. Start again.</p>
<a class="button" href="/auth/login">Sign in</a>
</main>"""
    return shell("static", "Sign-in failed", body, status_code=400)


def signin_unavailable_page() -> HTMLResponse:
    body = f"""<main class="notice">
{WORDMARK}
<h1>Sign-in unavailable</h1>
<p>{html.escape(ERRORS['identity_unavailable'][1])}</p>
<a class="button" href="/auth/login">Sign in</a>
</main>"""
    return shell("static", "Sign-in unavailable", body, status_code=503)


def error_page() -> HTMLResponse:
    body = f"""<main class="notice">
{WORDMARK}
<h1>{html.escape(ERRORS['internal'][1])}</h1>
<a class="button" href="/vault">Back to ledger</a>
</main>"""
    return shell("static", "Something went wrong", body, status_code=500)
