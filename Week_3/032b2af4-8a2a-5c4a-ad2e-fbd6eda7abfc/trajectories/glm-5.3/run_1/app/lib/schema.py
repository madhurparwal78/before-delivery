"""Schema creation and seeding: idempotent on every start."""

SCHEMA = """
CREATE TABLE IF NOT EXISTS athletes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    private BOOLEAN NOT NULL DEFAULT FALSE,
    default_visibility TEXT NOT NULL DEFAULT 'everyone',
    plan TEXT NOT NULL DEFAULT 'free',
    subscriber BOOLEAN NOT NULL DEFAULT FALSE,
    time_zone TEXT NOT NULL DEFAULT 'UTC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS follows (
    id TEXT PRIMARY KEY,
    follower_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    followee_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (follower_id, followee_id)
);
CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sport_type TEXT NOT NULL,
    visibility TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    distance_m INTEGER NOT NULL,
    moving_time_s INTEGER NOT NULL,
    elapsed_time_s INTEGER NOT NULL,
    elevation_gain_m INTEGER NOT NULL,
    avg_pace_s_per_km INTEGER,
    avg_speed_kmh NUMERIC(8,1) NOT NULL DEFAULT 0,
    splits JSONB NOT NULL DEFAULT '[]',
    best_efforts JSONB NOT NULL DEFAULT '[]',
    kudos_count INTEGER NOT NULL DEFAULT 0,
    comment_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS activities_athlete_start
    ON activities (athlete_id, start_time);
CREATE TABLE IF NOT EXISTS activity_points (
    id BIGSERIAL PRIMARY KEY,
    activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    ele DOUBLE PRECISION NOT NULL,
    point_time TIMESTAMPTZ NOT NULL,
    distance_m INTEGER NOT NULL DEFAULT 0,
    UNIQUE (activity_id, seq)
);
CREATE TABLE IF NOT EXISTS segments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    start_lat DOUBLE PRECISION NOT NULL,
    start_lon DOUBLE PRECISION NOT NULL,
    end_lat DOUBLE PRECISION NOT NULL,
    end_lon DOUBLE PRECISION NOT NULL,
    distance_m INTEGER NOT NULL,
    elevation_diff_m INTEGER NOT NULL,
    creator_id TEXT REFERENCES athletes(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS segment_efforts (
    id TEXT PRIMARY KEY,
    segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    elapsed_time_s INTEGER NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    pr_rank INTEGER,
    is_crown BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (activity_id, segment_id)
);
CREATE INDEX IF NOT EXISTS segment_efforts_segment ON segment_efforts (segment_id);
CREATE TABLE IF NOT EXISTS kudos (
    id TEXT PRIMARY KEY,
    athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (athlete_id, activity_id)
);
CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    sport_types JSONB NOT NULL,
    dimension TEXT NOT NULL,
    goal BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS challenge_participants (
    id TEXT PRIMARY KEY,
    athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (athlete_id, challenge_id)
);
CREATE TABLE IF NOT EXISTS privacy_zones (
    athlete_id TEXT PRIMARY KEY REFERENCES athletes(id) ON DELETE CASCADE,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    radius_m INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
    athlete_id TEXT PRIMARY KEY REFERENCES athletes(id) ON DELETE CASCADE,
    plan TEXT NOT NULL,
    billing TEXT NOT NULL,
    status TEXT NOT NULL,
    trial_ends_on DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS activity_edits (
    id TEXT PRIMARY KEY,
    activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    field TEXT NOT NULL,
    old_value TEXT NOT NULL,
    new_value TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
    athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    body_sha TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (athlete_id, key)
);
"""
