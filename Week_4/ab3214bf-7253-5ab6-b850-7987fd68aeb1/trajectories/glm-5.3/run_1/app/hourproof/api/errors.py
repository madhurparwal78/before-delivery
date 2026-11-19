"""API error shape and helpers, in the published order."""
from __future__ import annotations

from typing import Any

from .. import clock
from ..copy import FIELD_MESSAGES, message_for


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str | None = None,
                 fields: dict[str, str] | None = None, extra: dict[str, Any] | None = None) -> None:
        self.status = status
        self.code = code
        self.message = message if message is not None else message_for(code)
        self.fields = fields or {}
        self.extra = extra or {}
        super().__init__(self.message)

    def body(self) -> dict[str, Any]:
        err: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.fields:
            err["fields"] = self.fields
        err.update(self.extra)
        return {"error": err, "server_now": clock.now().strftime("%Y-%m-%dT%H:%M:%SZ")}


def unauthenticated() -> ApiError:
    return ApiError(401, "UNAUTHENTICATED")


def not_found() -> ApiError:
    return ApiError(404, "NOT_FOUND", message_for("NOT_FOUND"))


def forbidden() -> ApiError:
    return ApiError(403, "FORBIDDEN")


def wrong_state(state: str) -> ApiError:
    return ApiError(409, "WRONG_STATE", message_for("WRONG_STATE", state=state))


def stale_revision(name: str, wrote_at: str) -> ApiError:
    hhmm = wrote_at[11:16]
    return ApiError(
        409, "STALE_REVISION",
        message_for("STALE_REVISION", name=name, hhmm=hhmm),
        extra={"wrote_by": name, "wrote_at": wrote_at},
    )


def validation(fields: dict[str, str]) -> ApiError:
    return ApiError(422, "VALIDATION", message_for("VALIDATION"), fields=fields)


def field_error(field: str) -> ApiError:
    return validation({field: FIELD_MESSAGES[field]})


def dependency(code: str, message: str | None = None, **params: Any) -> ApiError:
    return ApiError(503, code, message_for(code, **params) if message is None else message)

