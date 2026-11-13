CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verify_codes (
  id text PRIMARY KEY,
  email text NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS boards (
  id text PRIMARY KEY,
  title text NOT NULL,
  layout text NOT NULL DEFAULT 'columns',
  sort text NOT NULL DEFAULT 'by_hand',
  "group" text NOT NULL DEFAULT 'section',
  privacy text NOT NULL DEFAULT 'private',
  approval boolean NOT NULL DEFAULT false,
  link_access text NOT NULL DEFAULT 'off',
  link_token text,
  pass_hash text,
  pass_gen integer NOT NULL DEFAULT 1,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS board_links (
  token text PRIMARY KEY,
  board_id text NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sections (
  id text PRIMARY KEY,
  board_id text NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  title text NOT NULL,
  position integer NOT NULL,
  UNIQUE (board_id, title)
);

CREATE TABLE IF NOT EXISTS memberships (
  board_id text NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  PRIMARY KEY (board_id, user_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id text PRIMARY KEY,
  board_id text NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  section_id text NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position integer,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'published',
  version integer NOT NULL DEFAULT 1,
  last_moved_by text,
  push_state text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state IN ('published', 'awaiting_approval', 'rejected'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY,
  post_id text NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
  board_id text NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size integer NOT NULL,
  stored boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS likes (
  post_id text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS votes (
  post_id text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value integer NOT NULL CHECK (value IN (1, -1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invites (
  token text PRIMARY KEY,
  board_id text NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL,
  invited_by text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used boolean NOT NULL DEFAULT false,
  used_by text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS board_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_retries (
  post_id text PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  next_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS storage_retries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  prefix text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('post', 'board')),
  next_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_board ON posts (board_id, state);
CREATE INDEX IF NOT EXISTS idx_posts_section ON posts (section_id, position);
CREATE INDEX IF NOT EXISTS idx_board_events_board ON board_events (board_id, id);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id, created_at);
