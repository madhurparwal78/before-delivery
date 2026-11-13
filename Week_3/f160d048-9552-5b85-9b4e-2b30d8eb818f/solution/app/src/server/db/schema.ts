import { pool } from "./pool";

const SCHEMA_LOCK = 7351001;

const DDL = `
CREATE TABLE IF NOT EXISTS clock (id int PRIMARY KEY CHECK (id = 1), offset_seconds bigint NOT NULL DEFAULT 0);
INSERT INTO clock (id, offset_seconds) VALUES (1, 0) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION app_now() RETURNS timestamptz LANGUAGE sql STABLE AS
  $$ SELECT now() + make_interval(secs => offset_seconds::double precision) FROM clock WHERE id = 1 $$;

CREATE TABLE IF NOT EXISTS files (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  object_key text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  city text NOT NULL,
  size text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  email_domain text NOT NULL,
  mark_file_id text REFERENCES files (id),
  created_at timestamptz NOT NULL DEFAULT app_now()
);
CREATE UNIQUE INDEX IF NOT EXISTS companies_name_key ON companies (lower(name));

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  role text NOT NULL,
  display_name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  company_id text REFERENCES companies (id),
  unlocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT app_now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash text PRIMARY KEY,
  kind text NOT NULL,
  user_id text REFERENCES users (id) ON DELETE CASCADE,
  pending_name text,
  pending_email text,
  pending_password_hash text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS verification_codes (
  company_id text PRIMARY KEY REFERENCES companies (id),
  code_hash text NOT NULL,
  issued_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS verification_requests (
  id bigserial PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies (id),
  requested_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS verification_requests_company ON verification_requests (company_id, requested_at);

CREATE TABLE IF NOT EXISTS posts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  kind text NOT NULL,
  company_id text NOT NULL REFERENCES companies (id),
  author_id text REFERENCES users (id),
  state text NOT NULL,
  title text, overall integer, work_life integer, pay integer, management integer, pros text, cons text,
  role_family text, city text, annual_pay integer, years_experience integer,
  difficulty integer, outcome text, text text,
  created_at timestamptz NOT NULL,
  deleted_at timestamptz,
  claimed_by text REFERENCES users (id),
  claimed_at timestamptz,
  lapsed_by text REFERENCES users (id),
  decided_by text REFERENCES users (id),
  decided_at timestamptz,
  reason text
);
CREATE INDEX IF NOT EXISTS posts_company_state ON posts (company_id, state) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS posts_queue ON posts (created_at) WHERE deleted_at IS NULL AND state IN ('pending', 'claimed');
CREATE INDEX IF NOT EXISTS posts_author ON posts (author_id);

CREATE TABLE IF NOT EXISTS post_history (
  id bigserial PRIMARY KEY,
  post_id text NOT NULL REFERENCES posts (id),
  type text NOT NULL,
  by_user_id text REFERENCES users (id),
  by_name text,
  reason text,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS post_history_post ON post_history (post_id, id);

CREATE TABLE IF NOT EXISTS replies (
  review_id text PRIMARY KEY REFERENCES posts (id),
  company_id text NOT NULL REFERENCES companies (id),
  body text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_id text NOT NULL REFERENCES companies (id),
  title text NOT NULL,
  role_family text NOT NULL,
  city text NOT NULL,
  remote text NOT NULL,
  pay_low integer NOT NULL,
  pay_high integer NOT NULL,
  description text NOT NULL,
  status text NOT NULL,
  listed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT app_now()
);
CREATE INDEX IF NOT EXISTS jobs_company ON jobs (company_id, status);

CREATE TABLE IF NOT EXISTS saved_jobs (
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, job_id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  q text NOT NULL,
  city text[] NOT NULL,
  role text[] NOT NULL,
  remote text[] NOT NULL,
  band text[] NOT NULL,
  label text NOT NULL,
  new_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT app_now()
);
CREATE TABLE IF NOT EXISTS alert_batches (
  id bigserial PRIMARY KEY,
  alert_id text NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL,
  sent_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS alert_batches_one_open ON alert_batches (alert_id) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS alert_batch_jobs (
  batch_id bigint NOT NULL REFERENCES alert_batches (id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  PRIMARY KEY (batch_id, job_id)
);

CREATE TABLE IF NOT EXISTS applications (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  job_id text NOT NULL REFERENCES jobs (id),
  user_id text NOT NULL REFERENCES users (id),
  candidate_name text NOT NULL,
  contact_email text NOT NULL,
  phone text NOT NULL,
  cover_note text NOT NULL,
  stage text NOT NULL,
  applied_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  resume_file_id text NOT NULL REFERENCES files (id),
  UNIQUE (job_id, user_id)
);
CREATE INDEX IF NOT EXISTS applications_user ON applications (user_id);

CREATE TABLE IF NOT EXISTS apply_keys (
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key text NOT NULL,
  fingerprint text NOT NULL,
  response json NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS channels (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slug text NOT NULL UNIQUE,
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS channel_posts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  channel_id text NOT NULL REFERENCES channels (id),
  author_id text REFERENCES users (id),
  body text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS channel_posts_channel ON channel_posts (channel_id, created_at, id);

CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox (next_attempt_at) WHERE sent_at IS NULL;

CREATE SEQUENCE IF NOT EXISTS search_sync_seq;
CREATE TABLE IF NOT EXISTS search_sync (
  index_name text NOT NULL,
  doc_id text NOT NULL,
  seq bigint NOT NULL DEFAULT nextval('search_sync_seq'),
  next_attempt_at timestamptz NOT NULL,
  PRIMARY KEY (index_name, doc_id)
);

CREATE TABLE IF NOT EXISTS rate_events (
  bucket text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_events_bucket ON rate_events (bucket, at);

CREATE TABLE IF NOT EXISTS audit (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL,
  actor_id text,
  action text NOT NULL,
  subject_id text NOT NULL,
  detail json NOT NULL
);

CREATE TABLE IF NOT EXISTS live_counter (id int PRIMARY KEY CHECK (id = 1), last bigint NOT NULL);
INSERT INTO live_counter (id, last) VALUES (1, 0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS live_events (
  id bigint PRIMARY KEY,
  type text NOT NULL,
  audience text[] NOT NULL,
  exclude_user text,
  data json NOT NULL
);
`;

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
    await client.query(DDL);
    await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]);
  } finally {
    client.release();
  }
}
