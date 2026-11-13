/**
 * The brief's seed data, written once when the app starts on a database with no agency.
 * Every person, organisation, address and phone number here is invented.
 */
import type { PoolClient } from "pg";
import { AGENCY_ZONE, addDays, fromWallClockOrAfterGap } from "../shared/agencyTime.js";
import { type Role, hashPassword } from "./auth.js";
import { agencyToday } from "./rules.js";

const SEED_PASSWORD = "relay-demo-2026";

const ORGANISATIONS = [
  { code: "HPMC", name: "Harbor Point Medical Center", rateCents: 9750, scheduler: ["Jordan Baptiste", "sched@harborpoint.example"] },
  { code: "LKSU", name: "Lakemont State University", rateCents: 8625, scheduler: ["Avery Lindqvist", "sched@lakemont.example"] },
  { code: "ECCC", name: "Ellery County Circuit Court", rateCents: 11000, scheduler: ["Sam Whitfield", "sched@ellerycourt.example"] },
] as const;

const STAFF: { role: Role; name: string; email: string }[] = [
  { role: "coordinator", name: "Priya Velasco", email: "coord@crosshand.example" },
  { role: "billing_admin", name: "Morgan Reyes-Hall", email: "billing@crosshand.example" },
];

const INTERPRETERS = [
  { key: "rosa", display: "Rosa D.", full: "Rosa Delgado-Finch", email: "rosa@interpreters.example", phone: "(555) 010-0141", area: "North Halden", payCents: 5800, credentials: ["NIC"] },
  { key: "theo", display: "Theo M.", full: "Theo Marchetti", email: "theo@interpreters.example", phone: "(555) 010-0142", area: "Marrow Bay", payCents: 5500, credentials: ["NIC"] },
  { key: "kemi", display: "Kemi A.", full: "Kemi Adeyemi", email: "kemi@interpreters.example", phone: "(555) 010-0143", area: "Ellery", payCents: 6400, credentials: ["NIC", "SC:L"] },
  { key: "wren", display: "Wren C.", full: "Wren Castellanos", email: "wren@interpreters.example", phone: "(555) 010-0144", area: "Marrow Bay", payCents: 5000, credentials: ["EIPA"] },
  { key: "malik", display: "Malik O.", full: "Malik Osei", email: "malik@interpreters.example", phone: "(555) 010-0145", area: "Halden", payCents: 6000, credentials: ["CDI"] },
  { key: "ines", display: "Ines P.", full: "Ines Park", email: "ines@interpreters.example", phone: "(555) 010-0146", area: "South Halden", payCents: 5600, credentials: ["NIC"] },
] as const;

type InterpreterKey = (typeof INTERPRETERS)[number]["key"];

interface SeedRequest {
  org: (typeof ORGANISATIONS)[number]["code"];
  setting: "medical" | "education" | "legal";
  credential: string;
  dayOffset: number;
  hour: number;
  minute: number;
  minutes: number;
  team: 1 | 2 | null;
  rotation: number | null;
  city: string;
  address: string;
  consumer: string;
  notes: string;
  status: "draft" | "submitted" | "half-staffed" | "staffed" | "completed";
  seats: Partial<Record<"A" | "B", InterpreterKey | null>>;
  actual?: number;
}

const REQUESTS: SeedRequest[] = [
  { org: "HPMC", setting: "medical", credential: "NIC", dayOffset: 3, hour: 9, minute: 0, minutes: 120, team: 2, rotation: 20, city: "Halden", address: "400 Harbor Point Way", consumer: "Elena Brandt", notes: "Cardiology follow-up; patient prefers interpreters to the left of the screen.", status: "half-staffed", seats: { A: "rosa", B: null } },
  { org: "LKSU", setting: "education", credential: "EIPA", dayOffset: 2, hour: 13, minute: 0, minutes: 50, team: 1, rotation: 20, city: "Marrow Bay", address: "12 Quarry Hall", consumer: "Devon Achterberg", notes: "BIOL 210 lab; vocabulary list sent to the coordinator.", status: "submitted", seats: { A: null } },
  { org: "ECCC", setting: "legal", credential: "SC:L", dayOffset: 4, hour: 8, minute: 30, minutes: 210, team: 2, rotation: 30, city: "Ellery", address: "1 Courthouse Square, Courtroom 4B", consumer: "Marisol Varga", notes: "Arraignment; proceedings team only.", status: "submitted", seats: { A: null, B: null } },
  { org: "HPMC", setting: "medical", credential: "NIC", dayOffset: 1, hour: 14, minute: 0, minutes: 90, team: 2, rotation: 20, city: "Halden", address: "400 Harbor Point Way", consumer: "Graham Oduya", notes: "Pre-surgical consult.", status: "staffed", seats: { A: "theo", B: "rosa" } },
  { org: "HPMC", setting: "medical", credential: "NIC", dayOffset: 10, hour: 10, minute: 0, minutes: 60, team: null, rotation: null, city: "Halden", address: "400 Harbor Point Way", consumer: "Lena Petrakis", notes: "", status: "draft", seats: {} },
  { org: "LKSU", setting: "education", credential: "NIC", dayOffset: -2, hour: 10, minute: 0, minutes: 120, team: 2, rotation: 20, city: "Marrow Bay", address: "3 Founders Hall", consumer: "Priyanka Moss", notes: "Thesis defence.", status: "completed", seats: { A: "rosa", B: "theo" }, actual: 127 },
  { org: "ECCC", setting: "legal", credential: "SC:L", dayOffset: -1, hour: 13, minute: 0, minutes: 45, team: 1, rotation: 20, city: "Ellery", address: "1 Courthouse Square, Courtroom 2A", consumer: "Victor Halloran", notes: "Status hearing.", status: "completed", seats: { A: "kemi" }, actual: 40 },
];

async function insertId(client: PoolClient, sql: string, params: unknown[]): Promise<string> {
  const { rows } = await client.query<{ id: string }>(`${sql} RETURNING id`, params);
  return rows[0]?.id ?? "";
}

export async function seedOnce(client: PoolClient): Promise<void> {
  const { rows } = await client.query("SELECT 1 FROM agency LIMIT 1");
  if (rows.length > 0) return;
  await client.query("BEGIN");
  try {
    await seed(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function seed(client: PoolClient): Promise<void> {
  const today = agencyToday();
  await client.query("INSERT INTO agency (name, time_zone) VALUES ($1, $2)", ["Crosshand Interpreting Collective", AGENCY_ZONE]);

  const organisationIds = new Map<string, string>();
  const schedulerNames = new Map<string, string>();
  for (const org of ORGANISATIONS) {
    const id = await insertId(client, "INSERT INTO organisations (code, name, hourly_rate_cents) VALUES ($1, $2, $3)", [
      org.code,
      org.name,
      org.rateCents,
    ]);
    organisationIds.set(org.code, id);
    schedulerNames.set(org.code, org.scheduler[0]);
    await client.query(
      "INSERT INTO people (role, email, display_name, full_name, password_hash, organisation_id) VALUES ('client_scheduler', $1, $2, $2, $3, $4)",
      [org.scheduler[1], org.scheduler[0], await hashPassword(SEED_PASSWORD), id],
    );
  }
  for (const person of STAFF) {
    await client.query("INSERT INTO people (role, email, display_name, full_name, password_hash) VALUES ($1, $2, $3, $3, $4)", [
      person.role,
      person.email,
      person.name,
      await hashPassword(SEED_PASSWORD),
    ]);
  }

  const interpreterIds = new Map<InterpreterKey, string>();
  for (const i of INTERPRETERS) {
    const id = await insertId(
      client,
      `INSERT INTO people (role, email, display_name, full_name, password_hash, phone, home_area, pay_rate_cents)
       VALUES ('interpreter', $1, $2, $3, $4, $5, $6, $7)`,
      [i.email, i.display, i.full, await hashPassword(SEED_PASSWORD), i.phone, i.area, i.payCents],
    );
    interpreterIds.set(i.key, id);
    for (const type of i.credentials) {
      await client.query(
        "INSERT INTO credentials (interpreter_id, credential_type, verified_at, expires_on) VALUES ($1, $2, now(), '2030-12-31')",
        [id, type],
      );
    }
  }
  // Malik's EIPA expired yesterday: it reads expired and makes him eligible for nothing.
  await client.query("INSERT INTO credentials (interpreter_id, credential_type, verified_at, expires_on) VALUES ($1, 'EIPA', now(), $2)", [
    interpreterIds.get("malik"),
    addDays(today, -1),
  ]);

  const coordinator = "Priya Velasco";
  for (const r of REQUESTS) {
    const [year, month, day] = addDays(today, r.dayOffset).split("-").map(Number) as [number, number, number];
    const startsAt = fromWallClockOrAfterGap({ year, month, day, hour: r.hour, minute: r.minute });
    const requestId = await insertId(
      client,
      `INSERT INTO requests (reference, organisation_id, setting, required_credential, starts_at, duration_minutes,
                             consumer_name, location_address, city, notes, status, team_size, rotation_minutes, actual_minutes)
       VALUES ('CR-' || nextval('request_reference_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [organisationIds.get(r.org), r.setting, r.credential, startsAt, r.minutes, r.consumer, r.address, r.city, r.notes,
        r.status, r.team, r.rotation, r.actual ?? null],
    );
    const history: [string, string, string][] = [[schedulerNames.get(r.org) ?? "", "created", ""]];
    if (r.status !== "draft") history.push([schedulerNames.get(r.org) ?? "", "submitted", ""]);
    for (const [label, who] of Object.entries(r.seats)) {
      const interpreter = INTERPRETERS.find((i) => i.key === who);
      await client.query(
        "INSERT INTO seats (request_id, label, interpreter_id, confirmed_at) VALUES ($1, $2, $3, CASE WHEN $3::text IS NULL THEN NULL ELSE now() END)",
        [requestId, label, who ? interpreterIds.get(who) : null],
      );
      if (interpreter) history.push([interpreter.display, "claim_won", `Seat ${label}`]);
    }
    if (r.actual) history.push([coordinator, "completed", `${r.actual} actual minutes`]);
    for (const [actor, action, detail] of history) {
      await client.query("INSERT INTO history (request_id, actor, action, detail) VALUES ($1, $2, $3, $4)", [
        requestId,
        actor,
        action,
        detail,
      ]);
    }
  }
}
