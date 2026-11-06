import type { Db } from './db.js';

// The schema is applied on every serve start, idempotently. DDL runs inside a
// transaction so concurrent app copies either see it complete or retry safely.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  password_hash text,
  role text NOT NULL,
  stockist_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS members_ws_email ON members (workspace_id, lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS invitations (
  token text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL,
  stockist_id text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);
CREATE INDEX IF NOT EXISTS invitations_ws ON invitations (workspace_id, lower(email));

CREATE TABLE IF NOT EXISTS password_resets (
  token text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS drops (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  brand text NOT NULL,
  type text NOT NULL,
  status text NOT NULL,
  hold_seconds integer NOT NULL DEFAULT 900,
  palette jsonb NOT NULL DEFAULT '[]'::jsonb,
  internal_note text NOT NULL DEFAULT '',
  go_live_at timestamptz,
  earliest_go_live_at timestamptz,
  copenhagen_go_live text,
  local_go_live text,
  created_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  withdrawn_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS drops_ws_slug ON drops (workspace_id, slug);
CREATE INDEX IF NOT EXISTS drops_public ON drops (workspace_id, status);

CREATE TABLE IF NOT EXISTS drop_markets (
  drop_id text NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  market text NOT NULL,
  go_live_at timestamptz,
  store_pieces integer NOT NULL DEFAULT 0,
  PRIMARY KEY (drop_id, market)
);

CREATE TABLE IF NOT EXISTS styles (
  id text PRIMARY KEY,
  drop_id text NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  style_number text NOT NULL,
  name text NOT NULL DEFAULT '',
  colour text NOT NULL DEFAULT '',
  wholesale_edition integer NOT NULL DEFAULT 0,
  rrp_dkk_minor bigint NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS styles_drop_number ON styles (drop_id, lower(style_number));

CREATE TABLE IF NOT EXISTS restock_series (
  id text PRIMARY KEY,
  drop_id text NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  weekday integer NOT NULL,
  copenhagen_time text NOT NULL,
  first_restock text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS restock_series_one_per_drop ON restock_series (drop_id);

CREATE TABLE IF NOT EXISTS restock_pieces (
  series_id text NOT NULL REFERENCES restock_series(id) ON DELETE CASCADE,
  market text NOT NULL,
  pieces integer NOT NULL DEFAULT 0,
  PRIMARY KEY (series_id, market)
);

CREATE TABLE IF NOT EXISTS restock_done (
  series_id text NOT NULL REFERENCES restock_series(id) ON DELETE CASCADE,
  occurrence timestamptz NOT NULL,
  PRIMARY KEY (series_id, occurrence)
);

CREATE TABLE IF NOT EXISTS waitlist (
  id text PRIMARY KEY,
  drop_id text NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  market text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  position integer NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  optin_token text,
  optin_expires_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_unique ON waitlist (drop_id, market, lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_pos ON waitlist (drop_id, market, position);
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_optin ON waitlist (optin_token);

CREATE TABLE IF NOT EXISTS holds (
  id text PRIMARY KEY,
  drop_id text NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  market text NOT NULL,
  waitlist_id text NOT NULL REFERENCES waitlist(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'offered',
  offered_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS holds_drop_market ON holds (drop_id, market, status);
CREATE UNIQUE INDEX IF NOT EXISTS holds_one_per_member ON holds (drop_id, market, waitlist_id);

CREATE TABLE IF NOT EXISTS claims (
  id text PRIMARY KEY,
  drop_id text NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  market text NOT NULL,
  reference text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  email text,
  waitlist_id text REFERENCES waitlist(id) ON DELETE SET NULL,
  hold_id text REFERENCES holds(id) ON DELETE SET NULL,
  claimed_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS claims_one_per_address ON claims (drop_id, market, lower(coalesce(email, ''))) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS idempotency (
  key text NOT NULL,
  workspace_id text NOT NULL,
  request_hash text NOT NULL,
  status integer NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, workspace_id)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE IF NOT EXISTS stockists (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  market text NOT NULL,
  currency text NOT NULL,
  contact_name text,
  contact_email text,
  contact_phone text,
  contact_erased boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stockists_ws ON stockists (workspace_id, status);

CREATE TABLE IF NOT EXISTS price_lists (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  effective_date text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_lists_ws ON price_lists (workspace_id, effective_date);

CREATE TABLE IF NOT EXISTS prices (
  price_list_id text NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  style_number text NOT NULL,
  currency text NOT NULL,
  unit_price_minor bigint NOT NULL,
  PRIMARY KEY (price_list_id, style_number, currency)
);

CREATE TABLE IF NOT EXISTS allocations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  drop_id text NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  stockist_id text NOT NULL REFERENCES stockists(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'requested',
  version integer NOT NULL DEFAULT 1,
  requested_at timestamptz NOT NULL DEFAULT now(),
  total_minor bigint,
  price_list_date text,
  invoice_number text,
  killbill_invoice_id text,
  internal_note text NOT NULL DEFAULT '',
  saved_by text,
  saved_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  UNIQUE (drop_id, stockist_id)
);
CREATE INDEX IF NOT EXISTS allocations_ws ON allocations (workspace_id, status);

CREATE TABLE IF NOT EXISTS allocation_lines (
  allocation_id text NOT NULL REFERENCES allocations(id) ON DELETE CASCADE,
  style_number text NOT NULL,
  style_name text NOT NULL DEFAULT '',
  requested_quantity integer NOT NULL DEFAULT 0,
  allocated_quantity integer NOT NULL DEFAULT 0,
  unit_price_minor bigint,
  net_minor bigint,
  vat_minor bigint,
  line_total_minor bigint,
  PRIMARY KEY (allocation_id, style_number)
);

CREATE TABLE IF NOT EXISTS looks (
  id text PRIMARY KEY,
  drop_id text NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  position integer NOT NULL,
  title text NOT NULL,
  alt_text text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  ext text NOT NULL,
  order_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS looks_pos ON looks (drop_id, position);

CREATE TABLE IF NOT EXISTS look_orders (
  drop_id text NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  order_version integer NOT NULL,
  saved_by text,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (drop_id)
);

CREATE TABLE IF NOT EXISTS stories (
  drop_id text PRIMARY KEY REFERENCES drops(id) ON DELETE CASCADE,
  html text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  saved_by text,
  saved_at timestamptz NOT NULL DEFAULT now(),
  published_html text,
  published_at timestamptz
);

CREATE TABLE IF NOT EXISTS previews (
  id text PRIMARY KEY,
  drop_id text NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  editor_name text NOT NULL,
  editor_email text NOT NULL,
  outlet text NOT NULL DEFAULT '',
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active',
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS previews_drop ON previews (drop_id);

CREATE TABLE IF NOT EXISTS jobs (
  id bigserial PRIMARY KEY,
  run_at timestamptz NOT NULL,
  claimed_at timestamptz,
  claimed_by text,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  workspace_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs (run_at) WHERE claimed_at IS NULL;
CREATE INDEX IF NOT EXISTS jobs_mail ON jobs (kind) WHERE kind = 'mail';
`;
