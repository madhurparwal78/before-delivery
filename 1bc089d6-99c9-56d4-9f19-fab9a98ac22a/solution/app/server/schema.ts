export const SCHEMA = `
CREATE TABLE IF NOT EXISTS visitors (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY,
  visitor_id uuid NOT NULL UNIQUE REFERENCES visitors (id) ON DELETE CASCADE,
  bedtime text NOT NULL,
  time_zone text NOT NULL,
  rituals jsonb NOT NULL,
  note text NOT NULL,
  reminders text NOT NULL CHECK (reminders IN ('on', 'paused')),
  active_since timestamptz NOT NULL,
  version integer NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  bedtime text NOT NULL,
  time_zone text NOT NULL,
  rituals jsonb NOT NULL,
  note text NOT NULL
);
CREATE INDEX IF NOT EXISTS drafts_email ON drafts (email);
CREATE TABLE IF NOT EXISTS links (
  token_hash text PRIMARY KEY,
  email text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('confirm', 'sign_in')),
  draft_id uuid REFERENCES drafts (id) ON DELETE SET NULL,
  sent_at timestamptz,
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS links_email ON links (email);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  visitor_id uuid NOT NULL REFERENCES visitors (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS share_links (
  token text PRIMARY KEY,
  plan_id uuid NOT NULL UNIQUE REFERENCES plans (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS reminders (
  plan_id uuid NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  night date NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'skipped')),
  PRIMARY KEY (plan_id, night)
);
CREATE TABLE IF NOT EXISTS outbox (
  id uuid PRIMARY KEY,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  link_hash text,
  created_at timestamptz NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_recipient ON outbox (recipient);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (next_attempt_at) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS idempotency (
  key text PRIMARY KEY,
  request_hash text NOT NULL,
  status integer NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_events (
  bucket text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_events_bucket ON rate_events (bucket, at);
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);
`;
