"""The ASGI application: pages, static files, the JSON interface and the stream."""

from __future__ import annotations

import asyncio
import sys
import traceback

from . import assets
from .api import NO_STORE, EventStream, dispatch
from .config import MAX_BODY_BYTES, STREAM_COMMENT_SECONDS
from .db import DATABASE, DatabaseUnavailable
from .errors import ApiError, unavailable
from .http import Request, Response, error_response, html_response
from .live import HUB
from .pages import render_page
from .pages.platform import not_found as not_found_page
from .schema import migrate

SEED_RETRY_SECONDS = 0.5


async def _seed_until_ready() -> None:
    while not DATABASE.seeded:
        try:
            await DATABASE.call(migrate, budget=30.0)
            DATABASE.seeded = True
        except DatabaseUnavailable:
            await asyncio.sleep(SEED_RETRY_SECONDS)
        except Exception:  # keep retrying, never exit
            traceback.print_exc(file=sys.stderr)
            await asyncio.sleep(SEED_RETRY_SECONDS)


class Application:
    def __init__(self) -> None:
        self._tasks: list[asyncio.Task] = []

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] == "lifespan":
            await self._lifespan(receive, send)
        elif scope["type"] == "http":
            await self._http(scope, receive, send)

    async def _lifespan(self, receive, send) -> None:
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                self._tasks = [
                    asyncio.create_task(_seed_until_ready()),
                    asyncio.create_task(HUB.run()),
                ]
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                for task in self._tasks:
                    task.cancel()
                DATABASE.shutdown()
                await send({"type": "lifespan.shutdown.complete"})
                return

    async def _http(self, scope, receive, send) -> None:
        headers = {
            name.decode("latin-1").lower(): value.decode("latin-1")
            for name, value in scope.get("headers", [])
        }
        body, oversized = await _read_body(receive, headers)
        request = Request(
            method=scope["method"],
            path=scope["path"],
            raw_query=scope.get("query_string", b"").decode("latin-1"),
            headers=headers,
            body=body,
            oversized=oversized,
        )

        if request.path == "/api/stream" and request.method in ("GET", "HEAD"):
            answered = await self._open_stream(request, receive, send)
            if answered:
                return

        response = await self._answer(request)
        await _send(send, response, head=request.method == "HEAD")

    async def _answer(self, request: Request) -> Response:
        if request.path.startswith("/api"):
            try:
                result = await dispatch(request)
            except ApiError as error:
                result = error_response(error)
            except DatabaseUnavailable:
                result = error_response(unavailable())
            except Exception:  # never answer with a 500
                traceback.print_exc(file=sys.stderr)
                result = error_response(unavailable())
            if isinstance(result, EventStream):
                result = error_response(unavailable())
            result.headers.append(NO_STORE)
            return result

        static = assets.serve(request.path, request.headers.get("range"))
        if static is not None:
            return static
        try:
            return render_page(request)
        except Exception:  # a page is never a server error
            traceback.print_exc(file=sys.stderr)
            return html_response(not_found_page(), 404, [NO_STORE])

    async def _open_stream(self, request: Request, receive, send) -> bool:
        """Answer /api/stream, which stays open until the database is lost."""
        try:
            result = await dispatch(request)
        except ApiError as error:
            await _send(send, error_response(error))
            return True
        except DatabaseUnavailable:
            await _send(send, error_response(unavailable()))
            return True
        if not isinstance(result, EventStream):
            return False
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [
                    (b"content-type", b"text/event-stream; charset=utf-8"),
                    (b"cache-control", b"no-store"),
                    (b"connection", b"keep-alive"),
                    (b"x-accel-buffering", b"no"),
                ],
            }
        )
        await _stream_events(receive, send)
        return True


async def _await_disconnect(receive) -> None:
    while True:
        message = await receive()
        if message["type"] == "http.disconnect":
            return


async def _stream_events(receive, send) -> None:
    queue = HUB.subscribe()
    watcher = asyncio.create_task(_await_disconnect(receive))
    getter: asyncio.Task | None = None
    try:
        await _send_chunk(send, b": open\n\n")
        while True:
            if getter is None:
                getter = asyncio.create_task(queue.get())
            done, _ = await asyncio.wait(
                {getter, watcher},
                timeout=STREAM_COMMENT_SECONDS,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if watcher in done:
                return
            if getter in done:
                item = getter.result()
                getter = None
                if item is None:
                    break
                name, data = item
                await _send_chunk(
                    send, f"event: {name}\ndata: {data}\n\n".encode("utf-8")
                )
            else:
                await _send_chunk(send, b": keep-alive\n\n")
    except (OSError, RuntimeError):
        return
    finally:
        watcher.cancel()
        if getter is not None:
            getter.cancel()
        HUB.unsubscribe(queue)
    await send({"type": "http.response.body", "body": b"", "more_body": False})


async def _send_chunk(send, chunk: bytes) -> None:
    await send({"type": "http.response.body", "body": chunk, "more_body": True})


async def _read_body(receive, headers: dict[str, str]) -> tuple[bytes, bool]:
    declared = headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        return b"", True
    chunks: list[bytes] = []
    total = 0
    oversized = False
    while True:
        message = await receive()
        if message["type"] == "http.disconnect":
            break
        chunk = message.get("body", b"")
        total += len(chunk)
        if total > MAX_BODY_BYTES:
            oversized = True
        else:
            chunks.append(chunk)
        if not message.get("more_body"):
            break
    return b"".join(chunks), oversized


async def _send(send, response: Response, head: bool = False) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": response.status,
            "headers": response.header_pairs(),
        }
    )
    await send(
        {
            "type": "http.response.body",
            "body": b"" if head else response.body,
            "more_body": False,
        }
    )


application = Application()
