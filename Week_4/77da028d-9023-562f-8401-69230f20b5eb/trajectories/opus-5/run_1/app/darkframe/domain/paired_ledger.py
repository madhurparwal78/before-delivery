"""The paired hours-owed ledger: every movement is two entries that cancel."""

from __future__ import annotations

from dataclasses import dataclass

ALLOTMENT = "allotment"
OWED = "owed"
INTEGRATED = "integrated"

ALLOT = "allot"
LOG = "log"
REVERSAL = "reversal"


@dataclass(frozen=True)
class Entry:
    account: str
    seconds: int


def allot_entries(previous_seconds: int, next_seconds: int) -> list[Entry]:
    """Setting planned time from P to Q posts owed +(Q-P) and allotment -(Q-P)."""
    change = next_seconds - previous_seconds
    if change == 0:
        return []
    return [Entry(OWED, change), Entry(ALLOTMENT, -change)]


def log_entries(integration_seconds: int) -> list[Entry]:
    return [Entry(OWED, -integration_seconds), Entry(INTEGRATED, integration_seconds)]


def reversal_entries(entries: list[Entry]) -> list[Entry]:
    return [Entry(entry.account, -entry.seconds) for entry in entries]


def integration_seconds(sub_count: int, exposure_s: int) -> int:
    return sub_count * exposure_s
