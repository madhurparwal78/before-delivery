"""The one JSON response helper."""

from __future__ import annotations

import json

from flask import Response


def json_text(payload) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def api_response(payload, status: int = 200, headers: dict | None = None) -> Response:
    body = "" if status == 204 else json_text(payload)
    response = Response(body, status=status, mimetype="application/json")
    response.headers["Cache-Control"] = "no-store"
    if headers:
        response.headers.update(headers)
    return response


def stored_response(status: int, body: str) -> Response:
    """A recorded idempotent response, returned byte for byte."""
    response = Response(body, status=status, mimetype="application/json")
    response.headers["Cache-Control"] = "no-store"
    response.headers["Idempotent-Replayed"] = "true"
    return response
