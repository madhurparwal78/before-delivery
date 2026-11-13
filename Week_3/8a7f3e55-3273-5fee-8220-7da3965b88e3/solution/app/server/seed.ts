import type { Db } from "./db.js";
import { hashPassword } from "./passwords.js";

const SEED_PASSWORD = "relayline-demo-2026";
const SEED_RATE_DATE = "2026-01-01";

const ORGANISATIONS = [
  { id: "riverbend", name: "Riverbend Regional Hospital", rate: 9000, bp: 1000, mileage: 67, interval: 20 },
  { id: "maple-valley", name: "Maple Valley School District", rate: 7850, bp: 500, mileage: 70, interval: 30 },
  { id: "harlan-court", name: "Harlan County Court", rate: 10500, bp: 1500, mileage: 0, interval: 15 },
] as const;

const STAFF = [
  { id: "dana-okafor", name: "Dana Okafor", email: "dana.okafor@tandemhands.example", role: "coordinator", org: null },
  { id: "morgan-ellis", name: "Morgan Ellis", email: "morgan.ellis@tandemhands.example", role: "billing_manager", org: null },
  { id: "lena-torres", name: "Lena Torres", email: "lena.torres@riverbend.example", role: "requester", org: "riverbend" },
  { id: "sam-whitfield", name: "Sam Whitfield", email: "sam.whitfield@maplevalley.example", role: "requester", org: "maple-valley" },
  { id: "ruth-adeyemi", name: "Ruth Adeyemi", email: "ruth.adeyemi@harlancourt.example", role: "requester", org: "harlan-court" },
] as const;

interface SeedInterpreter {
  id: string;
  name: string;
  initials: string;
  phone: string;
  city: string;
  pay: number;
  credentials: [string, string][];
}

const INTERPRETERS: SeedInterpreter[] = [
  { id: "jordan-reyes", name: "Jordan Reyes", initials: "JR", phone: "+1 555 010 0141", city: "Fairbrook", pay: 5500, credentials: [["NIC", "2028-06-30"]] },
  { id: "avery-chen", name: "Avery Chen", initials: "AC", phone: "+1 555 010 0142", city: "Linden Park", pay: 5200, credentials: [["NIC", "2027-12-31"], ["EIPA", "2027-08-31"]] },
  { id: "casey-morgan", name: "Casey Morgan", initials: "CM", phone: "+1 555 010 0143", city: "Oak Hollow", pay: 5000, credentials: [["BEI", "2028-03-31"]] },
  { id: "riley-brooks", name: "Riley Brooks", initials: "RB", phone: "+1 555 010 0144", city: "Westmere", pay: 6500, credentials: [["NIC", "2028-12-31"], ["SC:L", "2028-12-31"]] },
  { id: "taylor-nguyen", name: "Taylor Nguyen", initials: "TN", phone: "+1 555 010 0145", city: "Fairbrook", pay: 4800, credentials: [["NIC", "2026-01-31"], ["EIPA", "2027-05-31"]] },
  { id: "quinn-halvorsen", name: "Quinn Halvorsen", initials: "QH", phone: "+1 555 010 0146", city: "Cedar Bluff", pay: 6200, credentials: [["NIC", "2029-01-31"], ["SC:L", "2029-01-31"]] },
  { id: "sasha-lindqvist", name: "Sasha Lindqvist", initials: "SL", phone: "+1 555 010 0147", city: "Granite Falls", pay: 6300, credentials: [["SC:L", "2028-09-30"]] },
];

function interpreterEmail(id: string): string {
  return `${id.replace("-", ".")}@interpreters.example`;
}

/** Idempotent: every statement skips what already exists, so a restart or a concurrent start changes nothing. */
export async function seed(db: Db): Promise<void> {
  const hash = await hashPassword(SEED_PASSWORD);

  for (const org of ORGANISATIONS) {
    await db.query("INSERT INTO organisations (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING", [org.id, org.name]);
    const contractId = `contract-${org.id}`;
    await db.query(
      `INSERT INTO contracts (id, org_id, minimum_minutes, increment_minutes, rotation_interval_minutes)
       VALUES ($1, $2, 120, 15, $3) ON CONFLICT DO NOTHING`,
      [contractId, org.id, org.interval],
    );
    await db.query(
      `INSERT INTO contract_rates (contract_id, effective_from, hourly_rate_cents, team_surcharge_bp, mileage_cents_per_mile)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [contractId, SEED_RATE_DATE, org.rate, org.bp, org.mileage],
    );
  }

  for (const person of STAFF) {
    await db.query(
      `INSERT INTO users (id, name, email, password_hash, role, org_id) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [person.id, person.name, person.email, hash, person.role, person.org],
    );
  }

  for (const person of INTERPRETERS) {
    await db.query(
      `INSERT INTO users (id, name, email, password_hash, role, org_id) VALUES ($1, $2, $3, $4, 'interpreter', NULL)
       ON CONFLICT DO NOTHING`,
      [person.id, person.name, interpreterEmail(person.id), hash],
    );
    await db.query(
      `INSERT INTO interpreters (user_id, initials, phone, home_city, pay_rate_cents) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [person.id, person.initials, person.phone, person.city, person.pay],
    );
    for (const [code, expiresOn] of person.credentials) {
      await db.query("INSERT INTO credentials (interpreter_id, code, expires_on) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [
        person.id,
        code,
        expiresOn,
      ]);
    }
  }
}
