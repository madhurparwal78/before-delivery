"""The deterministic draw of the sampled hours."""

from __future__ import annotations

import hashlib
from datetime import datetime

SAMPLE_SIZE = 25


def draw(window_id: str, allocation_digest: str, hours: list[datetime]) -> list[datetime]:
    """Hours drawn by the published hash, in draw order."""
    count = len(hours)
    wanted = min(SAMPLE_SIZE, count)
    drawn: list[datetime] = []
    taken: set[int] = set()
    index = 0
    while len(drawn) < wanted:
        seed = f"{window_id}|{allocation_digest}|{index}".encode("utf-8")
        position = int(hashlib.sha256(seed).hexdigest()[:16], 16) % count
        if position not in taken:
            taken.add(position)
            drawn.append(hours[position])
        index += 1
    return drawn
