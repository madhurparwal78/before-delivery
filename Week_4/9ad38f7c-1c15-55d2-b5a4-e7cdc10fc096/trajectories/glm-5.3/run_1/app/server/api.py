"""The JSON interface under /api. One place applies the error precedence,
the strict JSON reading and the path and query input forms."""

import json
import re

from . import db, errors, validation
from .app import APP

MAX_BODY = 16384
JSON_CONTENT_TYPE = "application/json"
_TOKEN_RE = re.compile(r"^Bearer\s+(.+)$", re.IGNORECASE)

# method -> path -> (handler, published_methods)
ROUTES = {}
PUBLISHED = {}


def route(method, path, extra_allowed=()):
    """Register one published route. `extra_allowed` lets a GET path also
    publish HEAD."""
    def register(handler):
        routes = ROUTES.setdefault(path, {})
        routes[method] = handler
        allowed = set(routes) | set(extra_allowed)
        PUBLISHED[path] = sorted(allowed)
        return handler
    return register


def api_error(err):
    return err.status, errors.error_bytes(err), err.headers or []


def public_data(payload):
    return 200, (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"), []


def created_data(payload):
    return 201, (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"), []


def no_content():
    return 204, b"", []


def bearer_token(environ):
    header = environ.get("HTTP_AUTHORIZATION", "")
    match = _TOKEN_RE.match(header.strip())
    return match.group(1) if match else None


def _read_body(environ):
    """Precedence steps 2 to 4: body size, content type and strict JSON."""
    try:
        length = int(environ.get("CONTENT_LENGTH") or 0)
    except ValueError:
        length = 0
    if length > MAX_BODY:
        raise errors.payload_too_large()
    if length <= 0:
        raise errors.unsupported_media_type()
    raw = environ["wsgi.input"].read(length)
    if len(raw) > MAX_BODY:
        raise errors.payload_too_large()
    ctype = environ.get("CONTENT_TYPE", "")
    media = ctype.split(";", 1)[0].strip().lower()
    if media != JSON_CONTENT_TYPE:
        raise errors.unsupported_media_type()
    for part in ctype.split(";")[1:]:
        key, _, value = part.partition("=")
        if key.strip().lower() == "charset" and value.strip().lower() not in ("utf-8", ""):
            raise errors.unsupported_media_type()
    return validation.read_strict_json(raw)


def _call(handler, environ, params):
    """Run one route with a connection from the pool. Any ApiError rolls the
    transaction back, so a refusal stores nothing and changes nothing."""
    needs_body = params.get("body")
    conn = None
    try:
        conn = APP.connection()
        if not APP.ready.is_set():
            raise errors.starting()
        if needs_body:
            body = _read_body(environ)
        else:
            body = None
        status, payload, headers = handler(conn, environ, body)
        conn.commit()
        return status, payload, headers
    except db.OutOfService:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        raise
    except errors.ApiError as err:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return api_error(err)
    finally:
        if conn is not None:
            APP.recycle(conn)


def dispatch(method, path, query, environ):
    """Answer one /api request. The database outage answers 503 unavailable
    on every route other than health, within five seconds."""
    matched = _match_route(method, path)
    if matched is None:
        raise errors.not_found()
    handler, params = matched
    if handler is None:
        allow = ", ".join(sorted({*PUBLISHED.get(path, set())}))
        raise errors.method_not_allowed(allow)
    if params.get("name") == "health":
        return handler(None, environ, None)
    if "slug" in params:
        environ["downtime.slug"] = params["slug"]
    if "user_id" in params:
        environ["downtime.user_id"] = params["user_id"]
    try:
        return _call(handler, environ, params)
    except db.OutOfService:
        raise errors.unavailable()


def _match_route(method, path):
    if not path.startswith("/api"):
        return None
    if path == "/api/health":
        return ROUTES["/api/health"].get(method), {"name": "health"}
    if path == "/api/scenarios":
        return ROUTES["/api/scenarios"].get(method), {}
    if path.startswith("/api/scenarios/"):
        rest = path[len("/api/scenarios/"):]
        parts = rest.split("/")
        if len(parts) == 1 and parts[0]:
            return ROUTES["/api/scenarios/{slug}"].get(method), {"slug": parts[0]}
        if len(parts) == 2 and parts[1] == "flag" and parts[0]:
            return ROUTES["/api/scenarios/{slug}/flag"].get(method), {
                "slug": parts[0], "body": True}
        return None
    if path == "/api/webinar/flag":
        return ROUTES["/api/webinar/flag"].get(method), {"body": True}
    if path == "/api/teams":
        return ROUTES["/api/teams"].get(method), {"body": True}
    if path == "/api/teams/join":
        return ROUTES["/api/teams/join"].get(method), {"body": True}
    if path == "/api/teams/leave":
        return ROUTES["/api/teams/leave"].get(method), {}
    if path == "/api/teams/mine":
        return ROUTES["/api/teams/mine"].get(method), {}
    if path == "/api/teams/mine/invite-code":
        return ROUTES["/api/teams/mine/invite-code"].get(method), {}
    if path.startswith("/api/teams/mine/members/") and path.endswith("/remove"):
        raw = path[len("/api/teams/mine/members/"):-len("/remove")]
        return (ROUTES["/api/teams/mine/members/{user_id}/remove"].get(method),
                {"user_id": raw})
    if path == "/api/leaderboard":
        return ROUTES["/api/leaderboard"].get(method), {}
    if path == "/api/stream":
        return ROUTES["/api/stream"].get(method), {"stream": True}
    if path == "/api/me/certificate":
        return ROUTES["/api/me/certificate"].get(method), {}
    if path == "/api/me/certificate/image":
        return ROUTES["/api/me/certificate/image"].get(method), {}
    for known in ("/api/auth/signup", "/api/auth/login", "/api/auth/logout", "/api/me",
                  "/api/event", "/api/event/calendar.ics"):
        if path == known:
            body = known in ("/api/auth/signup", "/api/auth/login")
            return ROUTES[known].get(method), {"body": body} if body else {}
    return None
