"""The published surface: every `/api` path this brief defines and the methods it allows."""

import re

_SEGMENT = r"[^/]+"

PUBLISHED: list[tuple[str, frozenset[str]]] = [
    ("/api/health", frozenset({"GET"})),
    ("/api/auth/login", frozenset({"POST"})),
    ("/api/auth/logout", frozenset({"POST"})),
    ("/api/auth/accept-invite", frozenset({"POST"})),
    ("/api/me", frozenset({"GET"})),
    ("/api/me/preferences", frozenset({"PATCH"})),
    ("/api/members", frozenset({"GET", "POST"})),
    ("/api/members/{}", frozenset({"PATCH"})),
    ("/api/workspace", frozenset({"GET", "PATCH"})),
    ("/api/stats", frozenset({"GET"})),
    ("/api/connector-definitions", frozenset({"GET"})),
    ("/api/connector-definitions/{}", frozenset({"GET"})),
    ("/api/sources", frozenset({"GET", "POST"})),
    ("/api/sources/{}", frozenset({"GET"})),
    ("/api/sources/{}/check", frozenset({"POST"})),
    ("/api/sources/{}/catalog", frozenset({"GET"})),
    ("/api/sources/{}/sample-events", frozenset({"POST"})),
    ("/api/destinations", frozenset({"GET", "POST"})),
    ("/api/destinations/{}/tables", frozenset({"GET"})),
    ("/api/destinations/{}/tables/{}/records", frozenset({"GET"})),
    ("/api/connections", frozenset({"GET", "POST"})),
    ("/api/connections/{}", frozenset({"GET", "PATCH"})),
    ("/api/connections/{}/state", frozenset({"GET"})),
    ("/api/connections/{}/reset", frozenset({"POST"})),
    ("/api/connections/{}/sync", frozenset({"POST"})),
    ("/api/jobs", frozenset({"GET"})),
    ("/api/jobs/{}", frozenset({"GET"})),
    ("/api/jobs/{}/cancel", frozenset({"POST"})),
    ("/api/jobs/{}/logs", frozenset({"GET"})),
    ("/api/jobs/{}/events", frozenset({"GET"})),
    ("/api/builder/projects", frozenset({"GET", "POST"})),
    ("/api/builder/projects/{}", frozenset({"GET", "PUT"})),
    ("/api/builder/projects/{}/test", frozenset({"POST"})),
    ("/api/builder/projects/{}/publish", frozenset({"POST"})),
    ("/api/audit", frozenset({"GET"})),
    ("/api/audit/{}", frozenset({"GET"})),
]

_COMPILED = [(re.compile("^" + re.escape(path).replace(re.escape("{}"), _SEGMENT) + "$"), methods)
             for path, methods in PUBLISHED]


def allowed_methods(path: str) -> frozenset[str] | None:
    """The methods a defined `/api` path allows, or None when the path is not published."""
    for pattern, methods in _COMPILED:
        if pattern.match(path):
            return methods
    return None
