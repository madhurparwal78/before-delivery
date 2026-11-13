export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organiser_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL,
  logo_key text,
  logo_type text,
  logo_uploads integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  name text NOT NULL,
  short_name text NOT NULL,
  position integer NOT NULL,
  UNIQUE (team_id, short_name)
);

CREATE TABLE IF NOT EXISTS tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organiser_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL,
  overs integer NOT NULL,
  players_per_side integer NOT NULL,
  super_over boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL
);

CREATE TABLE IF NOT EXISTS group_teams (
  group_id uuid NOT NULL REFERENCES tournament_groups (id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, team_id),
  UNIQUE (tournament_id, team_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organiser_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  home_team_id uuid NOT NULL REFERENCES teams (id),
  away_team_id uuid NOT NULL REFERENCES teams (id),
  batting_first_team_id uuid NOT NULL REFERENCES teams (id),
  tournament_id uuid REFERENCES tournaments (id) ON DELETE SET NULL,
  overs integer NOT NULL,
  players_per_side integer NOT NULL,
  super_over boolean NOT NULL,
  viewer_link boolean NOT NULL DEFAULT true,
  viewer_code text UNIQUE,
  played_on date,
  summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS match_xi (
  match_id uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams (id),
  player_id uuid NOT NULL REFERENCES players (id),
  position integer NOT NULL,
  PRIMARY KEY (match_id, player_id)
);

CREATE TABLE IF NOT EXISTS match_scorers (
  match_id uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (match_id, user_id)
);

CREATE TABLE IF NOT EXISTS innings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  striker_id uuid NOT NULL REFERENCES players (id),
  non_striker_id uuid NOT NULL REFERENCES players (id),
  UNIQUE (match_id, ordinal)
);

CREATE TABLE IF NOT EXISTS ball_log (
  innings_id uuid NOT NULL REFERENCES innings (id) ON DELETE CASCADE,
  position integer NOT NULL,
  entry jsonb NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (innings_id, position)
);

CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  organiser_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  sent_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS invitations_organiser_sent ON invitations (organiser_id, sent_at);
`;
