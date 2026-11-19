/** The schema: PostgreSQL is the system of record for everything the app owns. */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  legal_name text NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  time_zone text NOT NULL,
  address text NOT NULL,
  display_order int NOT NULL
);

CREATE TABLE IF NOT EXISTS stations (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  name text NOT NULL,
  kind text NOT NULL,
  display_order int NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  email text NOT NULL,
  email_key text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL,
  site_id uuid REFERENCES sites(id),
  business_name text,
  contact_name text,
  coi_valid_through date,
  fhc_valid_through date,
  bl_valid_through date,
  created_at bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key_unique ON users (email_key);
CREATE INDEX IF NOT EXISTS users_tenant_site ON users (tenant_id, site_id);

CREATE TABLE IF NOT EXISTS trucks (
  id uuid PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES users(id),
  site_id uuid NOT NULL REFERENCES sites(id),
  name text NOT NULL,
  permit_number text NOT NULL
);

CREATE TABLE IF NOT EXISTS packs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  quarter_hours int NOT NULL,
  price_cents int NOT NULL,
  display_order int NOT NULL
);

CREATE TABLE IF NOT EXISTS lots (
  id bigserial PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES users(id),
  purchase_id uuid,
  pack_name text NOT NULL,
  valid_through date,
  remainder_qh int NOT NULL,
  purchase_seq int NOT NULL,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS lots_member ON lots (member_id);

CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES users(id),
  pack_id uuid NOT NULL REFERENCES packs(id),
  pack_name text NOT NULL,
  quarter_hours int NOT NULL,
  price_cents int NOT NULL,
  valid_through date NOT NULL,
  killbill_payment_id text,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS series (
  id uuid PRIMARY KEY,
  station_id uuid NOT NULL REFERENCES stations(id),
  weekday int NOT NULL,
  start_minute int NOT NULL,
  end_minute int NOT NULL,
  weeks int NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  site_id uuid NOT NULL REFERENCES sites(id),
  station_id uuid NOT NULL REFERENCES stations(id),
  member_id uuid NOT NULL REFERENCES users(id),
  series_id uuid REFERENCES series(id),
  reference text NOT NULL,
  date text NOT NULL,
  start_minute int NOT NULL,
  end_minute int NOT NULL,
  start_at bigint NOT NULL,
  end_at bigint NOT NULL,
  quarter_hours int NOT NULL,
  status text NOT NULL,
  hold_expires_at bigint,
  refunded_qh int,
  forfeited_qh int,
  cancelled_by_user uuid,
  cancelled_by_name text,
  cancellation_reason text,
  checked_in_at bigint,
  checked_in_by_name text,
  no_show_by_name text,
  checked_out_at bigint,
  checked_out_by_name text,
  late_qh int,
  pack_applied_qh int,
  overage jsonb,
  created_at bigint NOT NULL,
  CONSTRAINT bookings_reference_unique UNIQUE (tenant_id, reference)
);
CREATE INDEX IF NOT EXISTS bookings_station_date ON bookings (station_id, date);
CREATE INDEX IF NOT EXISTS bookings_site_date ON bookings (site_id, date);
CREATE INDEX IF NOT EXISTS bookings_member ON bookings (member_id);

CREATE TABLE IF NOT EXISTS booking_lot_draw (
  booking_id uuid NOT NULL REFERENCES bookings(id),
  lot_id bigint NOT NULL REFERENCES lots(id),
  purchase_id uuid,
  quarter_hours int NOT NULL,
  PRIMARY KEY (booking_id, lot_id)
);

CREATE TABLE IF NOT EXISTS rates (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id),
  effective_from date NOT NULL,
  hourly_rate_cents int NOT NULL,
  tax_rate_percent text NOT NULL,
  created_at bigint NOT NULL,
  CONSTRAINT rates_site_date_unique UNIQUE (site_id, effective_from)
);

CREATE TABLE IF NOT EXISTS movements (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  member_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  booking_id uuid,
  purchase_id uuid,
  quarter_hours int NOT NULL,
  from_account text NOT NULL,
  to_account text NOT NULL,
  actor_user_id uuid,
  actor_name text NOT NULL,
  actor_role text,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS movements_member ON movements (member_id, id);
CREATE INDEX IF NOT EXISTS movements_booking ON movements (booking_id);

CREATE TABLE IF NOT EXISTS movement_lots (
  movement_id bigint NOT NULL REFERENCES movements(id),
  lot_id bigint NOT NULL REFERENCES lots(id),
  purchase_id uuid,
  quarter_hours int NOT NULL,
  PRIMARY KEY (movement_id, lot_id)
);

CREATE TABLE IF NOT EXISTS movement_entries (
  movement_id bigint NOT NULL REFERENCES movements(id),
  member_id uuid NOT NULL,
  account text NOT NULL,
  quarter_hours int NOT NULL,
  PRIMARY KEY (movement_id, account)
);
CREATE INDEX IF NOT EXISTS movement_entries_member ON movement_entries (member_id, account);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  member_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL,
  expiry_date date NOT NULL,
  status text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes int NOT NULL,
  sha256 text NOT NULL,
  rejection_reason text,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_member ON documents (member_id, created_at);
CREATE INDEX IF NOT EXISTS documents_status ON documents (status);

CREATE TABLE IF NOT EXISTS visits (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  truck_id uuid NOT NULL REFERENCES trucks(id),
  site_id uuid NOT NULL REFERENCES sites(id),
  arrived_at bigint NOT NULL,
  departed_at bigint,
  services text[] NOT NULL,
  operator_signature text NOT NULL,
  manager_name text NOT NULL
);
CREATE INDEX IF NOT EXISTS visits_truck ON visits (truck_id, arrived_at);

CREATE TABLE IF NOT EXISTS inspector_links (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  truck_id uuid NOT NULL REFERENCES trucks(id),
  token text NOT NULL,
  inspector_email text NOT NULL,
  expires_at bigint NOT NULL,
  revoked_at bigint,
  snapshot_key text NOT NULL,
  created_at bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS inspector_links_token ON inspector_links (token);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  token text NOT NULL,
  csrf text NOT NULL,
  created_at bigint NOT NULL,
  last_used_at bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_token ON sessions (token);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id, created_at);

CREATE TABLE IF NOT EXISTS sign_in_failures (
  id bigserial PRIMARY KEY,
  email_key text NOT NULL,
  address text NOT NULL,
  failed_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS sign_in_failures_email ON sign_in_failures (email_key, failed_at);
CREATE INDEX IF NOT EXISTS sign_in_failures_address ON sign_in_failures (address, failed_at);

CREATE TABLE IF NOT EXISTS idempotency_records (
  user_id uuid NOT NULL,
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  binding text NOT NULL,
  status int,
  response_body jsonb,
  created_at bigint NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid,
  subject_user_id uuid,
  scope_site_id uuid,
  at bigint NOT NULL,
  actor_user_id uuid,
  actor_name text NOT NULL,
  actor_role text,
  action text NOT NULL,
  target_type text,
  target_id text,
  outcome text NOT NULL,
  address_prefix text
);
CREATE INDEX IF NOT EXISTS audit_events_tenant ON audit_events (tenant_id, id);
CREATE INDEX IF NOT EXISTS audit_events_site ON audit_events (scope_site_id, id);

CREATE TABLE IF NOT EXISTS email_outbox (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at bigint NOT NULL,
  claimed_at bigint,
  sent_at bigint
);
CREATE INDEX IF NOT EXISTS email_outbox_pending ON email_outbox (id) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS expiry_notices (
  member_id uuid NOT NULL,
  doc_type text NOT NULL,
  valid_through date NOT NULL,
  notice_kind text NOT NULL,
  PRIMARY KEY (member_id, doc_type, valid_through, notice_kind)
);
`;
