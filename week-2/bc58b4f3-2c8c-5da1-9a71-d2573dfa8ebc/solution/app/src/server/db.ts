import pg from "pg";
import { config } from "./config.js";
import { hashPassword } from "./passwords.js";

// Postgres returns bigint (int8) as text by default; every bigint here is a count or cents within range.
pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));
// Dates stay `YYYY-MM-DD` strings rather than local-midnight Date objects.
pg.types.setTypeParser(1082, (value) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

export type Db = pg.PoolClient;

/** Run `work` inside one transaction on one connection. */
export async function transaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS languages (
  code text PRIMARY KEY,
  name text NOT NULL,
  position integer NOT NULL
);
CREATE TABLE IF NOT EXISTS organisations (
  code text PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text,
  role text NOT NULL CHECK (role IN ('scheduler','org_admin','dispatcher','billing_lead','interpreter')),
  org_code text REFERENCES organisations(code),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS interpreter_languages (
  person_id uuid NOT NULL REFERENCES people(id),
  language_code text NOT NULL REFERENCES languages(code),
  PRIMARY KEY (person_id, language_code)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES people(id),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (
  name text PRIMARY KEY,
  value bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS assignments (
  id bigserial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  org_code text NOT NULL REFERENCES organisations(code),
  scheduler_id uuid NOT NULL REFERENCES people(id),
  language_code text NOT NULL REFERENCES languages(code),
  setting text NOT NULL CHECK (setting IN ('hospital','clinic','school')),
  start_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL,
  street_address text NOT NULL,
  city text NOT NULL,
  patient_initials text NOT NULL,
  medical_notes text NOT NULL,
  status text NOT NULL CHECK (status IN
    ('draft','released','partially_covered','covered','served','verified','invoiced','cancelled')),
  billing_status text NOT NULL DEFAULT 'none' CHECK (billing_status IN ('none','ready','queued','posted')),
  invoice_id text,
  billed_charges jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assignments_start ON assignments (start_at);
CREATE TABLE IF NOT EXISTS seats (
  assignment_id bigint NOT NULL REFERENCES assignments(id),
  seat integer NOT NULL,
  status text NOT NULL CHECK (status IN ('open','held','served')),
  holder_id uuid REFERENCES people(id),
  PRIMARY KEY (assignment_id, seat)
);
CREATE TABLE IF NOT EXISTS holds (
  id bigserial PRIMARY KEY,
  assignment_id bigint NOT NULL REFERENCES assignments(id),
  seat integer NOT NULL,
  interpreter_id uuid NOT NULL REFERENCES people(id),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  outcome text NOT NULL DEFAULT 'held' CHECK (outcome IN ('held','released_back','freed_by_change','served'))
);
CREATE TABLE IF NOT EXISTS verifications (
  assignment_id bigint NOT NULL REFERENCES assignments(id),
  seat integer NOT NULL,
  interpreter_id uuid NOT NULL REFERENCES people(id),
  actual_minutes integer NOT NULL,
  round_trip_miles integer NOT NULL,
  object_key text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, seat)
);
CREATE TABLE IF NOT EXISTS cancellations (
  assignment_id bigint PRIMARY KEY REFERENCES assignments(id),
  cancelled_at timestamptz NOT NULL,
  fee_applies boolean NOT NULL,
  business_minutes_notice integer NOT NULL,
  fee_cents bigint NOT NULL,
  seats integer NOT NULL,
  rate_effective_from date,
  hourly_rate_cents bigint,
  mileage_cents_per_mile bigint
);
CREATE TABLE IF NOT EXISTS rate_cards (
  id bigserial PRIMARY KEY,
  org_code text NOT NULL REFERENCES organisations(code),
  service_line text NOT NULL CHECK (service_line IN ('asl','spoken')),
  effective_from date NOT NULL,
  hourly_rate_cents bigint NOT NULL,
  mileage_cents_per_mile bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_code, service_line, effective_from)
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  person_id uuid NOT NULL REFERENCES people(id),
  key text NOT NULL,
  fingerprint text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, key)
);
CREATE TABLE IF NOT EXISTS email_outbox (
  id bigserial PRIMARY KEY,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS email_outbox_unsent ON email_outbox (id) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS file_links (
  token_hash text PRIMARY KEY,
  session_token_hash text NOT NULL,
  assignment_id bigint NOT NULL,
  seat integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid REFERENCES people(id),
  action text NOT NULL,
  assignment_id bigint REFERENCES assignments(id),
  detail jsonb NOT NULL
);
`;

const LANGUAGES: ReadonlyArray<[string, string]> = [
  ["asl", "ASL"],
  ["es", "Spanish"],
  ["vi", "Vietnamese"],
  ["so", "Somali"],
  ["ar", "Arabic"],
];

const ORGANISATIONS: ReadonlyArray<[string, string]> = [
  ["RVH", "Riverbend Valley Hospital"],
  ["CPSD", "Cedar Prairie School District"],
  ["LFC", "Lakeview Family Clinic"],
];

interface SeedPerson {
  name: string;
  email: string;
  role: string;
  org: string | null;
  phone: string | null;
  languages: string[];
}

const PEOPLE: readonly SeedPerson[] = [
  { name: "Dana Whitcombe", email: "dana.whitcombe@northfold.example", role: "dispatcher", org: null, phone: null, languages: [] },
  { name: "Marguerite Ellison", email: "marguerite.ellison@northfold.example", role: "billing_lead", org: null, phone: null, languages: [] },
  { name: "Tomas Herrera", email: "tomas.herrera@rvh.example", role: "scheduler", org: "RVH", phone: "312-555-0141", languages: [] },
  { name: "Alina Brooks", email: "alina.brooks@rvh.example", role: "scheduler", org: "RVH", phone: "312-555-0142", languages: [] },
  { name: "Helen Marsh", email: "helen.marsh@rvh.example", role: "org_admin", org: "RVH", phone: "312-555-0140", languages: [] },
  { name: "Grace Lindqvist", email: "grace.lindqvist@cpsd.example", role: "scheduler", org: "CPSD", phone: "847-555-0163", languages: [] },
  { name: "Victor Ames", email: "victor.ames@cpsd.example", role: "org_admin", org: "CPSD", phone: "847-555-0160", languages: [] },
  { name: "Owen Pakulski", email: "owen.pakulski@lfc.example", role: "scheduler", org: "LFC", phone: "773-555-0175", languages: [] },
  { name: "Nora Quist", email: "nora.quist@lfc.example", role: "org_admin", org: "LFC", phone: "773-555-0170", languages: [] },
  { name: "Rosa Mendez", email: "rosa.mendez@interp.example", role: "interpreter", org: null, phone: null, languages: ["asl", "es"] },
  { name: "Samuel Okoye", email: "samuel.okoye@interp.example", role: "interpreter", org: null, phone: null, languages: ["asl"] },
  { name: "Jordan Fairweather", email: "jordan.fairweather@interp.example", role: "interpreter", org: null, phone: null, languages: ["asl"] },
  { name: "Linh Tran", email: "linh.tran@interp.example", role: "interpreter", org: null, phone: null, languages: ["vi", "es"] },
  { name: "Abdi Warsame", email: "abdi.warsame@interp.example", role: "interpreter", org: null, phone: null, languages: ["so", "ar"] },
];

const SEED_PASSWORD = "Teamseat-demo-2026";

const RATE_CARDS: ReadonlyArray<[string, string, number, number]> = [
  ["RVH", "asl", 8575, 70],
  ["RVH", "spoken", 6550, 70],
  ["CPSD", "asl", 7800, 65],
  ["CPSD", "spoken", 6000, 65],
  ["LFC", "asl", 8575, 70],
  ["LFC", "spoken", 6550, 70],
];

/** Apply the schema and seed data; safe to run on every start and from concurrent instances. */
export async function prepareDatabase(): Promise<void> {
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('teamseat-schema'))");
    await db.query(SCHEMA);
    for (const [index, [code, name]] of LANGUAGES.entries()) {
      await db.query(
        "INSERT INTO languages (code, name, position) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING",
        [code, name, index + 1],
      );
    }
    for (const [code, name] of ORGANISATIONS) {
      await db.query("INSERT INTO organisations (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING", [code, name]);
    }
    for (const person of PEOPLE) {
      const existing = await db.query("SELECT 1 FROM people WHERE email = $1", [person.email]);
      if (existing.rowCount) continue;
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO people (name, email, phone, role, org_code, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [person.name, person.email, person.phone, person.role, person.org, await hashPassword(SEED_PASSWORD)],
      );
      for (const language of person.languages) {
        await db.query("INSERT INTO interpreter_languages (person_id, language_code) VALUES ($1, $2)", [
          inserted.rows[0]?.id,
          language,
        ]);
      }
    }
    for (const [org, line, hourly, mileage] of RATE_CARDS) {
      await db.query(
        `INSERT INTO rate_cards (org_code, service_line, effective_from, hourly_rate_cents, mileage_cents_per_mile)
         VALUES ($1, $2, '2026-01-01', $3, $4) ON CONFLICT (org_code, service_line, effective_from) DO NOTHING`,
        [org, line, hourly, mileage],
      );
    }
    await db.query("INSERT INTO counters (name, value) VALUES ('assignment_number', 1000) ON CONFLICT (name) DO NOTHING");
  });
}
