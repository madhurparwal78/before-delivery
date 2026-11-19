"""A small asyncio HTTP/1.1 client for the plain-HTTP hosts Darkframe talks to.

Only internal services, MinIO and ntfy are called, all over plain HTTP on the
private network, so no TLS layer is needed.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from urllib.parse import urlsplit

import h11


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: dict[str, str]
    body: bytes

    def text(self) -> str:
        return self.body.decode("utf-8", "replace")


class HttpError(Exception):
    """A transport-level failure: the host did not answer usefully."""


async def request(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    body: bytes = b"",
    timeout: float = 5.0,
) -> HttpResponse:
    try:
        return await asyncio.wait_for(
            _exchange(method, url, headers or {}, body), timeout
        )
    except asyncio.TimeoutError:
        raise HttpError(f"{method} {url} timed out after {timeout}s")
    except (OSError, h11.ProtocolError) as exc:
        raise HttpError(f"{method} {url} failed: {exc}")


async def _exchange(
    method: str, url: str, headers: dict[str, str], body: bytes
) -> HttpResponse:
    parts = urlsplit(url)
    port = parts.port or 80
    target = parts.path or "/"
    if parts.query:
        target = f"{target}?{parts.query}"
    reader, writer = await asyncio.open_connection(parts.hostname, port)
    try:
        connection = h11.Connection(our_role=h11.CLIENT)
        wire_headers = [("Host", parts.netloc), ("Connection", "close")]
        wire_headers += [(k, v) for k, v in headers.items()]
        wire_headers.append(("Content-Length", str(len(body))))
        writer.write(
            connection.send(
                h11.Request(method=method, target=target, headers=wire_headers)
            )
        )
        if body:
            writer.write(connection.send(h11.Data(data=body)))
        writer.write(connection.send(h11.EndOfMessage()))
        await writer.drain()

        status = 0
        response_headers: dict[str, str] = {}
        chunks: list[bytes] = []
        while True:
            event = connection.next_event()
            if event is h11.NEED_DATA:
                data = await reader.read(65536)
                connection.receive_data(data)
                continue
            if event is h11.PAUSED:
                break
            if isinstance(event, h11.Response):
                status = event.status_code
                response_headers = {
                    k.decode("latin-1").lower(): v.decode("latin-1")
                    for k, v in event.headers
                }
            elif isinstance(event, h11.Data):
                chunks.append(bytes(event.data))
            elif isinstance(event, (h11.EndOfMessage, h11.ConnectionClosed)):
                break
        return HttpResponse(status, response_headers, b"".join(chunks))
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except OSError:
            pass
