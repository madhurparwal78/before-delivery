import contextlib
import threading

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import DATABASE_URL

_pool: ConnectionPool | None = None
_lock = threading.Lock()


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        with _lock:
            if _pool is None:
                _pool = ConnectionPool(
                    DATABASE_URL,
                    min_size=1,
                    max_size=12,
                    kwargs={"row_factory": dict_row, "autocommit": True},
                    open=True,
                    timeout=20,
                )
    return _pool


@contextlib.contextmanager
def conn():
    with pool().connection() as c:
        yield c


@contextlib.contextmanager
def tx():
    """A connection inside an explicit transaction."""
    with pool().connection() as c:
        with c.transaction():
            yield c


def q(c, sql, params=()):
    cur = c.execute(sql, params)
    return cur.fetchall()


def q1(c, sql, params=()):
    cur = c.execute(sql, params)
    return cur.fetchone()


def ex(c, sql, params=()):
    c.execute(sql, params)


SCHEMA = """
CREATE TABLE IF NOT EXISTS members (
  id             TEXT PRIMARY KEY,
  username       TEXT NOT NULL,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  rating         INTEGER NOT NULL DEFAULT 1200,
  rated_games    INTEGER NOT NULL DEFAULT 0,
  avatar_key     TEXT NOT NULL DEFAULT 'avatar_01',
  avatar_blob    BYTEA,
  role           TEXT NOT NULL DEFAULT 'member',
  view           TEXT NOT NULL DEFAULT 'flat',
  piece_set_2d   TEXT NOT NULL DEFAULT 'Classic',
  piece_set_3d   TEXT NOT NULL DEFAULT 'Marble',
  theme          TEXT NOT NULL DEFAULT 'Forest',
  sound          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS members_username_lower ON members (lower(username));
CREATE INDEX IF NOT EXISTS members_ladder ON members (rating DESC, rated_games DESC, username ASC);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_member ON sessions (member_id);

CREATE TABLE IF NOT EXISTS clubs (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  slug     TEXT NOT NULL UNIQUE,
  private  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS club_memberships (
  club_id    TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',
  banned     BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (club_id, member_id)
);
CREATE INDEX IF NOT EXISTS club_memberships_member ON club_memberships (member_id);

CREATE TABLE IF NOT EXISTS games (
  id            TEXT PRIMARY KEY,
  white_id      TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  black_id      TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  club_id       TEXT REFERENCES clubs(id) ON DELETE SET NULL,
  rated         BOOLEAN NOT NULL DEFAULT FALSE,
  level         TEXT,
  fen           TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'in_progress',
  result        TEXT NOT NULL DEFAULT '*',
  opening       TEXT,
  draw_offer_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  takeback_by   TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_move_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- additive bookkeeping columns
  kind                      TEXT NOT NULL DEFAULT 'member',
  player_colour             TEXT,
  start_fen                 TEXT NOT NULL,
  end_reason                TEXT,
  finished_at               TIMESTAMPTZ,
  white_rating_before       INTEGER,
  black_rating_before       INTEGER,
  white_rating_after        INTEGER,
  black_rating_after        INTEGER,
  white_rated_games_before  INTEGER,
  black_rated_games_before  INTEGER
);
CREATE INDEX IF NOT EXISTS games_white ON games (white_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS games_black ON games (black_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS games_status ON games (status, last_move_at DESC);

CREATE TABLE IF NOT EXISTS moves (
  id          TEXT PRIMARY KEY,
  game_id     TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply         INTEGER NOT NULL,
  uci         TEXT NOT NULL,
  san         TEXT NOT NULL,
  fen_after   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, ply)
);
CREATE INDEX IF NOT EXISTS moves_game_ply ON moves (game_id, ply);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  game_id     TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  member_id   TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_game ON chat_messages (game_id, created_at, id);
CREATE INDEX IF NOT EXISTS chat_member_time ON chat_messages (member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS challenges (
  id               TEXT PRIMARY KEY,
  from_id          TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  to_id            TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  club_id          TEXT REFERENCES clubs(id) ON DELETE SET NULL,
  rated            BOOLEAN NOT NULL DEFAULT TRUE,
  colour           TEXT NOT NULL DEFAULT 'Random',
  status           TEXT NOT NULL DEFAULT 'pending',
  idempotency_key  TEXT UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  game_id          TEXT REFERENCES games(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS challenges_to ON challenges (to_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS challenges_from ON challenges (from_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  blocked_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  game_id     TEXT REFERENCES games(id) ON DELETE CASCADE,
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  body        TEXT
);
CREATE INDEX IF NOT EXISTS notifications_member ON notifications (member_id, read, created_at DESC);

CREATE TABLE IF NOT EXISTS rating_audit (
  id             TEXT PRIMARY KEY,
  game_id        TEXT NOT NULL,
  admin_id       TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  member_id      TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  rating_before  INTEGER NOT NULL,
  rating_after   INTEGER NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rating_audit_game ON rating_audit (game_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id           TEXT PRIMARY KEY,
  username     TEXT NOT NULL,
  succeeded    BOOLEAN NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_user ON login_attempts (username, attempted_at DESC);
"""


def init_schema() -> None:
    with pool().connection() as c:
        c.execute("SELECT pg_advisory_lock(762341)")
        try:
            c.execute(SCHEMA)
        finally:
            c.execute("SELECT pg_advisory_unlock(762341)")


def wait_for_db(attempts: int = 60) -> None:
    import time

    last: Exception | None = None
    for _ in range(attempts):
        try:
            with psycopg.connect(DATABASE_URL, connect_timeout=3) as c:
                c.execute("SELECT 1")
            return
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1)
    raise RuntimeError(f"database never became reachable: {last}")
