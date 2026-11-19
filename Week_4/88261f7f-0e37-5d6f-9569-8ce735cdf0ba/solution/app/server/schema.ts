import { database } from "./db";
import { seedLarkspur } from "./seed";

const SCHEMA_LOCK = 727_001;

const DDL = `
CREATE TABLE IF NOT EXISTS hotels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  time_zone text NOT NULL,
  business_date date NOT NULL,
  clock_now timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','front_desk','housekeeper')),
  password_hash text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (lower(email));
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  number text NOT NULL,
  type text NOT NULL,
  status text NOT NULL CHECK (status IN ('dirty','clean','inspected','out_of_order')),
  UNIQUE (hotel_id, number)
);
CREATE TABLE IF NOT EXISTS rate_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  name text NOT NULL,
  weeknight_cents int NOT NULL,
  weekend_cents int NOT NULL
);
CREATE TABLE IF NOT EXISTS tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  hundredths int NOT NULL,
  start_date date
);
CREATE UNIQUE INDEX IF NOT EXISTS tax_rates_start ON tax_rates (hotel_id, COALESCE(start_date, '0001-01-01'));
CREATE TABLE IF NOT EXISTS guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  name text NOT NULL,
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS guests_email ON guests (hotel_id, lower(email));
CREATE TABLE IF NOT EXISTS stays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  guest_id uuid NOT NULL REFERENCES guests(id),
  rate_plan_id uuid NOT NULL REFERENCES rate_plans(id),
  guests int NOT NULL,
  arrival date NOT NULL,
  departure date NOT NULL,
  status text NOT NULL CHECK (status IN ('booked','in_house','checked_out','cancelled','no_show')),
  version int NOT NULL DEFAULT 1,
  checked_in_night date,
  checked_in_online boolean NOT NULL DEFAULT false,
  online_full_name text,
  online_phone text,
  id_photo boolean NOT NULL DEFAULT false,
  link_token text,
  link_state text NOT NULL DEFAULT 'not_sent' CHECK (link_state IN ('not_sent','sent','ended')),
  link_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stays_link_token ON stays (link_token) WHERE link_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS stays_hotel ON stays (hotel_id, arrival);
CREATE TABLE IF NOT EXISTS stay_nights (
  stay_id uuid NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
  night date NOT NULL,
  room_id uuid NOT NULL REFERENCES rooms(id),
  room_cents int NOT NULL,
  city_tax_cents int NOT NULL,
  tax_cents int,
  posted boolean NOT NULL DEFAULT false,
  holds boolean NOT NULL DEFAULT true,
  PRIMARY KEY (stay_id, night)
);
CREATE UNIQUE INDEX IF NOT EXISTS stay_nights_hold ON stay_nights (room_id, night) WHERE holds;
CREATE INDEX IF NOT EXISTS stay_nights_night ON stay_nights (night);
CREATE TABLE IF NOT EXISTS closed_days (
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  business_date date NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (hotel_id, business_date)
);
CREATE TABLE IF NOT EXISTS folios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  stay_id uuid NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
  name text NOT NULL,
  payer_name text NOT NULL,
  payer_email text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','closed'))
);
CREATE INDEX IF NOT EXISTS folios_stay ON folios (stay_id);
CREATE TABLE IF NOT EXISTS entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigserial,
  folio_id uuid NOT NULL REFERENCES folios(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('charge','payment')),
  date date NOT NULL,
  description text NOT NULL,
  amount_cents int NOT NULL,
  room_number text,
  reverses_entry_id uuid REFERENCES entries(id),
  split_of_entry_id uuid REFERENCES entries(id)
);
CREATE INDEX IF NOT EXISTS entries_folio ON entries (folio_id, seq);
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  folio_id uuid NOT NULL UNIQUE REFERENCES folios(id),
  sequence int NOT NULL,
  number text NOT NULL,
  bill_to_name text NOT NULL,
  payer_email text NOT NULL,
  mail_state text NOT NULL DEFAULT 'not_sent' CHECK (mail_state IN ('not_sent','sent')),
  UNIQUE (hotel_id, sequence)
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  hotel_id uuid NOT NULL REFERENCES hotels(id),
  key text NOT NULL,
  fingerprint text NOT NULL,
  stay_id uuid REFERENCES stays(id) ON DELETE CASCADE,
  response jsonb,
  PRIMARY KEY (hotel_id, key)
);
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS response jsonb;
`;

/** Applies the schema and the first-start seed; safe when several copies start at once. */
export async function prepareDatabase(): Promise<void> {
  const client = await database().connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
    await client.query(DDL);
    await seedLarkspur(client);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]).catch(() => undefined);
    client.release();
  }
}
