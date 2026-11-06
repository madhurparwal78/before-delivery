"""Minimal ASGI request and response plumbing."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Iterable
from urllib.parse import parse_qs, unquote

MAX_BODY_BYTES = 65_536


@dataclass
class Request:
    method: str
    path: str
    raw_query: str
    headers: dict[str, str]
    body: bytes
    body_too_large: bool

    @property
    def query(self) -> dict[str, list[str]]:
        return parse_qs(self.raw_query, keep_blank_values=True)

    def header(self, name: str) -> str | None:
        return self.headers.get(name.lower())

    @property
    def content_type(self) -> str | None:
        return self.header("content-type")

    @property
    def bearer_token(self) -> str | None:
        value = self.header("authorization")
        if value is None:
            return None
        parts = value.split(" ", 1)
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return None
        token = parts[1].strip()
        return token or None


@dataclass
class Response:
    status: int = 200
    body: bytes = b""
    headers: list[tuple[str, str]] = field(default_factory=list)
    content_type: str | None = None

    def with_header(self, name: str, value: str) -> "Response":
        self.headers = [(k, v) for (k, v) in self.headers if k.lower() != name.lower()]
        self.headers.append((name, value))
        return self

    def drop_headers(self, names: Iterable[str]) -> "Response":
        lowered = {name.lower() for name in names}
        self.headers = [(k, v) for (k, v) in self.headers if k.lower() not in lowered]
        return self

    def raw_headers(self) -> list[tuple[bytes, bytes]]:
        out: list[tuple[bytes, bytes]] = []
        if self.content_type is not None:
            out.append((b"content-type", self.content_type.encode("latin-1")))
        out.append((b"content-length", str(len(self.body)).encode("ascii")))
        for name, value in self.headers:
            out.append((name.encode("latin-1"), value.encode("latin-1")))
        return out


def json_response(status: int, payload: Any, *, headers: list[tuple[str, str]] | None = None) -> Response:
    body = json.dumps(payload, ensure_ascii=True, allow_nan=False).encode("utf-8")
    return Response(
        status=status,
        body=body,
        headers=list(headers or []),
        content_type="application/json; charset=utf-8",
    )


def html_response(status: int, markup: str, *, headers: list[tuple[str, str]] | None = None) -> Response:
    return Response(
        status=status,
        body=markup.encode("utf-8"),
        headers=list(headers or []),
        content_type="text/html; charset=utf-8",
    )


def no_content() -> Response:
    return Response(status=204, body=b"", content_type=None)


async def read_request(scope: dict[str, Any], receive: Any) -> Request:
    headers: dict[str, str] = {}
    for raw_name, raw_value in scope.get("headers", []):
        name = raw_name.decode("latin-1").lower()
        value = raw_value.decode("latin-1")
        headers[name] = f"{headers[name]}, {value}" if name in headers else value

    chunks: list[bytes] = []
    size = 0
    too_large = False
    more_body = True
    while more_body:
        message = await receive()
        if message["type"] != "http.request":
            break
        chunk = message.get("body", b"")
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            too_large = True
        else:
            chunks.append(chunk)
        more_body = message.get("more_body", False)

    path = scope.get("path", "/")
    raw_path = scope.get("raw_path")
    if isinstance(raw_path, bytes):
        # Keep the decoded form the server produced, but remember encoded separators
        # so that encoded slashes never widen a route match.
        decoded_raw = unquote(raw_path.split(b"?", 1)[0].decode("latin-1"))
        if decoded_raw != path:
            path = decoded_raw

    return Request(
        method=scope.get("method", "GET").upper(),
        path=path,
        raw_query=scope.get("query_string", b"").decode("latin-1"),
        headers=headers,
        body=b"" if too_large else b"".join(chunks),
        body_too_large=too_large,
    )


async def send_response(send: Any, response: Response, *, head: bool = False) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": response.status,
            "headers": response.raw_headers(),
        }
    )
    await send({"type": "http.response.body", "body": b"" if head else response.body})
