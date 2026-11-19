"""The one error shape every API refusal is built from."""

from __future__ import annotations


class ApiError(Exception):
    """A refusal with a published status, code and optional field messages."""

    def __init__(
        self,
        status: int,
        code: str,
        fields: dict[str, str] | None = None,
        headers: list[tuple[str, str]] | None = None,
    ) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.fields = fields
        self.headers = headers or []

    def body(self) -> dict[str, object]:
        payload: dict[str, object] = {"error": self.code}
        if self.fields:
            payload["fields"] = self.fields
        return payload


def validation(field: str, message: str) -> ApiError:
    return ApiError(400, "validation", {field: message})


def unauthenticated() -> ApiError:
    return ApiError(401, "unauthenticated")


def unavailable() -> ApiError:
    return ApiError(503, "unavailable")
