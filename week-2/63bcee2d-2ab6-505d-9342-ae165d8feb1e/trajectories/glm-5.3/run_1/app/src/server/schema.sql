-- Plumbline schema. Applied idempotently on every serve.

CREATE TABLE IF NOT EXISTS brands (
  id          uuid PRIMARY KEY,
  name        text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS companies (
  id          uuid PRIMARY KEY,
  name        text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS members (
  id              uuid PRIMARY KEY,
  email           text NOT NULL UNIQUE,
  name            text NOT NULL,
  role            text NOT NULL CHECK (role IN ('director','project_lead','designer','finance','client_approver','contractor')),
  phone           text,
  password_hash    text,
  brand_id         uuid REFERENCES brands(id),
  company_id       uuid REFERENCES companies(id),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  approval_hkd     bigint,   -- whole cents, project leads only
  approval_sgd     bigint,
  version         integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token        text PRIMARY KEY,
  member_id    uuid NOT NULL REFERENCES members(id),
  last_used    timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invitations (
  token        text PRIMARY KEY,
  email        text NOT NULL,
  name         text NOT NULL,
  role         text NOT NULL,
  phone        text,
  brand_id     uuid REFERENCES brands(id),
  company_name text,
  approval_hkd bigint,
  approval_sgd bigint,
  invited_by   uuid REFERENCES members(id),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id                uuid PRIMARY KEY,
  reference         text NOT NULL UNIQUE,
  name              text NOT NULL,
  brand_id          uuid NOT NULL REFERENCES brands(id),
  region            text NOT NULL CHECK (region IN ('HK','SG','MO')),
  currency          text NOT NULL CHECK (currency IN ('HKD','SGD')),
  ref_seq           integer NOT NULL UNIQUE,
  defects_period_months integer NOT NULL DEFAULT 12,
  practical_completion_on date,
  defects_end_on    date,
  contract_company  uuid REFERENCES companies(id),
  contract_sum_cents bigint,
  contract_awarded_at timestamptz,
  kb_account_id  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stores (
  id          uuid PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES projects(id),
  code        text NOT NULL,
  name        text NOT NULL,
  weight      integer NOT NULL,
  UNIQUE (project_id, code)
);

CREATE TABLE IF NOT EXISTS stages (
  project_id      uuid NOT NULL REFERENCES projects(id),
  key             text NOT NULL CHECK (key IN ('groundwork','scheme','detailing','tender_award','build','handover','aftercare')),
  position        integer NOT NULL,
  fee_cents       bigint,
  state           text NOT NULL DEFAULT 'not_started' CHECK (state IN ('not_started','requested','signed_off','returned')),
  requested_at    timestamptz,
  requested_by    uuid REFERENCES members(id),
  requested_message text,
  signed_off_at   timestamptz,
  signed_off_by   uuid REFERENCES members(id),
  returned_reason text,
  internal_note   text,
  killbill_invoice_id text,
  invoice_number  text,
  invoice_amount_cents bigint,
  PRIMARY KEY (project_id, key)
);

CREATE TABLE IF NOT EXISTS sheets (
  id          uuid PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES projects(id),
  code        text NOT NULL,
  title       text NOT NULL,
  UNIQUE (project_id, code)
);

CREATE TABLE IF NOT EXISTS sheet_revisions (
  id           uuid PRIMARY KEY,
  sheet_id     uuid NOT NULL REFERENCES sheets(id),
  revision     text NOT NULL,
  position     integer NOT NULL,
  state        text NOT NULL DEFAULT 'current' CHECK (state IN ('current','superseded')),
  bytes        integer NOT NULL,
  sha256       text NOT NULL,
  content_type text NOT NULL,
  original_name text NOT NULL,
  note         text,
  uploaded_by  uuid REFERENCES members(id),
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sheet_id, revision)
);

CREATE TABLE IF NOT EXISTS transmittals (
  id          uuid PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES projects(id),
  number      text NOT NULL,
  seq          integer NOT NULL,
  purpose      text NOT NULL CHECK (purpose IN ('for_construction','for_tender','for_information')),
  issued_at    timestamptz NOT NULL DEFAULT now(),
  issued_by    uuid REFERENCES members(id),
  zip_bytes    integer NOT NULL,
  zip_sha256   text NOT NULL,
  UNIQUE (project_id, number)
);

CREATE TABLE IF NOT EXISTS transmittal_sheets (
  transmittal_id uuid NOT NULL REFERENCES transmittals(id),
  sheet_id       uuid NOT NULL REFERENCES sheets(id),
  revision       text NOT NULL,
  PRIMARY KEY (transmittal_id, sheet_id)
);

CREATE TABLE IF NOT EXISTS tenders (
  id             uuid PRIMARY KEY,
  project_id     uuid NOT NULL REFERENCES projects(id),
  title          text NOT NULL,
  scope          text NOT NULL,
  closes_at      timestamptz,
  closes_at_local text,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','opened','awarded')),
  contingency_percent numeric(5,2) NOT NULL DEFAULT 0,
  ics_sequence   integer NOT NULL DEFAULT 0,
  awarded_bid_id uuid,
  award_reason   text,
  created_by     uuid REFERENCES members(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bidders (
  id            uuid PRIMARY KEY,
  tender_id     uuid NOT NULL REFERENCES tenders(id),
  reference     text NOT NULL,
  company_name  text NOT NULL,
  contact_name  text NOT NULL,
  contact_email text NOT NULL,
  member_id     uuid REFERENCES members(id),
  position      integer NOT NULL,
  UNIQUE (tender_id, reference)
);

CREATE TABLE IF NOT EXISTS tender_links (
  token       text PRIMARY KEY,
  tender_id   uuid NOT NULL REFERENCES tenders(id),
  bidder_id   uuid NOT NULL REFERENCES bidders(id),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bids (
  id                  uuid PRIMARY KEY,
  tender_id           uuid NOT NULL REFERENCES tenders(id),
  bidder_id           uuid NOT NULL REFERENCES bidders(id),
  base_cents          bigint NOT NULL,
  provisional_sums    jsonb NOT NULL DEFAULT '[]',  -- [{label, amountCents}]
  submitted_at        timestamptz NOT NULL,
  UNIQUE (tender_id, bidder_id)
);

CREATE TABLE IF NOT EXISTS bid_exclusions (
  id           uuid PRIMARY KEY,
  bid_id       uuid NOT NULL REFERENCES bids(id),
  label        text NOT NULL,
  price_cents  bigint,  -- null = unpriced
  position     integer NOT NULL
);

CREATE TABLE IF NOT EXISTS bid_allowances (
  id           uuid PRIMARY KEY,
  bid_id       uuid NOT NULL REFERENCES bids(id),
  label        text NOT NULL,
  amount_cents bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS variations (
  id          uuid PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES projects(id),
  number      text NOT NULL,
  seq         integer NOT NULL,
  title       text NOT NULL,
  description text NOT NULL,
  amount_cents bigint NOT NULL,
  store_code  text,
  state       text NOT NULL DEFAULT 'raised' CHECK (state IN ('raised','under_review','approved','rejected','withdrawn')),
  raised_by   uuid NOT NULL REFERENCES members(id),
  raised_at   timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  updated_by  uuid NOT NULL REFERENCES members(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  transitioned_at timestamptz,
  UNIQUE (project_id, number)
);

CREATE TABLE IF NOT EXISTS variation_comments (
  id            uuid PRIMARY KEY,
  variation_id  uuid NOT NULL REFERENCES variations(id),
  author_id     uuid NOT NULL REFERENCES members(id),
  body          text NOT NULL,
  posted_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS certificates (
  id                uuid PRIMARY KEY,
  project_id        uuid NOT NULL REFERENCES projects(id),
  number            text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('interim','retention_release_half','retention_release_final')),
  period_ending     date,
  gross_valuation_cents bigint,
  valuation_this_period_cents bigint NOT NULL,
  retention_this_period_cents bigint NOT NULL,
  retention_held_cents bigint NOT NULL,
  amount_due_cents  bigint NOT NULL,
  issued_by         uuid NOT NULL REFERENCES members(id),
  issued_at         timestamptz NOT NULL DEFAULT now(),
  store_split       jsonb NOT NULL DEFAULT '[]',  -- [{storeCode,storeName,weight,amountCents}]
  UNIQUE (project_id, number)
);

CREATE TABLE IF NOT EXISTS retention_movements (
  id            uuid PRIMARY KEY,
  project_id    uuid NOT NULL REFERENCES projects(id),
  certificate_id uuid NOT NULL REFERENCES certificates(id),
  kind          text NOT NULL CHECK (kind IN ('hold','release_half','release_final')),
  amount_cents  bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS retention_entries (
  id            uuid PRIMARY KEY,
  movement_id   uuid NOT NULL REFERENCES retention_movements(id),
  account       text NOT NULL CHECK (account IN ('contractor_payable','retention_held')),
  side          text NOT NULL CHECK (side IN ('debit','credit')),
  amount_cents  bigint NOT NULL,
  posted_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shop_drawings (
  id          uuid PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES projects(id),
  reference   text NOT NULL,
  title       text NOT NULL,
  UNIQUE (project_id, reference)
);

CREATE TABLE IF NOT EXISTS shop_submissions (
  id              uuid PRIMARY KEY,
  shop_drawing_id uuid NOT NULL REFERENCES shop_drawings(id),
  submission      integer NOT NULL,
  status          text NOT NULL DEFAULT 'received' CHECK (status IN ('received','returned')),
  received_at     timestamptz NOT NULL,
  review_due_on   date NOT NULL,
  file_bytes      integer NOT NULL,
  sha256          text NOT NULL,
  content_type    text NOT NULL,
  file_name       text NOT NULL,
  UNIQUE (shop_drawing_id, submission)
);

CREATE TABLE IF NOT EXISTS shop_reviews (
  id              uuid PRIMARY KEY,
  submission_id   uuid NOT NULL UNIQUE REFERENCES shop_submissions(id),
  code            integer NOT NULL CHECK (code IN (1,2,3,4)),
  comments        text,
  by_member       uuid NOT NULL REFERENCES members(id),
  at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS viewpoints (
  id          uuid PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES projects(id),
  name        text NOT NULL,
  store_code   text NOT NULL,
  render_ext   text,
  render_bytes integer,
  render_sha256 text,
  photo_id    uuid,
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS viewpoint_photos (
  id          uuid PRIMARY KEY,
  viewpoint_id uuid NOT NULL REFERENCES viewpoints(id),
  width       integer NOT NULL,
  height      integer NOT NULL,
  ext         text NOT NULL,
  bytes       integer NOT NULL,
  sha256       text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS snags (
  id           uuid PRIMARY KEY,
  viewpoint_id uuid NOT NULL REFERENCES viewpoints(id),
  number       integer NOT NULL,
  s            integer NOT NULL,
  y            integer NOT NULL,
  title        text NOT NULL,
  note         text,
  observed_on  date NOT NULL,
  state        text NOT NULL DEFAULT 'open' CHECK (state IN ('open','fixed','closed','reopened')),
  version      integer NOT NULL DEFAULT 1,
  raised_by    uuid REFERENCES members(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (viewpoint_id, number)
);

CREATE TABLE IF NOT EXISTS finishes (
  id          uuid PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES projects(id),
  position    integer NOT NULL,
  code        text,
  name        text NOT NULL,
  category    text NOT NULL,
  supplier     text,
  product_ref text,
  location    text,
  notes       text
);

CREATE TABLE IF NOT EXISTS case_studies (
  id          uuid PRIMARY KEY,
  title       text NOT NULL,
  slug        text NOT NULL UNIQUE,
  sector      text NOT NULL CHECK (sector IN ('retail','workplace','food_beverage')),
  brand_id    uuid NOT NULL REFERENCES brands(id),
  location    text NOT NULL,
  summary     text NOT NULL,
  body         text NOT NULL,
  featured    boolean NOT NULL DEFAULT false,
  featured_order integer,
  state       text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','preview_sent','client_approved','published','withdrawn')),
  published_at timestamptz,
  published_seq integer
);

CREATE TABLE IF NOT EXISTS preview_links (
  id            uuid PRIMARY KEY,
  token         text NOT NULL UNIQUE,
  case_study_id uuid NOT NULL REFERENCES case_studies(id),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enquiries (
  id          uuid PRIMARY KEY,
  reference   text NOT NULL UNIQUE,
  name        text NOT NULL,
  company     text NOT NULL,
  email       text NOT NULL,
  phone       text,
  sector      text NOT NULL,
  region      text NOT NULL,
  sites       integer NOT NULL,
  opening_month text NOT NULL,
  message     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox (
  id          uuid PRIMARY KEY,
  to_email    text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  ics         text,
  reply_to    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  claimed_until timestamptz,
  attempts    integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  member_id   uuid NOT NULL,
  key         text NOT NULL,
  endpoint    text NOT NULL,
  request_hash text NOT NULL,
  status      integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, key)
);

CREATE TABLE IF NOT EXISTS counter_state (
  name        text PRIMARY KEY,
  value       integer NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_member ON sessions(member_id);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(id) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_idem_created ON idempotency_keys(created_at);
