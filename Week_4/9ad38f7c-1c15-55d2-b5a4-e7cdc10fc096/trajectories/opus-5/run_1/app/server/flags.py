"""Flag submission: team credit, personal tickets and the wrong-flag lock."""

from __future__ import annotations

import hashlib
from typing import Any

from .accounts import Caller
from .config import WRONG_FLAG_LIMIT, WRONG_FLAG_LOCK_SECONDS
from .db import LOCK_CLASS_FLAG, Transaction, key32
from .errors import ApiError
from .live import publish_score, publish_team
from .scenarios import load_scenario
from .scoring import team_score, tickets
from .seed_data import WEBINAR_FLAG
from .teams import require_team
from .throttle import lock_end, seconds_remaining
from .validation import required_text


def flag_digest(submitted: str) -> str:
    """Flags are trimmed, then compared exactly, letter case included."""
    return hashlib.sha256(submitted.strip().encode("utf-8")).hexdigest()


def _refuse_while_locked(tx: Transaction, user_id: int, slug: str) -> None:
    """The wrong-flag lock: five wrong flags in a row hold a player for a minute."""
    attempts = [
        (bool(correct), created_at)
        for correct, created_at in reversed(
            tx.rows(
                """
                SELECT correct, created_at FROM flag_attempts
                WHERE user_id = %s AND scenario_slug = %s
                ORDER BY id DESC LIMIT 200
                """,
                (user_id, slug),
            )
        )
    ]
    ends_at = lock_end(attempts, WRONG_FLAG_LIMIT, WRONG_FLAG_LOCK_SECONDS)
    left = seconds_remaining(ends_at, tx.now(), WRONG_FLAG_LOCK_SECONDS)
    if left is not None:
        raise ApiError(429, "too_many_attempts", headers=[("Retry-After", str(left))])


def _record_attempt(tx: Transaction, user_id: int, slug: str, correct: bool) -> None:
    tx.execute(
        "INSERT INTO flag_attempts (user_id, scenario_slug, correct) VALUES (%s, %s, %s)",
        (user_id, slug, correct),
    )


def submit_flag(
    tx: Transaction, caller: Caller, raw_slug: str, body: dict[str, Any]
) -> dict[str, Any]:
    team_id = require_team(caller, code="no_team")
    submitted = required_text(body, "flag")
    scenario = load_scenario(tx, raw_slug)
    slug = scenario["slug"]

    tx.lock(LOCK_CLASS_FLAG, key32("flag", caller.user_id, slug))
    _refuse_while_locked(tx, caller.user_id, slug)

    correct = flag_digest(submitted) == tx.value(
        "SELECT flag_sha256 FROM scenarios WHERE slug = %s", (slug,)
    )
    if not correct:
        _record_attempt(tx, caller.user_id, slug, correct=False)
        return _flag_payload(tx, caller, team_id, False, False, 0, False)

    already = bool(
        tx.value(
            "SELECT 1 FROM completions WHERE user_id = %s AND scenario_slug = %s",
            (caller.user_id, slug),
        )
    )
    if already:
        return _flag_payload(tx, caller, team_id, True, True, 0, False)

    _record_attempt(tx, caller.user_id, slug, correct=True)
    tx.execute(
        """
        INSERT INTO completions (user_id, scenario_slug, team_id)
        VALUES (%s, %s, %s)
        """,
        (caller.user_id, slug, team_id),
    )
    awarded = _credit_team(tx, caller, team_id, scenario)
    publish_team(tx, team_id)
    return _flag_payload(tx, caller, team_id, True, False, awarded, True)


def _credit_team(
    tx: Transaction, caller: Caller, team_id: int, scenario: dict[str, Any]
) -> int:
    """A team's first correct flag on a scenario stores one team solve."""
    solved = tx.value(
        """
        INSERT INTO team_solves (team_id, scenario_slug, user_id)
        VALUES (%s, %s, %s)
        ON CONFLICT (team_id, scenario_slug) DO NOTHING
        RETURNING id
        """,
        (team_id, scenario["slug"], caller.user_id),
    )
    if solved is None:
        return 0
    points = int(scenario["points"])
    publish_score(
        tx,
        team_id,
        tx.value("SELECT name FROM teams WHERE id = %s", (team_id,)),
        scenario["slug"],
        points,
        team_score(tx, team_id),
    )
    return points


def _flag_payload(
    tx: Transaction,
    caller: Caller,
    team_id: int,
    correct: bool,
    already_completed: bool,
    awarded: int,
    ticket_awarded: bool,
) -> dict[str, Any]:
    return {
        "correct": correct,
        "already_completed": already_completed,
        "team_points_awarded": awarded,
        "ticket_awarded": ticket_awarded,
        "team_score": team_score(tx, team_id),
        "tickets": tickets(tx, caller.user_id),
    }


def claim_webinar(
    tx: Transaction, caller: Caller, body: dict[str, Any]
) -> dict[str, Any]:
    submitted = required_text(body, "flag")
    if tx.value("SELECT 1 FROM webinar_claims WHERE user_id = %s", (caller.user_id,)):
        raise ApiError(409, "already_claimed")
    if flag_digest(submitted) != flag_digest(WEBINAR_FLAG):
        raise ApiError(422, "wrong_flag")
    claimed = tx.value(
        """
        INSERT INTO webinar_claims (user_id) VALUES (%s)
        ON CONFLICT (user_id) DO NOTHING
        RETURNING id
        """,
        (caller.user_id,),
    )
    if claimed is None:
        raise ApiError(409, "already_claimed")
    if caller.team_id is not None:
        publish_team(tx, caller.team_id)
    return {"claimed": True, "tickets": tickets(tx, caller.user_id)}
