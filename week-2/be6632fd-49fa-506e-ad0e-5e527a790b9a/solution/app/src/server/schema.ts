// Schema applied on every start, safe when several copies run it together (callers hold one advisory lock).
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS stockists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  market text NOT NULL,
  contact_name text,
  contact_email text,
  contact_phone text,
  contact_erased boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  archived_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  stockist_id uuid REFERENCES stockists(id),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  removed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS members_active_email ON members (lower(email)) WHERE removed_at IS NULL;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL,
  signed_out_at timestamptz
);
CREATE TABLE IF NOT EXISTS account_links (
  token_hash text PRIMARY KEY,
  kind text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  member_id uuid REFERENCES members(id),
  email text NOT NULL,
  role text,
  stockist_id uuid REFERENCES stockists(id),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL,
  status text NOT NULL,
  hold_seconds integer NOT NULL,
  palette text[] NOT NULL,
  internal_note text NOT NULL DEFAULT '',
  copenhagen_go_live text,
  local_go_live text,
  created_at timestamptz NOT NULL,
  withdrawn_at timestamptz,
  withdraw_reason text,
  look_order_version integer NOT NULL DEFAULT 1,
  look_saved_by text,
  look_saved_at timestamptz
);
CREATE TABLE IF NOT EXISTS drop_markets (
  drop_id uuid NOT NULL REFERENCES drops(id),
  market text NOT NULL,
  store_pieces integer NOT NULL,
  go_live_at timestamptz,
  PRIMARY KEY (drop_id, market)
);
CREATE TABLE IF NOT EXISTS styles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id uuid NOT NULL REFERENCES drops(id),
  position integer NOT NULL,
  style_number text NOT NULL,
  name text NOT NULL,
  colour text NOT NULL,
  wholesale_edition integer NOT NULL,
  rrp_dkk_minor bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS styles_number ON styles (drop_id, lower(style_number));
CREATE SEQUENCE IF NOT EXISTS join_positions;
CREATE TABLE IF NOT EXISTS waitlist_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id uuid NOT NULL REFERENCES drops(id),
  market text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  status text NOT NULL,
  join_position bigint NOT NULL DEFAULT nextval('join_positions'),
  joined_at timestamptz NOT NULL,
  opt_in_token_hash text UNIQUE,
  opt_in_expires_at timestamptz,
  confirmed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_address ON waitlist_members (drop_id, market, lower(email));
CREATE TABLE IF NOT EXISTS holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id uuid NOT NULL REFERENCES drops(id),
  market text NOT NULL,
  waitlist_member_id uuid NOT NULL UNIQUE REFERENCES waitlist_members(id),
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL,
  offered_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id uuid NOT NULL REFERENCES drops(id),
  market text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  reference text NOT NULL UNIQUE,
  hold_id uuid UNIQUE REFERENCES holds(id),
  claimed_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS claims_address ON claims (drop_id, market, lower(email));
CREATE TABLE IF NOT EXISTS claim_replays (
  idempotency_key text PRIMARY KEY,
  body text NOT NULL,
  status integer NOT NULL,
  response text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS waitlist_joins (
  id bigserial PRIMARY KEY,
  client text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS waitlist_joins_client ON waitlist_joins (client, at);
CREATE TABLE IF NOT EXISTS restock_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id uuid NOT NULL REFERENCES drops(id),
  first_restock text NOT NULL,
  pieces jsonb NOT NULL,
  applied integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id uuid NOT NULL REFERENCES drops(id),
  stockist_id uuid NOT NULL REFERENCES stockists(id),
  status text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  requested_at timestamptz,
  internal_note text NOT NULL DEFAULT '',
  saved_by text NOT NULL,
  saved_at timestamptz NOT NULL,
  price_list_effective_date date,
  invoice_number text,
  killbill_invoice_id text,
  total_minor bigint,
  confirmed_at timestamptz,
  created_order bigserial,
  UNIQUE (drop_id, stockist_id)
);
CREATE TABLE IF NOT EXISTS allocation_lines (
  allocation_id uuid NOT NULL REFERENCES allocations(id),
  style_id uuid NOT NULL REFERENCES styles(id),
  requested_quantity integer NOT NULL DEFAULT 0,
  allocated_quantity integer NOT NULL DEFAULT 0,
  unit_price_minor bigint,
  net_minor bigint,
  vat_minor bigint,
  line_total_minor bigint,
  PRIMARY KEY (allocation_id, style_id)
);
CREATE TABLE IF NOT EXISTS price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  effective_date date NOT NULL,
  created_at timestamptz NOT NULL,
  created_order bigserial
);
CREATE TABLE IF NOT EXISTS price_list_prices (
  price_list_id uuid NOT NULL REFERENCES price_lists(id),
  style_number text NOT NULL,
  currency text NOT NULL,
  unit_price_minor bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS looks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id uuid NOT NULL REFERENCES drops(id),
  position integer NOT NULL,
  title text NOT NULL,
  alt_text text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  object_key text NOT NULL,
  stored boolean NOT NULL,
  seed_figure integer
);
CREATE TABLE IF NOT EXISTS stories (
  drop_id uuid PRIMARY KEY REFERENCES drops(id),
  html text NOT NULL,
  version integer NOT NULL,
  saved_by text,
  saved_at timestamptz,
  published_html text,
  published_at timestamptz
);
CREATE TABLE IF NOT EXISTS previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id uuid NOT NULL REFERENCES drops(id),
  editor_name text NOT NULL,
  editor_email text NOT NULL,
  outlet text NOT NULL,
  token text NOT NULL UNIQUE,
  revoked_at timestamptz,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS replaced_preview_tokens (
  token text PRIMARY KEY,
  preview_id uuid NOT NULL REFERENCES previews(id)
);
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  to_name text,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  queued_at timestamptz NOT NULL,
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (id) WHERE delivered_at IS NULL;
CREATE TABLE IF NOT EXISTS seed_marks (
  name text PRIMARY KEY
);
`;
