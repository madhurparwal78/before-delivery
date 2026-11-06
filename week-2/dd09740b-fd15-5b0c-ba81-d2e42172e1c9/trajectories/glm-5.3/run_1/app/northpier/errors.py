"""The one error shape every refusal uses."""
from __future__ import annotations

from flask import Response, jsonify


def error_body(field: str | None, message: str) -> dict:
    return {"error": {"field": field, "message": message}}


def refusal(status: int, field: str | None, message: str) -> tuple[Response, int]:
    return jsonify(error_body(field, message)), status

