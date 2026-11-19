"""The single live-update channel, authenticated at its handshake.

The workspace upgrades to a WebSocket; the same stream is also readable as
server-sent events for a caller that asks for it with a plain GET.
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator

from starlette.responses import StreamingResponse

from ..app import Ctx
from ..live import DISPATCHER, Subscriber
from ..users import Caller

HEARTBEAT_SECONDS = 20.0


async def live_socket(caller: Caller, receive: Any, send: Any) -> None:
    """Accept the upgrade, then push one JSON object per text frame."""
    await send({"type": "websocket.accept", "subprotocol": "bearer"})
    subscriber = Subscriber(member_id=caller.id, token_digest=caller.token_digest)
    DISPATCHER.add(subscriber)

    async def read_until_closed() -> None:
        while True:
            message = await receive()
            if message["type"] == "websocket.disconnect":
                subscriber.end()
                return

    reader = asyncio.create_task(read_until_closed())
    try:
        await send({"type": "websocket.send", "text": '{"type": "ready", "data": {}}'})
        while True:
            try:
                payload = await asyncio.wait_for(
                    subscriber.queue.get(), timeout=HEARTBEAT_SECONDS
                )
            except asyncio.TimeoutError:
                await send({"type": "websocket.send", "text": '{"type": "ping", "data": {}}'})
                continue
            if payload is None:
                break
            await send({"type": "websocket.send", "text": payload})
    except (OSError, RuntimeError):
        pass
    finally:
        DISPATCHER.remove(subscriber)
        reader.cancel()
        try:
            await send({"type": "websocket.close", "code": 1000})
        except (OSError, RuntimeError):
            pass


async def live(ctx: Ctx) -> StreamingResponse:
    """The same events as server-sent events, one JSON object per data line."""
    assert ctx.caller is not None
    subscriber = Subscriber(member_id=ctx.caller.id, token_digest=ctx.caller.token_digest)

    async def events() -> AsyncIterator[bytes]:
        DISPATCHER.add(subscriber)
        try:
            yield b'data: {"type": "ready", "data": {}}\n\n'
            while True:
                try:
                    payload = await asyncio.wait_for(
                        subscriber.queue.get(), timeout=HEARTBEAT_SECONDS
                    )
                except asyncio.TimeoutError:
                    yield b": keep-alive\n\n"
                    continue
                if payload is None:
                    return
                yield b"data: " + payload.encode("utf-8") + b"\n\n"
        finally:
            DISPATCHER.remove(subscriber)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
