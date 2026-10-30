import { Pool } from "pg";
import * as crypto from "node:crypto";

export function passwordHash(password: string, salt: string): string {
  return crypto.scryptSync(password, Buffer.from(salt, "hex"), 32).toString("hex");
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const candidate = passwordHash(password, salt);
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_secrets (
  id text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('member','volunteer','founder')),
  phone text NOT NULL DEFAULT '',
  password_salt text NOT NULL,
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS library (
  id text PRIMARY KEY,
  name text NOT NULL,
  time_zone text NOT NULL,
  open_days text[] NOT NULL,
  closed_dates text[] NOT NULL,
  opening_time text NOT NULL,
  closing_time text NOT NULL,
  max_active_per_member int NOT NULL
);

CREATE TABLE IF NOT EXISTS late_fee_schedule (
  effective_from date NOT NULL,
  cents_per_day int NOT NULL,
  PRIMARY KEY (effective_from)
);

CREATE TABLE IF NOT EXISTS items (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  deposit_cents int NOT NULL,
  replacement_cents int NOT NULL,
  sort_index int NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES items(id),
  label text NOT NULL,
  lane_index int NOT NULL,
  UNIQUE (item_id, lane_index)
);

CREATE TABLE IF NOT EXISTS holds (
  id uuid PRIMARY KEY,
  item_id text NOT NULL REFERENCES items(id),
  unit_id text NOT NULL REFERENCES units(id),
  member_id text NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('requested','ready','collected','expired','cancelled')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  ready_at timestamptz,
  pickup_deadline timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loans (
  id uuid PRIMARY KEY,
  item_id text NOT NULL REFERENCES items(id),
  unit_id text NOT NULL REFERENCES units(id),
  member_id text NOT NULL REFERENCES users(id),
  hold_id uuid REFERENCES holds(id),
  status text NOT NULL CHECK (status IN ('out','returned','inspected','settled')),
  checked_out_at timestamptz NOT NULL,
  due_date date NOT NULL,
  renewed_at timestamptz,
  returned_at timestamptz,
  on_time boolean,
  late_days int,
  deposit_cents int NOT NULL,
  replacement_cents int NOT NULL
);

CREATE TABLE IF NOT EXISTS inspections (
  loan_id uuid PRIMARY KEY REFERENCES loans(id),
  outcome text NOT NULL CHECK (outcome IN ('ok','damaged')),
  note text NOT NULL,
  inspected_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS settlements (
  loan_id uuid PRIMARY KEY REFERENCES loans(id),
  deposit_cents int NOT NULL,
  released_cents int NOT NULL,
  damage_cents int NOT NULL,
  damage_from_deposit_cents int NOT NULL,
  extra_damage_cents int NOT NULL,
  late_days int NOT NULL,
  late_fee_cents int NOT NULL,
  total_charged_cents int NOT NULL,
  settled_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS fixed_damage_charges (
  loan_id uuid PRIMARY KEY REFERENCES loans(id),
  damage_cents int NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id uuid PRIMARY KEY,
  loan_id uuid NOT NULL REFERENCES loans(id),
  stage text NOT NULL CHECK (stage IN ('checkout','return')),
  content_type text NOT NULL,
  size_bytes int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loan_id, stage, created_at, id)
);

CREATE INDEX IF NOT EXISTS photos_loan_stage_idx ON photos (loan_id, stage, created_at, id);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY,
  loan_id uuid NOT NULL REFERENCES loans(id),
  item_id text NOT NULL REFERENCES items(id),
  kind text NOT NULL CHECK (kind IN ('deposit_hold','deposit_release','damage_charge','extra_damage','late_fee')),
  amount_cents int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ledger_loan_idx ON ledger_entries (loan_id);
CREATE INDEX IF NOT EXISTS ledger_created_idx ON ledger_entries (created_at, id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id text NOT NULL REFERENCES users(id),
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  request_hash text NOT NULL,
  response_status int,
  response_body text,
  in_progress boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id uuid PRIMARY KEY,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  claimed_by text,
  claimed_at timestamptz
);

CREATE INDEX IF NOT EXISTS email_unsent_idx ON email_outbox (created_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS due_reminders (
  loan_id uuid NOT NULL REFERENCES loans(id),
  due_at timestamptz NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (loan_id, due_at)
);
`;

interface SeedPerson {
  id: string;
  name: string;
  role: "member" | "volunteer" | "founder";
  email: string;
  phone: string;
}

const SEED_PEOPLE: SeedPerson[] = [
  { id: "usr-rosa", name: "Rosa Lindqvist", role: "founder", email: "rosa@commonshed.example", phone: "555-0100" },
  { id: "usr-dev", name: "Dev Okafor", role: "volunteer", email: "dev@commonshed.example", phone: "555-0101" },
  { id: "usr-ines", name: "Ines Marchetti", role: "volunteer", email: "ines@commonshed.example", phone: "555-0102" },
  { id: "mem-hal", name: "Hal Brennan", role: "member", email: "hal@members.example", phone: "555-0141" },
  { id: "mem-mina", name: "Mina Castellanos", role: "member", email: "mina@members.example", phone: "555-0142" },
  { id: "mem-tobi", name: "Tobi Adeyemi", role: "member", email: "tobi@members.example", phone: "555-0143" },
  { id: "mem-wren", name: "Wren Kowalski", role: "member", email: "wren@members.example", phone: "555-0144" },
  { id: "mem-sol", name: "Sol Navarro", role: "member", email: "sol@members.example", phone: "555-0145" },
  { id: "mem-juno", name: "Juno Achterberg", role: "member", email: "juno@members.example", phone: "555-0146" },
];

interface SeedItem {
  id: string;
  name: string;
  category: string;
  labels: string[];
  depositCents: number | null;
  replacementCents: number;
}

const SEED_ITEMS: SeedItem[] = [
  { id: "tile-saw", name: "7-inch wet tile saw", category: "Masonry", labels: ["TS-1", "TS-2"], depositCents: 5000, replacementCents: 18900 },
  { id: "pressure-washer", name: "Electric pressure washer", category: "Cleaning", labels: ["PW-1", "PW-2", "PW-3"], depositCents: 4000, replacementCents: 24900 },
  { id: "carpet-cleaner", name: "Carpet cleaner", category: "Cleaning", labels: ["CC-1", "CC-2"], depositCents: 6000, replacementCents: 32900 },
  { id: "floor-sander", name: "Orbital floor sander", category: "Power tools", labels: ["FS-1", "FS-2"], depositCents: 7500, replacementCents: 89900 },
  { id: "laser-level", name: "Self-levelling laser", category: "Measuring", labels: ["LL-1"], depositCents: 2500, replacementCents: 13900 },
  { id: "ext-ladder", name: "24-foot extension ladder", category: "Ladders", labels: ["LD-1"], depositCents: null, replacementCents: 21900 },
  { id: "drill-driver", name: "Cordless drill driver", category: "Power tools", labels: ["DR-1", "DR-2", "DR-3", "DR-4"], depositCents: null, replacementCents: 12900 },
  { id: "hedge-trimmer", name: "Hedge trimmer", category: "Garden", labels: ["HT-1", "HT-2"], depositCents: null, replacementCents: 9900 },
  { id: "post-hole-digger", name: "Post hole digger", category: "Garden", labels: ["PH-1"], depositCents: null, replacementCents: 4500 },
  { id: "stud-finder", name: "Stud finder", category: "Hand tools", labels: ["SF-1", "SF-2"], depositCents: null, replacementCents: 2499 },
];

export async function migrateAndSeed(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA_SQL);

    await client.query(
      "INSERT INTO app_secrets (id, value) VALUES ('session', $1), ('cursor', $2) ON CONFLICT (id) DO NOTHING",
      [crypto.randomBytes(32).toString("hex"), crypto.randomBytes(32).toString("hex")],
    );

    await client.query(
      `INSERT INTO library (id, name, time_zone, open_days, closed_dates, opening_time, closing_time, max_active_per_member)
       VALUES ('library', 'Common Shed — Eastgate', 'America/New_York',
               ARRAY['tue','wed','thu','fri','sat','sun']::text[],
               ARRAY['2026-07-04','2026-11-26','2026-12-25','2026-12-26']::text[],
               '10:00', '18:00', 4)
       ON CONFLICT (id) DO NOTHING`,
    );

    await client.query(
      `INSERT INTO late_fee_schedule (effective_from, cents_per_day) VALUES
        ('2026-01-06', 50), ('2026-09-01', 100)
       ON CONFLICT (effective_from) DO NOTHING`,
    );

    for (const person of SEED_PEOPLE) {
      const salt = crypto.randomBytes(16).toString("hex");
      await client.query(
        `INSERT INTO users (id, email, name, role, phone, password_salt, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
        [person.id, person.email, person.name, person.role, person.phone, salt, passwordHash("pegboard-2026", salt)],
      );
    }

    for (const [index, item] of SEED_ITEMS.entries()) {
      await client.query(
        `INSERT INTO items (id, name, category, deposit_cents, replacement_cents, sort_index)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [item.id, item.name, item.category, item.depositCents ?? 0, item.replacementCents, index],
      );
      for (const [laneIndex, label] of item.labels.entries()) {
        await client.query(
          `INSERT INTO units (id, item_id, label, lane_index)
           VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
          [`${item.id}-${laneIndex + 1}`, item.id, label, laneIndex],
        );
      }
    }
  } finally {
    client.release();
  }
}

export async function readSecret(pool: Pool, id: string): Promise<string> {
  const result = await pool.query("SELECT value FROM app_secrets WHERE id = $1", [id]);
  if (result.rowCount === null || result.rowCount === 0) {
    throw new Error(`Secret ${id} is missing`);
  }
  return result.rows[0].value as string;
}
