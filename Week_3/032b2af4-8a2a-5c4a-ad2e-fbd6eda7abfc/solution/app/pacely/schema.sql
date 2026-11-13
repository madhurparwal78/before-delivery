CREATE TABLE IF NOT EXISTS athletes (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL UNIQUE,
    name text NOT NULL,
    password_hash text NOT NULL,
    private boolean NOT NULL DEFAULT false,
    default_visibility text NOT NULL DEFAULT 'everyone' CHECK (default_visibility IN ('everyone', 'followers', 'only_me')),
    plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'individual', 'family', 'student')),
    time_zone text NOT NULL DEFAULT 'UTC',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    athlete_id bigint NOT NULL REFERENCES athletes (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_athlete ON sessions (athlete_id);

CREATE TABLE IF NOT EXISTS follows (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    follower_id bigint NOT NULL REFERENCES athletes (id) ON DELETE CASCADE,
    followee_id bigint NOT NULL REFERENCES athletes (id) ON DELETE CASCADE,
    status text NOT NULL CHECK (status IN ('pending', 'accepted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS follows_followee ON follows (followee_id, status);

CREATE TABLE IF NOT EXISTS activities (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    athlete_id bigint NOT NULL REFERENCES athletes (id) ON DELETE CASCADE,
    name text NOT NULL,
    sport_type text NOT NULL CHECK (sport_type IN ('run', 'ride', 'walk', 'hike')),
    visibility text NOT NULL CHECK (visibility IN ('everyone', 'followers', 'only_me')),
    start_time timestamptz NOT NULL,
    distance_m integer NOT NULL,
    moving_time_s integer NOT NULL,
    elapsed_time_s integer NOT NULL,
    elevation_gain_m integer NOT NULL,
    avg_pace_s_per_km integer,
    avg_speed_kmh double precision NOT NULL,
    point_count integer NOT NULL,
    splits jsonb NOT NULL,
    best_efforts jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (athlete_id, start_time)
);
CREATE INDEX IF NOT EXISTS activities_feed ON activities (start_time DESC, id DESC);

CREATE TABLE IF NOT EXISTS activity_points (
    activity_id bigint NOT NULL REFERENCES activities (id) ON DELETE CASCADE,
    idx integer NOT NULL,
    lat double precision NOT NULL,
    lon double precision NOT NULL,
    ele double precision NOT NULL,
    time timestamptz NOT NULL,
    distance_m double precision NOT NULL,
    PRIMARY KEY (activity_id, idx)
);
CREATE INDEX IF NOT EXISTS activity_points_position ON activity_points (lat, lon);

CREATE TABLE IF NOT EXISTS segments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL,
    start_lat double precision NOT NULL,
    start_lon double precision NOT NULL,
    end_lat double precision NOT NULL,
    end_lon double precision NOT NULL,
    distance_m integer NOT NULL,
    elevation_diff_m integer NOT NULL,
    creator_id bigint REFERENCES athletes (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS segments_start ON segments (start_lat, start_lon);

CREATE TABLE IF NOT EXISTS segment_efforts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    segment_id bigint NOT NULL REFERENCES segments (id) ON DELETE CASCADE,
    activity_id bigint NOT NULL REFERENCES activities (id) ON DELETE CASCADE,
    athlete_id bigint NOT NULL REFERENCES athletes (id) ON DELETE CASCADE,
    elapsed_time_s integer NOT NULL,
    start_time timestamptz NOT NULL,
    pr_rank smallint CHECK (pr_rank IN (1, 2, 3)),
    is_crown boolean NOT NULL,
    UNIQUE (activity_id, segment_id)
);
CREATE INDEX IF NOT EXISTS segment_efforts_board ON segment_efforts (segment_id, elapsed_time_s, start_time);

CREATE TABLE IF NOT EXISTS kudos (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    athlete_id bigint NOT NULL REFERENCES athletes (id) ON DELETE CASCADE,
    activity_id bigint NOT NULL REFERENCES activities (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (athlete_id, activity_id)
);
CREATE INDEX IF NOT EXISTS kudos_activity ON kudos (activity_id, created_at, id);

CREATE TABLE IF NOT EXISTS comments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    activity_id bigint NOT NULL REFERENCES activities (id) ON DELETE CASCADE,
    author_id bigint NOT NULL REFERENCES athletes (id) ON DELETE CASCADE,
    text text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS comments_activity ON comments (activity_id, created_at, id);

CREATE TABLE IF NOT EXISTS challenges (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL UNIQUE,
    sport_types text[] NOT NULL,
    dimension text NOT NULL CHECK (dimension IN ('distance', 'single_distance', 'elevation', 'moving_time')),
    goal integer NOT NULL
);

CREATE TABLE IF NOT EXISTS challenge_participants (
    athlete_id bigint NOT NULL REFERENCES athletes (id) ON DELETE CASCADE,
    challenge_id bigint NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (athlete_id, challenge_id)
);

CREATE TABLE IF NOT EXISTS privacy_zones (
    athlete_id bigint PRIMARY KEY REFERENCES athletes (id) ON DELETE CASCADE,
    lat double precision NOT NULL,
    lon double precision NOT NULL,
    radius_m integer NOT NULL CHECK (radius_m IN (200, 400, 800, 1600))
);

CREATE TABLE IF NOT EXISTS subscriptions (
    athlete_id bigint PRIMARY KEY REFERENCES athletes (id) ON DELETE CASCADE,
    plan text NOT NULL CHECK (plan IN ('individual', 'family', 'student')),
    billing text NOT NULL CHECK (billing IN ('annual', 'monthly')),
    status text NOT NULL CHECK (status = 'trialing'),
    trial_ends_on date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_edits (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    activity_id bigint NOT NULL REFERENCES activities (id) ON DELETE CASCADE,
    field text NOT NULL,
    old_value text NOT NULL,
    new_value text NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS activity_edits_activity ON activity_edits (activity_id, id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    athlete_id bigint NOT NULL REFERENCES athletes (id) ON DELETE CASCADE,
    key text NOT NULL,
    fingerprint text NOT NULL,
    activity_id bigint REFERENCES activities (id) ON DELETE CASCADE,
    PRIMARY KEY (athlete_id, key)
);
