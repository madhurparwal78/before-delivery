import type { Pool } from "pg";

// The schema is applied idempotently on every start.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES people(id),
  title TEXT NOT NULL,
  story TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  goal INTEGER NOT NULL,
  min_run_copies INTEGER NOT NULL,
  ships_from TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  deadline_local TEXT NOT NULL,
  deadline_utc TIMESTAMPTZ NOT NULL,
  launched_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stretch_breaks (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  copies INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, position)
);

CREATE TABLE IF NOT EXISTS tiers (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL,
  quantity INTEGER,
  shipping_domestic INTEGER NOT NULL,
  shipping_europe INTEGER NOT NULL,
  shipping_rest_of_world INTEGER NOT NULL,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  filename TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pledges (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  tier_id TEXT NOT NULL REFERENCES tiers(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  country TEXT NOT NULL,
  zone TEXT NOT NULL,
  reward INTEGER NOT NULL,
  shipping INTEGER NOT NULL,
  add_on INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  state TEXT NOT NULL,
  card_last4 TEXT NOT NULL,
  card_behaviour TEXT NOT NULL,
  replaces TEXT,
  kb_payment_id TEXT NOT NULL,
  kb_payment_method_id TEXT NOT NULL,
  kb_fix_payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  captured_at TIMESTAMPTZ,
  errored_at TIMESTAMPTZ,
  fix_deadline TIMESTAMPTZ,
  fix_count INTEGER NOT NULL DEFAULT 0,
  card_fixed BOOLEAN NOT NULL DEFAULT FALSE,
  last_capture_attempt TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pledges_campaign_idx ON pledges (campaign_id);
CREATE INDEX IF NOT EXISTS pledges_person_idx ON pledges (person_id);

CREATE TABLE IF NOT EXISTS pledge_history (
  pledge_id TEXT NOT NULL REFERENCES pledges(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS fix_codes (
  code TEXT PRIMARY KEY,
  pledge_id TEXT NOT NULL REFERENCES pledges(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency (
  person_key TEXT NOT NULL,
  route TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER,
  response_body TEXT,
  in_progress BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (person_key, route, idem_key)
);

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  pledge_id TEXT,
  kind TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  dedupe_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS statements (
  pledge_id TEXT PRIMARY KEY REFERENCES pledges(id),
  status TEXT NOT NULL,
  object_key TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settlements (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id),
  status TEXT NOT NULL,
  object_key TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seed_marker (
  id INTEGER PRIMARY KEY DEFAULT 1,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA);
}
