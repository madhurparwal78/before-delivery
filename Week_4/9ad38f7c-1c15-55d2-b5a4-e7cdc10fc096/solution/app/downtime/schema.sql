-- Applied by bootstrap inside one transaction while holding the bootstrap advisory lock.

CREATE TABLE IF NOT EXISTS users (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL UNIQUE,
    display_name text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS sessions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    token_sha256 text NOT NULL UNIQUE,
    user_id bigint NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS login_attempts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL,
    succeeded boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS login_attempts_email ON login_attempts (email, id);

CREATE TABLE IF NOT EXISTS teams (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL,
    invite_code text NOT NULL UNIQUE,
    captain_id bigint REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS teams_name_key ON teams (lower(name));

CREATE TABLE IF NOT EXISTS memberships (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL UNIQUE REFERENCES users (id),
    team_id bigint NOT NULL REFERENCES teams (id),
    joined_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS memberships_team ON memberships (team_id, joined_at);

CREATE TABLE IF NOT EXISTS scenarios (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    number integer NOT NULL UNIQUE,
    title text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('soc-sim', 'th-sim', 'tabletop', 'challenge')),
    points integer NOT NULL,
    description text NOT NULL,
    flag_sha256 text NOT NULL
);

CREATE TABLE IF NOT EXISTS completions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users (id),
    scenario_slug text NOT NULL REFERENCES scenarios (slug),
    team_id bigint NOT NULL REFERENCES teams (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (user_id, scenario_slug)
);

CREATE TABLE IF NOT EXISTS team_solves (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id bigint NOT NULL REFERENCES teams (id),
    scenario_slug text NOT NULL REFERENCES scenarios (slug),
    user_id bigint NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (team_id, scenario_slug)
);
CREATE INDEX IF NOT EXISTS team_solves_recent ON team_solves (created_at DESC);

CREATE TABLE IF NOT EXISTS flag_attempts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users (id),
    scenario_slug text NOT NULL REFERENCES scenarios (slug),
    correct boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS flag_attempts_player ON flag_attempts (user_id, scenario_slug, id);

CREATE TABLE IF NOT EXISTS webinar_claims (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL UNIQUE REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Derived values: computed from stored rows on every read, never stored.

-- Tickets: one per completion, plus 2 for a webinar claim.
CREATE OR REPLACE VIEW player_tickets AS
SELECT u.id AS user_id,
       (SELECT count(*) FROM completions c WHERE c.user_id = u.id)
       + 2 * (SELECT count(*) FROM webinar_claims w WHERE w.user_id = u.id) AS tickets
FROM users u;

-- Team score and time of last scoring, with the per-kind solve counts the leaderboard shows.
CREATE OR REPLACE VIEW team_scores AS
SELECT t.id AS team_id,
       coalesce(sum(s.points), 0)::integer AS points,
       max(ts.created_at) AS last_scored_at,
       count(ts.id)::integer AS solved,
       count(ts.id) FILTER (WHERE s.kind = 'soc-sim')::integer AS soc_solved,
       count(ts.id) FILTER (WHERE s.kind = 'th-sim')::integer AS th_solved,
       count(ts.id) FILTER (WHERE s.kind = 'tabletop')::integer AS tabletop_solved,
       count(ts.id) FILTER (WHERE s.kind = 'challenge')::integer AS challenges_solved
FROM teams t
LEFT JOIN team_solves ts ON ts.team_id = t.id
LEFT JOIN scenarios s ON s.slug = ts.scenario_slug
GROUP BY t.id;
