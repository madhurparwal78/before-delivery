"""The one request prologue: boundary checks, the caller, scoped ids and role."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from starlette.requests import Request
from starlette.responses import Response

from ..config import MAX_BODY_BYTES, SESSION_COOKIE
from ..db import Database
from ..domain.exposure import VaultView
from ..errors import ApiError
from ..sessions import Caller, resolve_caller
from ..state import AppState
from ..store import load_view

BODY_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
JSON_MEDIA_TYPE = "application/json"


@dataclass(slots=True)
class Ctx:
    request: Request
    state: AppState
    caller: Caller
    body: dict[str, Any]
    view: VaultView | None = None
    target: Any = None

    @property
    def db(self) -> Database:
        return self.state.db

    @property
    def vault_id(self) -> str:
        return self.caller.vault_id

    @property
    def role(self) -> str:
        return self.caller.role

    def vault_view(self) -> VaultView:
        assert self.view is not None
        return self.view


Handler = Callable[[Ctx], Awaitable[Response]]


async def read_body(request: Request) -> dict[str, Any]:
    """Enforce the body limit and content type, then read the JSON object."""
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise ApiError("too_large")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            raise ApiError("too_large")
        chunks.append(chunk)
    raw = b"".join(chunks)
    content_type = request.headers.get("content-type", "")
    media_type = content_type.split(";", 1)[0].strip().lower()
    if media_type:
        if media_type != JSON_MEDIA_TYPE:
            raise ApiError("unsupported_media_type")
    elif raw:
        raise ApiError("unsupported_media_type")
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def check_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin is None:
        return
    host = request.headers.get("host", "")
    if origin != f"{request.url.scheme}://{host}":
        raise ApiError("cross_origin")


def endpoint(
    state: AppState,
    handler: Handler,
    *,
    owner_only: bool = False,
    contact_only: bool = False,
    id_kind: str | None = None,
    allow_ended: bool = False,
    needs_view: bool = False,
    touch: bool = True,
) -> Callable[[Request], Awaitable[Response]]:
    """Wrap a handler in the published error precedence."""

    async def serve(request: Request) -> Response:
        try:
            body: dict[str, Any] = {}
            if request.method in BODY_METHODS:
                body = await read_body(request)
                check_origin(request)

            caller = await resolve_caller(
                state.db, state.settings, request.cookies.get(SESSION_COOKIE), touch
            )
            if caller is None:
                raise ApiError("signed_out")
            if caller.is_contact and not caller.has_access and not allow_ended:
                raise ApiError("access_ended")

            ctx = Ctx(request, state, caller, body)
            if id_kind is not None or needs_view:
                async with state.db.pool.acquire() as connection:
                    ctx.view = await load_view(connection, caller.vault_id, caller.scope_levels)
            if id_kind is not None:
                ctx.target = _resolve(ctx, id_kind, request.path_params["id"])
                if ctx.target is None:
                    raise ApiError("not_found")
            if owner_only and caller.is_contact:
                raise ApiError("owner_only")
            if contact_only and not caller.is_contact:
                raise ApiError("not_found")
            return await handler(ctx)
        except ApiError as error:
            return error.response()

    return serve


def _resolve(ctx: Ctx, id_kind: str, record_id: str) -> Any:
    view = ctx.vault_view()
    if id_kind == "holding":
        return view.holding(record_id)
    if id_kind == "breach":
        return view.breach(record_id)
    if id_kind == "step":
        return view.step(record_id)
    if ctx.caller.is_contact:
        return None  # a rule is never in a contact's view
    return next((rule for rule in view.rules if rule.id == record_id), None)
