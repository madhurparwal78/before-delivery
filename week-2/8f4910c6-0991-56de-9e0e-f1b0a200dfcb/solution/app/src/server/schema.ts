// The PostgreSQL schema, applied at start-up under an advisory lock (safe when copies start together).

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS offices (
  id text PRIMARY KEY,
  city text NOT NULL,
  time_zone text NOT NULL
);
CREATE TABLE IF NOT EXISTS office_closures (
  office_id text NOT NULL REFERENCES offices(id),
  day date NOT NULL,
  PRIMARY KEY (office_id, day)
);
CREATE TABLE IF NOT EXISTS talent (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  state text NOT NULL,
  office_id text NOT NULL REFERENCES offices(id),
  board text NOT NULL,
  date_of_birth date,
  email text,
  phone text,
  home_address text,
  guardian_name text,
  guardian_email text,
  guardian_phone text,
  height_cm integer,
  chest_cm integer,
  waist_cm integer,
  hips_cm integer,
  instagram bigint,
  tiktok bigint,
  youtube bigint,
  office_note text,
  version integer NOT NULL DEFAULT 1,
  saved_by text,
  saved_at timestamptz,
  portfolio_version integer NOT NULL DEFAULT 1,
  portfolio_saved_by text,
  portfolio_saved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS talent_board ON talent (board, state);
CREATE TABLE IF NOT EXISTS photos (
  id text PRIMARY KEY,
  talent_id text NOT NULL REFERENCES talent(id) ON DELETE CASCADE,
  position integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_talent ON photos (talent_id, position);
CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  office_id text NOT NULL REFERENCES offices(id),
  talent_id text REFERENCES talent(id),
  password_hash text NOT NULL,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS members_email ON members (lower(email)) WHERE removed_at IS NULL;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS account_links (
  token_hash text PRIMARY KEY,
  kind text NOT NULL,
  email text NOT NULL,
  name text,
  role text,
  office_id text,
  talent_id text,
  created_at timestamptz NOT NULL,
  used_at timestamptz,
  replaced_at timestamptz
);
CREATE TABLE IF NOT EXISTS clients (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  company text NOT NULL,
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  time_zone text NOT NULL,
  killbill_account_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rate_cards (
  id text PRIMARY KEY,
  name text NOT NULL,
  effective_from date NOT NULL UNIQUE,
  boards jsonb NOT NULL,
  usage_base jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS options (
  id text PRIMARY KEY,
  talent_id text NOT NULL REFERENCES talent(id),
  client_id text NOT NULL REFERENCES clients(id),
  job_date date NOT NULL,
  job_title text NOT NULL,
  note text NOT NULL DEFAULT '',
  rank integer,
  last_rank integer NOT NULL,
  state text NOT NULL,
  auto_release_at timestamptz NOT NULL,
  hold_until timestamptz,
  hold_until_local text,
  challenge_deadline timestamptz,
  placed_by_id text NOT NULL,
  placed_by_name text NOT NULL,
  placed_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason text,
  booking_id text,
  version integer NOT NULL DEFAULT 1,
  sequence integer NOT NULL DEFAULT 0,
  saved_by text NOT NULL,
  saved_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS options_day ON options (talent_id, job_date);
CREATE INDEX IF NOT EXISTS options_live ON options (state) WHERE state IN ('placed', 'challenged');
CREATE TABLE IF NOT EXISTS bookings (
  id text PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  state text NOT NULL,
  job_date date NOT NULL,
  office_id text NOT NULL,
  client_id text NOT NULL REFERENCES clients(id),
  job_title text NOT NULL,
  rate_card_id text NOT NULL REFERENCES rate_cards(id),
  talent_fees_cents bigint NOT NULL,
  service_fee_cents bigint NOT NULL,
  tax_cents bigint NOT NULL,
  total_cents bigint NOT NULL,
  killbill_invoice_id text NOT NULL,
  confirmed_by text NOT NULL,
  confirmed_at timestamptz NOT NULL,
  issued_by text,
  issued_at timestamptz
);
CREATE INDEX IF NOT EXISTS bookings_month ON bookings (office_id, job_date);
CREATE TABLE IF NOT EXISTS booking_talent (
  booking_id text NOT NULL REFERENCES bookings(id),
  position integer NOT NULL,
  talent_id text NOT NULL REFERENCES talent(id),
  option_id text NOT NULL,
  talent_fees_cents bigint NOT NULL,
  service_fee_share_cents bigint NOT NULL,
  PRIMARY KEY (booking_id, position)
);
CREATE TABLE IF NOT EXISTS booking_lines (
  booking_id text NOT NULL REFERENCES bookings(id),
  position integer NOT NULL,
  kind text NOT NULL,
  label text NOT NULL,
  talent_id text,
  amount_cents bigint NOT NULL,
  PRIMARY KEY (booking_id, position)
);
CREATE TABLE IF NOT EXISTS movements (
  id text PRIMARY KEY,
  kind text NOT NULL,
  reference text NOT NULL UNIQUE,
  talent_id text NOT NULL REFERENCES talent(id),
  booking_id text REFERENCES bookings(id),
  reversal_of text REFERENCES movements(id),
  reversed_by text,
  reversed_at timestamptz,
  note text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  office_date date NOT NULL
);
CREATE INDEX IF NOT EXISTS movements_talent ON movements (talent_id, office_date);
CREATE TABLE IF NOT EXISTS entries (
  movement_id text NOT NULL REFERENCES movements(id),
  position integer NOT NULL,
  account text NOT NULL,
  amount_cents bigint NOT NULL,
  PRIMARY KEY (movement_id, position)
);
CREATE INDEX IF NOT EXISTS entries_account ON entries (account);
CREATE TABLE IF NOT EXISTS licences (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES clients(id),
  talent_id text NOT NULL REFERENCES talent(id),
  media text NOT NULL,
  territory text NOT NULL,
  first_use_date date NOT NULL,
  term_months integer NOT NULL,
  monthly_fee_cents bigint NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS licence_extensions (
  id text PRIMARY KEY,
  licence_id text NOT NULL REFERENCES licences(id),
  months integer NOT NULL,
  amount_cents bigint NOT NULL,
  killbill_invoice_id text NOT NULL,
  extended_by text NOT NULL,
  extended_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS licence_reminders (
  licence_id text NOT NULL REFERENCES licences(id),
  ends_on date NOT NULL,
  PRIMARY KEY (licence_id, ends_on)
);
CREATE TABLE IF NOT EXISTS packages (
  id text PRIMARY KEY,
  title text NOT NULL,
  recipient_name text NOT NULL,
  recipient_email text NOT NULL,
  state text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS package_links (
  token text PRIMARY KEY,
  package_id text NOT NULL REFERENCES packages(id),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL
);
CREATE TABLE IF NOT EXISTS package_talent (
  package_id text NOT NULL REFERENCES packages(id),
  talent_id text NOT NULL REFERENCES talent(id),
  position integer NOT NULL,
  decision text NOT NULL DEFAULT 'undecided',
  PRIMARY KEY (package_id, talent_id)
);
CREATE TABLE IF NOT EXISTS applications (
  id text PRIMARY KEY,
  token_hash text NOT NULL,
  status text NOT NULL,
  office_id text NOT NULL REFERENCES offices(id),
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  date_of_birth date,
  height_cm integer,
  instagram bigint,
  bio text NOT NULL DEFAULT '',
  guardian_name text NOT NULL DEFAULT '',
  guardian_email text NOT NULL DEFAULT '',
  consented_at timestamptz,
  submitted_at timestamptz,
  decided_by text,
  decided_at timestamptz,
  talent_id text,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS application_photos (
  application_id text NOT NULL REFERENCES applications(id),
  slot text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  PRIMARY KEY (application_id, slot)
);
CREATE TABLE IF NOT EXISTS consent_links (
  token_hash text PRIMARY KEY,
  application_id text NOT NULL REFERENCES applications(id),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS cast_requests (
  id text PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  name text NOT NULL,
  company text NOT NULL,
  email text NOT NULL,
  office_id text NOT NULL,
  shoot_date date NOT NULL,
  brief text NOT NULL,
  talent_slugs text[] NOT NULL,
  received_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS feed_tokens (
  talent_id text PRIMARY KEY REFERENCES talent(id),
  token text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer,
  body text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE TABLE IF NOT EXISTS rate_hits (
  bucket text NOT NULL,
  address text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_hits_lookup ON rate_hits (bucket, address, at);
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  to_address text NOT NULL,
  subject text NOT NULL,
  text_body text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]',
  talent_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (next_attempt_at) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS counters (
  name text PRIMARY KEY,
  value bigint NOT NULL
);
`;
