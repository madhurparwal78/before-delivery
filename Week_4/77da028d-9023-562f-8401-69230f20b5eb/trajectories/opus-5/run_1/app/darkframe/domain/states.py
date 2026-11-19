"""The three state machines. Every legal edge is listed here only."""

from __future__ import annotations

from ..errors import ApiError, conflict

PROJECT_EDGES: frozenset[tuple[str, str]] = frozenset(
    {
        ("draft", "active"),
        ("draft", "archived"),
        ("active", "paused"),
        ("paused", "active"),
        ("active", "complete"),
        ("complete", "archived"),
    }
)
PROJECT_STATES: tuple[str, ...] = (
    "draft",
    "active",
    "paused",
    "complete",
    "archived",
)
PROJECT_CLOSED: frozenset[str] = frozenset({"complete", "archived"})

SESSION_EDGES: frozenset[tuple[str, str]] = frozenset(
    {
        ("planned", "imaging"),
        ("imaging", "logged"),
        ("logged", "amended"),
        ("amended", "amended"),
        ("planned", "trashed"),
        ("logged", "trashed"),
        ("amended", "trashed"),
    }
)

CALIBRATION_EDGES: frozenset[tuple[str, str]] = frozenset(
    {
        ("building", "ready"),
        ("building", "retired"),
        ("ready", "retired"),
        ("stale", "retired"),
    }
)


def closed_project(state: str) -> ApiError | None:
    if state not in PROJECT_CLOSED:
        return None
    return conflict(
        "project_closed", f"A project that is {state} cannot be changed."
    )


def project_transition(from_state: str, to_state: str) -> ApiError | None:
    if (from_state, to_state) in PROJECT_EDGES:
        return None
    return conflict(
        "illegal_transition",
        f"A project that is {from_state} cannot become {to_state}.",
    )


def session_transition(from_state: str, to_state: str) -> ApiError | None:
    if (from_state, to_state) in SESSION_EDGES:
        return None
    return conflict(
        "illegal_transition",
        f"A session that is {from_state} cannot become {to_state}.",
    )


def calibration_transition(from_state: str, to_state: str) -> ApiError | None:
    if (from_state, to_state) in CALIBRATION_EDGES:
        return None
    return conflict(
        "illegal_transition",
        f"A calibration set that is {from_state} cannot become {to_state}.",
    )
