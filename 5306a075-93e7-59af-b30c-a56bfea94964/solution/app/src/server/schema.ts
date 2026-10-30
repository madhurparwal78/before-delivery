// The schema, applied on every start. Every statement is idempotent; ids sort in byte order (COLLATE "C").
const SCHEMA = `
CREATE SEQUENCE IF NOT EXISTS id_seq;

CREATE OR REPLACE FUNCTION gen_id(prefix text) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT prefix || lpad(to_hex(nextval('id_seq')), 12, '0') || substr(md5(random()::text || clock_timestamp()::text), 1, 12)
$$;

CREATE OR REPLACE FUNCTION now_s() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$
  SELECT date_trunc('second', clock_timestamp())
$$;

CREATE TABLE IF NOT EXISTS workspaces (
  id text COLLATE "C" PRIMARY KEY,
  name text NOT NULL,
  time_zone text NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id text COLLATE "C" PRIMARY KEY DEFAULT gen_id('u'),
  workspace_id text COLLATE "C" NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('head_of_product', 'product_manager', 'customer_success')),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now_s()
);
CREATE UNIQUE INDEX IF NOT EXISTS members_email ON members (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text COLLATE "C" PRIMARY KEY,
  member_id text COLLATE "C" NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companies (
  id text COLLATE "C" PRIMARY KEY DEFAULT gen_id('co'),
  workspace_id text COLLATE "C" NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now_s()
);

CREATE TABLE IF NOT EXISTS company_domains (
  workspace_id text COLLATE "C" NOT NULL REFERENCES workspaces(id),
  domain text NOT NULL,
  company_id text COLLATE "C" NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY (workspace_id, domain)
);

CREATE TABLE IF NOT EXISTS contacts (
  id text COLLATE "C" PRIMARY KEY DEFAULT gen_id('ct'),
  workspace_id text COLLATE "C" NOT NULL REFERENCES workspaces(id),
  company_id text COLLATE "C" REFERENCES companies(id),
  name text NOT NULL,
  email text NOT NULL,
  UNIQUE (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS notes (
  id text COLLATE "C" PRIMARY KEY DEFAULT gen_id('n'),
  workspace_id text COLLATE "C" NOT NULL REFERENCES workspaces(id),
  title text NOT NULL,
  body text NOT NULL,
  text text NOT NULL,
  source text NOT NULL CHECK (source IN ('support_ticket', 'sales_call', 'email', 'csv_import')),
  status text NOT NULL CHECK (status IN ('unprocessed', 'snoozed', 'processed')),
  snoozed_until timestamptz,
  received_on date,
  contact_id text COLLATE "C" REFERENCES contacts(id),
  created_at timestamptz NOT NULL DEFAULT now_s()
);
CREATE INDEX IF NOT EXISTS notes_inbox ON notes (workspace_id, created_at DESC, id DESC);

-- A snooze ends at its instant: every read sees the note as unprocessed from then on.
CREATE OR REPLACE VIEW notes_live AS
  SELECT n.id, n.workspace_id, n.title, n.body, n.text, n.source, n.received_on, n.contact_id, n.created_at,
         CASE WHEN n.status = 'snoozed' AND n.snoozed_until <= now() THEN 'unprocessed' ELSE n.status END AS status,
         CASE WHEN n.status = 'snoozed' AND n.snoozed_until > now() THEN n.snoozed_until END AS snoozed_until
  FROM notes n;

CREATE TABLE IF NOT EXISTS attachments (
  id text COLLATE "C" PRIMARY KEY DEFAULT gen_id('a'),
  note_id text COLLATE "C" NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  filename text NOT NULL,
  content_type text NOT NULL,
  size integer NOT NULL,
  status text NOT NULL CHECK (status IN ('available', 'pending')),
  storage_key text NOT NULL,
  pending_bytes bytea,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_pending ON attachments (created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS object_deletions (
  id text COLLATE "C" PRIMARY KEY DEFAULT gen_id('od'),
  prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz
);

CREATE TABLE IF NOT EXISTS products (
  id text COLLATE "C" PRIMARY KEY DEFAULT gen_id('p'),
  workspace_id text COLLATE "C" NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS components (
  id text COLLATE "C" PRIMARY KEY DEFAULT gen_id('cm'),
  workspace_id text COLLATE "C" NOT NULL REFERENCES workspaces(id),
  product_id text COLLATE "C" NOT NULL REFERENCES products(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS releases (
  id text COLLATE "C" PRIMARY KEY DEFAULT gen_id('r'),
  workspace_id text COLLATE "C" NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  target_date date NOT NULL,
  is_public boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'frozen', 'shipped')),
  order_version integer NOT NULL DEFAULT 1,
  snapshot_version integer,
  shipped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS features (
  id text COLLATE "C" PRIMARY KEY DEFAULT gen_id('f'),
  workspace_id text COLLATE "C" NOT NULL REFERENCES workspaces(id),
  component_id text COLLATE "C" NOT NULL REFERENCES components(id),
  parent_feature_id text COLLATE "C" REFERENCES features(id),
  name text NOT NULL,
  public_description text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('candidate', 'planned', 'in_progress', 'released', 'archived')),
  prior_status text,
  release_id text COLLATE "C" REFERENCES releases(id),
  position integer,
  effort integer NOT NULL,
  confidence integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS features_name ON features (workspace_id, lower(name));
CREATE INDEX IF NOT EXISTS features_release ON features (release_id, position);

CREATE TABLE IF NOT EXISTS objectives (
  id text COLLATE "C" PRIMARY KEY DEFAULT gen_id('o'),
  workspace_id text COLLATE "C" NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  weight integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS feature_fits (
  feature_id text COLLATE "C" NOT NULL REFERENCES features(id),
  objective_id text COLLATE "C" NOT NULL REFERENCES objectives(id),
  level integer NOT NULL,
  PRIMARY KEY (feature_id, objective_id)
);

CREATE TABLE IF NOT EXISTS score_versions (
  feature_id text COLLATE "C" NOT NULL REFERENCES features(id),
  version integer NOT NULL,
  effort integer NOT NULL,
  confidence integer NOT NULL,
  fits jsonb NOT NULL,
  priority_cents bigint NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now_s(),
  saved_by text COLLATE "C" REFERENCES members(id),
  PRIMARY KEY (feature_id, version)
);

CREATE TABLE IF NOT EXISTS insights (
  id text COLLATE "C" PRIMARY KEY DEFAULT gen_id('i'),
  workspace_id text COLLATE "C" NOT NULL REFERENCES workspaces(id),
  note_id text COLLATE "C" NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  feature_id text COLLATE "C" NOT NULL REFERENCES features(id),
  start_offset integer NOT NULL,
  end_offset integer NOT NULL,
  quote text NOT NULL,
  importance text NOT NULL CHECK (importance IN ('nice_to_have', 'important', 'critical')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (note_id, feature_id, start_offset, end_offset)
);
CREATE INDEX IF NOT EXISTS insights_feature ON insights (feature_id);

CREATE TABLE IF NOT EXISTS share_links (
  id text COLLATE "C" PRIMARY KEY DEFAULT gen_id('s'),
  workspace_id text COLLATE "C" NOT NULL REFERENCES workspaces(id),
  token text COLLATE "C" NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_in_seconds integer,
  expires_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  workspace_id text COLLATE "C" NOT NULL REFERENCES workspaces(id),
  key text COLLATE "C" NOT NULL,
  release_id text COLLATE "C" NOT NULL REFERENCES releases(id),
  status_code integer NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS outbox (
  id text COLLATE "C" PRIMARY KEY DEFAULT gen_id('m'),
  workspace_id text COLLATE "C" NOT NULL REFERENCES workspaces(id),
  release_id text COLLATE "C" REFERENCES releases(id),
  recipient_name text NOT NULL,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  text_body text NOT NULL,
  html_body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_unsent ON outbox (created_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS invitations (
  id text COLLATE "C" PRIMARY KEY DEFAULT gen_id('v'),
  workspace_id text COLLATE "C" NOT NULL REFERENCES workspaces(id),
  email text NOT NULL,
  role text NOT NULL,
  token text COLLATE "C" NOT NULL UNIQUE,
  invited_by text COLLATE "C" NOT NULL REFERENCES members(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  replaced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  workspace_id text COLLATE "C" NOT NULL REFERENCES workspaces(id),
  member_id text COLLATE "C" REFERENCES members(id),
  action text NOT NULL,
  subject_id text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
`;

/** One statement per entry, in order. */
export const SCHEMA_STATEMENTS = SCHEMA.split(/;\s*\n(?=CREATE|--)/).map((statement) => statement.trim()).filter((statement) => statement !== "");
