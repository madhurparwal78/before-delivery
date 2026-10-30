import { pool } from './db.js';
import { allStockSkus } from './domain/catalog.js';
import { hashPassword } from './domain/passwords.js';

const DDL = `
CREATE TABLE IF NOT EXISTS app_clock (
  id int PRIMARY KEY,
  offset_ms bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS counters (
  name text PRIMARY KEY,
  value bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id bigserial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL,
  billing_account_id text,
  billing_account_key text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS reset_tokens (
  token text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS stock (
  sku text PRIMARY KEY,
  seed_stock int NOT NULL,
  stock int NOT NULL
);

CREATE TABLE IF NOT EXISTS builds (
  code text PRIMARY KEY,
  board_sku text NOT NULL,
  wing text NOT NULL,
  mast text NOT NULL,
  propulsion text NOT NULL,
  battery text NOT NULL,
  controller text NOT NULL,
  spares int NOT NULL,
  rider_kg int NOT NULL,
  gear int NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS match_results (
  id text PRIMARY KEY,
  answers jsonb NOT NULL,
  recommended text NOT NULL,
  scores jsonb NOT NULL,
  reasons jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS carts (
  id bigserial PRIMARY KEY,
  user_id bigint UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  guest_token text UNIQUE,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS cart_lines (
  id bigserial PRIMARY KEY,
  cart_id bigint NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  type text NOT NULL,
  build_code text,
  sku text NOT NULL,
  quantity int NOT NULL,
  added_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS cart_codes (
  id bigserial PRIMARY KEY,
  cart_id bigint NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  code text NOT NULL,
  added_at timestamptz NOT NULL,
  UNIQUE (cart_id, code)
);

CREATE TABLE IF NOT EXISTS shared_carts (
  token text PRIMARY KEY,
  lines jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  number text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id),
  status text NOT NULL,
  placed_at timestamptz NOT NULL,
  country text NOT NULL,
  addr_name text NOT NULL,
  addr_line1 text NOT NULL,
  addr_city text NOT NULL,
  addr_postal_code text NOT NULL,
  addr_phone text NOT NULL,
  subtotal_cents int NOT NULL,
  discounts jsonb NOT NULL,
  credits jsonb NOT NULL,
  taxable_cents int NOT NULL,
  shipping_cents int NOT NULL,
  free_shipping boolean NOT NULL,
  packed_batteries int NOT NULL,
  standalone_batteries int NOT NULL,
  dangerous_goods_cents int NOT NULL,
  taxes jsonb NOT NULL,
  tax_cents int NOT NULL,
  total_cents int NOT NULL,
  ships_on date NOT NULL,
  arrives_on date NOT NULL,
  trade_in_id bigint,
  demo_credit_id bigint,
  billing_account_key text,
  billing_invoice_id text
);

CREATE TABLE IF NOT EXISTS order_lines (
  id bigserial PRIMARY KEY,
  order_number text NOT NULL REFERENCES orders(number) ON DELETE CASCADE,
  type text NOT NULL,
  sku text NOT NULL,
  build_code text,
  name text NOT NULL,
  quantity int NOT NULL,
  unit_cents int NOT NULL,
  line_cents int NOT NULL
);

CREATE TABLE IF NOT EXISTS order_events (
  id bigserial PRIMARY KEY,
  order_number text NOT NULL REFERENCES orders(number) ON DELETE CASCADE,
  status text NOT NULL,
  at timestamptz NOT NULL,
  by_email text NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_items (
  id bigserial PRIMARY KEY,
  order_number text NOT NULL REFERENCES orders(number) ON DELETE CASCADE,
  invoice_item_id text NOT NULL,
  description text NOT NULL,
  amount_cents int NOT NULL,
  adjusted boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  state text NOT NULL,
  body_hash text NOT NULL,
  order_number text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS protection_plans (
  id bigserial PRIMARY KEY,
  order_number text NOT NULL REFERENCES orders(number) ON DELETE CASCADE,
  line_id bigint NOT NULL UNIQUE REFERENCES order_lines(id) ON DELETE CASCADE,
  term_years int NOT NULL,
  price_cents int NOT NULL,
  tax_cents int NOT NULL,
  protected_until timestamptz NOT NULL,
  voided boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS registrations (
  serial text PRIMARY KEY,
  order_number text NOT NULL REFERENCES orders(number) ON DELETE CASCADE,
  line_id bigint NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_name text NOT NULL,
  country text NOT NULL,
  registered_at timestamptz NOT NULL,
  board_warranty_ends_on date NOT NULL,
  battery_warranty_ends_on date NOT NULL
);

CREATE TABLE IF NOT EXISTS trade_ins (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL,
  brand text NOT NULL,
  model_year int NOT NULL,
  condition text NOT NULL,
  serial text NOT NULL,
  note text NOT NULL,
  quote_cents int,
  quote_expires_at timestamptz,
  reject_reason text,
  order_number text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
  id int PRIMARY KEY,
  name text NOT NULL,
  city text NOT NULL,
  country text NOT NULL,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  timezone text NOT NULL,
  opening_hours text NOT NULL
);

CREATE TABLE IF NOT EXISTS demo_slots (
  id bigint PRIMARY KEY,
  location_id int NOT NULL REFERENCES locations(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  capacity int NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS demo_slot_ids START WITH 100;

CREATE TABLE IF NOT EXISTS demo_bookings (
  id bigserial PRIMARY KEY,
  slot_id bigint NOT NULL REFERENCES demo_slots(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  attended_at timestamptz
);

CREATE TABLE IF NOT EXISTS demo_credits (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  booking_id bigint NOT NULL REFERENCES demo_bookings(id) ON DELETE CASCADE,
  amount_cents int NOT NULL,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  used_order_number text
);

CREATE TABLE IF NOT EXISTS demo_events (
  id int PRIMARY KEY,
  title text NOT NULL,
  location_id int NOT NULL REFERENCES locations(id),
  starts_on date NOT NULL,
  ends_on date NOT NULL
);

CREATE TABLE IF NOT EXISTS callbacks (
  id bigserial PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  timezone text NOT NULL,
  preferred_start_utc timestamptz NOT NULL,
  topic text NOT NULL,
  message text NOT NULL,
  build_code text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS support_cases (
  reference text PRIMARY KEY,
  email text NOT NULL,
  order_number text,
  subject text NOT NULL,
  message text NOT NULL,
  status text NOT NULL,
  opened_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS newsletter_signups (
  email text PRIMARY KEY,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS partner_applications (
  id bigserial PRIMARY KEY,
  business_name text NOT NULL,
  email text NOT NULL UNIQUE,
  country text NOT NULL,
  kind text NOT NULL,
  website text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS lookup_misses (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS notices (
  id bigserial PRIMARY KEY,
  to_email text NOT NULL,
  template text NOT NULL,
  reference text,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  locked_until timestamptz,
  created_at timestamptz NOT NULL,
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS cart_lines_cart ON cart_lines (cart_id);
CREATE INDEX IF NOT EXISTS order_lines_order ON order_lines (order_number);
CREATE INDEX IF NOT EXISTS order_events_order ON order_events (order_number);
CREATE INDEX IF NOT EXISTS orders_user ON orders (user_id, number DESC);
CREATE INDEX IF NOT EXISTS lookup_misses_email ON lookup_misses (email, at);
CREATE INDEX IF NOT EXISTS notices_pending ON notices (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS bookings_slot ON demo_bookings (slot_id);
CREATE UNIQUE INDEX IF NOT EXISTS registrations_line_serial ON registrations (serial);
`;

interface SeedStaff {
  email: string;
  password: string;
  role: string;
}

export const SEEDED_STAFF: readonly SeedStaff[] = [
  { email: 'staff@ternfoils.com', password: 'StaffPass2026', role: 'admin' },
  { email: 'dealer@ternfoils.com', password: 'DealerPass2026', role: 'dealer' },
  { email: 'support@ternfoils.com', password: 'SupportPass2026', role: 'support' },
];

const SEED_LOCATIONS: readonly [number, string, string, string, number, number, string][] = [
  [1, 'Bayfront Demo Center', 'San Juan', 'PR', 18.4655, -66.1057, 'America/Puerto_Rico'],
  [2, 'Harbor Point Rentals', 'Miami', 'US', 25.7617, -80.1918, 'America/New_York'],
  [3, 'Lakeside Foil Club', 'Austin', 'US', 30.2672, -97.7431, 'America/Chicago'],
  [4, 'North Shore Watersports', 'Toronto', 'CA', 43.6532, -79.3832, 'America/Toronto'],
  [5, 'Elbe Foil Station', 'Hamburg', 'DE', 53.5511, 9.9937, 'Europe/Berlin'],
  [6, 'Riviera Foil Lab', 'Nice', 'FR', 43.7102, 7.262, 'Europe/Paris'],
  [7, 'Coastline Demo Hub', 'Sydney', 'AU', -33.8688, 151.2093, 'Australia/Sydney'],
];

const OPENING_HOURS = 'Mon-Sun 9:00-17:00';

const EXTRA_SLOTS: readonly [number, number, string, string, number][] = [
  [22, 5, '2030-10-26T08:00:00Z', '2030-10-26T10:00:00Z', 4],
  [23, 5, '2030-10-27T09:00:00Z', '2030-10-27T11:00:00Z', 4],
  [24, 2, '2030-11-02T14:00:00Z', '2030-11-02T16:00:00Z', 4],
  [25, 2, '2030-11-03T15:00:00Z', '2030-11-03T17:00:00Z', 4],
];

const SEED_EVENTS: readonly [number, string, number, string, string][] = [
  [1, 'Spring Demo Tour', 2, '2030-04-10', '2030-04-12'],
  [2, 'Euro Demo Days', 5, '2030-05-20', '2030-05-22'],
  [3, 'Island Glide Weekend', 1, '2030-07-04', '2030-07-06'],
  [4, 'Winter Demo (past)', 3, '2020-01-13', '2020-01-15'],
];

export async function migrateAndSeed(): Promise<void> {
  await pool.query(DDL);
  await pool.query('INSERT INTO app_clock (id, offset_ms) VALUES (1, 0) ON CONFLICT (id) DO NOTHING');

  for (const [name, value] of [
    ['order_number', 100000],
    ['callback_reference', 10000],
    ['case_reference', 50000],
  ] as const) {
    await pool.query('INSERT INTO counters (name, value) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING', [name, value]);
  }

  for (const staff of SEEDED_STAFF) {
    await pool.query(
      `INSERT INTO users (email, password_hash, role, created_at)
       VALUES ($1, $2, $3, now()) ON CONFLICT (email) DO NOTHING`,
      [staff.email, hashPassword(staff.password), staff.role],
    );
  }

  for (const { sku, stock } of allStockSkus()) {
    await pool.query(
      `INSERT INTO stock (sku, seed_stock, stock) VALUES ($1, $2, $2)
       ON CONFLICT (sku) DO UPDATE SET seed_stock = EXCLUDED.seed_stock`,
      [sku, stock],
    );
  }

  for (const [id, name, city, country, lat, lon, timezone] of SEED_LOCATIONS) {
    await pool.query(
      `INSERT INTO locations (id, name, city, country, lat, lon, timezone, opening_hours)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [id, name, city, country, lat, lon, timezone, OPENING_HOURS],
    );
  }

  for (const [locationId] of SEED_LOCATIONS) {
    const base = 3 * locationId;
    const triple: [number, string, string, number][] = [
      [base - 2, '2030-06-15T10:00:00Z', '2030-06-15T12:00:00Z', 2],
      [base - 1, '2030-06-15T11:00:00Z', '2030-06-15T13:00:00Z', 1],
      [base, '2030-06-15T12:00:00Z', '2030-06-15T14:00:00Z', 3],
    ];
    for (const [id, startsAt, endsAt, capacity] of triple) {
      await pool.query(
        `INSERT INTO demo_slots (id, location_id, starts_at, ends_at, capacity)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [id, locationId, startsAt, endsAt, capacity],
      );
    }
  }

  for (const [id, locationId, startsAt, endsAt, capacity] of EXTRA_SLOTS) {
    await pool.query(
      `INSERT INTO demo_slots (id, location_id, starts_at, ends_at, capacity)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [id, locationId, startsAt, endsAt, capacity],
    );
  }

  for (const [id, title, locationId, startsOn, endsOn] of SEED_EVENTS) {
    await pool.query(
      `INSERT INTO demo_events (id, title, location_id, starts_on, ends_on)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [id, title, locationId, startsOn, endsOn],
    );
  }

  await pool.query(
    `SELECT setval('demo_slot_ids', GREATEST((SELECT COALESCE(MAX(id), 0) FROM demo_slots), 25) + 1, false)`,
  );
}
