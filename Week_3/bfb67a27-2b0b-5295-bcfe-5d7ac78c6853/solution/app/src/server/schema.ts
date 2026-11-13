import { pool, type Queryable } from './db.js';

/** Advisory lock so concurrent app instances apply the schema and seed once. */
const MIGRATION_LOCK = 4_417_209;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS kits (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  seq integer NOT NULL
);

CREATE TABLE IF NOT EXISTS unit_classes (
  id text PRIMARY KEY,
  kit_id text NOT NULL REFERENCES kits(id),
  name text NOT NULL,
  replacement_value_cents bigint NOT NULL,
  seq integer NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  serial text PRIMARY KEY,
  class_id text NOT NULL REFERENCES unit_classes(id)
);

CREATE TABLE IF NOT EXISTS rate_cards (
  version integer PRIMARY KEY,
  effective_date date NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_card_rates (
  version integer NOT NULL REFERENCES rate_cards(version),
  kit_id text NOT NULL REFERENCES kits(id),
  day_rate_cents bigint NOT NULL,
  deposit_cents bigint NOT NULL,
  PRIMARY KEY (version, kit_id)
);

CREATE SEQUENCE IF NOT EXISTS booking_ref_seq START WITH 10001 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS bookings (
  ref text PRIMARY KEY,
  kit_id text NOT NULL REFERENCES kits(id),
  state text NOT NULL,
  pickup_date date NOT NULL,
  return_date date NOT NULL,
  hire_days integer NOT NULL,
  renter_name text NOT NULL,
  renter_email text NOT NULL,
  renter_key text NOT NULL,
  billable_days integer NOT NULL,
  day_rate_cents bigint NOT NULL,
  hire_price_cents bigint NOT NULL,
  deposit_cents bigint NOT NULL,
  total_cents bigint NOT NULL,
  replacement_value_cents bigint NOT NULL,
  rate_card_version integer NOT NULL REFERENCES rate_cards(version),
  hold_expires_at timestamptz,
  payment_status text NOT NULL DEFAULT 'none',
  damage_cents bigint NOT NULL DEFAULT 0,
  refund_cents bigint NOT NULL DEFAULT 0,
  killbill_payment_id text,
  confirm_in_flight boolean NOT NULL DEFAULT false,
  confirmation_mailed boolean NOT NULL DEFAULT false,
  receipt_mailed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bookings_order_idx ON bookings (pickup_date, ref);

CREATE TABLE IF NOT EXISTS booking_units (
  booking_ref text NOT NULL REFERENCES bookings(ref),
  serial text NOT NULL REFERENCES units(serial),
  class_id text NOT NULL REFERENCES unit_classes(id),
  checked_out boolean NOT NULL DEFAULT false,
  checked_in boolean NOT NULL DEFAULT false,
  condition text,
  damage_charge_cents bigint NOT NULL DEFAULT 0,
  checkout_notes text,
  checkin_notes text,
  PRIMARY KEY (booking_ref, serial)
);

CREATE TABLE IF NOT EXISTS certificates (
  id uuid PRIMARY KEY,
  booking_ref text NOT NULL REFERENCES bookings(ref),
  status text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  size_bytes bigint NOT NULL,
  storage_key text NOT NULL,
  coverage_start date,
  coverage_end date,
  limit_cents bigint,
  reason text,
  rejection_mailed boolean NOT NULL DEFAULT false,
  seq bigserial NOT NULL
);

CREATE INDEX IF NOT EXISTS certificates_booking_idx ON certificates (booking_ref, seq DESC);

CREATE TABLE IF NOT EXISTS photos (
  id uuid PRIMARY KEY,
  booking_ref text NOT NULL REFERENCES bookings(ref),
  phase text NOT NULL,
  serial text NOT NULL,
  status text NOT NULL,
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS photos_booking_idx ON photos (booking_ref);

CREATE TABLE IF NOT EXISTS movements (
  id uuid PRIMARY KEY,
  serial text NOT NULL REFERENCES units(serial),
  at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  from_location text NOT NULL,
  to_location text NOT NULL,
  booking_ref text,
  seq bigserial NOT NULL
);

CREATE INDEX IF NOT EXISTS movements_serial_idx ON movements (serial, seq);

CREATE TABLE IF NOT EXISTS movement_entries (
  movement_id uuid NOT NULL REFERENCES movements(id),
  location text NOT NULL,
  delta integer NOT NULL,
  PRIMARY KEY (movement_id, location)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  endpoint text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response_status integer,
  response_body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (endpoint, key)
);

CREATE TABLE IF NOT EXISTS staff_sessions (
  id text PRIMARY KEY,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_passcodes (
  passcode text PRIMARY KEY,
  role text NOT NULL
);
`;

interface SeedClass {
  id: string;
  name: string;
  replacementValueCents: number;
  serials: string[];
}

interface SeedKit {
  id: string;
  name: string;
  category: string;
  classes: SeedClass[];
}

const SEED_KITS: SeedKit[] = [
  {
    id: 'kestrel-lf',
    name: 'Kestrel LF Camera Package',
    category: 'Camera',
    classes: [
      {
        id: 'kestrel-lf-body',
        name: 'Kestrel LF body',
        replacementValueCents: 4_800_000,
        serials: ['KLF-001', 'KLF-002'],
      },
      {
        id: 'halden-primes',
        name: 'Halden Prime Set',
        replacementValueCents: 3_200_000,
        serials: ['HPS-01', 'HPS-02', 'HPS-03'],
      },
      {
        id: 'field-monitor',
        name: 'Field monitor and power kit',
        replacementValueCents: 350_000,
        serials: ['FMP-01', 'FMP-02', 'FMP-03'],
      },
    ],
  },
  {
    id: 'wren-s35',
    name: 'Wren S35 Documentary Kit',
    category: 'Camera',
    classes: [
      {
        id: 'wren-s35-body',
        name: 'Wren S35 body',
        replacementValueCents: 1_400_000,
        serials: ['WS35-01'],
      },
      {
        id: 'tor-zoom',
        name: 'Tor 18-80 zoom',
        replacementValueCents: 900_000,
        serials: ['TZ-01', 'TZ-02'],
      },
    ],
  },
  {
    id: 'lantern-led',
    name: 'Lantern 4-Light LED Package',
    category: 'Lighting',
    classes: [
      {
        id: 'lantern-panels',
        name: 'Lantern panel set',
        replacementValueCents: 720_000,
        serials: ['LP-01', 'LP-02'],
      },
      {
        id: 'stand-grip-case',
        name: 'Stand and grip case',
        replacementValueCents: 130_000,
        serials: ['SG-01', 'SG-02', 'SG-03'],
      },
    ],
  },
];

const SEED_RATES: { kitId: string; dayRateCents: number; depositCents: number }[] = [
  { kitId: 'kestrel-lf', dayRateCents: 65_000, depositCents: 250_000 },
  { kitId: 'wren-s35', dayRateCents: 28_000, depositCents: 100_000 },
  { kitId: 'lantern-led', dayRateCents: 18_000, depositCents: 50_000 },
];

const SEED_PASSCODES: { passcode: string; role: string }[] = [
  { passcode: 'northbar-owner-4417', role: 'owner' },
  { passcode: 'northbar-prep-2093', role: 'prep_tech' },
];

export async function applySchemaAndSeed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query(SCHEMA_SQL);

    let kitSeq = 0;
    for (const kit of SEED_KITS) {
      kitSeq += 1;
      await client.query(
        `INSERT INTO kits (id, name, category, seq) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [kit.id, kit.name, kit.category, kitSeq],
      );
      let classSeq = 0;
      for (const unitClass of kit.classes) {
        classSeq += 1;
        await client.query(
          `INSERT INTO unit_classes (id, kit_id, name, replacement_value_cents, seq)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
          [unitClass.id, kit.id, unitClass.name, unitClass.replacementValueCents, classSeq],
        );
        for (const serial of unitClass.serials) {
          await client.query(
            `INSERT INTO units (serial, class_id) VALUES ($1, $2) ON CONFLICT (serial) DO NOTHING`,
            [serial, unitClass.id],
          );
        }
      }
    }

    await client.query(
      `INSERT INTO rate_cards (version, effective_date, published_at)
       VALUES (1, DATE '2026-01-01', TIMESTAMPTZ '2026-01-01T00:00:00Z')
       ON CONFLICT (version) DO NOTHING`,
    );
    for (const rate of SEED_RATES) {
      await client.query(
        `INSERT INTO rate_card_rates (version, kit_id, day_rate_cents, deposit_cents)
         VALUES (1, $1, $2, $3) ON CONFLICT (version, kit_id) DO NOTHING`,
        [rate.kitId, rate.dayRateCents, rate.depositCents],
      );
    }

    for (const staff of SEED_PASSCODES) {
      await client.query(
        `INSERT INTO staff_passcodes (passcode, role) VALUES ($1, $2)
         ON CONFLICT (passcode) DO NOTHING`,
        [staff.passcode, staff.role],
      );
    }

    const openings = await client.query<{ serial: string }>(
      `SELECT u.serial FROM units u
       WHERE NOT EXISTS (SELECT 1 FROM movements m WHERE m.serial = u.serial)
       ORDER BY u.serial`,
    );
    for (const row of openings.rows) {
      await insertSeedMovement(client, row.serial, 'opening', 'acquired', 'shelf');
    }

    const repairSeeded = await client.query(
      `SELECT 1 FROM movements WHERE serial = 'SG-03' AND reason = 'to_repair'`,
    );
    if (repairSeeded.rowCount === 0) {
      await insertSeedMovement(client, 'SG-03', 'to_repair', 'shelf', 'repair');
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]);
    client.release();
  }
}

async function insertSeedMovement(
  client: Queryable,
  serial: string,
  reason: string,
  from: string,
  to: string,
): Promise<void> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO movements (id, serial, reason, from_location, to_location, booking_ref)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, NULL) RETURNING id`,
    [serial, reason, from, to],
  );
  const movementId = inserted.rows[0]?.id;
  if (movementId === undefined) throw new Error(`Seed movement for ${serial} was not inserted`);
  await client.query(
    `INSERT INTO movement_entries (movement_id, location, delta)
     VALUES ($1, $2, -1), ($1, $3, 1)`,
    [movementId, from, to],
  );
}
