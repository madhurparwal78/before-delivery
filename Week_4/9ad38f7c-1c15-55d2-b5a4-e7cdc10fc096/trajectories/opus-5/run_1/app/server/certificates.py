"""The certificate: who may collect one, when it was issued and its image."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .accounts import Caller
from .config import SCENARIO_COUNT
from .db import Transaction
from .errors import ApiError
from .markup import fmt
from .seed_data import EVENT_NAME
from .times import as_iso

SHIELD_PATH = "M60 6 L108 24 V66 C108 96 86 116 60 126 C34 116 12 96 12 66 V24 Z"


def team_solved_count(tx: Transaction, team_id: int | None) -> int:
    if team_id is None:
        return 0
    return int(
        tx.value(
            "SELECT count(DISTINCT scenario_slug) FROM team_solves WHERE team_id = %s",
            (team_id,),
        )
        or 0
    )


def issued_on(tx: Transaction, team_id: int) -> datetime | None:
    """The moment of the team solve that completed the team's eighth scenario."""
    found = tx.row(
        """
        SELECT max(created_at) FROM team_solves WHERE team_id = %s
        HAVING count(DISTINCT scenario_slug) >= %s
        """,
        (team_id, SCENARIO_COUNT),
    )
    return None if found is None else found[0]


def certificate(tx: Transaction, caller: Caller) -> dict[str, Any]:
    """Eligibility: a current member of a team that has solved all eight."""
    if caller.team_id is None:
        raise ApiError(403, "not_complete")
    completed_at = issued_on(tx, caller.team_id)
    if completed_at is None:
        raise ApiError(403, "not_complete")
    return {
        "display_name": caller.display_name,
        "team_name": caller.team_name,
        "event_name": EVENT_NAME,
        "issued_on": as_iso(completed_at),
    }


def certificate_image(body: dict[str, Any]) -> str:
    return str(
        fmt(
            """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" \
height="800" role="img" aria-label="Certificate of completion">
  <rect width="1200" height="800" fill="#05060c"/>
  <rect x="24" y="24" width="1152" height="752" fill="none" stroke="#c6ff2e" \
stroke-width="4"/>
  <g transform="translate(540 90)">
    <path d="{shield}" fill="none" stroke="#c6ff2e" stroke-width="6"/>
    <path d="M38 66 L54 84 L86 44" fill="none" stroke="#c6ff2e" stroke-width="8"/>
  </g>
  <text x="600" y="320" text-anchor="middle" fill="#f4f7ff" \
font-family="Source Sans Pro, sans-serif" font-size="56">Certificate of \
completion</text>
  <text x="600" y="410" text-anchor="middle" fill="#c6ff2e" \
font-family="Source Sans Pro, sans-serif" font-size="64">{display_name}</text>
  <text x="600" y="476" text-anchor="middle" fill="#dbe3f5" \
font-family="Source Sans Pro, sans-serif" font-size="40">{team_name}</text>
  <text x="600" y="556" text-anchor="middle" fill="#f4f7ff" \
font-family="Source Sans Pro, sans-serif" font-size="44">{event_name}</text>
  <text x="600" y="620" text-anchor="middle" fill="#9fb0cc" \
font-family="Source Sans Pro, sans-serif" font-size="32">22 to 26 October \
2026</text>
  <text x="600" y="684" text-anchor="middle" fill="#9fb0cc" \
font-family="Source Sans Pro, sans-serif" font-size="30">{issued_on}</text>
</svg>
""",
            shield=SHIELD_PATH,
            display_name=body["display_name"],
            team_name=body["team_name"],
            event_name=body["event_name"],
            issued_on=body["issued_on"],
        )
    )
