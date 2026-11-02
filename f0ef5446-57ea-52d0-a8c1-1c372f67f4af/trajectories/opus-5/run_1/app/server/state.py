"""Readiness, shared by the health route and the start-up work."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Readiness:
    """True once the schema, the seeded corpus and the seeded accounts are in place."""

    ready: bool = False


READINESS = Readiness()
