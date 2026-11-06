"""Page routes: the signed-out redirect, the single-page shell and the generated domain script."""

import re
from pathlib import Path
from urllib.parse import quote

from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response

from .sessions import SESSION_COOKIE, session_account
from .web_domain import domain_script

STATIC = Path(__file__).resolve().parent.parent / "static"
PUBLIC_PAGES = re.compile(r"/(signin|signup)?")
SIGNED_IN_PAGES = re.compile(
    r"/(archive|curves|log|rolls/new|rolls/[^/]+|rolls/[^/]+/edit|rolls/[^/]+/scans/[^/]+)")
SHELL = (STATIC / "index.html")


async def shell(request: Request) -> Response:
    """Serve the shell for a known page; a signed-out visit to a signed-in page goes to sign-in with `next`."""
    path = request.url.path
    if PUBLIC_PAGES.fullmatch(path):
        return HTMLResponse(SHELL.read_text())
    if not SIGNED_IN_PAGES.fullmatch(path):
        return HTMLResponse(SHELL.read_text(), status_code=404)
    token = request.cookies.get(SESSION_COOKIE)
    if not (token and await session_account(request.app.state.db, token)):
        target = path + (f"?{request.url.query}" if request.url.query else "")
        return RedirectResponse(f"/signin?next={quote(target, safe='')}", status_code=302)
    return HTMLResponse(SHELL.read_text())


async def domain_module(_request: Request) -> Response:
    return Response(domain_script(), media_type="text/javascript", headers={"Cache-Control": "no-cache"})
