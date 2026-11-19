"""Page routes, the API routing table and the shared middleware boundary."""
from __future__ import annotations

import json
from typing import Optional

from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, PlainTextResponse, Response
from starlette.routing import Mount, Route

from . import api
from .errors import ApiError, ERROR_MESSAGES, method_not_allowed
from .requesthelp import check_origin


API_ROUTES: dict = {
    "/api/health": {"GET"},
    "/api/auth/signup": {"POST"},
    "/api/auth/login": {"POST"},
    "/api/auth/logout": {"POST"},
    "/api/auth/verify-email": {"POST"},
    "/api/auth/resend-confirmation": {"POST"},
    "/api/users/@me": {"GET", "PATCH"},
    "/api/users/@me/password": {"POST"},
    "/api/servers": {"GET", "POST"},
    "/api/servers/{slug}": {"GET", "PATCH"},
    "/api/servers/{slug}/join": {"POST"},
    "/api/servers/{slug}/membership": {"PATCH", "DELETE"},
    "/api/servers/{slug}/members": {"GET"},
    "/api/servers/{slug}/bans": {"GET"},
    "/api/servers/{slug}/bans/{user_id}": {"PUT", "DELETE"},
    "/api/servers/{slug}/members/{user_id}/timeout": {"PUT"},
    "/api/servers/{slug}/roles": {"GET", "POST"},
    "/api/roles/{role_id}": {"PATCH", "DELETE"},
    "/api/servers/{slug}/members/{user_id}/roles/{role_id}": {"PUT", "DELETE"},
    "/api/channels/{channel_id}/overwrites": {"GET"},
    "/api/channels/{channel_id}/overwrites/{target_type}/{target_id}": {"PUT", "DELETE"},
    "/api/channels/{channel_id}/permissions": {"GET"},
    "/api/servers/{slug}/invites": {"GET", "POST"},
    "/api/invites/{code}": {"GET", "DELETE"},
    "/api/invites/{code}/accept": {"POST"},
    "/api/servers/{slug}/messages/search": {"GET"},
    "/api/servers/{slug}/read-states": {"GET"},
    "/api/channels/{channel_id}/ack": {"POST"},
    "/api/channels/{channel_id}/messages": {"GET", "POST"},
    "/api/messages/{message_id}": {"PATCH", "DELETE"},
    "/api/messages/{message_id}/replies": {"GET"},
    "/api/messages/{message_id}/reactions/{emoji}": {"PUT", "DELETE"},
    "/api/attachments": {"POST"},
    "/api/live": {"GET"},
    "/api/notifications": {"GET"},
    "/api/notifications/{id}": {"GET"},
    "/api/notifications/{id}/read": {"POST"},
    "/api/notifications/read-all": {"POST"},
    "/api/membership/tiers": {"GET"},
    "/api/membership/checkout": {"POST"},
    "/api/membership": {"DELETE"},
    "/api/trending-games": {"GET"},
    "/api/games/{slug}": {"GET"},
    "/api/safety/articles": {"GET"},
    "/api/support/tickets": {"POST"},
    "/api/analytics/pageview": {"POST"},
}


API_HANDLERS = {
    "/api/health": {"GET": api.api_health},
    "/api/auth/signup": {"POST": api.api_signup},
    "/api/auth/login": {"POST": api.api_login},
    "/api/auth/logout": {"POST": api.api_logout},
    "/api/auth/verify-email": {"POST": api.api_verify_email},
    "/api/auth/resend-confirmation": {"POST": api.api_resend_confirmation},
    "/api/users/@me": {"GET": api.api_me_get, "PATCH": api.api_me_patch},
    "/api/users/@me/password": {"POST": api.api_password_change},
    "/api/servers": {"GET": api.api_servers_list, "POST": api.api_server_create},
    "/api/servers/{slug}": {"GET": api.api_server_detail, "PATCH": api.api_server_patch},
    "/api/servers/{slug}/join": {"POST": api.api_server_join},
    "/api/servers/{slug}/membership": {"PATCH": api.api_membership_patch, "DELETE": api.api_server_leave},
    "/api/servers/{slug}/members": {"GET": api.api_server_members},
    "/api/servers/{slug}/bans": {"GET": api.api_server_bans},
    "/api/servers/{slug}/bans/{user_id}": {"PUT": api.api_server_ban, "DELETE": api.api_server_unban},
    "/api/servers/{slug}/members/{user_id}/timeout": {"PUT": api.api_server_timeout},
    "/api/servers/{slug}/roles": {"GET": api.api_roles_list, "POST": api.api_roles_create},
    "/api/roles/{role_id}": {"PATCH": api.api_role_patch, "DELETE": api.api_role_delete},
    "/api/servers/{slug}/members/{user_id}/roles/{role_id}": {
        "PUT": api.api_role_assign, "DELETE": api.api_role_remove},
    "/api/channels/{channel_id}/overwrites": {"GET": api.api_overwrites_list},
    "/api/channels/{channel_id}/overwrites/{target_type}/{target_id}": {
        "PUT": api.api_overwrite_put, "DELETE": api.api_overwrite_delete},
    "/api/channels/{channel_id}/permissions": {"GET": api.api_channel_permissions},
    "/api/servers/{slug}/invites": {"GET": api.api_invites_list, "POST": api.api_invites_create},
    "/api/invites/{code}": {"GET": api.api_invite_get, "DELETE": api.api_invite_delete},
    "/api/invites/{code}/accept": {"POST": api.api_invite_accept},
    "/api/servers/{slug}/messages/search": {"GET": api.api_search},
    "/api/servers/{slug}/read-states": {"GET": api.api_read_states},
    "/api/channels/{channel_id}/ack": {"POST": api.api_channel_ack},
    "/api/channels/{channel_id}/messages": {"GET": api.api_messages_list, "POST": api.api_messages_post},
    "/api/messages/{message_id}": {"PATCH": api.api_message_patch, "DELETE": api.api_message_delete},
    "/api/messages/{message_id}/replies": {"GET": api.api_message_replies},
    "/api/messages/{message_id}/reactions/{emoji}": {
        "PUT": api.api_reaction_put, "DELETE": api.api_reaction_delete},
    "/api/attachments": {"POST": api.api_attachment_upload},
    "/api/live": {"GET": api.api_live},
    "/api/notifications": {"GET": api.api_notifications_list},
    "/api/notifications/{id}/read": {"POST": api.api_notification_read},
    "/api/notifications/read-all": {"POST": api.api_notifications_read_all},
    "/api/membership/tiers": {"GET": api.api_tiers},
    "/api/membership/checkout": {"POST": api.api_checkout},
    "/api/membership": {"DELETE": api.api_membership_cancel},
    "/api/trending-games": {"GET": api.api_trending},
    "/api/games/{slug}": {"GET": api.api_game_detail},
    "/api/safety/articles": {"GET": api.api_safety_articles},
    "/api/support/tickets": {"POST": api.api_support_ticket},
    "/api/analytics/pageview": {"POST": api.api_pageview},
}


def _compile_pattern(pattern: str):
    """Translate an endpoint-table path into a regex for matching."""
    import re as _re
    parts = []
    for segment in pattern.strip("/").split("/"):
        if segment.startswith("{") and segment.endswith("}"):
            name = segment[1:-1]
            if name.endswith("_id") or name == "id":
                parts.append(r"([1-9][0-9]{0,9})")
            else:
                parts.append(r"([^/]+)")
        else:
            parts.append(_re.escape(segment))
    return _re.compile("^/" + "/".join(parts) + "$")


_COMPILED = [(_compile_pattern(p), p, m) for p, m in API_ROUTES.items()]


def _path_matches(path: str):
    """Match a request path against the table, returning (pattern, params)."""
    for regex, pattern, methods in _COMPILED:
        match = regex.match(path)
        if match:
            names = [s[1:-1] for s in pattern.strip("/").split("/") if s.startswith("{")]
            params = dict(zip(names, match.groups()))
            return pattern, params
    return None, None


async def dispatch_api(request: Request) -> Response:
    """Route and method steps of the error precedence for every /api path."""
    path = request.url.path
    pattern, params = _path_matches(path)
    if pattern is None:
        raise ApiError("not_found")
    methods = API_ROUTES[pattern]
    if request.method not in methods:
        raise method_not_allowed(sorted(methods))
    request.scope["path_params"] = params
    handler = API_HANDLERS[pattern][request.method]
    return await handler(request)


# ---------------------------------------------------------------------------
# page routes and HTML rendering

from jinja2 import Environment, FileSystemLoader, select_autoescape  # noqa: E402

env = Environment(
    loader=FileSystemLoader("/app/hub/templates"),
    autoescape=select_autoescape(["html"]),
)


def render(request: Request, template: str, title: str, **context) -> HTMLResponse:
    state = request.app.state.hub
    db = state.db
    member = None
    auth_header = request.headers.get("authorization") or ""
    if auth_header.lower().startswith("bearer "):
        from .auth import resolve_bearer
        member = resolve_bearer(request)
    context.setdefault("app_url", state.config.public_origin)
    context.setdefault("member", member)
    context.setdefault("locale", request.cookies.get("hub_locale", "en-US"))
    html = env.get_template(template).render(**context)
    return HTMLResponse(html)


async def page_home(request: Request) -> HTMLResponse:
    return render(request, "home.html", "Community Hub")


async def page_download(request: Request) -> HTMLResponse:
    return render(request, "download.html", "Download")


async def page_membership(request: Request) -> HTMLResponse:
    return render(request, "membership.html", "Membership")


async def page_servers(request: Request) -> HTMLResponse:
    return render(request, "servers.html", "Discover communities")


async def page_server_detail(request: Request) -> HTMLResponse:
    db = request.app.state.hub.db
    slug = request.path_params["slug"]
    from . import api as api_mod
    from .auth import resolve_bearer
    member = resolve_bearer(request)
    c = api_mod.load_community(db, slug)
    if c is None or not c["published"]:
        if not (member and c and api_mod.membership_of(db, member["id"], c["id"])):
            return page_not_found(request)
    if c is None:
        return page_not_found(request)
    shape = api_mod.community_shape(db, c)
    from .auth import resolve_bearer as rb
    viewer = rb(request)
    membership = api_mod.membership_of(db, viewer["id"], c["id"]) if viewer else None
    channels = []
    for ch in db.all("SELECT * FROM channels WHERE community_id = %s ORDER BY position ASC", (c["id"],)):
        channels.append(ch)
    return render(request, "server_detail.html", shape["name"], community=shape,
                  channels=channels, is_member=bool(membership))


async def page_trending(request: Request) -> HTMLResponse:
    return render(request, "trending.html", "Trending games")


async def page_game_detail(request: Request) -> HTMLResponse:
    db = request.app.state.hub.db
    slug = request.path_params["slug"]
    game = db.one("SELECT * FROM trending_games WHERE slug = %s", (slug,))
    if game is None:
        return page_not_found(request)
    return render(request, "game.html", game["name"], game_slug=slug, game_name=game["name"])


async def page_listening_room(request: Request) -> HTMLResponse:
    return render(request, "listening.html", "Listening room")


async def page_support(request: Request) -> HTMLResponse:
    return render(request, "support.html", "Support centre")


async def page_support_new(request: Request) -> HTMLResponse:
    return render(request, "support_new.html", "Submit a request")


async def page_safety(request: Request) -> HTMLResponse:
    return render(request, "safety.html", "Safety center")


async def page_safety_sub(request: Request) -> HTMLResponse:
    page = request.path_params.get("page") or request.url.path.strip("/")
    templates = {
        "safety-family-center": ("Family center", "safety_family.html"),
        "safety-library": ("Safety library", "safety_library.html"),
        "safety-news": ("Safety news", "safety_news.html"),
        "safety-teen-charter": ("Teen charter", "safety_charter.html"),
        "safety-players-guide": ("Players guide", "safety_players.html"),
        "safety-parents": ("For parents", "safety_parents.html"),
    }
    entry = templates.get(page)
    if entry is None:
        return page_not_found(request)
    return render(request, entry[1], entry[0])


async def page_safety_article(request: Request) -> HTMLResponse:
    db = request.app.state.hub.db
    slug = request.path_params["slug"]
    article = db.one("SELECT * FROM safety_articles WHERE slug = %s", (slug,))
    if article is None:
        return page_not_found(request)
    return render(request, "safety_article.html", article["title"], article=article)


async def page_login(request: Request) -> HTMLResponse:
    return render(request, "login.html", "Log in", next_path=request.query_params.get("next", ""))


async def page_register(request: Request) -> HTMLResponse:
    return render(request, "register.html", "Create an account", next_path=request.query_params.get("next", ""))


async def page_verify_email(request: Request) -> HTMLResponse:
    resp = render(request, "verify.html", "Confirm your email")
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp


async def page_settings(request: Request) -> HTMLResponse:
    from .auth import resolve_bearer
    member = resolve_bearer(request)
    if member is None:
        from .rules import TIER_NAMES
        return redirect_to_login(request)
    return render(request, "settings.html", "Settings", member=member,
                  tier_name=TIER_NAMES.get(member["tier"], "Free"))


def redirect_to_login(request: Request) -> Response:
    from urllib.parse import quote
    target = request.url.path
    if request.url.query:
        target += "?" + request.url.query
    return Response(status_code=302, headers={
        "Location": "/login?next=" + quote(target, safe=""),
        "Cache-Control": "no-store",
    })


async def page_workspace(request: Request) -> HTMLResponse:
    from .auth import resolve_bearer
    member = resolve_bearer(request)
    if member is None:
        return redirect_to_login(request)
    return render(request, "workspace.html", "Community workspace")


async def page_not_found(request: Request) -> HTMLResponse:
    html = env.get_template("notfound.html").render(app_url="", member=None, locale="en-US")
    return HTMLResponse(html, status_code=404)


async def page_sitemap(request: Request) -> Response:
    state = request.app.state.hub
    db = state.db
    origin = state.config.public_origin
    urls = ["/", "/download", "/membership", "/servers", "/trending-games", "/listening-room",
            "/support", "/support/new", "/safety", "/safety-family-center", "/safety-library",
            "/safety-news", "/safety-teen-charter", "/safety-players-guide", "/safety-parents"]
    for row in db.all("SELECT slug FROM communities WHERE published = TRUE"):
        urls.append(f"/servers/{row['slug']}")
    for row in db.all("SELECT slug FROM trending_games"):
        urls.append(f"/game/{row['slug']}")
    for row in db.all("SELECT slug FROM safety_articles"):
        urls.append(f"/safety-library/{row['slug']}")
    body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    for u in urls:
        body += f"<url><loc>{origin}{u}</loc></url>\n"
    body += "</urlset>\n"
    return Response(body, media_type="application/xml")


async def page_robots(request: Request) -> Response:
    state = request.app.state.hub
    origin = state.config.public_origin
    text = f"User-agent: *\nDisallow: /channels/\nDisallow: /settings\nSitemap: {origin}/sitemap.xml\n"
    return PlainTextResponse(text)


def build_routes(state) -> list:
    """The routing table for pages, API, media and static files."""
    from starlette.staticfiles import StaticFiles
    page_routes = [
        Route("/", page_home),
        Route("/download", page_download),
        Route("/membership", page_membership),
        Route("/servers", page_servers),
        Route("/servers/{slug}", page_server_detail),
        Route("/trending-games", page_trending),
        Route("/game/{slug}", page_game_detail),
        Route("/listening-room", page_listening_room),
        Route("/support", page_support),
        Route("/support/new", page_support_new),
        Route("/safety", page_safety),
        Route("/safety-library", page_safety_sub, name="library"),
        Route("/safety-library/{slug}", page_safety_article),
        Route("/safety-family-center", page_safety_sub),
        Route("/safety-news", page_safety_sub),
        Route("/safety-teen-charter", page_safety_sub),
        Route("/safety-players-guide", page_safety_sub),
        Route("/safety-parents", page_safety_sub),
        Route("/login", page_login),
        Route("/register", page_register),
        Route("/verify-email", page_verify_email),
        Route("/settings", page_settings),
        Route("/channels/{community_id}/{channel_id}", page_workspace),
        Route("/channels/{community_id}/{channel_id}/{rest:path}", page_workspace),
        Route("/sitemap.xml", page_sitemap),
        Route("/robots.txt", page_robots),
    ]
    media_route = Route("/media/{attachment_id}", api_media)
    api_route = Route("/api/{rest:path}", dispatch_api, methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    static = Mount("/static", app=StaticFiles(directory="/app/hub/static"), name="static")
    return [api_route, media_route, *page_routes, static]






async def api_media(request: Request) -> Response:
    return api.media_response(request, request.path_params["attachment_id"])
