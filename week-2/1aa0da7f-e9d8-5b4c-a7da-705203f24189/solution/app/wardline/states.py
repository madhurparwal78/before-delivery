"""Exhibit and release states: what each action may move, what each state allows, and when a derivative is superseded."""

from __future__ import annotations

import asyncpg

from wardline.errors import ApiError, illegal

READABLE = ("cleared", "held", "disposal proposed")
WRITABLE = ("cleared", "held")
# action -> (states it may start from, state it produces)
EXHIBIT_TRANSITIONS: dict[str, tuple[tuple[str, ...], str]] = {
    "clear": (("quarantined",), "cleared"),
    "refuse": (("quarantined",), "refused"),
    "hold": (READABLE, "held"),
    "lift_last_hold": (("held",), "cleared"),
    "propose_disposal": (("cleared",), "disposal proposed"),
    "confirm_disposal": (("disposal proposed",), "disposed"),
    "cancel_disposal": (("disposal proposed",), "cleared"),
}
RELEASE_TRANSITIONS: dict[str, tuple[tuple[str, ...], str]] = {
    "submit": (("assembling",), "submitted"),
    "sign_off": (("submitted",), "signed off"),
    "reject": (("submitted",), "rejected"),
    "reopen": (("rejected",), "assembling"),
    "share": (("signed off",), "shared"),
    "regenerate_link": (("shared",), "shared"),
    "withdraw": (("shared",), "withdrawn"),
}
# For a query with derivatives as d and exhibits as e.
SUPERSEDED_SQL = "d.marks_version < e.marks_version"


def _transition(table: dict[str, tuple[tuple[str, ...], str]], state: str, action: str) -> str:
    starts, produces = table[action]
    if state not in starts:
        raise illegal(state, produces)
    return produces


def exhibit_transition(state: str, action: str) -> str:
    """The state this action produces, or `illegal_transition` from this one."""
    return _transition(EXHIBIT_TRANSITIONS, state, action)


def release_transition(state: str, action: str) -> str:
    """The state this action produces, or `illegal_transition` from this one."""
    return _transition(RELEASE_TRANSITIONS, state, action)


def require_assembling(state: str) -> None:
    """Items change only while a release is being assembled."""
    if state != "assembling":
        raise ApiError("release_locked", state=state)


def is_superseded(derivative_version: int, exhibit_version: int) -> bool:
    return derivative_version < exhibit_version


def not_previewable(row: asyncpg.Record) -> bool:
    return row["page_count"] is None or row["over_render_limits"]
