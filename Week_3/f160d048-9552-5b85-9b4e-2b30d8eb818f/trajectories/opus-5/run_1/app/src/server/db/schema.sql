CREATE TABLE IF NOT EXISTS clock_offset (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  offset_seconds bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS companies (
  id            uuid PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL UNIQUE,
  city          text NOT NULL,
  size          text NOT NULL,
  verified      boolean NOT NULL DEFAULT false,
  email_domain  text NOT NULL,
  mark_file_id  uuid,
  created_at    timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY,
  display_name  text NOT NULL,
  email         text NOT NULL,
  email_lower   text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL,
  company_id    uuid REFERENCES companies (id),
  unlocked      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token         text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS email_tokens (
  token         text PRIMARY KEY,
  kind          text NOT NULL,
  user_id       uuid REFERENCES users (id) ON DELETE CASCADE,
  email         text,
  display_name  text,
  password_hash text,
  created_at    timestamptz NOT NULL,
  used_at       timestamptz
);

CREATE TABLE IF NOT EXISTS verification_codes (
  id            uuid PRIMARY KEY,
  company_id    uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  email         text NOT NULL,
  code          text NOT NULL,
  issued_at     timestamptz NOT NULL,
  superseded    boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS posts (
  id                uuid PRIMARY KEY,
  kind              text NOT NULL,
  company_id        uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  author_id         uuid REFERENCES users (id) ON DELETE SET NULL,
  state             text NOT NULL,
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  deleted_at        timestamptz,
  claimed_by        uuid REFERENCES users (id),
  claimed_at        timestamptz,
  lease_started_at  timestamptz,
  last_lapsed_by    uuid REFERENCES users (id),
  last_lapsed_at    timestamptz,
  decided_by        uuid REFERENCES users (id),
  decided_at        timestamptz,
  reason            text,
  overall           integer,
  work_life         integer,
  pay               integer,
  management        integer,
  title             text,
  pros              text,
  cons              text,
  role_family       text,
  city              text,
  annual_pay        integer,
  years_experience  integer,
  difficulty        integer,
  outcome           text,
  body_text         text
);

CREATE INDEX IF NOT EXISTS posts_company_state_idx ON posts (company_id, state) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS posts_author_idx ON posts (author_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS post_history (
  id            bigserial PRIMARY KEY,
  post_id       uuid NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  type          text NOT NULL,
  by_name       text,
  reason        text,
  at            timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS review_replies (
  review_id     uuid PRIMARY KEY REFERENCES posts (id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  body          text NOT NULL,
  created_at    timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id            uuid PRIMARY KEY,
  company_id    uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  title         text NOT NULL,
  role_family   text NOT NULL,
  city          text NOT NULL,
  remote        text NOT NULL,
  pay_low       integer NOT NULL,
  pay_high      integer NOT NULL,
  description   text NOT NULL,
  status        text NOT NULL,
  listed_at     timestamptz,
  created_at    timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_jobs (
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  job_id        uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  saved_at      timestamptz NOT NULL,
  PRIMARY KEY (user_id, job_id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  q               text NOT NULL DEFAULT '',
  cities          text[] NOT NULL DEFAULT '{}',
  role_families   text[] NOT NULL DEFAULT '{}',
  remotes         text[] NOT NULL DEFAULT '{}',
  bands           text[] NOT NULL DEFAULT '{}',
  new_count       integer NOT NULL DEFAULT 0,
  batch_opened_at timestamptz,
  created_at      timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_batch_jobs (
  alert_id      uuid NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
  job_id        uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  matched_at    timestamptz NOT NULL,
  PRIMARY KEY (alert_id, job_id)
);

CREATE TABLE IF NOT EXISTS stored_files (
  id            uuid PRIMARY KEY,
  kind          text NOT NULL,
  storage_key   text NOT NULL,
  content_type  text NOT NULL,
  byte_size     integer NOT NULL,
  company_id    uuid REFERENCES companies (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id              uuid PRIMARY KEY,
  job_id          uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  candidate_name  text NOT NULL,
  contact_email   text NOT NULL,
  phone           text NOT NULL DEFAULT '',
  cover_note      text NOT NULL DEFAULT '',
  stage           text NOT NULL,
  resume_file_id  uuid NOT NULL REFERENCES stored_files (id),
  applied_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  UNIQUE (job_id, user_id)
);

CREATE TABLE IF NOT EXISTS application_stages (
  id              bigserial PRIMARY KEY,
  application_id  uuid NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  stage           text NOT NULL,
  at              timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS apply_keys (
  key             text NOT NULL,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  job_id          uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  request_hash    text NOT NULL,
  response        jsonb NOT NULL,
  created_at      timestamptz NOT NULL,
  PRIMARY KEY (key, user_id)
);

CREATE TABLE IF NOT EXISTS upload_events (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  at            timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id            uuid PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_posts (
  id            uuid PRIMARY KEY,
  channel_id    uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  author_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  body          text NOT NULL,
  created_at    timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id              uuid PRIMARY KEY,
  to_email        text NOT NULL,
  subject         text NOT NULL,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  claimed_at      timestamptz,
  sent_at         timestamptz,
  attempts        integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox (next_attempt_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS search_sync (
  id              bigserial PRIMARY KEY,
  target          text NOT NULL,
  target_id       uuid NOT NULL,
  operation       text NOT NULL,
  created_at      timestamptz NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  done_at         timestamptz
);

CREATE INDEX IF NOT EXISTS search_sync_pending_idx ON search_sync (next_attempt_at) WHERE done_at IS NULL;

CREATE TABLE IF NOT EXISTS live_events (
  id            bigserial PRIMARY KEY,
  type          text NOT NULL,
  payload       jsonb NOT NULL,
  audience      jsonb NOT NULL,
  created_at    timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id            bigserial PRIMARY KEY,
  action        text NOT NULL,
  actor_id      uuid,
  subject_id    uuid,
  detail        jsonb NOT NULL,
  at            timestamptz NOT NULL
);
