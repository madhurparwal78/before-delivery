export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (lower(email));

CREATE TABLE IF NOT EXISTS verification_codes (
  user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users,
  title text NOT NULL,
  layout text NOT NULL DEFAULT 'columns',
  sort text NOT NULL DEFAULT 'by_hand',
  grouping text NOT NULL DEFAULT 'section',
  privacy text NOT NULL DEFAULT 'private',
  password_hash text,
  password_generation integer NOT NULL DEFAULT 1,
  approval boolean NOT NULL DEFAULT false,
  link_access text NOT NULL DEFAULT 'off',
  link_token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS members (
  board_id uuid NOT NULL REFERENCES boards ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  role text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (board_id, user_id)
);

CREATE TABLE IF NOT EXISTS sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards ON DELETE CASCADE,
  title text NOT NULL,
  ordinal integer NOT NULL
);
CREATE INDEX IF NOT EXISTS sections_board ON sections (board_id, ordinal);

CREATE TABLE IF NOT EXISTS posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES sections ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  state text NOT NULL,
  position integer,
  version integer NOT NULL DEFAULT 1,
  last_actor_id uuid NOT NULL REFERENCES users,
  push text,
  file_card boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  seq bigserial
);
CREATE INDEX IF NOT EXISTS posts_board ON posts (board_id, state);
CREATE INDEX IF NOT EXISTS posts_section ON posts (section_id, position);

CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY,
  post_id uuid NOT NULL UNIQUE REFERENCES posts ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size integer NOT NULL
);

CREATE TABLE IF NOT EXISTS likes (
  post_id uuid NOT NULL REFERENCES posts ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS votes (
  post_id uuid NOT NULL REFERENCES posts ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  value smallint NOT NULL CHECK (value IN (1, -1)),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  seq bigserial
);
CREATE INDEX IF NOT EXISTS comments_post ON comments (post_id, seq);

CREATE TABLE IF NOT EXISTS invites (
  token text PRIMARY KEY,
  board_id uuid NOT NULL REFERENCES boards ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS unlocks (
  token text PRIMARY KEY,
  board_id uuid NOT NULL REFERENCES boards ON DELETE CASCADE,
  generation integer NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  board_id uuid NOT NULL REFERENCES boards ON DELETE CASCADE,
  scope text NOT NULL,
  user_id uuid,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS events_board ON events (board_id, id);

CREATE TABLE IF NOT EXISTS storage_removals (
  prefix text PRIMARY KEY
);
`;
