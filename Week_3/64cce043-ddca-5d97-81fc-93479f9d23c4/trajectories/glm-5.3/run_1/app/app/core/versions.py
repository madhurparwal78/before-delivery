"""The record version precondition check, decided in this one place."""

from __future__ import annotations

from typing import Any

from ..errors import MSG_SEND_VERSION, ApiError


def check_version(body: Any, current_version: int) -> int:
    """Require `version` to be the current version; otherwise answer stale_version.

    A missing or malformed version is a 422; a present but stale version is 409.
    This check runs before any other validation of the body's fields.
    """
    raw = body.get("version") if isinstance(body, dict) else None
    if raw is None:
        raise ApiError(422, "validation", "Check the highlighted fields.", {"version": MSG_SEND_VERSION})
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 1:
        raise ApiError(422, "validation", "Check the highlighted fields.", {"version": MSG_SEND_VERSION})
    if raw != current_version:
        from ..errors import stale_version

        raise stale_version()
    return raw
