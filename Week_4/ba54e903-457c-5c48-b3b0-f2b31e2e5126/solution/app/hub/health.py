"""GET /api/health: 200 once the database is ready, 503 while starting."""

from __future__ import annotations

from flask import Response, jsonify

from . import bootstrap, db
from .router import route


@route("GET", "/api/health")
def health() -> Response:
    if bootstrap.READY.is_set() and db.ping():
        return jsonify({"status": "ok"})
    response = jsonify({"status": "starting"})
    response.status_code = 503
    return response
