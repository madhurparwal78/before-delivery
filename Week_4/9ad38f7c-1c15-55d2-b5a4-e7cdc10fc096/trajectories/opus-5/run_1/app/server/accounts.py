"""Accounts, sessions and the sign-in throttle."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .config import SETTINGS, SIGN_IN_FAILURE_LIMIT
from .db import LOCK_CLASS_SIGN_IN, Transaction, key32
from .errors import ApiError
from .passwords import hash_password, new_token, password_matches
from .scoring import tickets
from .seed_data import SCENARIO_SLUGS
from .throttle import lock_end, seconds_remaining
from .validation import (
    display_name_problem,
    email_problem,
    normalise_email,
    password_problem,
    required_texts,
)

CALLER_SQL = """
    SELECT users.id, users.email, users.display_name,
           memberships.team_id, teams.name, teams.invite_code, teams.captain_id
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    LEFT JOIN memberships ON memberships.user_id = users.id
    LEFT JOIN teams ON teams.id = memberships.team_id
    WHERE sessions.token = %s
"""


@dataclass(frozen=True)
class Caller:
    user_id: int
    email: str
    display_name: str
    token: str
    team_id: int | None
    team_name: str | None
    invite_code: str | None
    captain_id: int | None

    @property
    def is_captain(self) -> bool:
        return self.team_id is not None and self.captain_id == self.user_id


def resolve_caller(tx: Transaction, token: str | None) -> Caller | None:
    """Membership and captaincy are read from the database on every request."""
    if token is None:
        return None
    found = tx.row(CALLER_SQL, (token,))
    if found is None:
        return None
    user_id, email, display_name, team_id, team_name, invite_code, captain_id = found
    return Caller(
        user_id=user_id,
        email=email,
        display_name=display_name,
        token=token,
        team_id=team_id,
        team_name=team_name,
        invite_code=invite_code,
        captain_id=captain_id,
    )


def _user_payload(user_id: int, email: str, display_name: str) -> dict[str, Any]:
    return {"id": user_id, "email": email, "display_name": display_name}


def start_session(tx: Transaction, user_id: int) -> str:
    token = new_token()
    tx.execute(
        "INSERT INTO sessions (token, user_id) VALUES (%s, %s)", (token, user_id)
    )
    return token


def end_session(tx: Transaction, token: str | None) -> None:
    if token is not None:
        tx.execute("DELETE FROM sessions WHERE token = %s", (token,))


def sign_up(tx: Transaction, body: dict[str, Any]) -> dict[str, Any]:
    values = required_texts(body, "email", "display_name", "password")
    email = normalise_email(values["email"])
    if tx.value("SELECT 1 FROM users WHERE email = %s", (email,)):
        raise ApiError(409, "email_taken")

    display_name = values["display_name"]
    password = values["password"]
    problems = {
        field: problem
        for field, problem in (
            ("email", email_problem(email)),
            ("display_name", display_name_problem(display_name)),
            ("password", password_problem(password)),
        )
        if problem
    }
    if problems:
        raise ApiError(400, "validation", problems)

    user_id = tx.value(
        """
        INSERT INTO users (email, display_name, password_hash)
        VALUES (%s, %s, %s)
        ON CONFLICT (email) DO NOTHING
        RETURNING id
        """,
        (email, display_name.strip(), hash_password(password)),
    )
    if user_id is None:
        raise ApiError(409, "email_taken")
    return {
        "token": start_session(tx, user_id),
        "user": _user_payload(user_id, email, display_name.strip()),
    }


def sign_in(tx: Transaction, body: dict[str, Any]) -> dict[str, Any] | ApiError:
    """Returns the session, or the refusal to answer once the attempt is stored."""
    values = required_texts(body, "email", "password")
    email = normalise_email(values["email"])
    password = values["password"]

    tx.lock(LOCK_CLASS_SIGN_IN, key32("sign-in", email))
    _refuse_while_locked(tx, email)

    found = tx.row(
        "SELECT id, email, display_name, password_hash FROM users WHERE email = %s",
        (email,),
    )
    if found is None or not password_matches(password, found[3]):
        _store_attempt(tx, email, succeeded=False)
        return ApiError(401, "invalid_credentials")

    _store_attempt(tx, email, succeeded=True)
    user_id, stored_email, display_name, _ = found
    return {
        "token": start_session(tx, user_id),
        "user": _user_payload(user_id, stored_email, display_name),
    }


def _store_attempt(tx: Transaction, email: str, succeeded: bool) -> None:
    tx.execute(
        "INSERT INTO login_attempts (email, succeeded) VALUES (%s, %s)",
        (email, succeeded),
    )


def _refuse_while_locked(tx: Transaction, email: str) -> None:
    """The sign-in throttle: ten failures in a row lock that email out."""
    attempts = [
        (bool(succeeded), created_at)
        for succeeded, created_at in reversed(
            tx.rows(
                """
                SELECT succeeded, created_at FROM login_attempts
                WHERE email = %s ORDER BY id DESC LIMIT 200
                """,
                (email,),
            )
        )
    ]
    lock_seconds = SETTINGS.sign_in_lock_seconds
    ends_at = lock_end(attempts, SIGN_IN_FAILURE_LIMIT, lock_seconds)
    left = seconds_remaining(ends_at, tx.now(), lock_seconds)
    if left is not None:
        raise ApiError(429, "too_many_attempts", headers=[("Retry-After", str(left))])


def me_payload(tx: Transaction, caller: Caller) -> dict[str, Any]:
    completed = {
        slug
        for (slug,) in tx.rows(
            "SELECT scenario_slug FROM completions WHERE user_id = %s",
            (caller.user_id,),
        )
    }
    team = None
    if caller.team_id is not None:
        team = {
            "id": caller.team_id,
            "name": caller.team_name,
            "invite_code": caller.invite_code,
            "is_captain": caller.is_captain,
        }
    return {
        "user": _user_payload(caller.user_id, caller.email, caller.display_name),
        "team": team,
        "tickets": tickets(tx, caller.user_id),
        "completions": [slug for slug in SCENARIO_SLUGS if slug in completed],
        "webinar_claimed": bool(
            tx.value(
                "SELECT 1 FROM webinar_claims WHERE user_id = %s", (caller.user_id,)
            )
        ),
    }
