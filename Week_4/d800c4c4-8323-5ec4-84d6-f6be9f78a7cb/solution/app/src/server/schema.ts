import type pg from "pg";
import { hashPassword } from "./domain/session.js";
import { placeParts, type Placement } from "./domain/board.js";
import { wallClockInstant } from "./domain/time.js";
import { transaction } from "./db.js";
import { dueDateFor, loadCalendar, loadSettings } from "./domain/calendar.js";
import { recordFeeRules } from "./domain/fees.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_meta (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('coordinator','volunteer','member')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
  user_id integer PRIMARY KEY REFERENCES users(id),
  tier text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending-payment','active')),
  ends_at_term boolean NOT NULL DEFAULT false,
  active_until date,
  killbill_account_id text,
  killbill_subscription_id text
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS settings (
  id integer PRIMARY KEY CHECK (id = 1),
  time_zone text NOT NULL,
  late_fee_cents integer NOT NULL,
  damage_fee_cents integer NOT NULL,
  loan_period_days integer NOT NULL
);
CREATE TABLE IF NOT EXISTS opening_hours (
  weekday text PRIMARY KEY,
  opens text NOT NULL,
  closes text NOT NULL
);
CREATE TABLE IF NOT EXISTS closures (
  date date PRIMARY KEY,
  reason text NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id serial PRIMARY KEY,
  tag text NOT NULL UNIQUE,
  name text NOT NULL,
  replacement_cost_cents integer NOT NULL
);
CREATE TABLE IF NOT EXISTS parts (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES items(id),
  name text NOT NULL,
  shape text NOT NULL,
  col integer NOT NULL,
  "row" integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  state text NOT NULL CHECK (state IN ('hung','out','missing'))
);
CREATE INDEX IF NOT EXISTS parts_item ON parts(item_id);
CREATE SEQUENCE IF NOT EXISTS loan_ref_seq START 5;
CREATE TABLE IF NOT EXISTS loans (
  id serial PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  member_id integer NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('reserved','out','pending-photo','returned-partial','returned-complete')),
  requested_checked_out_at timestamptz,
  checked_out_at timestamptz,
  due_date date,
  fee_rules jsonb,
  returned_at timestamptz,
  recorded_open_days_late integer,
  recorded_late_fee_cents integer
);
CREATE INDEX IF NOT EXISTS loans_status ON loans(status);
CREATE TABLE IF NOT EXISTS loan_items (
  loan_id integer NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  item_id integer NOT NULL REFERENCES items(id),
  position integer NOT NULL,
  grade text CHECK (grade IN ('good','worn','damaged')),
  PRIMARY KEY (loan_id, item_id)
);
CREATE INDEX IF NOT EXISTS loan_items_item ON loan_items(item_id);
CREATE TABLE IF NOT EXISTS photos (
  id serial PRIMARY KEY,
  loan_id integer NOT NULL REFERENCES loans(id),
  event text NOT NULL CHECK (event IN ('checkout','checkin')),
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  sha256 text NOT NULL,
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  object_key text NOT NULL,
  UNIQUE (loan_id, event)
);
CREATE TABLE IF NOT EXISTS holds (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES items(id),
  member_id integer NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('queued','ready','collected','cancelled')),
  placed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS holds_one_active ON holds(item_id, member_id) WHERE status IN ('queued','ready');
CREATE TABLE IF NOT EXISTS fees (
  id serial PRIMARY KEY,
  loan_id integer NOT NULL UNIQUE REFERENCES loans(id),
  member_id integer NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('raised','settled','waived-by-coordinator')),
  total_cents integer NOT NULL,
  killbill_invoice_id text NOT NULL,
  killbill_invoice_number text NOT NULL,
  waiver_status text CHECK (waiver_status IN ('requested','approved','declined')),
  waiver_reason text,
  waiver_requested_at timestamptz,
  waiver_decided_at timestamptz
);
CREATE TABLE IF NOT EXISTS fee_lines (
  fee_id integer NOT NULL REFERENCES fees(id),
  position integer NOT NULL,
  item_id integer NOT NULL REFERENCES items(id),
  kind text NOT NULL CHECK (kind IN ('late','damage')),
  open_days integer,
  amount_cents integer NOT NULL,
  description text NOT NULL,
  PRIMARY KEY (fee_id, position)
);
CREATE TABLE IF NOT EXISTS reminders (
  loan_id integer NOT NULL REFERENCES loans(id),
  due_date date NOT NULL,
  PRIMARY KEY (loan_id, due_date)
);
CREATE TABLE IF NOT EXISTS mail_outbox (
  id serial PRIMARY KEY,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS mail_outbox_pending ON mail_outbox(next_attempt_at) WHERE sent_at IS NULL;
`;

const SEED_ZONE = "America/Chicago";

const STAFF = [
  ["Rosalind Okafor", "coordinator@pegworth.example", "coordinator-pass-1", "coordinator"],
  ["Tomasz Brennan", "tomasz@pegworth.example", "volunteer-pass-1", "volunteer"],
  ["Priya Halloran", "priya@pegworth.example", "volunteer-pass-2", "volunteer"],
] as const;

const MEMBERS = [
  ["Ada Mwangi", "ada@members.example", "member-pass-ada", "standard"],
  ["Ben Castillo", "ben@members.example", "member-pass-ben", "pay-what-you-can"],
  ["Cleo Danforth", "cleo@members.example", "member-pass-cleo", "supporter"],
  ["Eli Nakamura", "eli@members.example", "member-pass-eli", "standard"],
] as const;

type SeedPart = readonly [name: string, shape: string, width: number, height: number];
const ITEMS: ReadonlyArray<readonly [tag: string, name: string, cost: number, parts: readonly SeedPart[]]> = [
  ["PW-101", "Cordless drill kit", 18900, [["Drill body", "drill", 3, 3], ["Battery A", "battery", 2, 2], ["Battery B", "battery", 2, 2], ["Charger", "case", 3, 2]]],
  ["PW-102", "Tile saw", 24000, [["Tile saw", "saw", 4, 3]]],
  ["PW-103", "Step ladder", 9500, [["Step ladder", "ladder", 2, 8]]],
  ["PW-104", "Socket set kit", 6800, [["Case", "case", 4, 2], ["Ratchet", "wrench", 2, 3], ["Extension bar", "generic", 2, 4], ["Metric socket tray", "case", 3, 2], ["Imperial socket tray", "case", 3, 2], ["Spark plug socket", "generic", 2, 2]]],
  ["PW-105", "Orbital sander kit", 7900, [["Sander", "generic", 3, 3], ["Dust bag", "generic", 2, 2], ["Sandpaper pack", "blade", 2, 2]]],
  ["PW-106", "Claw hammer", 1800, [["Claw hammer", "hammer", 2, 4]]],
  ["PW-107", "Stud finder", 3200, [["Stud finder", "generic", 2, 3]]],
  ["PW-108", "Pressure washer kit", 31000, [["Washer unit", "generic", 4, 4], ["Hose", "cable", 3, 3], ["Lance", "generic", 2, 6], ["Nozzle set", "case", 2, 2]]],
  ["PW-109", "Hedge trimmer", 12000, [["Hedge trimmer", "saw", 5, 2]]],
  ["PW-110", "Pipe wrench", 2600, [["Pipe wrench", "wrench", 2, 5]]],
  ["PW-111", "Laser level", 8500, [["Laser level", "generic", 3, 2]]],
  ["PW-112", "Jigsaw kit", 9900, [["Jigsaw", "saw", 3, 3], ["Blade case", "blade", 2, 2]]],
];

const LOANS = [
  ["L-0001", "ada@members.example", ["PW-102"], "2026-10-03T11:00"],
  ["L-0002", "ben@members.example", ["PW-101", "PW-106"], "2026-10-15T17:00"],
  ["L-0003", "eli@members.example", ["PW-104"], "2026-10-18T13:00"],
  ["L-0004", "cleo@members.example", ["PW-108"], "2026-10-24T10:30"],
] as const;

async function seed(client: pg.PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO settings (id, time_zone, late_fee_cents, damage_fee_cents, loan_period_days) VALUES (1, $1, 250, 1500, 7)`,
    [SEED_ZONE],
  );
  await client.query(
    `INSERT INTO opening_hours (weekday, opens, closes) VALUES ('thursday','16:00','20:00'), ('saturday','10:00','16:00'), ('sunday','12:00','16:00')`,
  );
  await client.query(
    `INSERT INTO closures (date, reason) VALUES ('2026-10-17','Volunteer training day'), ('2026-11-26','Thanksgiving'),
       ('2026-12-24','Christmas Eve'), ('2026-12-26','Winter stocktake')`,
  );
  const userIds = new Map<string, number>();
  for (const [name, email, password, role] of STAFF) {
    const r = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`,
      [name, email, await hashPassword(password), role],
    );
    userIds.set(email, r.rows[0]!.id);
  }
  for (const [name, email, password, tier] of MEMBERS) {
    const r = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,'member') RETURNING id`,
      [name, email, await hashPassword(password)],
    );
    const id = r.rows[0]!.id;
    userIds.set(email, id);
    await client.query(`INSERT INTO memberships (user_id, tier, status) VALUES ($1,$2,'pending-payment')`, [id, tier]);
  }
  const placed: Placement[] = [];
  const items = new Map<string, { id: number; cost: number; partIds: number[] }>();
  for (const [tag, name, cost, parts] of ITEMS) {
    const r = await client.query<{ id: number }>(
      `INSERT INTO items (tag, name, replacement_cost_cents) VALUES ($1,$2,$3) RETURNING id`,
      [tag, name, cost],
    );
    const itemId = r.rows[0]!.id;
    const spots = placeParts(placed, parts.map(([, , width, height]) => ({ width, height })));
    const partIds: number[] = [];
    for (const [index, [partName, shape, width, height]] of parts.entries()) {
      const spot = spots[index]!;
      placed.push(spot);
      const p = await client.query<{ id: number }>(
        `INSERT INTO parts (item_id, name, shape, col, "row", width, height, state) VALUES ($1,$2,$3,$4,$5,$6,$7,'hung') RETURNING id`,
        [itemId, partName, shape, spot.col, spot.row, width, height],
      );
      partIds.push(p.rows[0]!.id);
    }
    items.set(tag, { id: itemId, cost, partIds });
  }
  const settings = await loadSettings(client);
  const calendar = await loadCalendar(client);
  for (const [ref, email, tags, checkedOut] of LOANS) {
    const [date, time] = checkedOut.split("T") as [string, string];
    const instant = wallClockInstant(SEED_ZONE, date, `${time}:00`, false);
    const rules = recordFeeRules(settings, tags.map((tag) => ({ id: items.get(tag)!.id, replacement_cost_cents: items.get(tag)!.cost })));
    const r = await client.query<{ id: number }>(
      `INSERT INTO loans (ref, member_id, status, checked_out_at, due_date, fee_rules) VALUES ($1,$2,'out',$3,$4,$5) RETURNING id`,
      [ref, userIds.get(email), new Date(instant), dueDateFor(calendar, instant, settings.loan_period_days), rules],
    );
    for (const [position, tag] of tags.entries()) {
      const item = items.get(tag)!;
      await client.query(`INSERT INTO loan_items (loan_id, item_id, position) VALUES ($1,$2,$3)`, [r.rows[0]!.id, item.id, position]);
      await client.query(`UPDATE parts SET state = 'out' WHERE item_id = $1`, [item.id]);
    }
  }
  await client.query(
    `INSERT INTO holds (item_id, member_id, status, placed_at) VALUES ($1,$2,'queued',$3)`,
    [items.get("PW-102")!.id, userIds.get("cleo@members.example"), new Date(wallClockInstant(SEED_ZONE, "2026-10-08", "12:00:00", false))],
  );
  await client.query(`INSERT INTO app_meta (key, value) VALUES ('seeded', 'v1')`);
}

// Applies the schema and the seed once, safely when several processes start together on one database.
export async function migrate(): Promise<void> {
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(724461)");
    await client.query(SCHEMA);
    const seeded = await client.query(`SELECT 1 FROM app_meta WHERE key = 'seeded'`);
    if (seeded.rowCount === 0) await seed(client);
  });
}
