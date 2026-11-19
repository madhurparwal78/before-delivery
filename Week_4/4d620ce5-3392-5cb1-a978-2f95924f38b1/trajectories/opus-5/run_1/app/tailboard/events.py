"""The live feed. Every committed change to a thread or directive is published here."""

import json
import queue
import threading

_lock = threading.Lock()
_subscribers = set()
HEARTBEAT_SECONDS = 10


def subscribe():
    channel = queue.Queue(maxsize=256)
    with _lock:
        _subscribers.add(channel)
    return channel


def unsubscribe(channel):
    with _lock:
        _subscribers.discard(channel)


def publish(event, data):
    message = f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n".encode()
    with _lock:
        channels = list(_subscribers)
    for channel in channels:
        try:
            channel.put_nowait(message)
        except queue.Full:
            pass


def threads_changed(thread_ids):
    ids = [thread_id for thread_id in thread_ids if thread_id]
    if ids:
        publish("threads", {"thread_ids": ids})


def revision_changed(directive_id, splice):
    publish("revision", {"directive_id": directive_id, "splice": splice})
