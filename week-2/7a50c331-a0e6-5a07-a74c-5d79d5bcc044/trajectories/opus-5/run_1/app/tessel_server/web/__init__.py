"""Page routing: the public pages, the console and the static files."""
import mimetypes
import os
import re
from urllib.parse import quote

from .. import httpbase
from ..errors import TesselError
from . import console, pages, render

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
STATIC_SAFE = re.compile(r"^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$")
WORKSPACE = re.compile(r"^/console/db/([^/]+)$")

CONSOLE_PAGES = {
    "/console": console.database_table,
    "/console/settings": console.settings_page,
    "/console/settings/keys": console.keys_page,
    "/console/settings/billing": console.billing_page,
    "/console/settings/audit": console.audit_page,
}


def not_found():
    response = httpbase.html(render.page("not_found.html"), status=404)
    return response


def _static(path):
    relative = path[len("/static/") :]
    if not STATIC_SAFE.match(relative) or ".." in relative:
        return not_found()
    full = os.path.join(STATIC, relative)
    if not os.path.isfile(full):
        return not_found()
    with open(full, "rb") as handle:
        body = handle.read()
    guessed = mimetypes.guess_type(full)[0] or "application/octet-stream"
    response = httpbase.Response(200, body, content_type=guessed + "; charset=utf-8")
    response.add("X-Content-Type-Options", "nosniff")
    response.add("Cache-Control", "public, max-age=300")
    return response


def _sign_in_again(request):
    target = request.path
    if request.query_string:
        target += "?" + request.query_string
    response = httpbase.redirect("/login?next=%s" % quote(target, safe=""))
    response.add("Cache-Control", "no-store")
    return response


def dispatch(request):
    path = request.path
    if path.startswith("/static/"):
        return _static(path)
    if path == "/":
        return pages.landing(request)
    if path == "/contact":
        return pages.contact_page(request)
    if path == "/login":
        return pages.login_page(request)
    if path == "/forgot":
        return pages.forgot_page(request)
    if path == "/reset":
        return pages.reset_page(request)
    if path == "/console/sign-out" or path in CONSOLE_PAGES or WORKSPACE.match(path):
        return _console(request, path)
    return not_found()


def _console(request, path):
    actor = console.actor_for(request)
    if actor is None:
        return _sign_in_again(request)
    try:
        if path == "/console/sign-out":
            return console.sign_out(request, actor)
        workspace = WORKSPACE.match(path)
        if workspace:
            return console.workspace(request, actor, workspace.group(1))
        return CONSOLE_PAGES[path](request, actor)
    except console.Signout:
        response = httpbase.redirect("/login")
        response.clear_cookie(console.SESSION_COOKIE)
        response.add("Cache-Control", "no-store")
        return response
    except TesselError as refusal:
        if refusal.code == "FORBIDDEN_ROLE":
            return console.denied(actor)
        if refusal.code == "DATABASE_NOT_FOUND":
            return console.missing_database(actor)
        raise
