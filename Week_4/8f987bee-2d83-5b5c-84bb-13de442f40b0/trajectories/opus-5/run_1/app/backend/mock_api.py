"""The sandbox invoices API, read over HTTP and by a Builder read alike."""

from __future__ import annotations

from typing import Any

SANDBOX_KEY = "sandbox-key-2026"
INVOICES_PATH = "/mock-api/v1/invoices"

INVOICES: tuple[dict[str, Any], ...] = (
    {"id": "INV-1042", "customer": "AceTech Corp", "total_cents": 125000, "status": "paid"},
    {"id": "INV-1043", "customer": "Globex", "total_cents": 98000, "status": "open"},
    {"id": "INV-1044", "customer": "Initech", "total_cents": 45050, "status": "paid"},
    {"id": "INV-1045", "customer": "Umbrella Retail", "total_cents": 230000, "status": "open"},
    {"id": "INV-1046", "customer": "Soylent Foods", "total_cents": 15000, "status": "paid"},
    {"id": "INV-1047", "customer": "Hooli Labs", "total_cents": 87500, "status": "void"},
    {"id": "INV-1048", "customer": "Vandelay Imports", "total_cents": 64000, "status": "open"},
)


def read_page(path: str, page: int, page_size: int, api_key: str | None) -> tuple[int, dict[str, Any]]:
    """Answer one sandbox read: the status and the body, with no HTTP of its own."""
    if path != INVOICES_PATH:
        return 404, {"error": "not_found"}
    if api_key != SANDBOX_KEY:
        return 401, {"error": "unauthorized"}
    if page < 1 or page_size < 1 or page_size > 100:
        return 400, {"error": "bad_request"}
    start = (page - 1) * page_size
    data = list(INVOICES[start : start + page_size])
    next_page = page + 1 if start + page_size < len(INVOICES) else None
    return 200, {"data": data, "next_page": next_page}
