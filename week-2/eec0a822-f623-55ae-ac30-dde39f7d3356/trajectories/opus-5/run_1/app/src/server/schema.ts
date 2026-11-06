export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS yachts (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  slug text NOT NULL,
  name text NOT NULL,
  base text NOT NULL,
  status text NOT NULL,
  cabins integer NOT NULL,
  length_cm integer NOT NULL,
  beam_cm integer NOT NULL,
  draft_cm integer NOT NULL,
  battery_kwh numeric NOT NULL,
  hotel_kw numeric NOT NULL,
  solar_kw numeric NOT NULL,
  drag_kw_per_kn_cubed numeric NOT NULL,
  shore_power_kw numeric NOT NULL,
  rate_low_minor bigint NOT NULL,
  rate_shoulder_minor bigint NOT NULL,
  rate_high_minor bigint NOT NULL,
  currency text NOT NULL,
  seed_order integer NOT NULL,
  UNIQUE (workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL,
  yacht_id text REFERENCES yachts(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  member_id text REFERENCES members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  signed_out_at timestamptz
);

CREATE TABLE IF NOT EXISTS crew (
  id text PRIMARY KEY,
  yacht_id text NOT NULL REFERENCES yachts(id),
  name text NOT NULL,
  position text NOT NULL,
  seed_order integer NOT NULL
);

CREATE TABLE IF NOT EXISTS anchorages (
  workspace_id text NOT NULL REFERENCES workspaces(id),
  id text NOT NULL,
  name text NOT NULL,
  base text NOT NULL,
  latitude numeric NOT NULL,
  longitude numeric NOT NULL,
  seed_order integer NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS marinas (
  workspace_id text NOT NULL REFERENCES workspaces(id),
  id text NOT NULL,
  name text NOT NULL,
  base text NOT NULL,
  seed_order integer NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS berths (
  workspace_id text NOT NULL,
  marina_id text NOT NULL,
  code text NOT NULL,
  length_cm integer NOT NULL,
  width_cm integer NOT NULL,
  depth_cm integer NOT NULL,
  seed_order integer NOT NULL,
  PRIMARY KEY (workspace_id, marina_id, code),
  FOREIGN KEY (workspace_id, marina_id) REFERENCES marinas(workspace_id, id)
);

CREATE TABLE IF NOT EXISTS pontoons (
  workspace_id text NOT NULL,
  marina_id text NOT NULL,
  code text NOT NULL,
  limit_kw numeric NOT NULL,
  seed_order integer NOT NULL,
  PRIMARY KEY (workspace_id, marina_id, code),
  FOREIGN KEY (workspace_id, marina_id) REFERENCES marinas(workspace_id, id)
);

CREATE TABLE IF NOT EXISTS marina_tariffs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  marina_id text NOT NULL,
  effective_date date NOT NULL,
  rate_per_metre_minor integer NOT NULL,
  currency text NOT NULL,
  UNIQUE (workspace_id, marina_id, effective_date),
  FOREIGN KEY (workspace_id, marina_id) REFERENCES marinas(workspace_id, id)
);

CREATE TABLE IF NOT EXISTS exchange_tables (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  effective_date date NOT NULL,
  rate_gbp text NOT NULL,
  rate_usd text NOT NULL,
  UNIQUE (workspace_id, effective_date)
);

CREATE TABLE IF NOT EXISTS brokers (
  workspace_id text NOT NULL REFERENCES workspaces(id),
  id text NOT NULL,
  name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL,
  notes text NOT NULL,
  seed_order integer NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS charters (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  yacht_id text NOT NULL REFERENCES yachts(id),
  hold_id text,
  week_start date NOT NULL,
  week_end date NOT NULL,
  client_name text NOT NULL,
  client_email text NOT NULL,
  currency text NOT NULL,
  season text NOT NULL,
  deposit_date date,
  exchange_table_id text,
  rate text NOT NULL,
  total_eur_minor bigint NOT NULL,
  total_minor bigint NOT NULL,
  invoice_status text NOT NULL,
  killbill_invoice_id text,
  invoiced_at timestamptz,
  status text NOT NULL,
  closed_at timestamptz,
  erases_at timestamptz,
  erased_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS charters_week_unique
  ON charters (yacht_id, week_start);

CREATE TABLE IF NOT EXISTS charter_lines (
  charter_id text NOT NULL REFERENCES charters(id) ON DELETE CASCADE,
  line_index integer NOT NULL,
  kind text NOT NULL,
  label text NOT NULL,
  eur_minor bigint NOT NULL,
  amount_minor bigint NOT NULL,
  PRIMARY KEY (charter_id, line_index)
);

CREATE TABLE IF NOT EXISTS holds (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  yacht_id text NOT NULL REFERENCES yachts(id),
  week_start date NOT NULL,
  week_end date NOT NULL,
  client_name text NOT NULL,
  placed_by_member_id text REFERENCES members(id) ON DELETE SET NULL,
  placed_by_member_name text,
  placed_by_broker_id text,
  placed_by_broker_name text,
  status text NOT NULL,
  position integer,
  placed_at timestamptz NOT NULL,
  live_since timestamptz,
  lapses_at timestamptz,
  charter_id text REFERENCES charters(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS holds_one_live_per_week
  ON holds (yacht_id, week_start) WHERE status = 'live';

CREATE TABLE IF NOT EXISTS guests (
  id text PRIMARY KEY,
  charter_id text NOT NULL REFERENCES charters(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  nationality text,
  date_of_birth date,
  passport_number text,
  photo_key text,
  photo_content_type text,
  seed_order integer NOT NULL
);

CREATE TABLE IF NOT EXISTS manifest_pages (
  id text PRIMARY KEY,
  charter_id text NOT NULL REFERENCES charters(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  lead_guest_name text NOT NULL,
  lead_guest_email text NOT NULL,
  issued_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  ended_at timestamptz
);

CREATE TABLE IF NOT EXISTS broker_pages (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  broker_id text NOT NULL,
  token text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  ended_at timestamptz
);

CREATE TABLE IF NOT EXISTS broker_hold_requests (
  id text PRIMARY KEY,
  token text NOT NULL,
  requested_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS broker_hold_requests_token_at
  ON broker_hold_requests (token, requested_at);

CREATE TABLE IF NOT EXISTS passages (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  yacht_id text NOT NULL REFERENCES yachts(id),
  name text NOT NULL,
  status text NOT NULL,
  start_anchorage_id text NOT NULL,
  departure_date date NOT NULL,
  departure_time text NOT NULL,
  departs_at timestamptz NOT NULL,
  start_charge_pct integer NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS passage_legs (
  passage_id text NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
  leg_index integer NOT NULL,
  from_anchorage_id text NOT NULL,
  to_anchorage_id text NOT NULL,
  speed_kn numeric(4,1) NOT NULL,
  PRIMARY KEY (passage_id, leg_index)
);

CREATE TABLE IF NOT EXISTS rotas (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  yacht_id text NOT NULL REFERENCES yachts(id),
  week_start date NOT NULL,
  version integer NOT NULL,
  saved_by text NOT NULL,
  saved_at timestamptz NOT NULL,
  UNIQUE (yacht_id, week_start)
);

CREATE TABLE IF NOT EXISTS rota_work (
  rota_id text NOT NULL REFERENCES rotas(id) ON DELETE CASCADE,
  crew_id text NOT NULL REFERENCES crew(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  PRIMARY KEY (rota_id, crew_id, starts_at)
);

CREATE TABLE IF NOT EXISTS berth_bookings (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  yacht_id text NOT NULL REFERENCES yachts(id),
  marina_id text NOT NULL,
  berth_code text NOT NULL,
  arrival_date date NOT NULL,
  departure_date date NOT NULL,
  total_minor bigint NOT NULL,
  currency text NOT NULL,
  booked_by_member_id text REFERENCES members(id) ON DELETE SET NULL,
  booked_by_name text NOT NULL,
  booked_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS berth_booking_nights (
  booking_id text NOT NULL REFERENCES berth_bookings(id) ON DELETE CASCADE,
  night_date date NOT NULL,
  tariff_id text NOT NULL,
  rate_per_metre_minor integer NOT NULL,
  fee_minor bigint NOT NULL,
  PRIMARY KEY (booking_id, night_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS berth_night_unique
  ON berth_booking_nights (booking_id, night_date);

CREATE TABLE IF NOT EXISTS shore_power_bookings (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  yacht_id text NOT NULL REFERENCES yachts(id),
  marina_id text NOT NULL,
  pontoon_code text NOT NULL,
  slot_start timestamptz NOT NULL,
  slot_end timestamptz NOT NULL,
  kw numeric NOT NULL,
  booked_by_member_id text REFERENCES members(id) ON DELETE SET NULL,
  booked_by_name text NOT NULL,
  booked_at timestamptz NOT NULL,
  UNIQUE (workspace_id, marina_id, pontoon_code, slot_start, yacht_id)
);

CREATE TABLE IF NOT EXISTS store_items (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  yacht_id text NOT NULL REFERENCES yachts(id),
  name text NOT NULL,
  unit text NOT NULL,
  category text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS store_items_name_unique
  ON store_items (yacht_id, lower(name));

CREATE TABLE IF NOT EXISTS store_movements (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES store_items(id) ON DELETE CASCADE,
  kind text NOT NULL,
  quantity integer NOT NULL,
  logged_by_member_id text REFERENCES members(id) ON DELETE SET NULL,
  logged_by_name text NOT NULL,
  logged_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS energy_logs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  yacht_id text NOT NULL REFERENCES yachts(id),
  file_name text NOT NULL,
  size_bytes bigint NOT NULL,
  object_key text NOT NULL,
  uploaded_at timestamptz NOT NULL,
  uploaded_by_member_id text REFERENCES members(id) ON DELETE SET NULL,
  uploaded_by_name text NOT NULL
);

CREATE TABLE IF NOT EXISTS energy_log_days (
  log_id text NOT NULL REFERENCES energy_logs(id) ON DELETE CASCADE,
  day_date date NOT NULL,
  start_charge_pct numeric NOT NULL,
  end_charge_pct numeric NOT NULL,
  lowest_charge_pct numeric NOT NULL,
  solar_wh bigint NOT NULL,
  PRIMARY KEY (log_id, day_date)
);

CREATE TABLE IF NOT EXISTS seed_state (
  id integer PRIMARY KEY,
  seeded_at timestamptz NOT NULL
);
`;
