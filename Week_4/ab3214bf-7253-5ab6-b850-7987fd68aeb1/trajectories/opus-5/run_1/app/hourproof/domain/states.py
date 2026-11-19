"""Window states and every transition between them, decided here alone."""

from __future__ import annotations

AWAITING_METERS = "Awaiting meters"
RECONCILING = "Reconciling"
IN_REVIEW = "In review"
RETURNED = "Returned"
CANCELLING = "Cancelling"
CANCELLED = "Cancelled"
SIGNED = "Signed"
SEALED = "Sealed"
RESTATED = "Restated"

ALL = [
    AWAITING_METERS,
    RECONCILING,
    IN_REVIEW,
    RETURNED,
    CANCELLING,
    CANCELLED,
    SIGNED,
    SEALED,
    RESTATED,
]

# Which states each mutating action is legal in.
LEGAL_STATES = {
    "meter_pull": (AWAITING_METERS, RECONCILING),
    "repair": (RECONCILING,),
    "substitution": (RECONCILING,),
    "spread": (RECONCILING,),
    "merit_order": (RECONCILING,),
    "exclusion": (RECONCILING,),
    "allocation": (RECONCILING,),
    "sync": (RECONCILING,),
    "submit": (RECONCILING,),
    "resume": (RETURNED,),
    "cancellations": (CANCELLING,),
    "sample_result": (IN_REVIEW,),
    "return": (IN_REVIEW,),
    "complete": (IN_REVIEW,),
    "sign": (CANCELLED,),
    "verifier": (AWAITING_METERS, RECONCILING, RETURNED),
}


def permits(action: str, state: str) -> bool:
    return state in LEGAL_STATES[action]


def after_meter_pull(state: str) -> str:
    return RECONCILING


def after_complete(has_open_lines: bool) -> str:
    """A completed review goes to Cancelling while any line awaits the registry."""
    return CANCELLING if has_open_lines else CANCELLED


def after_rejected_line(state: str) -> str:
    """A kept line the registry rejects sends a reviewed window back to reconciling."""
    if state in (IN_REVIEW, CANCELLING):
        return RECONCILING
    return state


def clears_sample_on_rejection(state: str) -> bool:
    return state == IN_REVIEW
