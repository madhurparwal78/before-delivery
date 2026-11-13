"""Shared HTTP core: the route registry and helpers every API module uses."""
import json
from datetime import datetime, timezone

from lib import store
from lib.errors import ApiError

ROUTES: list[tuple[str, str, object]] = []
PATH_TEMPLATES: list[tuple[str, list[str], str, object]] = []


def route(method: str, path: str):
    def register(fn):
        ROUTES.append((method, path, fn))
        return fn
    return register


def build_path_templates():
    PATH_TEMPLATES.clear()
    for method, path, fn in ROUTES:
        if "{" in path:
            PATH_TEMPLATES.append((method, path.split("/"), path, fn))


def match_route(method: str, path: str):
    for m, pattern, fn in ROUTES:
        if m == method and pattern == path:
            return fn, {}
    segs = path.split("/")
    for m, tsegs, pattern, fn in PATH_TEMPLATES:
        if m != method or len(tsegs) != len(segs):
            continue
        params = {}
        ok = True
        for t, s in zip(tsegs, segs):
            if t.startswith("{") and t.endswith("}"):
                params[t[1:-1]] = s
            elif t != s:
                ok = False
                break
        if ok:
            return fn, params
    return None, None


def json_response(payload, status=200, headers=None) -> tuple:
    body = json.dumps(payload).encode()
    base = [("Content-Type", "application/json; charset=utf-8")]
    if headers:
        base.extend(headers)
    return status, base, body


def iso(dt) -> str:
    if isinstance(dt, str):
        return dt
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def require_session(handler) -> dict:
    auth = handler.headers.get("Authorization", "")
    token = auth[7:].strip() if auth.startswith("Bearer ") else ""
    if not token:
        raise ApiError(401, "unauthorized")
    session = store.one("SELECT * FROM sessions WHERE token=%s", (token,))
    if not session:
        raise ApiError(401, "unauthorized")
    me = store.one("SELECT * FROM athletes WHERE id=%s", (session["athlete_id"],))
    if not me:
        raise ApiError(401, "unauthorized")
    return me


def athlete_self(me) -> dict:
    return {"id": me["id"], "email": me["email"], "name": me["name"], "private": me["private"],
            "default_visibility": me["default_visibility"], "subscriber": me["subscriber"],
            "plan": me["plan"], "time_zone": me["time_zone"]}


def str_field(body: dict, name: str, required=True, max_len=None, min_len=1, choices=None,
              default=None):
    """Validate one string field, raising one shared error shape."""
    value = body.get(name, default)
    if value is None:
        if required:
            raise ApiError(400, "validation", {name: "required"})
        return default
    if not isinstance(value, str):
        raise ApiError(400, "validation", {name: "invalid"})
    stripped = value.strip()
    if min_len is not None and len(stripped) < min_len:
        raise ApiError(400, "validation", {name: "invalid"})
    if max_len is not None and len(stripped) > max_len:
        raise ApiError(400, "validation", {name: "invalid"})
    if choices and value not in choices:
        raise ApiError(400, "validation", {name: "invalid"})
    return stripped
