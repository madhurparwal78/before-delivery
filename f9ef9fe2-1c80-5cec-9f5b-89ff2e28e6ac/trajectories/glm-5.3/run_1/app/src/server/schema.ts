import { hashPassword } from "./passwords";
import { addDays, kitchenInstant, kitchenDate } from "./kitchenTime";
import { makeSeedDocumentPdf } from "./services/storageSeedPdf";

interface StationSeed {
  id: string;
  name: string;
  kind: string;
  surcharge: number;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS kitchens (
    id text PRIMARY KEY,
    name text NOT NULL,
    timezone text NOT NULL,
    same_day_cutoff text NOT NULL,
    hold_seconds int NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS members (
    id text PRIMARY KEY,
    kitchen_id text NOT NULL REFERENCES kitchens(id),
    business text NOT NULL,
    contact_email text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY,
    kitchen_id text NOT NULL REFERENCES kitchens(id),
    member_id text REFERENCES members(id),
    name text NOT NULL,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('operator','member','bookkeeper'))
  )`,
  `CREATE TABLE IF NOT EXISTS stations (
    id text PRIMARY KEY,
    kitchen_id text NOT NULL REFERENCES kitchens(id),
    name text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('oven','mixer','chiller','prep','range','kettle','cooler')),
    loom_order int NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rate_cards (
    id text PRIMARY KEY,
    kitchen_id text NOT NULL REFERENCES kitchens(id),
    effective_from date NOT NULL,
    tier_rates_cents jsonb NOT NULL,
    station_surcharges_cents jsonb NOT NULL,
    cancellation_window_hours int NOT NULL,
    pack_price_cents int NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS holds (
    id text PRIMARY KEY,
    kitchen_id text NOT NULL REFERENCES kitchens(id),
    member_id text NOT NULL REFERENCES members(id),
    date date NOT NULL,
    state text NOT NULL CHECK (state IN ('held','released','confirmed','expired')),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS hold_cells (
    hold_id text NOT NULL REFERENCES holds(id) ON DELETE CASCADE,
    kitchen_id text NOT NULL,
    date date NOT NULL,
    station_id text NOT NULL,
    start_q int NOT NULL,
    PRIMARY KEY (hold_id, station_id, start_q)
  )`,
  `CREATE INDEX IF NOT EXISTS hold_cells_lookup ON hold_cells (kitchen_id, date, station_id, start_q)`,
  `CREATE TABLE IF NOT EXISTS series (
    id text PRIMARY KEY,
    kitchen_id text NOT NULL REFERENCES kitchens(id),
    member_id text NOT NULL REFERENCES members(id),
    weekday int NOT NULL,
    start_time text NOT NULL,
    end_time text NOT NULL,
    station_ids jsonb NOT NULL,
    weeks int NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS bookings (
    id text PRIMARY KEY,
    ref text NOT NULL UNIQUE,
    kitchen_id text NOT NULL REFERENCES kitchens(id),
    member_id text NOT NULL REFERENCES members(id),
    series_id text REFERENCES series(id),
    date date NOT NULL,
    state text NOT NULL CHECK (state IN ('confirmed','checked_in','completed','no_show','cancelled_in_window','cancelled_late')),
    rate_card_id text NOT NULL REFERENCES rate_cards(id),
    cancellation_window_hours int NOT NULL,
    total_cents int NOT NULL,
    pack_quarters int NOT NULL,
    quarters int NOT NULL,
    lines jsonb NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    confirmed_at timestamptz NOT NULL,
    cancelled_at timestamptz,
    invoice_id text,
    created_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS bookings_member_date ON bookings (member_id, date)`,
  `CREATE TABLE IF NOT EXISTS booking_cells (
    booking_id text NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    kitchen_id text NOT NULL,
    date date NOT NULL,
    station_id text NOT NULL,
    start_q int NOT NULL,
    PRIMARY KEY (booking_id, station_id, start_q)
  )`,
  `CREATE INDEX IF NOT EXISTS booking_cells_lookup ON booking_cells (kitchen_id, date, station_id, start_q)`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id text PRIMARY KEY,
    ref text NOT NULL UNIQUE,
    kitchen_id text NOT NULL REFERENCES kitchens(id),
    member_id text NOT NULL REFERENCES members(id),
    kind text NOT NULL CHECK (kind IN ('booking','series','pack')),
    booking_ids jsonb NOT NULL,
    lines jsonb NOT NULL,
    total_cents int NOT NULL,
    killbill_invoice_id text,
    issued_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS movements (
    id text PRIMARY KEY,
    member_id text NOT NULL REFERENCES members(id),
    kind text NOT NULL CHECK (kind IN ('purchase','draw','refund')),
    quarters int NOT NULL,
    booking_id text REFERENCES bookings(id),
    reverses text REFERENCES movements(id),
    invoice_id text REFERENCES invoices(id),
    created_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS movement_entries (
    id bigserial PRIMARY KEY,
    movement_id text NOT NULL REFERENCES movements(id) ON DELETE CASCADE,
    account text NOT NULL CHECK (account IN ('member_pack','pack_sales','hours_used')),
    quarters int NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id text PRIMARY KEY,
    kitchen_id text NOT NULL REFERENCES kitchens(id),
    member_id text NOT NULL REFERENCES members(id),
    type text NOT NULL CHECK (type IN ('insurance','food_handler','kitchen_agreement')),
    state text NOT NULL CHECK (state IN ('uploaded','verified','rejected')),
    expires_on date,
    original_name text NOT NULL,
    size_bytes int NOT NULL,
    content_type text NOT NULL,
    storage_key text,
    reject_reason text,
    uploaded_at timestamptz NOT NULL,
    verified_at timestamptz,
    reminded_at timestamptz
  )`,
  `CREATE TABLE IF NOT EXISTS idempotency (
    user_id text NOT NULL REFERENCES users(id),
    key text NOT NULL,
    method text NOT NULL,
    path text NOT NULL,
    body_sha256 text NOT NULL,
    status int NOT NULL,
    response_body text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, key)
  )`,
  `CREATE TABLE IF NOT EXISTS audit (
    id bigserial PRIMARY KEY,
    entity text NOT NULL,
    entity_id text NOT NULL,
    from_state text,
    to_state text NOT NULL,
    actor text NOT NULL,
    at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS counters (
    name text PRIMARY KEY,
    value bigint NOT NULL
  )`,
];

const COUNTER_SEED = [
  "INSERT INTO counters (name, value) SELECT 'booking_ref', COALESCE(MAX((substring(ref from 3))::bigint), 2) FROM bookings WHERE ref ~ '^PL-[0-9]+$' ON CONFLICT (name) DO NOTHING",
  "INSERT INTO counters (name, value) SELECT 'invoice_ref', COALESCE(MAX((substring(ref from 5))::bigint), 0) FROM invoices WHERE ref ~ '^INV-[0-9]+$' ON CONFLICT (name) DO NOTHING",
  "INSERT INTO counters (name, value) SELECT 'movement_ref', COALESCE(MAX((substring(id from 5))::bigint), 0) FROM movements WHERE id ~ '^mov-[0-9]+$' ON CONFLICT (name) DO NOTHING",
];

const NSC_STATIONS: StationSeed[] = [
  { id: "st-deck-1", name: "Deck oven 1", kind: "oven", surcharge: 600 },
  { id: "st-deck-2", name: "Deck oven 2", kind: "oven", surcharge: 600 },
  { id: "st-convection", name: "Convection oven", kind: "oven", surcharge: 450 },
  { id: "st-mixer", name: "60-quart mixer", kind: "mixer", surcharge: 375 },
  { id: "st-chiller", name: "Blast chiller", kind: "chiller", surcharge: 550 },
  { id: "st-prep-a", name: "Prep table A", kind: "prep", surcharge: 0 },
  { id: "st-prep-b", name: "Prep table B", kind: "prep", surcharge: 0 },
  { id: "st-range", name: "Six-burner range", kind: "range", surcharge: 225 },
  { id: "st-kettle", name: "Steam kettle", kind: "kettle", surcharge: 400 },
  { id: "st-walkin", name: "Walk-in cooler", kind: "cooler", surcharge: 125 },
];

const LARK_STATIONS: StationSeed[] = [
  { id: "st-l-oven", name: "Rack oven", kind: "oven", surcharge: 500 },
  { id: "st-l-mixer", name: "40-quart mixer", kind: "mixer", surcharge: 300 },
  { id: "st-l-kettle", name: "Jam kettle", kind: "kettle", surcharge: 400 },
  { id: "st-l-prep", name: "Prep table", kind: "prep", surcharge: 0 },
  { id: "st-l-chiller", name: "Blast chiller", kind: "chiller", surcharge: 500 },
  { id: "st-l-cooler", name: "Walk-in cooler", kind: "cooler", surcharge: 100 },
];

export async function applySchemaAndSeed(pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, holdSeconds: number): Promise<void> {
  for (const statement of DDL) {
    await pool.query(statement);
  }

  for (const statement of COUNTER_SEED) {
    await pool.query(statement);
  }

  const existing = await pool.query("SELECT id FROM kitchens LIMIT 1");
  if (existing.rows.length > 0) {
    await pool.query("UPDATE kitchens SET hold_seconds = $1", [holdSeconds]);
    return;
  }

  const seedAt = new Date();
  const nscToday = kitchenDate(seedAt, "America/Chicago");
  const larkToday = kitchenDate(seedAt, "America/New_York");

  await pool.query(
    `INSERT INTO kitchens (id, name, timezone, same_day_cutoff, hold_seconds) VALUES
     ('kit-nsc', 'Night Shift Commons', 'America/Chicago', '14:00', $1),
     ('kit-lark', 'Larkspur Commissary', 'America/New_York', '12:00', $1)`,
    [holdSeconds]
  );

  await pool.query(
    `INSERT INTO members (id, kitchen_id, business, contact_email) VALUES
     ('mem-ember', 'kit-nsc', 'Ember & Rye Bakery', 'ember@pilotlight.test'),
     ('mem-saltline', 'kit-nsc', 'Saltline Catering', 'saltline@pilotlight.test'),
     ('mem-wren', 'kit-nsc', 'Wren Street Dumplings', 'wren@pilotlight.test'),
     ('mem-tidewater', 'kit-nsc', 'Tidewater Granola', 'tidewater@pilotlight.test'),
     ('mem-copper', 'kit-lark', 'Copper Pot Jams', 'copperpot@pilotlight.test')`
  );

  const passwordHash = await hashPassword("nightshift-demo-26");
  await pool.query(
    `INSERT INTO users (id, kitchen_id, member_id, name, email, password_hash, role) VALUES
     ('usr-dana', 'kit-nsc', NULL, 'Dana Okafor', 'operator@nightshift.test', $1, 'operator'),
     ('usr-ember', 'kit-nsc', 'mem-ember', 'Priya Anand', 'ember@pilotlight.test', $1, 'member'),
     ('usr-saltline', 'kit-nsc', 'mem-saltline', 'Marcus Bell', 'saltline@pilotlight.test', $1, 'member'),
     ('usr-wren', 'kit-nsc', 'mem-wren', 'Lin Zhao', 'wren@pilotlight.test', $1, 'member'),
     ('usr-tidewater', 'kit-nsc', 'mem-tidewater', 'Aoife Ryan', 'tidewater@pilotlight.test', $1, 'member'),
     ('usr-ines', 'kit-nsc', NULL, 'Ines Calloway', 'books@ledgerline.test', $1, 'bookkeeper'),
     ('usr-teo', 'kit-lark', NULL, 'Teo Marsh', 'operator@larkspur.test', $1, 'operator'),
     ('usr-copper', 'kit-lark', 'mem-copper', 'Sam Ortiz', 'copperpot@pilotlight.test', $1, 'member')`,
    [passwordHash]
  );

  const nscSurcharges: Record<string, number> = {};
  for (const [index, station] of NSC_STATIONS.entries()) {
    nscSurcharges[station.id] = station.surcharge;
    await pool.query(
      "INSERT INTO stations (id, kitchen_id, name, kind, loom_order) VALUES ($1, 'kit-nsc', $2, $3, $4)",
      [station.id, station.name, station.kind, index + 1]
    );
  }
  const larkSurcharges: Record<string, number> = {};
  for (const [index, station] of LARK_STATIONS.entries()) {
    larkSurcharges[station.id] = station.surcharge;
    await pool.query(
      "INSERT INTO stations (id, kitchen_id, name, kind, loom_order) VALUES ($1, 'kit-lark', $2, $3, $4)",
      [station.id, station.name, station.kind, index + 1]
    );
  }

  await pool.query(
    `INSERT INTO rate_cards (id, kitchen_id, effective_from, tier_rates_cents, station_surcharges_cents, cancellation_window_hours, pack_price_cents, created_at) VALUES
     ('rc-nsc-seed', 'kit-nsc', $1, $2, $3, 72, 56000, $5),
     ('rc-lark-seed', 'kit-lark', $4, $6, $7, 48, 52000, $5)`,
    [
      nscToday,
      JSON.stringify([3200, 2950, 2725, 2500]),
      JSON.stringify(nscSurcharges),
      larkToday,
      seedAt,
      JSON.stringify([3000, 2800, 2600, 2400]),
      JSON.stringify(larkSurcharges),
    ]
  );

  // Pack ledger: Ember & Rye holds one 20-hour pack.
  await pool.query(
    `INSERT INTO movements (id, member_id, kind, quarters, booking_id, reverses, invoice_id, created_at)
     VALUES ('mov-ember-pack', 'mem-ember', 'purchase', 80, NULL, NULL, NULL, $1)`,
    [seedAt]
  );
  await pool.query(
    `INSERT INTO movement_entries (movement_id, account, quarters) VALUES
     ('mov-ember-pack', 'member_pack', 80),
     ('mov-ember-pack', 'pack_sales', -80)`
  );

  // Seeded bookings, priced on the seed cards, no invoice and nothing in billing.
  const saltlineDate = addDays(nscToday, 2);
  const saltlineStarts = kitchenInstant(saltlineDate, "05:00", "America/Chicago");
  const saltlineEnds = kitchenInstant(saltlineDate, "07:00", "America/Chicago");
  await pool.query(
    `INSERT INTO bookings (id, ref, kitchen_id, member_id, series_id, date, state, rate_card_id,
       cancellation_window_hours, total_cents, pack_quarters, quarters, lines, starts_at, ends_at,
       confirmed_at, cancelled_at, invoice_id, created_at)
     VALUES ('bk-seed-saltline', 'PL-000001', 'kit-nsc', 'mem-saltline', NULL, $1, 'confirmed', 'rc-nsc-seed',
       72, 15100, 0, 16, $2, $3, $4, $5, NULL, NULL, $5)`,
    [
      saltlineDate,
      JSON.stringify([
        { station_id: "st-deck-1", station: "Deck oven 1", tier: 1, paid_by: "cash", quarters: 8, hours: "2.00", hourly_rate_cents: 3800, amount_cents: 7600 },
        { station_id: "st-chiller", station: "Blast chiller", tier: 1, paid_by: "cash", quarters: 8, hours: "2.00", hourly_rate_cents: 3750, amount_cents: 7500 },
      ]),
      saltlineStarts,
      saltlineEnds,
      seedAt,
    ]
  );
  for (const [stationId, q0] of [["st-deck-1", 4], ["st-chiller", 4]] as [string, number][]) {
    for (let q = q0; q < q0 + 8; q++) {
      await pool.query(
        `INSERT INTO booking_cells (booking_id, kitchen_id, date, station_id, start_q) VALUES ('bk-seed-saltline', 'kit-nsc', $1, $2, $3)`,
        [saltlineDate, stationId, q]
      );
    }
  }

  const copperDate = addDays(larkToday, 3);
  const copperStarts = kitchenInstant(copperDate, "06:00", "America/New_York");
  const copperEnds = kitchenInstant(copperDate, "10:00", "America/New_York");
  await pool.query(
    `INSERT INTO bookings (id, ref, kitchen_id, member_id, series_id, date, state, rate_card_id,
       cancellation_window_hours, total_cents, pack_quarters, quarters, lines, starts_at, ends_at,
       confirmed_at, cancelled_at, invoice_id, created_at)
     VALUES ('bk-seed-copper', 'PL-000002', 'kit-lark', 'mem-copper', NULL, $1, 'confirmed', 'rc-lark-seed',
       48, 13600, 0, 16, $2, $3, $4, $5, NULL, NULL, $5)`,
    [
      copperDate,
      JSON.stringify([
        { station_id: "st-l-kettle", station: "Jam kettle", tier: 1, paid_by: "cash", quarters: 16, hours: "4.00", hourly_rate_cents: 3400, amount_cents: 13600 },
      ]),
      copperStarts,
      copperEnds,
      seedAt,
    ]
  );
  for (let q = 8; q < 24; q++) {
    await pool.query(
      `INSERT INTO booking_cells (booking_id, kitchen_id, date, station_id, start_q) VALUES ('bk-seed-copper', 'kit-lark', $1, 'st-l-kettle', $2)`,
      [copperDate, q]
    );
  }

  // Seeded documents. Seeded PDFs are stored the first time storage is reachable.
  const pdf = makeSeedDocumentPdf();
  const documentSeeds: Array<{ id: string; member: string; type: string; expires: string | null }> = [
    { id: "doc-ember-coi", member: "mem-ember", type: "insurance", expires: addDays(nscToday, 300) },
    { id: "doc-ember-fh", member: "mem-ember", type: "food_handler", expires: addDays(nscToday, 300) },
    { id: "doc-ember-agreement", member: "mem-ember", type: "kitchen_agreement", expires: null },
    { id: "doc-saltline-coi", member: "mem-saltline", type: "insurance", expires: addDays(nscToday, 200) },
    { id: "doc-saltline-fh", member: "mem-saltline", type: "food_handler", expires: addDays(nscToday, 200) },
    { id: "doc-wren-coi", member: "mem-wren", type: "insurance", expires: addDays(nscToday, 10) },
    { id: "doc-wren-fh", member: "mem-wren", type: "food_handler", expires: addDays(nscToday, 200) },
    { id: "doc-tide-coi", member: "mem-tidewater", type: "insurance", expires: addDays(nscToday, -1) },
    { id: "doc-tide-fh", member: "mem-tidewater", type: "food_handler", expires: addDays(nscToday, 200) },
    { id: "doc-copper-coi", member: "mem-copper", type: "insurance", expires: addDays(larkToday, 300) },
    { id: "doc-copper-fh", member: "mem-copper", type: "food_handler", expires: addDays(larkToday, 300) },
  ];
  for (const doc of documentSeeds) {
    await pool.query(
      `INSERT INTO documents (id, kitchen_id, member_id, type, state, expires_on, original_name, size_bytes,
         content_type, storage_key, reject_reason, uploaded_at, verified_at, reminded_at)
       VALUES ($1, (SELECT kitchen_id FROM members WHERE id = $2), $2, $3, 'verified', $4, $5, $6,
         'application/pdf', NULL, NULL, $7, $7, NULL)`,
      [doc.id, doc.member, doc.type, doc.expires, `${doc.id}.pdf`, pdf.length, seedAt]
    );
  }
}
