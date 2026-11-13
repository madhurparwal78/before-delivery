"""Screen routes: redirects for who may see what, the page shell, and the server-rendered fallback pages."""
from __future__ import annotations

import html
import re
import uuid
from urllib.parse import quote

from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response

from . import auth, domain

OWNER_SCREENS = frozenset({"/vault", "/vault/breaches", "/vault/rules", "/vault/contact", "/vault/account"})
RECORD_SCREEN = re.compile(r"/vault/(holdings|breaches)/([^/]+)")
RECORD_EXISTS = {
    "holdings": "SELECT EXISTS (SELECT 1 FROM holding WHERE id = $1 AND vault_id = $2)",
    "breaches": "SELECT EXISTS (SELECT 1 FROM breach WHERE id = $1 AND vault_id = $2)",
}

MARK = ('<svg class="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">'
        '<rect x="3" y="3" width="26" height="26" rx="3"/><circle cx="16" cy="16" r="7.5"/>'
        '<path d="M16 8.5v4M16 19.5v4M8.5 16h4M19.5 16h4"/><circle class="mark-core" cx="16" cy="16" r="1.6"/></svg>')
NOT_FOUND = ("Not found", "This record does not exist or is not in your view.", "/vault", "Back to ledger")
SIGNIN_FAILED = ("Sign-in failed", "Sign-in could not be completed. Start again.", "/auth/login", "Sign in")
SIGNIN_UNAVAILABLE = ("Sign-in unavailable", "Sign-in service unavailable. Try again in a few minutes.", "/", "Back to start")


def shell(page: str, *, status_code: int = 200, today: str = "", notice: tuple[str, str, str, str] | None = None,
          sign_in: str = "/auth/login") -> HTMLResponse:
    """One document for every screen; the script draws the screen named by `data-page`."""
    body = ""
    if notice is not None:
        heading, text, href, link = (html.escape(part) for part in notice)
        body = (f'<main class="notice" id="main"><h1>{heading}</h1><p>{text}</p>'
                f'<p><a class="button button-primary" href="{href}">{link}</a></p></main>')
    elif page == "home":
        body = ('<main class="landing" id="main"><p class="wordmark">' + MARK + '<span>Hollowmere</span></p>'
                '<h1>Strongroom Ledger</h1>'
                '<p class="landing-lede">Record which companies hold which of your personal data, and know what to do first when one is breached.</p>'
                f'<p><a class="button button-primary" href="{html.escape(sign_in)}">Sign in</a></p></main>')
    document = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Strongroom Ledger · Hollowmere</title>
<link rel="icon" href="/assets/mark.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/ibm-plex-mono-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/app.css">
<script type="module" src="/assets/app.js"></script>
</head>
<body data-page="{page}" data-today="{today}">
<div id="root">{body}</div>
</body>
</html>"""
    return HTMLResponse(document, status_code=status_code, headers={"Cache-Control": "no-store"})


def signin_failed() -> HTMLResponse:
    return shell("notice", status_code=400, notice=SIGNIN_FAILED)


def signin_unavailable() -> HTMLResponse:
    return shell("unavailable", status_code=503, notice=SIGNIN_UNAVAILABLE)


def not_found() -> HTMLResponse:
    return shell("not-found", status_code=404, notice=NOT_FOUND)


async def screen(request: Request) -> Response:
    """Every non-API path: signed-out visits to private screens go to `/` carrying the return path."""
    state = request.app.state.strongroom
    path = request.url.path
    private = path == "/shared" or path == "/vault" or path.startswith("/vault/")
    if path != "/" and not private:
        return not_found()
    async with state.pool.acquire() as conn:
        who = await auth.session_of(state, conn, request.cookies.get(auth.SESSION_COOKIE), touch=True)
        if who is None:
            if path == "/":
                wanted = request.query_params.get("next")
                return shell("home", sign_in=f"/auth/login?next={quote(wanted, safe='')}" if wanted else "/auth/login")
            wanted = path + (f"?{request.url.query}" if request.url.query else "")
            return RedirectResponse(f"/?next={quote(wanted, safe='')}", status_code=302)
        home = domain.home_for(who.role)
        if path == "/" or (path == "/shared") == who.is_owner:
            return RedirectResponse(home, status_code=302)
        if path in OWNER_SCREENS or path == "/shared":
            return shell("app", today=str(await conn.fetchval("SELECT current_date")))
        record = RECORD_SCREEN.fullmatch(path)
        record_id = _uuid(record.group(2)) if record else None
        if record_id is None or not await conn.fetchval(RECORD_EXISTS[record.group(1)], record_id, who.vault_id):
            return not_found()
        return shell("app", today=str(await conn.fetchval("SELECT current_date")))


def _uuid(raw: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(raw)
    except ValueError:
        return None
