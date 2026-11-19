// PostgreSQL schema, applied idempotently on every serve (brief: Services / PostgreSQL).
// Timestamps are timestamptz (app-clock instants); calendar dates are `date`; ids are text.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_clock (id int PRIMARY KEY CHECK (id = 1), now timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS counters (name text PRIMARY KEY, value int NOT NULL);

CREATE TABLE IF NOT EXISTS organisations (
  id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL, territory text NOT NULL,
  engagement_starts_on date, engagement_ends_on date, engagement_territories text[]
);
CREATE TABLE IF NOT EXISTS principals (
  id text PRIMARY KEY, email text NOT NULL, display_name text NOT NULL, role text NOT NULL,
  organisation_id text NOT NULL REFERENCES organisations(id), password_hash text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS principals_email ON principals (lower(email));
CREATE TABLE IF NOT EXISTS sessions (token text PRIMARY KEY, principal_id text NOT NULL REFERENCES principals(id));
CREATE TABLE IF NOT EXISTS groups (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE IF NOT EXISTS group_members (
  group_id text NOT NULL REFERENCES groups(id), principal_id text NOT NULL REFERENCES principals(id),
  PRIMARY KEY (group_id, principal_id)
);
CREATE TABLE IF NOT EXISTS invitations (
  token text PRIMARY KEY, email text NOT NULL, display_name text NOT NULL, role text NOT NULL,
  organisation_id text NOT NULL REFERENCES organisations(id), expires_at timestamptz NOT NULL, used_at timestamptz
);

CREATE TABLE IF NOT EXISTS licences (
  id text PRIMARY KEY, name text NOT NULL, permitted_applications text[] NOT NULL, prohibited_applications text[] NOT NULL,
  audiences text[] NOT NULL, territories text[] NOT NULL, excluded_territories text[] NOT NULL,
  default_duration_days int NOT NULL, modification_permitted boolean NOT NULL, attribution_required boolean NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY, name text NOT NULL, class text NOT NULL, state text NOT NULL,
  licence_id text NOT NULL REFERENCES licences(id), successor_id text REFERENCES assets(id), position int NOT NULL
);
CREATE TABLE IF NOT EXISTS variants (
  id text PRIMARY KEY, asset_id text NOT NULL REFERENCES assets(id), key text NOT NULL, label text NOT NULL, position int NOT NULL
);
CREATE TABLE IF NOT EXISTS derivatives (
  id text PRIMARY KEY, asset_id text NOT NULL REFERENCES assets(id), variant_id text REFERENCES variants(id),
  file_name text NOT NULL, format text NOT NULL, width int NOT NULL, height int NOT NULL, byte_size int NOT NULL, position int NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id text PRIMARY KEY, requester_id text NOT NULL REFERENCES principals(id), asset_id text NOT NULL REFERENCES assets(id),
  variant_id text REFERENCES variants(id), application_class text NOT NULL, territories text[] NOT NULL,
  campaign_starts_on date NOT NULL, campaign_ends_on date NOT NULL, cited_rules text[] NOT NULL, note text NOT NULL,
  state text NOT NULL, submitted_at timestamptz, deadline timestamptz, escalation text,
  holder_id text NOT NULL REFERENCES principals(id),
  rule_versions jsonb NOT NULL DEFAULT '{}', requester_grants jsonb NOT NULL DEFAULT '[]',
  warned boolean NOT NULL DEFAULT false, breached boolean NOT NULL DEFAULT false,
  idempotency_key text, fingerprint text, created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS requests_requester ON requests (requester_id, idempotency_key);
CREATE TABLE IF NOT EXISTS request_stages (
  request_id text NOT NULL REFERENCES requests(id), n int NOT NULL, kind text NOT NULL,
  assignee_id text REFERENCES principals(id), decision text, decided_by text, decided_at timestamptz, comment text,
  PRIMARY KEY (request_id, n)
);
CREATE TABLE IF NOT EXISTS conditions (
  id text PRIMARY KEY, request_id text NOT NULL REFERENCES requests(id), kind text NOT NULL, value text,
  text text NOT NULL, added_by text NOT NULL, position int NOT NULL
);
CREATE TABLE IF NOT EXISTS grants (
  id text PRIMARY KEY, holder_type text NOT NULL, holder_id text NOT NULL, asset_id text NOT NULL REFERENCES assets(id),
  variant_id text REFERENCES variants(id), request_id text REFERENCES requests(id), not_before date, not_after date NOT NULL,
  status text NOT NULL, cap text, revoked_reason text
);
CREATE TABLE IF NOT EXISTS grant_conditions (
  grant_id text NOT NULL REFERENCES grants(id), position int NOT NULL, kind text NOT NULL, text text NOT NULL,
  PRIMARY KEY (grant_id, position)
);
CREATE TABLE IF NOT EXISTS proofs (
  id text PRIMARY KEY, grant_id text NOT NULL REFERENCES grants(id), file_name text NOT NULL, status text NOT NULL,
  reason text, uploaded_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (slug text PRIMARY KEY, title text NOT NULL, position int NOT NULL);
CREATE TABLE IF NOT EXISTS chapter_versions (
  id text PRIMARY KEY, slug text NOT NULL REFERENCES chapters(slug), number int NOT NULL, state text NOT NULL,
  author_id text REFERENCES principals(id), revision int NOT NULL DEFAULT 1, intro text NOT NULL,
  statements jsonb NOT NULL, asset_ids text[] NOT NULL, withdrawn jsonb NOT NULL DEFAULT '[]',
  published_at timestamptz, review_comment text, UNIQUE (slug, number)
);

CREATE TABLE IF NOT EXISTS audit (
  sequence int PRIMARY KEY, occurred_at timestamptz NOT NULL, actor_id text NOT NULL, actor_role text NOT NULL,
  action text NOT NULL, resource_type text NOT NULL, resource_id text NOT NULL, request_id text,
  before jsonb, after jsonb, outcome text NOT NULL, previous_hash text NOT NULL, record_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_outbox (
  id bigserial PRIMARY KEY, to_address text NOT NULL, subject text NOT NULL, body text NOT NULL,
  attempts int NOT NULL DEFAULT 0, sent_at timestamptz
);
`;

/** Every data table; reset empties them all (the clock row is rewritten afterwards). */
export const DATA_TABLES = [
  "mail_outbox", "audit", "chapter_versions", "chapters", "proofs", "grant_conditions", "grants", "conditions",
  "request_stages", "requests", "derivatives", "variants", "assets", "licences", "invitations", "group_members",
  "groups", "sessions", "principals", "organisations", "counters", "app_clock",
] as const;
