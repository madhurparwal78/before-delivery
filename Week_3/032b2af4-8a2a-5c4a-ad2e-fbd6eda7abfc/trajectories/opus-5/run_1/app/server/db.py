"""PostgreSQL connection pool and schema."""
from contextlib import contextmanager

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import DATABASE_URL

pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=12, open=False, kwargs={"row_factory": dict_row})

SCHEMA = """
CREATE TABLE IF NOT EXISTS athletes (
    id                 bigserial PRIMARY KEY,
    email              text NOT NULL,
    name               text NOT NULL,
    password_hash      text NOT NULL,
    private            boolean NOT NULL DEFAULT false,
    default_visibility text NOT NULL DEFAULT 'everyone',
    plan               text NOT NULL DEFAULT 'free',
    time_zone          text NOT NULL DEFAULT 'UTC',
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS athletes_email_key ON athletes (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
    token      text PRIMARY KEY,
    athlete_id bigint NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS follows (
    id          bigserial PRIMARY KEY,
    follower_id bigint NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    followee_id bigint NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    status      text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (follower_id, followee_id)
);

CREATE TABLE IF NOT EXISTS activities (
    id               bigserial PRIMARY KEY,
    athlete_id       bigint NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    name             text NOT NULL,
    sport_type       text NOT NULL,
    visibility       text NOT NULL,
    start_time       timestamptz NOT NULL,
    distance_m       integer NOT NULL,
    moving_time_s    integer NOT NULL,
    elapsed_time_s   integer NOT NULL,
    elevation_gain_m integer NOT NULL,
    avg_pace_s_per_km integer,
    avg_speed_kmh    numeric(8,1) NOT NULL,
    splits           jsonb NOT NULL,
    best_efforts     jsonb NOT NULL,
    idempotency_key  text,
    request_digest   text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT activities_recording_key UNIQUE (athlete_id, start_time)
);
CREATE UNIQUE INDEX IF NOT EXISTS activities_idempotency_key
    ON activities (athlete_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS activity_points (
    activity_id bigint NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    point_index integer NOT NULL,
    lat         double precision NOT NULL,
    lon         double precision NOT NULL,
    ele         double precision NOT NULL,
    point_time  timestamptz NOT NULL,
    PRIMARY KEY (activity_id, point_index)
);

CREATE TABLE IF NOT EXISTS segments (
    id               bigserial PRIMARY KEY,
    name             text NOT NULL,
    start_lat        double precision NOT NULL,
    start_lon        double precision NOT NULL,
    end_lat          double precision NOT NULL,
    end_lon          double precision NOT NULL,
    distance_m       integer NOT NULL,
    elevation_diff_m integer NOT NULL,
    created_by       bigint REFERENCES athletes(id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS segment_efforts (
    id             bigserial PRIMARY KEY,
    segment_id     bigint NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    activity_id    bigint NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    athlete_id     bigint NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    elapsed_time_s integer NOT NULL,
    start_time     timestamptz NOT NULL,
    pr_rank        integer,
    is_crown       boolean NOT NULL DEFAULT false,
    CONSTRAINT segment_efforts_activity_key UNIQUE (activity_id, segment_id)
);

CREATE TABLE IF NOT EXISTS kudos (
    id          bigserial PRIMARY KEY,
    activity_id bigint NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    athlete_id  bigint NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kudos_athlete_key UNIQUE (activity_id, athlete_id)
);

CREATE TABLE IF NOT EXISTS comments (
    id          bigserial PRIMARY KEY,
    activity_id bigint NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    athlete_id  bigint NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    text        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS challenges (
    id          bigserial PRIMARY KEY,
    name        text NOT NULL UNIQUE,
    sport_types text[] NOT NULL,
    dimension   text NOT NULL,
    goal        integer NOT NULL,
    window_unit text NOT NULL DEFAULT 'month'
);

CREATE TABLE IF NOT EXISTS challenge_participants (
    id           bigserial PRIMARY KEY,
    challenge_id bigint NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    athlete_id   bigint NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    joined_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (challenge_id, athlete_id)
);

CREATE TABLE IF NOT EXISTS privacy_zones (
    athlete_id bigint PRIMARY KEY REFERENCES athletes(id) ON DELETE CASCADE,
    lat        double precision NOT NULL,
    lon        double precision NOT NULL,
    radius_m   integer NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id             bigserial PRIMARY KEY,
    athlete_id     bigint NOT NULL UNIQUE REFERENCES athletes(id) ON DELETE CASCADE,
    plan           text NOT NULL,
    billing        text NOT NULL,
    status         text NOT NULL,
    trial_ends_on  date NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_edits (
    id          bigserial PRIMARY KEY,
    activity_id bigint NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    field       text NOT NULL,
    from_value  text NOT NULL,
    to_value    text NOT NULL,
    changed_at  timestamptz NOT NULL DEFAULT now()
);
"""


def connect():
    return pool.connection()


@contextmanager
def cursor():
    with pool.connection() as conn:
        with conn.cursor() as cur:
            yield cur


def create_schema() -> None:
    with pool.connection() as conn:
        conn.execute(SCHEMA)
