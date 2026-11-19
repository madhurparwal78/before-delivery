"""Public copy: every published string, in one place."""
from __future__ import annotations

from typing import Any

# --- Errors -------------------------------------------------------------
FIELD_MESSAGES = {
    "value_wh": "Enter a whole number of watt-hours.",
    "total_wh": "Enter a whole number of watt-hours.",
    "reason": "Enter a reason of 1 to 500 characters.",
    "note": "Enter a note of 1 to 2,000 characters.",
    "hours": "Select 2 to 168 consecutive hours.",
    "target_bp": "Enter a percent from 0.00 to 100.00 with at most two decimals.",
    "target_grain": "Choose MONTH, WEEK, DAY or HOUR.",
    "lot_ids": "Send every lot exactly once.",
    "result": "Choose agree or exception.",
    "excluded": "Send true or false.",
    "revision": "Send the window's revision as a whole number.",
    "typed_name": "Type your name exactly as it appears on your account.",
    "firm_id": "Choose a verifier firm.",
    "grain": "Choose MONTH, WEEK, DAY or HOUR.",
}

CODE_MESSAGES = {
    "REGISTRY_UNAVAILABLE": "REGISTRY IS DOWN. NOTHING WAS CANCELLED.",
    "HOLDINGS_UNAVAILABLE": "REGISTRY IS DOWN. HOLDINGS ARE UNCHANGED.",
    "REGISTRY_POLL_UNAVAILABLE": "REGISTRY IS DOWN. WAITING ON {n} LINES.",
    "METER_HUB_UNAVAILABLE": "METER HUB IS DOWN. NO READINGS CHANGED.",
    "GRID_UNAVAILABLE": "GRID FACTORS ARE LATE. SCORES DID NOT CHANGE.",
    "HELD_PRESS": "PDF PRESS IS DOWN. YOUR SIGNATURE IS SAFE.",
    "HELD_STORE": "THE STORE IS DOWN. YOUR SIGNATURE IS SAFE.",
    "STORE_UNAVAILABLE": "THE STORE IS DOWN. TRY THIS CHECK AGAIN.",
    "GRAIN_FAILED": "THAT GRAIN DID NOT LOAD. MOVE AGAIN.",
    "REVIEW_TIMEOUT": "REVIEW TIME RAN OUT. SENT BACK TO THE ANALYST.",
    "UNKNOWN_STATEMENT": "NO STATEMENT HAS THAT CODE.",
    "SIGNATURE_HOLDS": "SIGNATURE HOLDS.",
    "SIGNATURE_FAILS": "SIGNATURE DOES NOT HOLD.",
    "RESTATED_STAMP": "RESTATED. SEE THE SUCCESSOR WINDOW.",
    "HOURS_MISSING": "{n} hours are still Missing. Fix them first.",
    "WINDOW_NOT_OPEN": "This window opens at {opens_at}.",
    "NOT_WHOLE_WATT_HOUR": "Line {n} is not a whole watt-hour.",
    "CONFLICTING_CORRECTION": "Line {n} conflicts with an earlier line.",
    "SAMPLE_INCOMPLETE": "{n} sampled hours still need a result.",
    "NO_VERIFIER": "Assign a verifier firm first.",
    "LOT_EXPIRED": "A lot passed its cancel-by time — back to reconciling.",
    "HOUR_IS_ACTUAL": "This hour has an Actual reading.",
    "HOUR_NOT_SPREADABLE": "Only Missing or Estimated hours can take a spread.",
    "INVALID_CREDENTIALS": "That email and password don't match — try again.",
    "NOT_FOUND": "THAT PAGE DOES NOT EXIST.",
    "UNAUTHENTICATED": "Sign in first.",
    "FORBIDDEN": "You can't do that.",
    "BODY_TOO_LARGE": "That's too much to send.",
    "VALIDATION": "Some fields need fixing.",
    "STALE_REVISION": "{name} changed this window at {hhmm} UTC. Your change was not saved.",
    "WRONG_STATE": "This window is {state}. That can't be done now.",
}


def message_for(code: str, **params: Any) -> str:
    template = CODE_MESSAGES.get(code, code)
    if code == "STALE_REVISION":
        return template.format(name=params.get("name"), hhmm=params.get("hhmm"))
    if code == "WRONG_STATE":
        return template.format(state=params.get("state", ""))
    return template.format(**{k: v for k, v in params.items() if "{" + k + "}" in template})


# --- Announcements ------------------------------------------------------
ANNOUNCEMENT = {
    "grain": "{grain} grain. {score} percent matched. {points} points gone since month.",
    "allocation": "Allocation done. Hour score {score} percent. {n} unmatched hours.",
    "merit": "{lot} is now rank {rank} of {count}.",
    "pull": "Pull done. {read} hours read. {missing} hours still Missing.",
    "repair": "Repair done. {filled} hours filled. {missing} hours still Missing.",
    "spread": "Spread done. {n} hours filled.",
    "held_elsewhere": "{n} bundles are held by another window.",
    "no_missing": "No Missing hours.",
    "selection": "{n} hours selected.",
    "selection_cleared": "Selection cleared.",
    "changed": "{name} changed this window. Hour score {score} percent.",
    "confirmed": "Registry confirmed {confirmed} of {total} lines.",
    "submitted": "Sent for review. The verifier has 25 hours to test.",
    "sample_progress": "{n} of 25 recorded.",
    "sample_complete": "All 25 hours recorded.",
    "cancel_submitted": "Sent to the registry. Lots read Cancelled once it confirms.",
    "line_rejected": "The registry rejected a line — back to reconciling.",
    "key_replaced": "Signing key replaced. Earlier statements still check.",
    "seal_finished": "Sealed. Statement {code} is live.",
    "board_filtered": "{n} windows shown.",
    "group_filtered": "{n} windows shown.",
    "policy_saved": "Policy saved for {site}.",
    "verifier_assigned": "Verifier firm assigned.",
}


def fmt(msg: str, **params: Any) -> str:
    return msg.format(**params)


def score_pct(bp: int) -> str:
    """A percentage with exactly two decimals, from integer basis points."""
    return f"{bp // 100}.{bp % 100:02d}"


def thousands(n: int) -> str:
    return f"{n:,}"
