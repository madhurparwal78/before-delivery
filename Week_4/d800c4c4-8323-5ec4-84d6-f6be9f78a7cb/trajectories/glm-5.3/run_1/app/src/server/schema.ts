// Schema and seed data. Applied idempotently on every serve, safe when several processes start together.

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  time_zone text NOT NULL DEFAULT 'America/Chicago',
  late_fee_cents integer NOT NULL DEFAULT 250,
  damage_fee_cents integer NOT NULL DEFAULT 1500,
  loan_period_days integer NOT NULL DEFAULT 7
);

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('coordinator','volunteer','member')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_activity timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id serial PRIMARY KEY,
  user_id integer NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending-payment','active','lapsed')),
  tier text NOT NULL CHECK (tier IN ('pay-what-you-can','standard','supporter')),
  active_until date,
  ends_at_term boolean NOT NULL DEFAULT false,
  killbill_account_id text,
  killbill_subscription_id text,
  killbill_invoice_id text
);

CREATE TABLE IF NOT EXISTS opening_hours (
  weekday text PRIMARY KEY CHECK (weekday IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
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
  replacement_cost_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'on-wall' CHECK (status IN ('on-wall','reserved','out','pending-photo','incomplete','held')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parts (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  name text NOT NULL,
  shape text NOT NULL CHECK (shape IN ('drill','saw','ladder','hammer','wrench','case','battery','cable','blade','generic')),
  col integer NOT NULL,
  row integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  state text NOT NULL DEFAULT 'hung' CHECK (state IN ('hung','out','missing')),
  UNIQUE (item_id, col, row)
);

CREATE TABLE IF NOT EXISTS loans (
  id serial PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  member_id integer NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('reserved','out','pending-photo','returned-partial','returned-complete')),
  checked_out_at timestamptz,
  due_date date,
  returned_at timestamptz,
  returned_day date,
  open_days_late int,
  late_fee_so_far_cents int,
  fee_rules jsonb,
  loan_seq integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loan_items (
  loan_id integer NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  item_id integer NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  grade text CHECK (grade IN ('good','worn','damaged')),
  PRIMARY KEY (loan_id, item_id)
);

CREATE TABLE IF NOT EXISTS holds (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  member_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','ready','collected','cancelled')),
  placed_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz
);

CREATE TABLE IF NOT EXISTS fees (
  id serial PRIMARY KEY,
  loan_id integer NOT NULL REFERENCES loans(id),
  member_id integer NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'raised' CHECK (status IN ('raised','settled','waived-by-coordinator')),
  total_cents integer NOT NULL,
  lines jsonb NOT NULL,
  killbill_invoice_id text,
  killbill_invoice_number text
);

CREATE TABLE IF NOT EXISTS waivers (
  fee_id integer PRIMARY KEY REFERENCES fees(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('requested','approved','declined')),
  reason text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE TABLE IF NOT EXISTS photos (
  id serial PRIMARY KEY,
  loan_id integer NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('checkout','checkin')),
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  sha256 text NOT NULL,
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  storage_key text NOT NULL
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id serial PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS reminders (
  loan_id integer NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (loan_id, due_date)
);

CREATE TABLE IF NOT EXISTS hold_notices (
  hold_id integer PRIMARY KEY REFERENCES holds(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fee_notices (
  fee_id integer PRIMARY KEY REFERENCES fees(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promotion_locks (
  item_id integer PRIMARY KEY
);

CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
CREATE INDEX IF NOT EXISTS idx_holds_item ON holds(item_id, status);
CREATE INDEX IF NOT EXISTS idx_loan_items_loan ON loan_items(loan_id);
CREATE INDEX IF NOT EXISTS idx_photos_loan ON photos(loan_id, event);
`;

export interface SeedPart {
  name: string;
  shape: 'drill' | 'saw' | 'ladder' | 'hammer' | 'wrench' | 'case' | 'battery' | 'cable' | 'blade' | 'generic';
  width: number;
  height: number;
}

export interface SeedItem {
  tag: string;
  name: string;
  replacement_cost_cents: number;
  parts: SeedPart[];
}

export const SEED_ITEMS: SeedItem[] = [
  {
    tag: 'PW-101',
    name: 'Cordless drill kit',
    replacement_cost_cents: 18900,
    parts: [
      { name: 'Drill body', shape: 'drill', width: 3, height: 3 },
      { name: 'Battery A', shape: 'battery', width: 2, height: 2 },
      { name: 'Battery B', shape: 'battery', width: 2, height: 2 },
      { name: 'Charger', shape: 'case', width: 3, height: 2 },
    ],
  },
  { tag: 'PW-102', name: 'Tile saw', replacement_cost_cents: 24000, parts: [{ name: 'Tile saw', shape: 'saw', width: 4, height: 3 }] },
  { tag: 'PW-103', name: 'Step ladder', replacement_cost_cents: 9500, parts: [{ name: 'Step ladder', shape: 'ladder', width: 2, height: 8 }] },
  {
    tag: 'PW-104',
    name: 'Socket set kit',
    replacement_cost_cents: 6800,
    parts: [
      { name: 'Case', shape: 'case', width: 4, height: 2 },
      { name: 'Ratchet', shape: 'wrench', width: 2, height: 3 },
      { name: 'Extension bar', shape: 'generic', width: 2, height: 4 },
      { name: 'Metric socket tray', shape: 'case', width: 3, height: 2 },
      { name: 'Imperial socket tray', shape: 'case', width: 3, height: 2 },
      { name: 'Spark plug socket', shape: 'generic', width: 2, height: 2 },
    ],
  },
  {
    tag: 'PW-105',
    name: 'Orbital sander kit',
    replacement_cost_cents: 7900,
    parts: [
      { name: 'Sander', shape: 'generic', width: 3, height: 3 },
      { name: 'Dust bag', shape: 'generic', width: 2, height: 2 },
      { name: 'Sandpaper pack', shape: 'blade', width: 2, height: 2 },
    ],
  },
  { tag: 'PW-106', name: 'Claw hammer', replacement_cost_cents: 1800, parts: [{ name: 'Claw hammer', shape: 'hammer', width: 2, height: 4 }] },
  { tag: 'PW-107', name: 'Stud finder', replacement_cost_cents: 3200, parts: [{ name: 'Stud finder', shape: 'generic', width: 2, height: 3 }] },
  {
    tag: 'PW-108',
    name: 'Pressure washer kit',
    replacement_cost_cents: 31000,
    parts: [
      { name: 'Washer unit', shape: 'generic', width: 4, height: 4 },
      { name: 'Hose', shape: 'cable', width: 3, height: 3 },
      { name: 'Lance', shape: 'generic', width: 2, height: 6 },
      { name: 'Nozzle set', shape: 'case', width: 2, height: 2 },
    ],
  },
  { tag: 'PW-109', name: 'Hedge trimmer', replacement_cost_cents: 12000, parts: [{ name: 'Hedge trimmer', shape: 'saw', width: 5, height: 2 }] },
  { tag: 'PW-110', name: 'Pipe wrench', replacement_cost_cents: 2600, parts: [{ name: 'Pipe wrench', shape: 'wrench', width: 2, height: 5 }] },
  { tag: 'PW-111', name: 'Laser level', replacement_cost_cents: 8500, parts: [{ name: 'Laser level', shape: 'generic', width: 3, height: 2 }] },
  {
    tag: 'PW-112',
    name: 'Jigsaw kit',
    replacement_cost_cents: 9900,
    parts: [
      { name: 'Jigsaw', shape: 'saw', width: 3, height: 3 },
      { name: 'Blade case', shape: 'blade', width: 2, height: 2 },
    ],
  },
];

export const SEED_STAFF = [
  { name: 'Rosalind Okafor', email: 'coordinator@pegworth.example', password: 'coordinator-pass-1', role: 'coordinator' as const },
  { name: 'Tomasz Brennan', email: 'tomasz@pegworth.example', password: 'volunteer-pass-1', role: 'volunteer' as const },
  { name: 'Priya Halloran', email: 'priya@pegworth.example', password: 'volunteer-pass-2', role: 'volunteer' as const },
];

export const SEED_MEMBERS = [
  { name: 'Ada Mwangi', email: 'ada@members.example', password: 'member-pass-ada', tier: 'standard' as const },
  { name: 'Ben Castillo', email: 'ben@members.example', password: 'member-pass-ben', tier: 'pay-what-you-can' as const },
  { name: 'Cleo Danforth', email: 'cleo@members.example', password: 'member-pass-cleo', tier: 'supporter' as const },
  { name: 'Eli Nakamura', email: 'eli@members.example', password: 'member-pass-eli', tier: 'standard' as const },
];

export const SEED_LOANS = [
  { ref: 'L-0001', memberEmail: 'ada@members.example', itemTags: ['PW-102'], checkedOutAt: '2026-10-03T11:00:00', dueDate: '2026-10-10' },
  {
    ref: 'L-0002',
    memberEmail: 'ben@members.example',
    itemTags: ['PW-101', 'PW-106'],
    checkedOutAt: '2026-10-15T17:00:00',
    dueDate: '2026-10-22',
  },
  { ref: 'L-0003', memberEmail: 'eli@members.example', itemTags: ['PW-104'], checkedOutAt: '2026-10-18T13:00:00', dueDate: '2026-10-25' },
  { ref: 'L-0004', memberEmail: 'cleo@members.example', itemTags: ['PW-108'], checkedOutAt: '2026-10-24T10:30:00', dueDate: '2026-10-31' },
];

export const SEED_CLOSURES = [
  { date: '2026-10-17', reason: 'Volunteer training day' },
  { date: '2026-11-26', reason: 'Thanksgiving' },
  { date: '2026-12-24', reason: 'Christmas Eve' },
  { date: '2026-12-26', reason: 'Winter stocktake' },
];

export const BOARD_COLUMNS = 10;

/** Place a part rectangle at the first position where it fits without overlap. */
export function placePart(
  width: number,
  height: number,
  occupied: (col: number, row: number) => boolean,
): { col: number; row: number } {
  for (let row = 0; row < 1000; row++) {
    for (let col = 0; col <= BOARD_COLUMNS - width; col++) {
      if (fits(col, row, width, height, occupied)) return { col, row };
    }
  }
  throw new Error('board overflow');
}

function fits(col: number, row: number, width: number, height: number, occupied: (col: number, row: number) => boolean): boolean {
  for (let r = row; r < row + height; r++) {
    for (let c = col; c < col + width; c++) {
      if (occupied(c, r)) return false;
    }
  }
  return true;
}
