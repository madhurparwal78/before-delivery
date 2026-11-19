"""Helpers every route uses."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

from ..errors import ApiError
from ..validation import well_formed_id


def ok(payload: dict[str, Any], status: int = 200, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse(payload, status_code=status, headers=headers)


async def raw_body(request: Request) -> bytes:
    return await request.body()


def path_uuid(raw: str) -> uuid.UUID:
    """Every route whose path names an object checks that object's id before using it."""
    if not well_formed_id(raw):
        raise ApiError("not_found")
    return uuid.UUID(raw)


def query_value(request: Request, name: str) -> str | None:
    return request.query_params.get(name)
