import { pool, transaction } from "./db.js";
import type { Cell, RateCard, Station, StationKind } from "./domain.js";
import { addDays, clockOf, kitchenDate, minutesOf, toInstant } from "./kitchenTime.js";
import { priceCells } from "./pricing.js";
import { hashPassword } from "./session.js";

// Schema and seed, applied on every serve. Every statement is idempotent: tables are created when
// missing and seed rows are inserted only when absent, so nothing is duplicated.

const DDL = `
CREATE TABLE IF NOT EXISTS kitchens (
  id text PRIMARY KEY,
  name text NOT NULL,
  timezone text NOT NULL,
  same_day_cutoff text NOT NULL
);
CREATE TABLE IF NOT EXISTS stations (
  id text PRIMARY KEY,
  kitchen_id text NOT NULL REFERENCES kitchens(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('oven','mixer','chiller','prep','range','kettle','cooler')),
  loom_order integer NOT NULL,
  UNIQUE (kitchen_id, loom_order)
);
CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY,
  kitchen_id text NOT NULL REFERENCES kitchens(id),
  business text NOT NULL,
  contact_email text NOT NULL,
  killbill_account_id text
);
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  kitchen_id text NOT NULL REFERENCES kitchens(id),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('operator','member','bookkeeper')),
  member_id text REFERENCES members(id),
  password_hash text NOT NULL,
  CHECK ((role = 'member') = (member_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_cards (
  id text PRIMARY KEY,
  kitchen_id text NOT NULL REFERENCES kitchens(id),
  effective_from date NOT NULL,
  tier_rates_cents integer[] NOT NULL CHECK (cardinality(tier_rates_cents) = 4),
  station_surcharges_cents jsonb NOT NULL,
  cancellation_window_hours integer NOT NULL CHECK (cancellation_window_hours BETWEEN 0 AND 336),
  pack_price_cents integer NOT NULL CHECK (pack_price_cents > 0),
  created_at timestamptz NOT NULL,
  UNIQUE (kitchen_id, effective_from)
);
CREATE TABLE IF NOT EXISTS holds (
  id text PRIMARY KEY,
  kitchen_id text NOT NULL REFERENCES kitchens(id),
  member_id text NOT NULL REFERENCES members(id),
  date date NOT NULL,
  cells jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('held','released','confirmed')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS holds_by_date ON holds (kitchen_id, date) WHERE state = 'held';
CREATE TABLE IF NOT EXISTS series (
  id text PRIMARY KEY,
  kitchen_id text NOT NULL REFERENCES kitchens(id),
  member_id text NOT NULL REFERENCES members(id),
  weekday text NOT NULL,
  start text NOT NULL,
  "end" text NOT NULL,
  station_ids jsonb NOT NULL,
  weeks integer NOT NULL CHECK (weeks BETWEEN 2 AND 12),
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  kitchen_id text NOT NULL REFERENCES kitchens(id),
  member_id text NOT NULL REFERENCES members(id),
  kind text NOT NULL CHECK (kind IN ('booking','series','pack')),
  booking_ids jsonb NOT NULL,
  lines jsonb NOT NULL,
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  killbill_invoice_id text,
  issued_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id text PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  kitchen_id text NOT NULL REFERENCES kitchens(id),
  member_id text NOT NULL REFERENCES members(id),
  hold_id text REFERENCES holds(id),
  series_id text REFERENCES series(id),
  date date NOT NULL,
  state text NOT NULL CHECK (state IN ('confirmed','checked_in','completed','no_show','cancelled_in_window','cancelled_late')),
  cells jsonb NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  quarters integer NOT NULL CHECK (quarters > 0),
  lines jsonb NOT NULL,
  pack_quarters integer NOT NULL CHECK (pack_quarters >= 0),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  rate_card_id text NOT NULL REFERENCES rate_cards(id),
  cancellation_window_hours integer NOT NULL,
  confirmed_at timestamptz NOT NULL,
  invoice_id text REFERENCES invoices(id),
  refund_cents integer NOT NULL DEFAULT 0,
  cancelled_at timestamptz
);
CREATE INDEX IF NOT EXISTS bookings_by_date ON bookings (kitchen_id, date);
CREATE TABLE IF NOT EXISTS movements (
  id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id),
  kind text NOT NULL CHECK (kind IN ('purchase','draw','refund')),
  quarters integer NOT NULL CHECK (quarters > 0),
  booking_id text REFERENCES bookings(id),
  reverses text UNIQUE REFERENCES movements(id),
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
  movement_id text NOT NULL REFERENCES movements(id),
  account text NOT NULL CHECK (account IN ('member_pack','pack_sales','hours_used')),
  quarters integer NOT NULL,
  PRIMARY KEY (movement_id, account)
);
CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY,
  kitchen_id text NOT NULL REFERENCES kitchens(id),
  member_id text NOT NULL REFERENCES members(id),
  type text NOT NULL CHECK (type IN ('insurance','food_handler','kitchen_agreement')),
  state text NOT NULL CHECK (state IN ('uploaded','verified','rejected')),
  expires_on date,
  original_name text NOT NULL,
  size_bytes integer NOT NULL,
  content_type text NOT NULL,
  uploaded_at timestamptz NOT NULL,
  reject_reason text,
  file_stored boolean NOT NULL,
  CHECK ((type = 'kitchen_agreement') = (expires_on IS NULL))
);
CREATE TABLE IF NOT EXISTS reminders (
  document_id text NOT NULL REFERENCES documents(id),
  recipient text NOT NULL,
  sent_at timestamptz NOT NULL,
  PRIMARY KEY (document_id, recipient)
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id text NOT NULL REFERENCES users(id),
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  actor_user_id text REFERENCES users(id),
  entity text NOT NULL,
  entity_id text NOT NULL,
  from_state text,
  to_state text NOT NULL,
  at timestamptz NOT NULL
);
CREATE SEQUENCE IF NOT EXISTS booking_ref_seq START 3;
CREATE SEQUENCE IF NOT EXISTS invoice_ref_seq START 1;
`;

interface SeedStation {
  id: string;
  name: string;
  kind: StationKind;
  surchargeCents: number;
}

const NSC_STATIONS: SeedStation[] = [
  { id: "st-deck-1", name: "Deck oven 1", kind: "oven", surchargeCents: 600 },
  { id: "st-deck-2", name: "Deck oven 2", kind: "oven", surchargeCents: 600 },
  { id: "st-convection", name: "Convection oven", kind: "oven", surchargeCents: 450 },
  { id: "st-mixer", name: "60-quart mixer", kind: "mixer", surchargeCents: 375 },
  { id: "st-chiller", name: "Blast chiller", kind: "chiller", surchargeCents: 550 },
  { id: "st-prep-a", name: "Prep table A", kind: "prep", surchargeCents: 0 },
  { id: "st-prep-b", name: "Prep table B", kind: "prep", surchargeCents: 0 },
  { id: "st-range", name: "Six-burner range", kind: "range", surchargeCents: 225 },
  { id: "st-kettle", name: "Steam kettle", kind: "kettle", surchargeCents: 400 },
  { id: "st-walkin", name: "Walk-in cooler", kind: "cooler", surchargeCents: 125 },
];

const LARK_STATIONS: SeedStation[] = [
  { id: "st-l-oven", name: "Rack oven", kind: "oven", surchargeCents: 500 },
  { id: "st-l-mixer", name: "40-quart mixer", kind: "mixer", surchargeCents: 300 },
  { id: "st-l-kettle", name: "Jam kettle", kind: "kettle", surchargeCents: 400 },
  { id: "st-l-prep", name: "Prep table", kind: "prep", surchargeCents: 0 },
  { id: "st-l-chiller", name: "Blast chiller", kind: "chiller", surchargeCents: 500 },
  { id: "st-l-cooler", name: "Walk-in cooler", kind: "cooler", surchargeCents: 100 },
];

const KITCHENS = [
  { id: "kit-nsc", name: "Night Shift Commons", timezone: "America/Chicago", cutoff: "14:00", stations: NSC_STATIONS,
    card: { id: "rc-nsc-seed", tiers: [3200, 2950, 2725, 2500], window: 72, pack: 56000 } },
  { id: "kit-lark", name: "Larkspur Commissary", timezone: "America/New_York", cutoff: "12:00", stations: LARK_STATIONS,
    card: { id: "rc-lark-seed", tiers: [3000, 2800, 2600, 2400], window: 48, pack: 52000 } },
];

const MEMBERS = [
  { id: "mem-ember", kitchen: "kit-nsc", business: "Ember & Rye Bakery", email: "ember@pilotlight.test" },
  { id: "mem-saltline", kitchen: "kit-nsc", business: "Saltline Catering", email: "saltline@pilotlight.test" },
  { id: "mem-wren", kitchen: "kit-nsc", business: "Wren Street Dumplings", email: "wren@pilotlight.test" },
  { id: "mem-tidewater", kitchen: "kit-nsc", business: "Tidewater Granola", email: "tidewater@pilotlight.test" },
  { id: "mem-copper", kitchen: "kit-lark", business: "Copper Pot Jams", email: "copperpot@pilotlight.test" },
];

const USERS = [
  { id: "usr-dana", name: "Dana Okafor", email: "operator@nightshift.test", role: "operator", kitchen: "kit-nsc", member: null },
  { id: "usr-ember", name: "Priya Anand", email: "ember@pilotlight.test", role: "member", kitchen: "kit-nsc", member: "mem-ember" },
  { id: "usr-saltline", name: "Marcus Bell", email: "saltline@pilotlight.test", role: "member", kitchen: "kit-nsc", member: "mem-saltline" },
  { id: "usr-wren", name: "Lin Zhao", email: "wren@pilotlight.test", role: "member", kitchen: "kit-nsc", member: "mem-wren" },
  { id: "usr-tidewater", name: "Aoife Ryan", email: "tidewater@pilotlight.test", role: "member", kitchen: "kit-nsc", member: "mem-tidewater" },
  { id: "usr-ines", name: "Ines Calloway", email: "books@ledgerline.test", role: "bookkeeper", kitchen: "kit-nsc", member: null },
  { id: "usr-teo", name: "Teo Marsh", email: "operator@larkspur.test", role: "operator", kitchen: "kit-lark", member: null },
  { id: "usr-copper", name: "Sam Ortiz", email: "copperpot@pilotlight.test", role: "member", kitchen: "kit-lark", member: "mem-copper" },
];

const SEED_PASSWORD = "nightshift-demo-26";

const DOCUMENTS: { id: string; member: string; type: string; days: number | null }[] = [
  { id: "doc-ember-coi", member: "mem-ember", type: "insurance", days: 300 },
  { id: "doc-ember-fh", member: "mem-ember", type: "food_handler", days: 300 },
  { id: "doc-ember-agreement", member: "mem-ember", type: "kitchen_agreement", days: null },
  { id: "doc-saltline-coi", member: "mem-saltline", type: "insurance", days: 200 },
  { id: "doc-saltline-fh", member: "mem-saltline", type: "food_handler", days: 200 },
  { id: "doc-wren-coi", member: "mem-wren", type: "insurance", days: 10 },
  { id: "doc-wren-fh", member: "mem-wren", type: "food_handler", days: 200 },
  { id: "doc-tide-coi", member: "mem-tidewater", type: "insurance", days: -1 },
  { id: "doc-tide-fh", member: "mem-tidewater", type: "food_handler", days: 200 },
  { id: "doc-copper-coi", member: "mem-copper", type: "insurance", days: 300 },
  { id: "doc-copper-fh", member: "mem-copper", type: "food_handler", days: 300 },
];

const SEED_BOOKINGS = [
  { id: "bk-seed-1", ref: "PL-000001", member: "mem-saltline", kitchen: "kit-nsc", days: 2,
    stations: ["st-deck-1", "st-chiller"], start: "05:00", end: "07:00" },
  { id: "bk-seed-2", ref: "PL-000002", member: "mem-copper", kitchen: "kit-lark", days: 3,
    stations: ["st-l-kettle"], start: "06:00", end: "10:00" },
];

function blockCells(stations: string[], start: string, end: string): Cell[] {
  const cells: Cell[] = [];
  for (const station_id of stations) {
    for (let m = minutesOf(start); m < minutesOf(end); m += 15) cells.push({ station_id, start: clockOf(m) });
  }
  return cells;
}

export async function applySchemaAndSeed(now: Date): Promise<void> {
  await pool.query(DDL);
  const existingUsers = new Set((await pool.query<{ id: string }>("SELECT id FROM users")).rows.map((r) => r.id));
  const hashes = new Map<string, string>();
  for (const user of USERS) {
    if (!existingUsers.has(user.id)) hashes.set(user.id, await hashPassword(SEED_PASSWORD));
  }
  await transaction(async (client) => {
    for (const k of KITCHENS) {
      const today = kitchenDate(k.timezone, now);
      await client.query(
        "INSERT INTO kitchens (id, name, timezone, same_day_cutoff) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
        [k.id, k.name, k.timezone, k.cutoff],
      );
      for (const [i, s] of k.stations.entries()) {
        await client.query(
          "INSERT INTO stations (id, kitchen_id, name, kind, loom_order) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING",
          [s.id, k.id, s.name, s.kind, i + 1],
        );
      }
      await client.query(
        `INSERT INTO rate_cards (id, kitchen_id, effective_from, tier_rates_cents, station_surcharges_cents,
           cancellation_window_hours, pack_price_cents, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [k.card.id, k.id, today, k.card.tiers, JSON.stringify(Object.fromEntries(k.stations.map((s) => [s.id, s.surchargeCents]))),
          k.card.window, k.card.pack, now],
      );
    }
    for (const m of MEMBERS) {
      await client.query(
        "INSERT INTO members (id, kitchen_id, business, contact_email) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
        [m.id, m.kitchen, m.business, m.email],
      );
    }
    for (const u of USERS) {
      const hash = hashes.get(u.id);
      if (hash === undefined) continue;
      await client.query(
        `INSERT INTO users (id, kitchen_id, name, email, role, member_id, password_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [u.id, u.kitchen, u.name, u.email, u.role, u.member, hash],
      );
    }
    const nscToday = kitchenDate("America/Chicago", now);
    for (const d of DOCUMENTS) {
      const member = MEMBERS.find((m) => m.id === d.member);
      const kitchen = KITCHENS.find((k) => k.id === member?.kitchen);
      const today = kitchen ? kitchenDate(kitchen.timezone, now) : nscToday;
      await client.query(
        `INSERT INTO documents (id, kitchen_id, member_id, type, state, expires_on, original_name, size_bytes,
           content_type, uploaded_at, reject_reason, file_stored)
         VALUES ($1,$2,$3,$4,'verified',$5,$6,0,'application/pdf',$7,NULL,false) ON CONFLICT (id) DO NOTHING`,
        [d.id, member?.kitchen, d.member, d.type, d.days === null ? null : addDays(today, d.days), `${d.id}.pdf`, now],
      );
    }
    const seededPack = await client.query(
      "INSERT INTO movements (id, member_id, kind, quarters, booking_id, reverses, created_at) VALUES ('mv-seed-ember','mem-ember','purchase',80,NULL,NULL,$1) ON CONFLICT (id) DO NOTHING",
      [now],
    );
    if (seededPack.rowCount === 1) {
      await client.query(
        "INSERT INTO entries (movement_id, account, quarters) VALUES ('mv-seed-ember','member_pack',80), ('mv-seed-ember','pack_sales',-80)",
      );
    }
    for (const b of SEED_BOOKINGS) {
      const kitchen = KITCHENS.find((k) => k.id === b.kitchen);
      if (!kitchen) continue;
      const date = addDays(kitchenDate(kitchen.timezone, now), b.days);
      const stations: Station[] = kitchen.stations.map((s, i) => ({ id: s.id, name: s.name, kind: s.kind, order: i + 1 }));
      const card: RateCard = {
        id: kitchen.card.id,
        kitchen_id: kitchen.id,
        effective_from: date,
        tier_rates_cents: kitchen.card.tiers,
        station_surcharges_cents: Object.fromEntries(kitchen.stations.map((s) => [s.id, s.surchargeCents])),
        cancellation_window_hours: kitchen.card.window,
        pack_price_cents: kitchen.card.pack,
        created_at: now,
      };
      const cells = blockCells(b.stations, b.start, b.end);
      const { quote } = priceCells(cells, stations, card, date.slice(0, 7), 0, 0);
      await client.query(
        `INSERT INTO bookings (id, ref, kitchen_id, member_id, hold_id, series_id, date, state, cells, starts_at, ends_at,
           quarters, lines, pack_quarters, total_cents, rate_card_id, cancellation_window_hours, confirmed_at, invoice_id)
         VALUES ($1,$2,$3,$4,NULL,NULL,$5,'confirmed',$6,$7,$8,$9,$10,0,$11,$12,$13,$14,NULL) ON CONFLICT (id) DO NOTHING`,
        [b.id, b.ref, b.kitchen, b.member, date, JSON.stringify(cells), toInstant(kitchen.timezone, date, b.start),
          toInstant(kitchen.timezone, date, b.end), cells.length, JSON.stringify(quote.lines), quote.total_cents,
          kitchen.card.id, kitchen.card.window, now],
      );
    }
  });
}
