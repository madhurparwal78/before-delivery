"""The published route table: one place that knows every path, method and role."""
import re

ROUTES = []


def add(method, pattern, handler, role=None, versioned=True,
        takes_body=False, idempotent=False, query_limited=False):
    """role: 'public' (no credential), None (member session only),
    'viewer', 'editor' or 'owner'. Owner routes are never callable by keys.
    """
    key_ok = role != "owner"
    regex = re.compile("^" + re.sub(r"\{([a-z_]+)\}", r"(?P<\1>[^/]+)", pattern) + "$")
    ROUTES.append({"method": method, "pattern": pattern, "regex": regex,
                   "handler": handler, "role": role,
                   "versioned": versioned, "takes_body": takes_body,
                   "idempotent": idempotent, "query_limited": query_limited})


def match(method, path):
    """Return (spec, params, err) where err is None, a 404 or a 405 ApiError."""
    from .textutil import ApiError
    allowed = []
    for spec in ROUTES:
        m = spec["regex"].match(path)
        if m:
            allowed.append(spec["method"])
            if spec["method"] == method:
                return spec, m.groupdict(), None
    if not allowed:
        return None, None, ApiError(404, "ROUTE_NOT_FOUND", "No route matches this address")
    if method in ("HEAD", "OPTIONS"):
        allowed = [a for a in allowed if a not in ("HEAD", "OPTIONS")]
    allowed = sorted(set(allowed))
    return None, None, ApiError(405, "METHOD_NOT_ALLOWED",
                                "This address does not accept " + method,
                                headers={"Allow": ", ".join(allowed)})


def allowed_for(path):
    allowed = sorted({s["method"] for s in ROUTES if s["regex"].match(path)})
    return allowed
