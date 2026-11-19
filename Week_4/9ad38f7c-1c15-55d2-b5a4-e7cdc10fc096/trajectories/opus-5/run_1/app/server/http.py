"""Request and response values shared by the API and the pages."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qsl

from .config import MAX_BODY_BYTES
from .errors import ApiError
from .jsonio import dump

JSON_TYPE = "application/json; charset=utf-8"
HTML_TYPE = "text/html; charset=utf-8"


@dataclass
class Request:
    method: str
    path: str
    raw_query: str
    headers: dict[str, str]
    body: bytes
    oversized: bool = False

    @property
    def query(self) -> dict[str, str]:
        return dict(parse_qsl(self.raw_query, keep_blank_values=True))

    @property
    def bearer_token(self) -> str | None:
        header = self.headers.get("authorization", "")
        prefix = "bearer "
        if header[: len(prefix)].lower() != prefix:
            return None
        token = header[len(prefix) :].strip()
        return token or None


@dataclass
class Response:
    status: int = 200
    body: bytes = b""
    content_type: str = JSON_TYPE
    headers: list[tuple[str, str]] = field(default_factory=list)

    def header_pairs(self) -> list[tuple[bytes, bytes]]:
        pairs: list[tuple[bytes, bytes]] = []
        if self.content_type:
            pairs.append((b"content-type", self.content_type.encode("latin-1")))
        if self.status != 204:
            pairs.append((b"content-length", str(len(self.body)).encode("latin-1")))
        pairs += [
            (name.lower().encode("latin-1"), value.encode("latin-1"))
            for name, value in self.headers
        ]
        return pairs


def json_response(
    payload: Any,
    status: int = 200,
    headers: list[tuple[str, str]] | None = None,
) -> Response:
    return Response(
        status=status,
        body=dump(payload),
        content_type=JSON_TYPE,
        headers=list(headers or []),
    )


def error_response(error: ApiError) -> Response:
    return json_response(error.body(), error.status, error.headers)


def html_response(
    markup: str, status: int = 200, headers: list[tuple[str, str]] | None = None
) -> Response:
    return Response(
        status=status,
        body=markup.encode("utf-8"),
        content_type=HTML_TYPE,
        headers=list(headers or []),
    )


def require_json_content_type(request: Request) -> None:
    raw = request.headers.get("content-type")
    if not raw:
        raise ApiError(415, "unsupported_media_type")
    media, *parameters = raw.split(";")
    if media.strip().lower() != "application/json":
        raise ApiError(415, "unsupported_media_type")
    for parameter in parameters:
        name, _, value = parameter.partition("=")
        if name.strip().lower() == "charset" and value.strip().strip(
            '"'
        ).lower() not in (
            "utf-8",
            "utf8",
        ):
            raise ApiError(415, "unsupported_media_type")


def require_body_within_limit(request: Request) -> None:
    if request.oversized or len(request.body) > MAX_BODY_BYTES:
        raise ApiError(413, "payload_too_large")
