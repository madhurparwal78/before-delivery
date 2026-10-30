export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS organisations (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  kind text NOT NULL,
  time_zone text,
  accreditation_statement text
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL,
  organisation_id uuid REFERENCES organisations(id),
  licence_number text,
  date_of_birth date,
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courses (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  summary text NOT NULL,
  format text NOT NULL,
  state text NOT NULL,
  list_price_cents integer NOT NULL,
  version integer NOT NULL,
  author_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_modules (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position integer NOT NULL,
  title text NOT NULL,
  minutes integer NOT NULL,
  kind text NOT NULL,
  body text,
  question_prompt text,
  question_options jsonb,
  answer_index integer
);
CREATE INDEX IF NOT EXISTS course_modules_course ON course_modules (course_id, position);

CREATE TABLE IF NOT EXISTS course_history (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  from_state text NOT NULL,
  to_state text NOT NULL,
  by_user_id uuid NOT NULL REFERENCES users(id),
  note text,
  at timestamptz NOT NULL DEFAULT now(),
  seq bigserial
);
CREATE INDEX IF NOT EXISTS course_history_course ON course_history (course_id, seq);

CREATE TABLE IF NOT EXISTS cohorts (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name text NOT NULL,
  seat_cap integer NOT NULL,
  starts_on date NOT NULL,
  close_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cohorts_course ON cohorts (course_id, created_at);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id uuid PRIMARY KEY,
  cohort_id uuid NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial,
  UNIQUE (cohort_id, user_id)
);

CREATE TABLE IF NOT EXISTS coverage_policies (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  coverage_percent_hundredths integer NOT NULL,
  effective_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial
);
CREATE INDEX IF NOT EXISTS coverage_policies_org ON coverage_policies (organisation_id, effective_on, seq);

CREATE TABLE IF NOT EXISTS enrolments (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id),
  cohort_id uuid REFERENCES cohorts(id),
  state text NOT NULL,
  funding text NOT NULL,
  sponsor_organisation_id uuid REFERENCES organisations(id),
  list_price_cents integer NOT NULL,
  employer_share_cents integer NOT NULL,
  learner_share_cents integer NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS enrolments_one_live_per_course
  ON enrolments (user_id, course_id)
  WHERE state IN ('held', 'confirmed', 'completed', 'certified');
CREATE INDEX IF NOT EXISTS enrolments_cohort ON enrolments (cohort_id);
CREATE INDEX IF NOT EXISTS enrolments_sponsor ON enrolments (sponsor_organisation_id);

CREATE TABLE IF NOT EXISTS module_verifications (
  id uuid PRIMARY KEY,
  enrolment_id uuid NOT NULL REFERENCES enrolments(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrolment_id, module_id)
);

CREATE TABLE IF NOT EXISTS evaluations (
  id uuid PRIMARY KEY,
  enrolment_id uuid NOT NULL UNIQUE REFERENCES enrolments(id) ON DELETE CASCADE,
  rating integer NOT NULL,
  met_outcomes boolean NOT NULL,
  comment text,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS certificate_serial_seq AS bigint START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS certificates (
  id uuid PRIMARY KEY,
  enrolment_id uuid NOT NULL UNIQUE REFERENCES enrolments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  serial text NOT NULL UNIQUE,
  contact_hours_hundredths integer NOT NULL,
  verified_module_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS certificate_versions (
  id uuid PRIMARY KEY,
  certificate_id uuid NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  version integer NOT NULL,
  state text NOT NULL,
  nurse_name text NOT NULL,
  reason text,
  origin text NOT NULL,
  sealed_on date,
  sealed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (certificate_id, version)
);
CREATE INDEX IF NOT EXISTS certificate_versions_sealing ON certificate_versions (state);

CREATE TABLE IF NOT EXISTS share_links (
  id uuid PRIMARY KEY,
  certificate_id uuid NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS download_tokens (
  id uuid PRIMARY KEY,
  certificate_id uuid NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  version integer NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS packs (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id),
  seats_purchased integer NOT NULL,
  price_total_cents integer NOT NULL,
  purchased_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  expiry_settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS packs_org ON packs (organisation_id, purchased_at);

CREATE TABLE IF NOT EXISTS seat_assignments (
  id uuid PRIMARY KEY,
  pack_id uuid NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  nurse_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrolment_id uuid NOT NULL REFERENCES enrolments(id) ON DELETE CASCADE,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  returned_at timestamptz
);
CREATE INDEX IF NOT EXISTS seat_assignments_enrolment ON seat_assignments (enrolment_id);

CREATE TABLE IF NOT EXISTS ledger_movements (
  id uuid PRIMARY KEY,
  pack_id uuid NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  assignment_id uuid,
  posted_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_movements_one_expiry
  ON ledger_movements (pack_id) WHERE kind = 'expiry';

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY,
  movement_id uuid NOT NULL REFERENCES ledger_movements(id) ON DELETE CASCADE,
  pack_id uuid NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  account text NOT NULL,
  seats integer NOT NULL,
  assignment_id uuid,
  posted_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial
);
CREATE INDEX IF NOT EXISTS ledger_entries_pack ON ledger_entries (pack_id, seq);
CREATE INDEX IF NOT EXISTS ledger_entries_account ON ledger_entries (account);

CREATE TABLE IF NOT EXISTS refund_requests (
  id uuid PRIMARY KEY,
  enrolment_id uuid NOT NULL REFERENCES enrolments(id) ON DELETE CASCADE,
  reason text NOT NULL,
  state text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  refund_total_cents integer,
  employer_refund_cents integer,
  learner_refund_cents integer,
  amounts_fixed boolean NOT NULL DEFAULT false,
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_note text
);
CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_one_pending
  ON refund_requests (enrolment_id) WHERE state = 'pending';

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY,
  enrolment_id uuid REFERENCES enrolments(id) ON DELETE CASCADE,
  pack_id uuid REFERENCES packs(id) ON DELETE CASCADE,
  party text NOT NULL,
  external_key text NOT NULL UNIQUE,
  killbill_payment_id text NOT NULL,
  amount_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  body_hash text NOT NULL,
  status integer NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS email_outbox_unsent ON email_outbox (sent_at);

CREATE TABLE IF NOT EXISTS completion_exports (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  from_date date NOT NULL,
  to_date date NOT NULL,
  rows integer NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;
