import { Pool } from "pg";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export async function applySchema(db: Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS organisations (
      code text PRIMARY KEY,
      name text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS languages (
      code text PRIMARY KEY,
      name text NOT NULL,
      board_order int NOT NULL
    );
    CREATE TABLE IF NOT EXISTS people (
      id serial PRIMARY KEY,
      email text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      name text NOT NULL,
      role text NOT NULL,
      initials text,
      org_code text REFERENCES organisations(code),
      phone text,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS interpreter_languages (
      person_id int NOT NULL REFERENCES people(id),
      language_code text NOT NULL REFERENCES languages(code),
      PRIMARY KEY (person_id, language_code)
    );
    CREATE TABLE IF NOT EXISTS assignments (
      id serial PRIMARY KEY,
      number text NOT NULL UNIQUE,
      seq int NOT NULL UNIQUE,
      org_code text NOT NULL REFERENCES organisations(code),
      language_code text NOT NULL REFERENCES languages(code),
      setting text NOT NULL,
      start_at timestamptz NOT NULL,
      end_at timestamptz NOT NULL,
      duration_minutes int NOT NULL,
      street_address text NOT NULL,
      city text NOT NULL,
      patient_initials text NOT NULL,
      medical_notes text NOT NULL DEFAULT '',
      status text NOT NULL,
      scheduler_id int NOT NULL REFERENCES people(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS seats (
      id serial PRIMARY KEY,
      assignment_id int NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      seat int NOT NULL,
      status text NOT NULL DEFAULT 'open',
      holder_id int REFERENCES people(id),
      actual_minutes int,
      round_trip_miles int,
      form_object_key text,
      form_content_type text,
      form_size int,
      verified_at timestamptz,
      UNIQUE (assignment_id, seat)
    );
    CREATE TABLE IF NOT EXISTS hold_history (
      id serial PRIMARY KEY,
      seat_id int NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
      person_id int NOT NULL REFERENCES people(id),
      event text NOT NULL,
      at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS cancellations (
      assignment_id int PRIMARY KEY REFERENCES assignments(id) ON DELETE CASCADE,
      cancelled_at timestamptz NOT NULL,
      fee_applies boolean NOT NULL,
      business_minutes_notice int NOT NULL,
      fee_cents int NOT NULL
    );
    CREATE TABLE IF NOT EXISTS idempotency (
      scheduler_id int NOT NULL,
      key text NOT NULL,
      request_hash text NOT NULL,
      response_json text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (scheduler_id, key)
    );
    CREATE TABLE IF NOT EXISTS rate_cards (
      id serial PRIMARY KEY,
      org_code text NOT NULL REFERENCES organisations(code),
      service_line text NOT NULL,
      effective_from date NOT NULL,
      hourly_rate_cents int NOT NULL,
      mileage_cents_per_mile int NOT NULL,
      UNIQUE (org_code, service_line, effective_from)
    );
    CREATE TABLE IF NOT EXISTS billing (
      assignment_id int PRIMARY KEY REFERENCES assignments(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'none',
      invoice_id text,
      total_cents int,
      queued_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id serial PRIMARY KEY,
      kind text NOT NULL,
      detail jsonb NOT NULL,
      at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS outbox_emails (
      id serial PRIMARY KEY,
      to_email text NOT NULL,
      subject text NOT NULL,
      body text NOT NULL,
      sent_at timestamptz,
      attempts int NOT NULL DEFAULT 0,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token text PRIMARY KEY,
      person_id int NOT NULL REFERENCES people(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS form_links (
      token text PRIMARY KEY,
      seat_id int NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
      session_token text NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL
    );
  `);
}

const SEED_PASSWORD = "Teamseat-demo-2026";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

const LANG_SEED = [
  { code: "asl", name: "ASL", order: 1 },
  { code: "es", name: "Spanish", order: 2 },
  { code: "vi", name: "Vietnamese", order: 3 },
  { code: "so", name: "Somali", order: 4 },
  { code: "ar", name: "Arabic", order: 5 },
];

const ORG_SEED = [
  { code: "RVH", name: "Riverbend Valley Hospital" },
  { code: "CPSD", name: "Cedar Prairie School District" },
  { code: "LFC", name: "Lakeview Family Clinic" },
];

const PEOPLE_SEED = [
  { email: "dana.whitcombe@northfold.example", name: "Dana Whitcombe", role: "dispatcher", initials: null, org: null, phone: null, langs: [] },
  { email: "marguerite.ellison@northfold.example", name: "Marguerite Ellison", role: "billing_lead", initials: null, org: null, phone: null, langs: [] },
  { email: "tomas.herrera@rvh.example", name: "Tomas Herrera", role: "scheduler", initials: null, org: "RVH", phone: "312-555-0141", langs: [] },
  { email: "alina.brooks@rvh.example", name: "Alina Brooks", role: "scheduler", initials: null, org: "RVH", phone: "312-555-0142", langs: [] },
  { email: "helen.marsh@rvh.example", name: "Helen Marsh", role: "org_admin", initials: null, org: "RVH", phone: "312-555-0140", langs: [] },
  { email: "grace.lindqvist@cpsd.example", name: "Grace Lindqvist", role: "scheduler", initials: null, org: "CPSD", phone: "847-555-0163", langs: [] },
  { email: "victor.ames@cpsd.example", name: "Victor Ames", role: "org_admin", initials: null, org: "CPSD", phone: "847-555-0160", langs: [] },
  { email: "owen.pakulski@lfc.example", name: "Owen Pakulski", role: "scheduler", initials: null, org: "LFC", phone: "773-555-0175", langs: [] },
  { email: "nora.quist@lfc.example", name: "Nora Quist", role: "org_admin", initials: null, org: "LFC", phone: "773-555-0170", langs: [] },
  { email: "rosa.mendez@interp.example", name: "Rosa Mendez", role: "interpreter", initials: "R.M.", org: null, phone: null, langs: ["asl", "es"] },
  { email: "samuel.okoye@interp.example", name: "Samuel Okoye", role: "interpreter", initials: "S.O.", org: null, phone: null, langs: ["asl"] },
  { email: "jordan.fairweather@interp.example", name: "Jordan Fairweather", role: "interpreter", initials: "J.F.", org: null, phone: null, langs: ["asl"] },
  { email: "linh.tran@interp.example", name: "Linh Tran", role: "interpreter", initials: "L.T.", org: null, phone: null, langs: ["vi", "es"] },
  { email: "abdi.warsame@interp.example", name: "Abdi Warsame", role: "interpreter", initials: "A.W.", org: null, phone: null, langs: ["so", "ar"] },
];

const RATE_SEED = [
  { org: "RVH", line: "asl", rate: 8575, mileage: 70 },
  { org: "RVH", line: "spoken", rate: 6550, mileage: 70 },
  { org: "CPSD", line: "asl", rate: 7800, mileage: 65 },
  { org: "CPSD", line: "spoken", rate: 6000, mileage: 65 },
  { org: "LFC", line: "asl", rate: 8575, mileage: 70 },
  { org: "LFC", line: "spoken", rate: 6550, mileage: 70 },
];

export async function applySeed(db: Pool): Promise<void> {
  for (const lang of LANG_SEED) {
    await db.query(
      `INSERT INTO languages (code, name, board_order) VALUES ($1,$2,$3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, board_order = EXCLUDED.board_order`,
      [lang.code, lang.name, lang.order],
    );
  }
  for (const org of ORG_SEED) {
    await db.query(
      `INSERT INTO organisations (code, name) VALUES ($1,$2)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
      [org.code, org.name],
    );
  }
  const pw = hashPassword(SEED_PASSWORD);
  for (const p of PEOPLE_SEED) {
    await db.query(
      `INSERT INTO people (email, password_hash, name, role, initials, org_code, phone, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         initials = EXCLUDED.initials,
         org_code = EXCLUDED.org_code,
         phone = EXCLUDED.phone`,
      [p.email, pw, p.name, p.role, p.initials, p.org, p.phone],
    );
    const found = await db.query(`SELECT id FROM people WHERE email = $1`, [p.email]);
    const id = found.rows[0].id as number;
    for (const lang of p.langs) {
      await db.query(
        `INSERT INTO interpreter_languages (person_id, language_code) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [id, lang],
      );
    }
    if (p.langs.length > 0) {
      await db.query(
        `DELETE FROM interpreter_languages WHERE person_id = $1 AND language_code <> ALL($2)`,
        [id, p.langs],
      );
    }
  }
  for (const r of RATE_SEED) {
    await db.query(
      `INSERT INTO rate_cards (org_code, service_line, effective_from, hourly_rate_cents, mileage_cents_per_mile)
       VALUES ($1,$2,'2026-01-01',$3,$4)
       ON CONFLICT (org_code, service_line, effective_from) DO UPDATE SET
         hourly_rate_cents = EXCLUDED.hourly_rate_cents,
         mileage_cents_per_mile = EXCLUDED.mileage_cents_per_mile`,
      [r.org, r.line, r.rate, r.mileage],
    );
  }
  // Assignment number sequence: a table holding the last used seq, seeded at 1000.
  await db.query(`
    CREATE TABLE IF NOT EXISTS assignment_seq (
      id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      last_seq int NOT NULL
    );
  `);
  await db.query(
    `INSERT INTO assignment_seq (id, last_seq) VALUES (1, 1000)
     ON CONFLICT (id) DO NOTHING`,
  );
}

export function requestHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}
