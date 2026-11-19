"""The published surface: every path this app answers and the methods it gives it.

Routing refusals (`not_found` for an undefined path, `method_not_allowed` with an
`Allow` header otherwise) are decided here and nowhere else.
"""

from __future__ import annotations

import re

SEG = r"[^/]+"

_API_SURFACE: list[tuple[str, frozenset[str]]] = [
    (r"/api/health", frozenset({"GET"})),
    (r"/api/auth/login", frozenset({"POST"})),
    (r"/api/auth/logout", frozenset({"POST"})),
    (r"/api/auth/accept-invite", frozenset({"POST"})),
    (r"/api/me", frozenset({"GET"})),
    (r"/api/me/preferences", frozenset({"PATCH"})),
    (r"/api/members", frozenset({"GET", "POST"})),
    (rf"/api/members/{SEG}", frozenset({"PATCH"})),
    (r"/api/workspace", frozenset({"GET", "PATCH"})),
    (r"/api/stats", frozenset({"GET"})),
    (r"/api/connector-definitions", frozenset({"GET"})),
    (rf"/api/connector-definitions/{SEG}", frozenset({"GET"})),
    (r"/api/sources", frozenset({"GET", "POST"})),
    (rf"/api/sources/{SEG}", frozenset({"GET"})),
    (rf"/api/sources/{SEG}/check", frozenset({"POST"})),
    (rf"/api/sources/{SEG}/catalog", frozenset({"GET"})),
    (rf"/api/sources/{SEG}/sample-events", frozenset({"POST"})),
    (r"/api/destinations", frozenset({"GET", "POST"})),
    (rf"/api/destinations/{SEG}/tables", frozenset({"GET"})),
    (rf"/api/destinations/{SEG}/tables/{SEG}/records", frozenset({"GET"})),
    (r"/api/connections", frozenset({"GET", "POST"})),
    (rf"/api/connections/{SEG}", frozenset({"GET", "PATCH"})),
    (rf"/api/connections/{SEG}/state", frozenset({"GET"})),
    (rf"/api/connections/{SEG}/reset", frozenset({"POST"})),
    (rf"/api/connections/{SEG}/sync", frozenset({"POST"})),
    (r"/api/jobs", frozenset({"GET"})),
    (rf"/api/jobs/{SEG}", frozenset({"GET"})),
    (rf"/api/jobs/{SEG}/logs", frozenset({"GET"})),
    (rf"/api/jobs/{SEG}/events", frozenset({"GET"})),
    (rf"/api/jobs/{SEG}/cancel", frozenset({"POST"})),
    (r"/api/builder/projects", frozenset({"GET", "POST"})),
    (rf"/api/builder/projects/{SEG}", frozenset({"GET", "PUT"})),
    (rf"/api/builder/projects/{SEG}/test", frozenset({"POST"})),
    (rf"/api/builder/projects/{SEG}/publish", frozenset({"POST"})),
    (r"/api/audit", frozenset({"GET"})),
    (rf"/api/audit/{SEG}", frozenset({"GET"})),
    (r"/mock-api/v1/invoices", frozenset({"GET"})),
]

_MEDIA_SURFACE: list[tuple[str, frozenset[str]]] = [
    (r"/media/data-in-sound\.webm", frozenset({"GET", "HEAD"})),
    (r"/media/data-in-sound\.en\.vtt", frozenset({"GET", "HEAD"})),
    (r"/media/data-in-sound\.chapters\.vtt", frozenset({"GET", "HEAD"})),
]

_COMPILED = [(re.compile(f"^{pattern}$"), methods) for pattern, methods in _API_SURFACE + _MEDIA_SURFACE]

MARKETING_PAGES: tuple[str, ...] = (
    "/",
    "/connectors",
    "/pricing",
    "/connector-builder",
    "/data-replication",
    "/hybrid",
    "/mcp",
    "/context-layer",
    "/why-open-source",
    "/compare",
    "/data-engineering-resources",
    "/signin",
    "/login",
    "/accept-invite",
)

_CONSOLE_PAGE_PATTERNS = [
    re.compile(p)
    for p in (
        r"^/app$",
        rf"^/app/connections/{SEG}$",
        r"^/app/sources$",
        r"^/app/destinations$",
        rf"^/app/destinations/{SEG}/tables/{SEG}$",
        r"^/app/builder$",
        r"^/app/members$",
        r"^/app/audit$",
        r"^/app/settings$",
    )
]


def surface_methods(path: str) -> frozenset[str] | None:
    """The methods published for an interface path, or None when it is undefined."""
    for pattern, methods in _COMPILED:
        if pattern.match(path):
            return methods
    return None


def is_interface_path(path: str) -> bool:
    return path == "/api" or path.startswith("/api/") or path.startswith("/mock-api") or path.startswith("/media/")


def is_page_path(path: str) -> bool:
    if path in MARKETING_PAGES:
        return True
    return any(pattern.match(path) for pattern in _CONSOLE_PAGE_PATTERNS)
