"""Schema creation and the one-time baseline seed.

Every instance runs this itself at start, inside one transaction while holding a
PostgreSQL advisory lock, so two instances starting together write the seed
exactly once and a restart rewrites nothing.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta

from .db import LOCK_CLASS_MIGRATION, Transaction
from .passwords import hash_password
from .seed_data import (
    SCENARIOS,
    SEED_EXTRA_MEMBERS,
    SEED_PASSWORD,
    SEED_TEAMS,
)

DDL = (
    """
    CREATE TABLE IF NOT EXISTS users (
        id bigserial PRIMARY KEY,
        email text NOT NULL,
        display_name text NOT NULL,
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)",
    """
    CREATE TABLE IF NOT EXISTS sessions (
        id bigserial PRIMARY KEY,
        token text NOT NULL,
        user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_unique ON sessions (token)",
    """
    CREATE TABLE IF NOT EXISTS login_attempts (
        id bigserial PRIMARY KEY,
        email text NOT NULL,
        succeeded boolean NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS login_attempts_email_time
        ON login_attempts (email, created_at DESC)
    """,
    """
    CREATE TABLE IF NOT EXISTS teams (
        id bigserial PRIMARY KEY,
        name text NOT NULL,
        invite_code text NOT NULL,
        captain_id bigint REFERENCES users (id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS teams_name_unique ON teams (lower(name))",
    "CREATE UNIQUE INDEX IF NOT EXISTS teams_invite_code_unique ON teams (invite_code)",
    """
    CREATE TABLE IF NOT EXISTS memberships (
        id bigserial PRIMARY KEY,
        user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        team_id bigint NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        joined_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS memberships_user_unique ON memberships (user_id)",
    "CREATE INDEX IF NOT EXISTS memberships_team ON memberships (team_id, joined_at)",
    """
    CREATE TABLE IF NOT EXISTS scenarios (
        id bigserial PRIMARY KEY,
        slug text NOT NULL,
        number integer NOT NULL,
        title text NOT NULL,
        kind text NOT NULL,
        points integer NOT NULL,
        description text NOT NULL,
        flag_sha256 text NOT NULL
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS scenarios_slug_unique ON scenarios (slug)",
    "CREATE UNIQUE INDEX IF NOT EXISTS scenarios_number_unique ON scenarios (number)",
    """
    CREATE TABLE IF NOT EXISTS completions (
        id bigserial PRIMARY KEY,
        user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        scenario_slug text NOT NULL,
        team_id bigint NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS completions_user_scenario_unique
        ON completions (user_id, scenario_slug)
    """,
    """
    CREATE TABLE IF NOT EXISTS team_solves (
        id bigserial PRIMARY KEY,
        team_id bigint NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        scenario_slug text NOT NULL,
        user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS team_solves_team_scenario_unique
        ON team_solves (team_id, scenario_slug)
    """,
    """
    CREATE TABLE IF NOT EXISTS flag_attempts (
        id bigserial PRIMARY KEY,
        user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        scenario_slug text NOT NULL,
        correct boolean NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS flag_attempts_player_scenario
        ON flag_attempts (user_id, scenario_slug, created_at DESC)
    """,
    """
    CREATE TABLE IF NOT EXISTS webinar_claims (
        id bigserial PRIMARY KEY,
        user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS webinar_claims_user_unique
        ON webinar_claims (user_id)
    """,
    """
    CREATE TABLE IF NOT EXISTS live_events (
        id bigserial PRIMARY KEY,
        name text NOT NULL,
        data text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS live_events_id ON live_events (id DESC)",
)


def flag_hash(flag: str) -> str:
    return hashlib.sha256(flag.encode("utf-8")).hexdigest()


def _at(moment: str) -> datetime:
    return datetime.fromisoformat(moment.replace("Z", "+00:00"))


def _solve_times(team) -> dict[int, datetime]:
    if not team.solved:
        return {}
    last = _at(team.last_solve_at)
    count = len(team.solved)
    return {
        number: last - timedelta(hours=count - position)
        for position, number in enumerate(sorted(team.solved), start=1)
    }


def is_seeded(tx: Transaction) -> bool:
    return bool(tx.value("SELECT count(*) = 8 FROM scenarios"))


def migrate(tx: Transaction) -> None:
    """Create the schema and write the baseline exactly once."""
    tx.lock(LOCK_CLASS_MIGRATION, 1)
    for statement in DDL:
        tx.execute(statement)
    if is_seeded(tx):
        return
    _seed(tx)


def _seed(tx: Transaction) -> None:
    password_hash = hash_password(SEED_PASSWORD)
    for scenario in SCENARIOS:
        tx.execute(
            """
            INSERT INTO scenarios
                (slug, number, title, kind, points, description, flag_sha256)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                scenario.slug,
                scenario.number,
                scenario.title,
                scenario.kind,
                scenario.points,
                scenario.description,
                flag_hash(scenario.flag),
            ),
        )

    user_ids: dict[str, int] = {}

    def add_user(email: str, display_name: str, created_at: str) -> int:
        user_id = tx.value(
            """
            INSERT INTO users (email, display_name, password_hash, created_at)
            VALUES (%s, %s, %s, %s) RETURNING id
            """,
            (email, display_name, password_hash, created_at),
        )
        user_ids[email] = user_id
        return user_id

    team_ids: dict[str, int] = {}
    for team in SEED_TEAMS:
        captain_id = add_user(team.captain_email, team.captain_name, team.created_at)
        team_id = tx.value(
            """
            INSERT INTO teams (name, invite_code, captain_id, created_at)
            VALUES (%s, %s, %s, %s) RETURNING id
            """,
            (team.name, team.invite_code, captain_id, team.created_at),
        )
        team_ids[team.name] = team_id
        tx.execute(
            "INSERT INTO memberships (user_id, team_id, joined_at) VALUES (%s, %s, %s)",
            (captain_id, team_id, team.created_at),
        )
        for number, moment in _solve_times(team).items():
            scenario = SCENARIOS[number - 1]
            tx.execute(
                """
                INSERT INTO team_solves (team_id, scenario_slug, user_id, created_at)
                VALUES (%s, %s, %s, %s)
                """,
                (team_id, scenario.slug, captain_id, moment),
            )
            tx.execute(
                """
                INSERT INTO completions (user_id, scenario_slug, team_id, created_at)
                VALUES (%s, %s, %s, %s)
                """,
                (captain_id, scenario.slug, team_id, moment),
            )

    for member in SEED_EXTRA_MEMBERS:
        joined = member.joined_at or SEED_TEAMS[0].created_at
        user_id = add_user(member.email, member.display_name, joined)
        if member.team_name:
            tx.execute(
                """
                INSERT INTO memberships (user_id, team_id, joined_at)
                VALUES (%s, %s, %s)
                """,
                (user_id, team_ids[member.team_name], member.joined_at),
            )
