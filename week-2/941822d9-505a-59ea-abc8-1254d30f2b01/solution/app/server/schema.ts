// The schema, applied idempotently at every start.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('provider', 'hospital')),
  time_zone text,
  accreditation_statement text
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('learner', 'coordinator', 'planner', 'author')),
  organisation_id uuid REFERENCES organisations(id),
  licence_number text,
  date_of_birth date,
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_key text UNIQUE,
  title text NOT NULL,
  summary text NOT NULL,
  format text NOT NULL CHECK (format IN ('self_paced', 'cohort')),
  state text NOT NULL CHECK (state IN ('draft', 'in_review', 'published', 'withdrawn')),
  list_price_cents integer NOT NULL,
  version integer NOT NULL,
  author_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS course_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id),
  position integer NOT NULL,
  title text NOT NULL,
  minutes integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('lesson', 'evaluation')),
  body text,
  prompt text,
  options jsonb,
  answer_index integer
);
CREATE INDEX IF NOT EXISTS course_modules_course ON course_modules (course_id, position);

CREATE TABLE IF NOT EXISTS course_transitions (
  id bigserial PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id),
  from_state text NOT NULL,
  to_state text NOT NULL,
  by_user uuid NOT NULL REFERENCES users(id),
  note text,
  at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_key text UNIQUE,
  course_id uuid NOT NULL REFERENCES courses(id),
  name text NOT NULL,
  seat_cap integer NOT NULL,
  starts_on date NOT NULL,
  close_date date NOT NULL,
  closes_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id bigserial PRIMARY KEY,
  cohort_id uuid NOT NULL REFERENCES cohorts(id),
  learner_id uuid NOT NULL REFERENCES users(id),
  joined_at timestamptz NOT NULL,
  UNIQUE (cohort_id, learner_id)
);

CREATE TABLE IF NOT EXISTS coverage_policies (
  id bigserial PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES organisations(id),
  percent_bp integer NOT NULL,
  effective_on date NOT NULL,
  effective_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  superseded_at timestamptz,
  seeded boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS coverage_policies_seed ON coverage_policies (hospital_id) WHERE seeded;

CREATE TABLE IF NOT EXISTS enrolments (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES users(id),
  course_id uuid NOT NULL REFERENCES courses(id),
  cohort_id uuid REFERENCES cohorts(id),
  state text NOT NULL CHECK (state IN ('held', 'confirmed', 'completed', 'certified', 'refunded', 'withdrawn')),
  funding text NOT NULL CHECK (funding IN ('card', 'co_pay', 'seat')),
  funding_hospital_id uuid REFERENCES organisations(id),
  assignment_id uuid,
  list_price_cents integer NOT NULL,
  employer_share_cents integer NOT NULL,
  learner_share_cents integer NOT NULL,
  enrolled_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS enrolments_one_open_per_course
  ON enrolments (learner_id, course_id) WHERE state NOT IN ('refunded', 'withdrawn');
CREATE INDEX IF NOT EXISTS enrolments_cohort ON enrolments (cohort_id);

CREATE TABLE IF NOT EXISTS module_verifications (
  enrolment_id uuid NOT NULL REFERENCES enrolments(id),
  module_id uuid NOT NULL REFERENCES course_modules(id),
  verified_at timestamptz NOT NULL,
  PRIMARY KEY (enrolment_id, module_id)
);

CREATE TABLE IF NOT EXISTS evaluations (
  enrolment_id uuid PRIMARY KEY REFERENCES enrolments(id),
  rating integer NOT NULL,
  met_outcomes boolean NOT NULL,
  comment text,
  submitted_at timestamptz NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS certificate_serial_seq;

CREATE TABLE IF NOT EXISTS certificates (
  id uuid PRIMARY KEY,
  enrolment_id uuid NOT NULL UNIQUE REFERENCES enrolments(id),
  learner_id uuid NOT NULL REFERENCES users(id),
  serial text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('sealing', 'sealed', 'revoked')),
  contact_quarters integer NOT NULL,
  verified_module_count integer NOT NULL,
  issued_on date,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS certificate_versions (
  certificate_id uuid NOT NULL REFERENCES certificates(id),
  version integer NOT NULL,
  state text NOT NULL CHECK (state IN ('sealing', 'sealed', 'reissued', 'revoked')),
  nurse_name text NOT NULL,
  sealed_on date,
  origin text NOT NULL,
  reason text,
  decided_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL,
  lease_until timestamptz,
  PRIMARY KEY (certificate_id, version)
);

CREATE TABLE IF NOT EXISTS certificate_revocations (
  certificate_id uuid PRIMARY KEY REFERENCES certificates(id),
  reason text NOT NULL,
  decided_by uuid NOT NULL REFERENCES users(id),
  decided_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_links (
  id uuid PRIMARY KEY,
  certificate_id uuid NOT NULL REFERENCES certificates(id),
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS download_tokens (
  token_hash text PRIMARY KEY,
  certificate_id uuid NOT NULL REFERENCES certificates(id),
  version integer NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS signing_keys (
  name text PRIMARY KEY,
  secret text NOT NULL
);

CREATE TABLE IF NOT EXISTS seat_packs (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES organisations(id),
  course_id uuid NOT NULL REFERENCES courses(id),
  seats_purchased integer NOT NULL,
  price_total_cents integer NOT NULL,
  purchased_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'expired')),
  purchased_by uuid NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS seat_assignments (
  id uuid PRIMARY KEY,
  pack_id uuid NOT NULL REFERENCES seat_packs(id),
  nurse_id uuid NOT NULL REFERENCES users(id),
  enrolment_id uuid NOT NULL REFERENCES enrolments(id),
  state text NOT NULL CHECK (state IN ('assigned', 'returned')),
  assigned_at timestamptz NOT NULL,
  returned_at timestamptz
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigserial PRIMARY KEY,
  movement_id uuid NOT NULL,
  pack_id uuid NOT NULL REFERENCES seat_packs(id),
  kind text NOT NULL CHECK (kind IN ('purchase', 'assignment', 'return', 'expiry')),
  account text NOT NULL,
  seats integer NOT NULL,
  assignment_id uuid REFERENCES seat_assignments(id),
  posted_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_entries_pack ON ledger_entries (pack_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_expiry_movement ON ledger_entries (pack_id) WHERE kind = 'expiry' AND account = 'pack';

CREATE TABLE IF NOT EXISTS refund_requests (
  id uuid PRIMARY KEY,
  enrolment_id uuid NOT NULL REFERENCES enrolments(id),
  state text NOT NULL CHECK (state IN ('pending', 'approved', 'declined')),
  reason text NOT NULL,
  requested_at timestamptz NOT NULL,
  fixed_total_cents integer,
  fixed_employer_cents integer,
  fixed_learner_cents integer,
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_note text
);
CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_one_pending ON refund_requests (enrolment_id) WHERE state = 'pending';

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id uuid NOT NULL REFERENCES users(id),
  key text NOT NULL,
  request_hash text NOT NULL,
  status integer NOT NULL,
  response text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS payer_accounts (
  external_key text PRIMARY KEY,
  account_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  event_key text NOT NULL UNIQUE,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS completion_exports (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES organisations(id),
  from_date date NOT NULL,
  to_date date NOT NULL,
  row_count integer NOT NULL,
  object_key text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL
);
`;
