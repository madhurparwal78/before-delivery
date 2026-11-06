// The whole Postgres schema. Applied on every start inside the start-up advisory lock, so copies that
// start together apply it once (brief: Deployment).

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  phone text,
  role text NOT NULL,
  brand_id uuid REFERENCES brands(id),
  company_id uuid REFERENCES companies(id),
  status text NOT NULL DEFAULT 'active',
  password_hash text,
  approval_limit_hkd bigint,
  approval_limit_sgd bigint,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS members_email ON members (lower(email));
ALTER TABLE members ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES members(id);
ALTER TABLE members ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL,
  phone text,
  brand_id uuid REFERENCES brands(id),
  company_id uuid REFERENCES companies(id),
  approval_limit_hkd bigint,
  approval_limit_sgd bigint,
  invited_by uuid NOT NULL REFERENCES members(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES members(id),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  member_id uuid NOT NULL REFERENCES members(id),
  key text NOT NULL,
  request_hash text NOT NULL,
  status integer NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, key)
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number integer NOT NULL UNIQUE,
  reference text NOT NULL UNIQUE,
  name text NOT NULL,
  brand_id uuid NOT NULL REFERENCES brands(id),
  region text NOT NULL,
  currency text NOT NULL,
  time_zone text NOT NULL,
  defects_period_months integer NOT NULL,
  practical_completion_on date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stores (
  project_id uuid NOT NULL REFERENCES projects(id),
  code text NOT NULL,
  name text NOT NULL,
  weight integer NOT NULL,
  position integer NOT NULL,
  PRIMARY KEY (project_id, code)
);

CREATE TABLE IF NOT EXISTS stages (
  project_id uuid NOT NULL REFERENCES projects(id),
  key text NOT NULL,
  position integer NOT NULL,
  fee_cents bigint,
  state text NOT NULL,
  requested_at timestamptz,
  requested_by uuid REFERENCES members(id),
  request_message text,
  signed_off_at timestamptz,
  signed_off_by uuid REFERENCES members(id),
  returned_reason text,
  internal_note text NOT NULL DEFAULT '',
  invoice jsonb,
  PRIMARY KEY (project_id, key)
);

CREATE TABLE IF NOT EXISTS contracts (
  project_id uuid PRIMARY KEY REFERENCES projects(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  contract_sum_cents bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  code text NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);

CREATE TABLE IF NOT EXISTS sheet_revisions (
  sheet_id uuid NOT NULL REFERENCES sheets(id),
  ordinal integer NOT NULL,
  revision text NOT NULL,
  state text NOT NULL,
  bytes bigint NOT NULL,
  sha256 text NOT NULL,
  content_type text NOT NULL,
  extension text NOT NULL,
  original_name text NOT NULL,
  note text NOT NULL DEFAULT '',
  uploaded_by uuid NOT NULL REFERENCES members(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sheet_id, revision),
  UNIQUE (sheet_id, ordinal)
);

CREATE TABLE IF NOT EXISTS transmittals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  sequence integer NOT NULL,
  number text NOT NULL,
  purpose text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid NOT NULL REFERENCES members(id),
  sheets jsonb NOT NULL,
  zip_bytes bigint NOT NULL,
  zip_sha256 text NOT NULL,
  UNIQUE (project_id, sequence)
);

CREATE TABLE IF NOT EXISTS tenders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  title text NOT NULL,
  scope text NOT NULL,
  closes_at timestamptz,
  closes_at_local text,
  contingency_basis_points integer NOT NULL,
  status text NOT NULL,
  ics_sequence integer NOT NULL DEFAULT 0,
  awarded_bid_id uuid,
  award_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tender_bidders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id uuid NOT NULL REFERENCES tenders(id),
  position integer NOT NULL,
  reference text NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id),
  company_name text NOT NULL,
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  member_id uuid NOT NULL REFERENCES members(id),
  UNIQUE (tender_id, position)
);

CREATE TABLE IF NOT EXISTS tender_links (
  token_hash text PRIMARY KEY,
  tender_id uuid NOT NULL REFERENCES tenders(id),
  member_id uuid NOT NULL REFERENCES members(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id uuid NOT NULL REFERENCES tenders(id),
  bidder_id uuid NOT NULL UNIQUE REFERENCES tender_bidders(id),
  base_cents bigint NOT NULL,
  provisional_sums jsonb NOT NULL,
  exclusions jsonb NOT NULL,
  allowances jsonb NOT NULL DEFAULT '[]',
  final_submitted_at timestamptz NOT NULL,
  amendments integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS variations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  sequence integer NOT NULL,
  number text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  amount_cents bigint NOT NULL,
  currency text NOT NULL,
  store_code text,
  state text NOT NULL,
  reject_reason text,
  raised_by uuid NOT NULL REFERENCES members(id),
  raised_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  updated_by uuid NOT NULL REFERENCES members(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, sequence)
);

CREATE TABLE IF NOT EXISTS variation_events (
  id bigserial PRIMARY KEY,
  variation_id uuid NOT NULL REFERENCES variations(id),
  action text NOT NULL,
  state text NOT NULL,
  by_member uuid NOT NULL REFERENCES members(id),
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS variation_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variation_id uuid NOT NULL REFERENCES variations(id),
  body text NOT NULL,
  author_id uuid NOT NULL REFERENCES members(id),
  posted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  number text NOT NULL,
  kind text NOT NULL,
  period_ending date,
  gross_valuation_cents bigint,
  valuation_this_period_cents bigint,
  retention_this_period_cents bigint,
  retention_held_cents bigint NOT NULL,
  amount_due_cents bigint NOT NULL,
  currency text NOT NULL,
  store_split jsonb NOT NULL,
  issued_by uuid NOT NULL REFERENCES members(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);

CREATE TABLE IF NOT EXISTS retention_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  movement_id uuid NOT NULL,
  certificate_id uuid NOT NULL REFERENCES certificates(id),
  kind text NOT NULL,
  account text NOT NULL,
  side text NOT NULL,
  amount_cents bigint NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shop_drawings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  reference text NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shop_drawing_submissions (
  shop_drawing_id uuid NOT NULL REFERENCES shop_drawings(id),
  submission integer NOT NULL,
  received_at timestamptz NOT NULL,
  review_due_on date NOT NULL,
  extension text NOT NULL,
  content_type text NOT NULL,
  bytes bigint NOT NULL,
  original_name text NOT NULL,
  submitted_by uuid NOT NULL REFERENCES members(id),
  review_code integer,
  review_comments text,
  reviewed_by uuid REFERENCES members(id),
  reviewed_at timestamptz,
  PRIMARY KEY (shop_drawing_id, submission)
);

CREATE TABLE IF NOT EXISTS viewpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  store_code text NOT NULL,
  render_extension text,
  render_content_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewpoint_id uuid NOT NULL REFERENCES viewpoints(id),
  width integer NOT NULL,
  height integer NOT NULL,
  extension text NOT NULL,
  content_type text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS snags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewpoint_id uuid NOT NULL REFERENCES viewpoints(id),
  number integer NOT NULL,
  s integer NOT NULL,
  y integer NOT NULL,
  title text NOT NULL,
  note text NOT NULL DEFAULT '',
  observed_on date NOT NULL,
  state text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (viewpoint_id, number)
);

CREATE TABLE IF NOT EXISTS finishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  position integer NOT NULL,
  code text,
  name text NOT NULL,
  category text NOT NULL,
  supplier text NOT NULL DEFAULT '',
  product_ref text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS case_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  sector text NOT NULL,
  brand_id uuid NOT NULL REFERENCES brands(id),
  location text NOT NULL,
  summary text NOT NULL,
  body text NOT NULL,
  featured boolean NOT NULL,
  featured_order integer,
  state text NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS preview_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_study_id uuid NOT NULL REFERENCES case_studies(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number integer NOT NULL UNIQUE,
  reference text NOT NULL,
  name text NOT NULL,
  company text NOT NULL,
  email text NOT NULL,
  email_key text NOT NULL,
  phone text NOT NULL DEFAULT '',
  sector text NOT NULL,
  region text NOT NULL,
  sites integer NOT NULL,
  opening_month text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS enquiries_email_key ON enquiries (email_key, created_at);

CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  reply_to text,
  attachments jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (next_attempt_at) WHERE sent_at IS NULL;
`;
