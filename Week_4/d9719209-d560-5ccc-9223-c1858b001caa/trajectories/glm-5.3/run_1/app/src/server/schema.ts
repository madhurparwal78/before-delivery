/* Postgres schema, applied idempotently on every serve. Postgres is the only
   source of truth: accounts, sessions, lockout state, tokens, communities,
   memberships, moderators, approved posters, rules, posts, images, comments
   (adjacency + materialised path), idempotency records, reports, mod log. */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id            bigserial PRIMARY KEY,
  username      text NOT NULL,
  username_lc   text NOT NULL UNIQUE,
  email         text NOT NULL,
  email_lc      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  totp_secret   text,
  totp_enabled  boolean NOT NULL DEFAULT false,
  role          text NOT NULL DEFAULT 'user',
  suspended     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  failed_count  integer NOT NULL DEFAULT 0,
  locked_until  timestamptz
);

CREATE TABLE IF NOT EXISTS sessions (
  token      text PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions(account_id);

CREATE TABLE IF NOT EXISTS verification_tokens (
  id         bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token      text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_account_idx ON verification_tokens(account_id);

CREATE TABLE IF NOT EXISTS verification_mails (
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sent_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_mails_account_idx ON verification_mails(account_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token      text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_account_idx ON password_reset_tokens(account_id);

CREATE TABLE IF NOT EXISTS communities (
  id           bigserial PRIMARY KEY,
  name         text NOT NULL,
  name_lc      text NOT NULL UNIQUE,
  title        text NOT NULL,
  description text NOT NULL DEFAULT '',
  type         text NOT NULL DEFAULT 'public',
  member_count integer NOT NULL DEFAULT 0,
  show_mod_names boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  community_id bigint NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  account_id   bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, account_id)
);

CREATE TABLE IF NOT EXISTS moderators (
  community_id bigint NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  account_id   bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  is_owner     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, account_id)
);

CREATE TABLE IF NOT EXISTS approved_posters (
  community_id bigint NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  account_id   bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, account_id)
);

CREATE TABLE IF NOT EXISTS rules (
  id           bigserial PRIMARY KEY,
  community_id bigint NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  position     integer NOT NULL DEFAULT 0,
  title        text NOT NULL,
  description  text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS posts (
  id            bigserial PRIMARY KEY,
  community_id  bigint NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  author_id     bigint REFERENCES accounts(id) ON DELETE SET NULL,
  title         text NOT NULL,
  body_md       text,
  body_html     text,
  spoiler       boolean NOT NULL DEFAULT false,
  score         integer NOT NULL DEFAULT 0,
  hot_rank      double precision NOT NULL DEFAULT 0,
  comment_count integer NOT NULL DEFAULT 0,
  state         text NOT NULL DEFAULT 'published',
  removal_public_reason text,
  removal_at    timestamptz,
  locked        boolean NOT NULL DEFAULT false,
  locked_until  timestamptz,
  pinned        boolean NOT NULL DEFAULT false,
  pinned_at     timestamptz,
  version       integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  edited_at     timestamptz
);
CREATE INDEX IF NOT EXISTS posts_community_idx ON posts(community_id);
CREATE INDEX IF NOT EXISTS posts_state_idx ON posts(state, id DESC);
CREATE INDEX IF NOT EXISTS posts_author_idx ON posts(author_id);

CREATE TABLE IF NOT EXISTS images (
  id            bigserial PRIMARY KEY,
  sha256        text NOT NULL,
  owner_id      bigint REFERENCES accounts(id) ON DELETE SET NULL,
  width         integer NOT NULL,
  height        integer NOT NULL,
  alt           text,
  post_id       bigint REFERENCES posts(id) ON DELETE CASCADE,
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS images_sha_idx ON images(sha256);
CREATE INDEX IF NOT EXISTS images_post_idx ON images(post_id);
CREATE INDEX IF NOT EXISTS images_owner_idx ON images(owner_id);

CREATE TABLE IF NOT EXISTS post_images (
  post_id    bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  image_id   bigint NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  position   integer NOT NULL DEFAULT 0,
  alt        text,
  PRIMARY KEY (post_id, image_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id            bigserial PRIMARY KEY,
  post_id       bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_id     bigint REFERENCES comments(id) ON DELETE SET NULL,
  author_id     bigint REFERENCES accounts(id) ON DELETE SET NULL,
  path          text NOT NULL,
  depth         integer NOT NULL DEFAULT 1,
  body_md       text,
  body_html     text,
  score         integer NOT NULL DEFAULT 0,
  descendant_count integer NOT NULL DEFAULT 0,
  state         text NOT NULL DEFAULT 'published',
  removal_public_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  edited_at     timestamptz
);
CREATE INDEX IF NOT EXISTS comments_post_idx ON comments(post_id);
CREATE INDEX IF NOT EXISTS comments_parent_idx ON comments(parent_id);
CREATE INDEX IF NOT EXISTS comments_path_idx ON comments(path);

CREATE TABLE IF NOT EXISTS votes (
  member_id   bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_type text NOT NULL,
  target_id   bigint NOT NULL,
  value       smallint NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS revoked_sessions (
  token      text PRIMARY KEY,
  account_id bigint NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS revoked_sessions_account_idx ON revoked_sessions(account_id);

CREATE TABLE IF NOT EXISTS idempotency (
  key        text NOT NULL,
  account_id bigint NOT NULL,
  endpoint   text NOT NULL,
  fingerprint text NOT NULL DEFAULT '',
  status     integer NOT NULL,
  response   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, endpoint, key)
);

CREATE TABLE IF NOT EXISTS mod_log (
  id            bigserial PRIMARY KEY,
  community_id  bigint NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  action        text NOT NULL,
  target_type   text NOT NULL,
  target_id     text NOT NULL,
  target_label  text NOT NULL,
  moderator_id  bigint REFERENCES accounts(id) ON DELETE SET NULL,
  public_reason text,
  private_note  text,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS modlog_community_idx ON mod_log(community_id, id DESC);

CREATE TABLE IF NOT EXISTS reports (
  reference     text PRIMARY KEY,
  target_type   text NOT NULL,
  target_id     bigint NOT NULL,
  category      text NOT NULL,
  explanation   text NOT NULL,
  reporter_email text,
  good_faith    boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'open',
  created_at    timestamptz NOT NULL DEFAULT now(),
  deadline_at   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_deadline_idx ON reports(status, deadline_at);
`;
