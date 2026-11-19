"""The sandbox invoices API, answered in-process for the Builder and over HTTP under /mock-api/."""

from typing import Any

SANDBOX_KEY_HEADER = "x-api-key"
SANDBOX_KEY = "sandbox-key-2026"
INVOICES_PATH = "/mock-api/v1/invoices"
INVOICES = [
    {"id": "INV-1042", "customer": "AceTech Corp", "total_cents": 125000, "status": "paid"},
    {"id": "INV-1043", "customer": "Globex", "total_cents": 98000, "status": "open"},
    {"id": "INV-1044", "customer": "Initech", "total_cents": 45050, "status": "paid"},
    {"id": "INV-1045", "customer": "Umbrella Retail", "total_cents": 230000, "status": "open"},
    {"id": "INV-1046", "customer": "Soylent Foods", "total_cents": 15000, "status": "paid"},
    {"id": "INV-1047", "customer": "Hooli Labs", "total_cents": 87500, "status": "void"},
    {"id": "INV-1048", "customer": "Vandelay Imports", "total_cents": 64000, "status": "open"},
]


def _number(text: str | None, default: int) -> int | None:
    if text is None:
        return default
    return int(text) if text.isdigit() else None


def answer(path: str, headers: dict[str, str], page_text: str | None, size_text: str | None) -> tuple[int, Any]:
    """(status, body) for one sandbox request; `headers` keys are lowercase."""
    if path != INVOICES_PATH:
        return 404, {"error": "not_found"}
    if headers.get(SANDBOX_KEY_HEADER) != SANDBOX_KEY:
        return 401, {"error": "unauthenticated"}
    page, size = _number(page_text, 1), _number(size_text, 3)
    if page is None or page < 1 or size is None or not 1 <= size <= 100:
        return 400, {"error": "validation"}
    start = (page - 1) * size
    data = INVOICES[start:start + size]
    more = bool(data) and start + size < len(INVOICES)
    return 200, {"data": data, "next_page": page + 1 if more else None}
