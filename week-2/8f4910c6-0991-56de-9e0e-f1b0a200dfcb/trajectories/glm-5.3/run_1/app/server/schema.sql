-- Rungboard schema, applied once at start-up.
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  office TEXT NOT NULL,
  talent_id TEXT,
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS talent (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  display_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  office TEXT NOT NULL,
  board TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  home_address TEXT,
  date_of_birth DATE,
  guardian_name TEXT,
  guardian_email TEXT,
  guardian_phone TEXT,
  height_cm INT,
  chest_cm INT,
  waist_cm INT,
  hips_cm INT,
  instagram INT NOT NULL DEFAULT 0,
  tiktok INT NOT NULL DEFAULT 0,
  youtube INT NOT NULL DEFAULT 0,
  office_note TEXT,
  feed_token TEXT,
  feed_sequence INT NOT NULL DEFAULT 0,
  portfolio_version INT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1,
  last_saved_by TEXT,
  last_saved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS talent_slug_live_idx ON talent (lower(slug)) WHERE state <> 'erased';

CREATE TABLE IF NOT EXISTS talent_links (
  talent_id TEXT PRIMARY KEY REFERENCES talent(id) ON DELETE CASCADE,
  member_id TEXT UNIQUE REFERENCES members(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES talent(id) ON DELETE CASCADE,
  position INT NOT NULL,
  width INT NOT NULL,
  height INT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS photos_talent_position_idx ON photos (talent_id, position);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  company TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  time_zone TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_cards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  effective_from DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_card_boards (
  rate_card_id TEXT NOT NULL REFERENCES rate_cards(id) ON DELETE CASCADE,
  board TEXT NOT NULL,
  full_day_cents INT NOT NULL,
  half_day_cents INT NOT NULL,
  overtime_qh_cents INT NOT NULL,
  PRIMARY KEY (rate_card_id, board)
);

CREATE TABLE IF NOT EXISTS rate_card_usage (
  rate_card_id TEXT NOT NULL REFERENCES rate_cards(id) ON DELETE CASCADE,
  media TEXT NOT NULL,
  base_cents INT NOT NULL,
  PRIMARY KEY (rate_card_id, media)
);

CREATE TABLE IF NOT EXISTS office_closures (
  office TEXT NOT NULL,
  date DATE NOT NULL,
  PRIMARY KEY (office, date)
);

CREATE TABLE IF NOT EXISTS options (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES talent(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id),
  date DATE NOT NULL,
  job_title TEXT NOT NULL DEFAULT '',
  note TEXT,
  rank INT,
  state TEXT NOT NULL DEFAULT 'placed',
  auto_release_at TIMESTAMPTZ,
  hold_until TIMESTAMPTZ,
  release_at TIMESTAMPTZ,
  challenge_deadline TIMESTAMPTZ,
  placed_by TEXT NOT NULL REFERENCES members(id),
  placed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  release_reason TEXT,
  booked_booking_id TEXT,
  version INT NOT NULL DEFAULT 1,
  last_saved_by TEXT,
  last_saved_at TIMESTAMPTZ,
  sequence INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS options_day_idx ON options (talent_id, date);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'confirmed',
  date DATE NOT NULL,
  office TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  job_title TEXT NOT NULL DEFAULT '',
  rate_card_id TEXT NOT NULL REFERENCES rate_cards(id),
  talent_fees_cents INT NOT NULL,
  service_fee_cents INT NOT NULL,
  tax_cents INT NOT NULL,
  total_cents INT NOT NULL,
  killbill_invoice_id TEXT,
  killbill_invoice_number BIGINT,
  confirmed_by TEXT NOT NULL REFERENCES members(id),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_by TEXT REFERENCES members(id),
  issued_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS booking_talent (
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  talent_id TEXT NOT NULL REFERENCES talent(id) ON DELETE CASCADE,
  talent_fees_cents INT NOT NULL,
  service_fee_share_cents INT NOT NULL,
  PRIMARY KEY (booking_id, talent_id)
);

CREATE TABLE IF NOT EXISTS booking_lines (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  talent_id TEXT,
  amount_cents INT NOT NULL,
  position INT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_movements (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  reference TEXT NOT NULL,
  talent_id TEXT REFERENCES talent(id) ON DELETE CASCADE,
  booking_id TEXT REFERENCES bookings(id) ON DELETE SET NULL,
  reversal_of TEXT REFERENCES ledger_movements(id),
  reversed_by_movement TEXT,
  reversed_by_name TEXT,
  reversed_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  office_date DATE NOT NULL,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  movement_id TEXT NOT NULL REFERENCES ledger_movements(id) ON DELETE CASCADE,
  account TEXT NOT NULL,
  amount_cents INT NOT NULL
);

CREATE INDEX IF NOT EXISTS ledger_entries_account_idx ON ledger_entries (account);

CREATE TABLE IF NOT EXISTS licences (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  talent_id TEXT NOT NULL REFERENCES talent(id) ON DELETE CASCADE,
  media TEXT NOT NULL,
  territory TEXT NOT NULL,
  first_use_date DATE NOT NULL,
  term_months INT NOT NULL,
  ends_on DATE NOT NULL,
  monthly_fee_cents INT NOT NULL,
  reminder_sent_date DATE,
  version INT NOT NULL DEFAULT 1,
  last_extension_by TEXT,
  last_extension_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS licence_extensions (
  id TEXT PRIMARY KEY,
  licence_id TEXT NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  months INT NOT NULL,
  amount_cents INT NOT NULL,
  killbill_invoice_id TEXT,
  extended_by TEXT NOT NULL,
  extended_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  token TEXT NOT NULL,
  replaced_tokens TEXT[] NOT NULL DEFAULT '{}',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by TEXT NOT NULL REFERENCES members(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS packages_token_idx ON packages (token);

CREATE TABLE IF NOT EXISTS package_talent (
  package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  talent_id TEXT NOT NULL REFERENCES talent(id) ON DELETE CASCADE,
  position INT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'undecided',
  PRIMARY KEY (package_id, talent_id)
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  office TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  date_of_birth DATE,
  height_cm INT,
  instagram_followers INT,
  bio TEXT,
  guardian_name TEXT,
  guardian_email TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  minor BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at TIMESTAMPTZ,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision TEXT,
  signed_talent_id TEXT,
  consent_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS applications_token_idx ON applications (token);

CREATE TABLE IF NOT EXISTS application_photos (
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  width INT NOT NULL,
  height INT NOT NULL,
  PRIMARY KEY (application_id, slot)
);

CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  decision TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS consents_token_idx ON consents (token);

CREATE TABLE IF NOT EXISTS cast_requests (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  email TEXT NOT NULL,
  office TEXT NOT NULL,
  shoot_date DATE,
  brief TEXT,
  talent_ids TEXT[] NOT NULL DEFAULT '{}',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invitations (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  office TEXT NOT NULL,
  talent_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS invitations_email_idx ON invitations (email);

CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  member_id TEXT NOT NULL,
  key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status INT NOT NULL,
  response_body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, key)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits INT NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id TEXT PRIMARY KEY,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text/plain',
  attachment_name TEXT,
  attachment_content TEXT,
  sent_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seed_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT NOT NULL,
  value INT NOT NULL,
  PRIMARY KEY (name)
);

CREATE TABLE IF NOT EXISTS job_state (
  key TEXT PRIMARY KEY,
  value TIMESTAMPTZ NOT NULL
);
