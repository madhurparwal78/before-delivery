"""PostgreSQL access: the pool, the shared schema, and the seed written once.

Every instance creates the schema and seeds the baseline itself, inside one
transaction while holding a PostgreSQL advisory lock. A restart never
duplicates, resets or rewrites existing rows.
"""

import datetime
import hashlib
import re
import secrets

import pg8000.dbapi

from . import config
from .seed import SCENARIOS, TEAMS, EXTRA_MEMBERS, SOLO_PLAYER, SEED_PASSWORD

CONNECT_TIMEOUT = 3.0
SEED_KEY = 918273
CLOCK_TTL = datetime.timedelta(milliseconds=250)

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS config (key text PRIMARY KEY, value text NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  succeeded boolean NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  invite_code text NOT NULL UNIQUE,
  captain_id BIGINT,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS teams_lower_name ON teams (lower(name));

CREATE TABLE IF NOT EXISTS memberships (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE,
  team_id BIGINT NOT NULL REFERENCES teams (id),
  joined_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS scenarios (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  number int NOT NULL,
  title text NOT NULL,
  kind text NOT NULL,
  points int NOT NULL,
  description text NOT NULL,
  flag_sha256 text NOT NULL
);

CREATE TABLE IF NOT EXISTS completions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL,
  scenario_slug text NOT NULL,
  team_id BIGINT,
  created_at timestamptz NOT NULL,
  UNIQUE (user_id, scenario_slug)
);

CREATE TABLE IF NOT EXISTS team_solves (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id BIGINT NOT NULL,
  scenario_slug text NOT NULL,
  user_id BIGINT NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (team_id, scenario_slug)
);

CREATE TABLE IF NOT EXISTS flag_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL,
  scenario_slug text NOT NULL,
  correct boolean NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS webinar_claims (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token text NOT NULL UNIQUE,
  user_id BIGINT NOT NULL,
  created_at timestamptz NOT NULL
);
"""

SEED_MARKER = "downtime_seed_v1"
COUNTS = (("scenarios", 8), ("teams", 16), ("users", 55), ("memberships", 54),
          ("team_solves", 41), ("completions", 41), ("webinar_claims", 0),
          ("login_attempts", 0), ("flag_attempts", 0))

_UTC = datetime.timezone.utc
_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
_CODE_RE = re.compile(r"^[A-Z0-9]{8}$")


class OutOfService(Exception):
    """The database cannot be reached; the pool is due for reopening."""


def connect(timeout=CONNECT_TIMEOUT):
    """Open one connection, or raise OutOfService when it cannot be reached."""
    kw = config.database_parts()
    if kw is None:
        raise OutOfService()
    kw["timeout"] = timeout
    try:
        return pg8000.dbapi.connect(**kw)
    except Exception:
        raise OutOfService()


def time_text(moment):
    """A database clock reading as an ISO 8601 UTC string with seconds."""
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_time(text):
    return datetime.datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=_UTC)


def statement_now(conn):
    return query_one(conn, "SELECT statement_timestamp()")[0]


def execute(conn, sql, params=()):
    cur = conn.cursor()
    cur.execute(sql, params)
    return cur


def query(conn, sql, params=()):
    return execute(conn, sql, params).fetchall()


def query_one(conn, sql, params=()):
    rows = query(conn, sql, params)
    return rows[0] if rows else None


def _hash(password, salt):
    digest = hashlib.pbkdf2_hmac(
        "sha256", (salt + "\x00" + password).encode("utf-8"), bytes.fromhex(salt), 100_000)
    return digest.hex()


def salted_hash(password):
    salt = secrets.token_hex(16)
    return salt, _hash(password, salt)


def check_password(row, password):
    """row is id, email, display_name, password_salt, password_hash."""
    return secrets.compare_digest(_hash(password, row[3]), row[4])


def code_is_well_formed(code):
    return bool(_CODE_RE.match(code))


def draw_invite_code(conn, exclude=()):
    """A fresh eight-character invite code, unique across teams and different
    from every code in exclude."""
    taken = {row[0] for row in query(conn, "SELECT invite_code FROM teams")}
    taken.update(exclude)
    while True:
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
        if code not in taken:
            return code


def counts_complete(conn):
    """True when every collection holds its baseline row count, or more."""
    try:
        for table, minimum in COUNTS:
            row = query_one(conn, "SELECT count(*) FROM " + table)
            if row[0] < minimum:
                return False
        return True
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return False


def run_schema_and_seed(conn):
    """Create the schema and write the baseline once. Runs as one transaction
    under the seed advisory lock, so two instances starting together write it
    exactly once, and a restart rewrites nothing."""
    try:
        conn.rollback()
    except Exception:
        pass
    cur = conn.cursor()
    cur.execute("SELECT pg_advisory_lock(%s)", (SEED_KEY,))
    cur.execute(SCHEMA_SQL)
    try:
        write_seed(cur)
        cur.execute("COMMIT")
    except Exception:
        try:
            cur.execute("ROLLBACK")
        except Exception:
            pass
        raise


def write_seed(cur):
    """Every statement is idempotent: ON CONFLICT DO NOTHING keeps a second
    writer or a restart from duplicating or resetting any row."""
    for slug, number, title, kind, points, description, flag in SCENARIOS:
        cur.execute(
            "INSERT INTO scenarios (slug, number, title, kind, points, description, flag_sha256) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (slug) DO NOTHING",
            (slug, number, title, kind, points, description,
             hashlib.sha256(flag.encode("utf-8")).hexdigest()))
    for name, code, email, display, created, solved, last in TEAMS:
        cur.execute(
            "INSERT INTO teams (name, invite_code, captain_id, created_at) "
            "VALUES (%s, %s, NULL, %s) ON CONFLICT (invite_code) DO NOTHING",
            (name, code, parse_time(created)))
    people = [(t[2], t[3]) for t in TEAMS] + [SOLO_PLAYER] + [
        (row[1], row[2]) for row in EXTRA_MEMBERS]
    for email, display in people:
        salt, password_hash = salted_hash(SEED_PASSWORD)
        cur.execute(
            "INSERT INTO users (email, display_name, password_salt, password_hash, created_at) "
            "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (email) DO NOTHING",
            (email, display, salt, password_hash, parse_time("2026-10-22T16:00:00Z")))
    for name, code, email, display, created, solved, last in TEAMS:
        cur.execute(
            "INSERT INTO memberships (user_id, team_id, joined_at) "
            "SELECT u.id, t.id, %s FROM users u, teams t "
            "WHERE u.email = %s AND t.name = %s ON CONFLICT (user_id) DO NOTHING",
            (parse_time(created), email, name))
        cur.execute(
            "UPDATE teams SET captain_id = (SELECT id FROM users WHERE email = %s) "
            "WHERE name = %s AND captain_id IS NULL", (email, name))
    for team_name, email, display, joined in EXTRA_MEMBERS:
        cur.execute(
            "INSERT INTO memberships (user_id, team_id, joined_at) "
            "SELECT u.id, t.id, %s FROM users u, teams t "
            "WHERE u.email = %s AND t.name = %s ON CONFLICT (user_id) DO NOTHING",
            (parse_time(joined), email, team_name))
    for name, code, email, display, created, solved, last in TEAMS:
        for slug, when in zip(solved, _solve_times(solved, last)):
            cur.execute(
                "INSERT INTO team_solves (team_id, scenario_slug, user_id, created_at) "
                "SELECT t.id, %s, u.id, %s FROM teams t, users u "
                "WHERE t.name = %s AND u.email = %s "
                "ON CONFLICT (team_id, scenario_slug) DO NOTHING",
                (slug, when, name, email))
            cur.execute(
                "INSERT INTO completions (user_id, scenario_slug, team_id, created_at) "
                "SELECT u.id, %s, t.id, %s FROM teams t, users u "
                "WHERE t.name = %s AND u.email = %s "
                "ON CONFLICT (user_id, scenario_slug) DO NOTHING",
                (slug, when, name, email))


def _solve_times(solved, last):
    """The team's solves, spaced one hour apart, ending at the team's last
    solve."""
    if not solved:
        return []
    end = parse_time(last)
    return [end - datetime.timedelta(hours=(len(solved) - 1 - i))
            for i in range(len(solved))]
