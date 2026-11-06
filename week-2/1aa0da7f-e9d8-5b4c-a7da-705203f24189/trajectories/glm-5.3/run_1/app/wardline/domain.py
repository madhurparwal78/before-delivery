"""Domain records and the state machines, each decided in one place."""
from __future__ import annotations

from typing import Any

# Exhibit states and their transitions (the one place they are decided).
EXHIBIT_TRANSITIONS: dict[str, dict[str, str]] = {
    "quarantined": {"cleared": "clear", "refused": "refuse"},
    "cleared": {"held": "hold", "disposal proposed": "dispose"},
    "held": {"held": "hold"},
    "disposal proposed": {"disposed": "confirm", "cleared": "cancel", "held": "hold"},
    "disposed": {},
    "refused": {},
}

# Release states and their transitions.
RELEASE_TRANSITIONS: dict[str, dict[str, str]] = {
    "assembling": {"submitted": "submit"},
    "submitted": {"signed off": "sign_off", "rejected": "reject"},
    "rejected": {"assembling": "reopen"},
    "signed off": {"shared": "share"},
    "shared": {"withdrawn": "withdraw"},
    "withdrawn": {},
}

RELEASE_STATE_WORDS = {
    "assembling": "Assembling",
    "submitted": "Submitted",
    "signed off": "Signed off",
    "rejected": "Rejected",
    "shared": "Shared",
    "withdrawn": "Withdrawn",
}


def exhibit_transition_allowed(state: str, action: str) -> str | None:
    """Return the new state, or None when the action is illegal here."""
    for new_state, act in EXHIBIT_TRANSITIONS.get(state, {}).items():
        if act == action:
            return new_state
    return None


def release_transition_allowed(state: str, action: str) -> str | None:
    for new_state, act in RELEASE_TRANSITIONS.get(state, {}).items():
        if act == action:
            return new_state
    return None


def validate_regions(regions: Any, page_count: int | None) -> bool:
    if not isinstance(regions, list):
        return False
    for r in regions:
        if not isinstance(r, dict):
            return False
        if set(r.keys()) != {"page", "x", "y", "w", "h"}:
            return False
        for key in ("page", "x", "y", "w", "h"):
            v = r[key]
            if isinstance(v, bool) or not isinstance(v, int):
                return False
        if page_count is not None and not (1 <= r["page"] <= page_count):
            return False
        if r["x"] < 0 or r["y"] < 0 or r["w"] < 1 or r["h"] < 1:
            return False
        if r["x"] + r["w"] > 1000 or r["y"] + r["h"] > 1000:
            return False
    return True


def regions_equal(a: list[dict], b: list[dict]) -> bool:
    def norm(rs):
        return sorted((r["page"], r["x"], r["y"], r["w"], r["h"]) for r in rs)
    return norm(a) == norm(b)


def storable_text(value: str) -> bool:
    """Free text that cannot be stored answers the unstorable copy."""
    for ch in value:
        code = ord(ch)
        if code < 0x20 and ch not in "\t\n":
            return False
        if code == 0x7F:
            return False
        if 0xD800 <= code <= 0xDFFF:
            return False
    return True


def trim(value: str) -> str:
    return value.strip(" \t\r\n")


def id_usable(value: str) -> bool:
    """A path or body id that can be handled at all."""
    if "\x00" in value:
        return False
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    if len(value) > 500:
        return False
    return True
