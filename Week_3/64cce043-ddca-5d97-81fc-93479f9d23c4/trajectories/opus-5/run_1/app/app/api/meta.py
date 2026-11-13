"""Health, identity status, the caller and the published vocabulary."""
from __future__ import annotations

from typing import Awaitable, Callable

from starlette.requests import Request
from starlette.responses import Response

from ..domain.kinds import KINDS, LEVELS
from ..errors import json_response
from ..state import AppState
from .base import Ctx

PublicEndpoint = Callable[[Request], Awaitable[Response]]


def health(state: AppState) -> PublicEndpoint:
    """Answers as soon as the database is reachable, whether or not the realm is."""

    async def serve(_request: Request) -> Response:
        if not state.db.ready:
            return json_response({"status": "starting"}, status_code=503)
        return json_response({"status": "ok"})

    return serve


def status(state: AppState) -> PublicEndpoint:
    async def serve(_request: Request) -> Response:
        return json_response({"identity": "ok" if state.identity.reachable else "down"})

    return serve


async def me(ctx: Ctx) -> Response:
    return json_response(
        {"role": ctx.caller.role, "name": ctx.caller.name, "email": ctx.caller.email}
    )


async def kinds(_ctx: Ctx) -> Response:
    return json_response(
        {
            "kinds": [
                {"code": kind.code, "label": kind.label, "steps": list(kind.steps)}
                for kind in KINDS
            ],
            "levels": [
                {"code": level.code, "label": level.label, "weight": level.weight}
                for level in LEVELS
            ],
        }
    )
