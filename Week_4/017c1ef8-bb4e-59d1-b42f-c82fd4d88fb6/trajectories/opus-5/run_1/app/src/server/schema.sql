-- Plainwork schema. Applied idempotently on every serve.

CREATE TABLE IF NOT EXISTS app_meta (
  key   text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS business_clock (
  id        int PRIMARY KEY DEFAULT 1,
  offset_ms bigint NOT NULL,
  CONSTRAINT business_clock_single CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS members (
  id                   text PRIMARY KEY,
  email                text NOT NULL UNIQUE,
  handle               text NOT NULL UNIQUE,
  password_hash        text NOT NULL,
  name                 text NOT NULL,
  headline             text NOT NULL DEFAULT '',
  location             text NOT NULL DEFAULT '',
  about                text NOT NULL DEFAULT '',
  visibility           text NOT NULL DEFAULT 'public',
  photo_id             text,
  confirmed            boolean NOT NULL DEFAULT false,
  confirm_code         text,
  created_at           timestamptz NOT NULL,
  notifications_seen_at timestamptz,
  versions             jsonb NOT NULL DEFAULT '{"intro":1,"about":1,"experience":1,"education":1,"skills":1}'
);

CREATE TABLE IF NOT EXISTS sessions (
  token      text PRIMARY KEY,
  member_id  text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS experience (
  id         text PRIMARY KEY,
  member_id  text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  position   int NOT NULL,
  title      text NOT NULL,
  company    text NOT NULL,
  start_ym   text NOT NULL,
  end_ym     text
);
CREATE INDEX IF NOT EXISTS experience_member ON experience(member_id, position);

CREATE TABLE IF NOT EXISTS education (
  id         text PRIMARY KEY,
  member_id  text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  position   int NOT NULL,
  school     text NOT NULL,
  degree     text NOT NULL,
  start_ym   text NOT NULL,
  end_ym     text
);
CREATE INDEX IF NOT EXISTS education_member ON education(member_id, position);

CREATE TABLE IF NOT EXISTS skills (
  id                text PRIMARY KEY,
  member_id         text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  name              text NOT NULL,
  featured_position int
);
CREATE UNIQUE INDEX IF NOT EXISTS skills_member_name ON skills(member_id, lower(name));

CREATE TABLE IF NOT EXISTS endorsements (
  skill_id    text NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  endorser_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL,
  PRIMARY KEY (skill_id, endorser_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id          text PRIMARY KEY,
  sender_id   text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  receiver_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  state       text NOT NULL,
  created_at  timestamptz NOT NULL,
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS invitations_pair ON invitations(sender_id, receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invitations_receiver ON invitations(receiver_id, state);

CREATE TABLE IF NOT EXISTS connections (
  id           text PRIMARY KEY,
  member_a     text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  member_b     text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  connected_at timestamptz NOT NULL,
  CONSTRAINT connections_ordered CHECK (member_a < member_b)
);
CREATE UNIQUE INDEX IF NOT EXISTS connections_pair ON connections(member_a, member_b);
CREATE INDEX IF NOT EXISTS connections_b ON connections(member_b);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  blocked_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS blocks_blocked ON blocks(blocked_id);

CREATE TABLE IF NOT EXISTS follows (
  follower_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  target_id   text NOT NULL,
  created_at  timestamptz NOT NULL,
  PRIMARY KEY (follower_id, target_id)
);
CREATE INDEX IF NOT EXISTS follows_target ON follows(target_id);

CREATE TABLE IF NOT EXISTS photo_uploads (
  id           text PRIMARY KEY,
  member_id    text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  content_type text NOT NULL,
  bytes        int NOT NULL,
  created_at   timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS resume_uploads (
  id         text PRIMARY KEY,
  member_id  text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  bytes      int NOT NULL,
  sha256     text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id             text PRIMARY KEY,
  author_id      text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  text           text NOT NULL,
  created_at     timestamptz NOT NULL,
  edited_at      timestamptz,
  photo_id       text,
  shared_post_id text,
  deleted_at     timestamptz
);
CREATE INDEX IF NOT EXISTS posts_author ON posts(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_created ON posts(created_at DESC);

CREATE TABLE IF NOT EXISTS reposts (
  id         text PRIMARY KEY,
  member_id  text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  post_id    text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS reposts_pair ON reposts(member_id, post_id);

CREATE TABLE IF NOT EXISTS reactions (
  post_id    text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  member_id  text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  type       text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (post_id, member_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         text PRIMARY KEY,
  post_id    text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  parent_id  text,
  text       text NOT NULL,
  created_at timestamptz NOT NULL,
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS comments_post ON comments(post_id, created_at);

CREATE TABLE IF NOT EXISTS mentions (
  owner_kind text NOT NULL,
  owner_id   text NOT NULL,
  member_id  text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  handle     text NOT NULL,
  PRIMARY KEY (owner_kind, owner_id, member_id)
);

CREATE TABLE IF NOT EXISTS post_hashtags (
  post_id   text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_lower text NOT NULL,
  tag_raw   text NOT NULL,
  PRIMARY KEY (post_id, tag_lower)
);
CREATE INDEX IF NOT EXISTS post_hashtags_tag ON post_hashtags(tag_lower);

CREATE TABLE IF NOT EXISTS conversations (
  id         text PRIMARY KEY,
  member_a   text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  member_b   text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  CONSTRAINT conversations_ordered CHECK (member_a < member_b)
);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_pair ON conversations(member_a, member_b);

CREATE TABLE IF NOT EXISTS messages (
  id              text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  text            text NOT NULL,
  sent_at         timestamptz NOT NULL,
  read_at         timestamptz
);
CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, sent_at);

CREATE TABLE IF NOT EXISTS companies (
  id         text PRIMARY KEY,
  handle     text NOT NULL UNIQUE,
  name       text NOT NULL,
  location   text NOT NULL DEFAULT '',
  about      text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS company_admins (
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  member_id  text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, member_id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id            text PRIMARY KEY,
  company_id    text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  poster_id     text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title         text NOT NULL,
  location      text NOT NULL,
  workplace     text NOT NULL,
  description   text NOT NULL,
  posted_at     timestamptz NOT NULL,
  closes_at     timestamptz NOT NULL,
  versions      jsonb NOT NULL DEFAULT '{"title":1,"location":1,"workplace":1,"closes_at":1,"description":1,"questions":1}',
  field_editors jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS jobs_company ON jobs(company_id, posted_at DESC);

CREATE TABLE IF NOT EXISTS job_questions (
  id        text PRIMARY KEY,
  job_id    text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  position  int NOT NULL,
  type      text NOT NULL,
  text      text NOT NULL,
  required  boolean NOT NULL DEFAULT false,
  knock_out boolean NOT NULL DEFAULT false,
  ideal     text,
  options   jsonb,
  accepted  jsonb,
  minimum   int,
  maximum   int
);
CREATE INDEX IF NOT EXISTS job_questions_job ON job_questions(job_id, position);

CREATE TABLE IF NOT EXISTS saved_jobs (
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  job_id    text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  saved_at  timestamptz NOT NULL,
  PRIMARY KEY (member_id, job_id)
);

CREATE TABLE IF NOT EXISTS applications (
  id           text PRIMARY KEY,
  job_id       text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  applicant_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  state        text NOT NULL,
  created_at   timestamptz NOT NULL,
  entered_at   timestamptz NOT NULL,
  resume_id    text,
  answers      jsonb NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS applications_job_applicant ON applications(job_id, applicant_id);

CREATE TABLE IF NOT EXISTS application_history (
  id             text PRIMARY KEY,
  application_id text NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  seq            int NOT NULL,
  state          text NOT NULL,
  at             timestamptz NOT NULL,
  by             text NOT NULL,
  reason         text
);
CREATE INDEX IF NOT EXISTS application_history_app ON application_history(application_id, seq);

CREATE TABLE IF NOT EXISTS notifications (
  id          text PRIMARY KEY,
  member_id   text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  subject_id  text,
  target_url  text NOT NULL,
  detail      text,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_member ON notifications(member_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS notification_actors (
  notification_id text NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  actor_id        text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  at              timestamptz NOT NULL,
  PRIMARY KEY (notification_id, actor_id)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  member_id    text NOT NULL,
  route        text NOT NULL,
  key          text NOT NULL,
  request_hash text NOT NULL,
  status       int NOT NULL,
  body         jsonb NOT NULL,
  created_at   timestamptz NOT NULL,
  PRIMARY KEY (member_id, route, key)
);

CREATE TABLE IF NOT EXISTS mail_queue (
  id         text PRIMARY KEY,
  to_addr    text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL,
  sent_at    timestamptz,
  attempts   int NOT NULL DEFAULT 0
);
