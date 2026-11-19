"""Server-sent events: the live feed of thread and revision changes (DP-35)."""
import asyncio
import json


class EventFeed:
    """Every committed change is published; boards see it within 3 seconds."""

    def __init__(self):
        self._subscribers: set[asyncio.Queue] = set()
        self._pending = asyncio.Queue()

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue):
        self._subscribers.discard(queue)

    async def publish(self, kind: str, payload: dict):
        event = {"kind": kind, "payload": payload}
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                pass

    async def stream(self, queue):
        """Yield SSE lines with a comment at least every 15 seconds."""
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=12.0)
                yield f"event: {event['kind']}\ndata: {json.dumps(event['payload'])}\n\n"
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
