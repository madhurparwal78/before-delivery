/** The whole schema; every statement is idempotent so it can run at every start. */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id bigserial PRIMARY KEY,
  username text NOT NULL,
  username_key text NOT NULL UNIQUE,
  email text NOT NULL,
  email_key text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  totp_secret text,
  totp_enabled boolean NOT NULL DEFAULT false,
  suspended_at timestamptz,
  suspension_reason text,
  locked_until timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS login_failures (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS login_failures_user_idx ON login_failures (user_id, at);

CREATE TABLE IF NOT EXISTS email_tokens (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('verify', 'reset')),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS email_tokens_user_idx ON email_tokens (user_id, kind, id);

CREATE TABLE IF NOT EXISTS communities (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  name_key text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  type text NOT NULL CHECK (type IN ('public', 'restricted')),
  member_count integer NOT NULL DEFAULT 0 CHECK (member_count >= 0),
  show_mod_names boolean NOT NULL DEFAULT false,
  owner_id bigint NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id bigserial PRIMARY KEY,
  community_id bigint NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  position integer NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS rules_community_idx ON rules (community_id, position);

CREATE TABLE IF NOT EXISTS memberships (
  community_id bigint NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL,
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id);

CREATE TABLE IF NOT EXISTS moderators (
  community_id bigint NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (community_id, user_id)
);

CREATE TABLE IF NOT EXISTS approved_posters (
  community_id bigint NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (community_id, user_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id bigserial PRIMARY KEY,
  community_id bigint NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  author_id bigint NOT NULL REFERENCES users(id),
  title text NOT NULL,
  body_md text,
  body_html text,
  spoiler boolean NOT NULL DEFAULT false,
  score integer NOT NULL DEFAULT 0,
  comment_count integer NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  hot_rank double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  edited_at timestamptz,
  state text NOT NULL DEFAULT 'published' CHECK (state IN ('published', 'removed', 'deleted')),
  removal_reason text,
  removed_at timestamptz,
  locked boolean NOT NULL DEFAULT false,
  locked_until timestamptz,
  pinned boolean NOT NULL DEFAULT false,
  pinned_at timestamptz,
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS posts_hot_idx ON posts (hot_rank DESC, id DESC) WHERE state = 'published';
CREATE INDEX IF NOT EXISTS posts_new_idx ON posts (created_at DESC, id DESC) WHERE state = 'published';
CREATE INDEX IF NOT EXISTS posts_top_idx ON posts (score DESC, id DESC) WHERE state = 'published';
CREATE INDEX IF NOT EXISTS posts_community_idx ON posts (community_id, state);
CREATE INDEX IF NOT EXISTS posts_author_idx ON posts (author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS images (
  id bigserial PRIMARY KEY,
  uploader_id bigint NOT NULL REFERENCES users(id),
  post_id bigint REFERENCES posts(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  alt text,
  sha256 text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS images_post_idx ON images (post_id, position);

CREATE TABLE IF NOT EXISTS comments (
  id bigserial PRIMARY KEY,
  post_id bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_id bigint REFERENCES comments(id) ON DELETE CASCADE,
  author_id bigint NOT NULL REFERENCES users(id),
  body_md text,
  body_html text,
  score integer NOT NULL DEFAULT 0,
  depth integer NOT NULL,
  path text NOT NULL DEFAULT '/',
  descendant_count integer NOT NULL DEFAULT 0 CHECK (descendant_count >= 0),
  created_at timestamptz NOT NULL,
  edited_at timestamptz,
  state text NOT NULL DEFAULT 'published' CHECK (state IN ('published', 'deleted', 'removed')),
  removal_reason text
);
CREATE INDEX IF NOT EXISTS comments_post_idx ON comments (post_id, depth);
CREATE INDEX IF NOT EXISTS comments_parent_idx ON comments (parent_id);

CREATE TABLE IF NOT EXISTS votes (
  member_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('post', 'comment')),
  target_id bigint NOT NULL,
  value smallint NOT NULL CHECK (value IN (1, -1)),
  PRIMARY KEY (member_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  member_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer,
  response jsonb,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (member_id, endpoint, key)
);

CREATE TABLE IF NOT EXISTS reports (
  id bigserial PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  target_type text NOT NULL CHECK (target_type IN ('post', 'comment')),
  target_id bigint NOT NULL,
  category text NOT NULL,
  explanation text NOT NULL,
  reporter_email text NOT NULL,
  created_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed'))
);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status, created_at);

CREATE TABLE IF NOT EXISTS mod_log (
  id bigserial PRIMARY KEY,
  community_id bigint NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  action text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('post', 'comment', 'user')),
  target_id text NOT NULL,
  public_reason text,
  private_note text,
  moderator_id bigint NOT NULL REFERENCES users(id),
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS mod_log_community_idx ON mod_log (community_id, id DESC);
`;
