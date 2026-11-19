export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS coaches (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  access_code TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS cohorts (
  id UUID PRIMARY KEY,
  coach_id UUID NOT NULL REFERENCES coaches(id),
  name TEXT NOT NULL,
  starts_on DATE NOT NULL,
  price_cents INTEGER NOT NULL,
  seats INTEGER NOT NULL,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  closed_by_coach BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrollments (
  id UUID PRIMARY KEY,
  cohort_id UUID NOT NULL REFERENCES cohorts(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment',
  price_cents INTEGER NOT NULL,
  home_tz TEXT NOT NULL,
  bedtime TEXT NOT NULL,
  first_night DATE,
  receipt_status TEXT NOT NULL DEFAULT 'none',
  access_code TEXT NOT NULL UNIQUE,
  paid_via_killbill BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  coach_id UUID REFERENCES coaches(id),
  enrollment_id UUID REFERENCES enrollments(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entries (
  id UUID PRIMARY KEY,
  enrollment_id UUID NOT NULL REFERENCES enrollments(id),
  cohort_id UUID NOT NULL REFERENCES cohorts(id),
  night_key DATE NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  dreams_recalled INTEGER NOT NULL,
  lucid BOOLEAN NOT NULL,
  wbtb BOOLEAN NOT NULL,
  technique TEXT NOT NULL,
  technique_minutes INTEGER NOT NULL,
  late_recall BOOLEAN NOT NULL,
  shared BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  body_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memo_slots (
  entry_id UUID PRIMARY KEY REFERENCES entries(id),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_type TEXT,
  size_bytes INTEGER,
  duration_ms INTEGER,
  stored BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS signs (
  id UUID PRIMARY KEY,
  entry_id UUID NOT NULL REFERENCES entries(id),
  enrollment_id UUID NOT NULL REFERENCES enrollments(id),
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  phrase TEXT NOT NULL,
  category TEXT NOT NULL,
  night_key DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reality_checks (
  id UUID PRIMARY KEY,
  enrollment_id UUID NOT NULL REFERENCES enrollments(id),
  category TEXT NOT NULL,
  night_key DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS digests (
  cohort_id UUID NOT NULL REFERENCES cohorts(id),
  week INTEGER NOT NULL,
  coach_email TEXT NOT NULL,
  dreamers INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cohort_id, week)
);

CREATE INDEX IF NOT EXISTS idx_entries_enrollment ON entries(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_entries_cohort_night ON entries(cohort_id, night_key);
CREATE INDEX IF NOT EXISTS idx_signs_enrollment ON signs(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_signs_entry ON signs(entry_id);
CREATE INDEX IF NOT EXISTS idx_reality_checks_enrollment ON reality_checks(enrollment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_coach_cohort_name ON cohorts(lower(name), coach_id);

CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY,
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
