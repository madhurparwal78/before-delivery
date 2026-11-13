// The practice's exact starting data, written once in one transaction.

import { randomUUID } from "node:crypto";
import type { Cadence, Sex } from "../shared/api";
import { localDate, localTime, type TimeZone } from "../shared/time";
import { SEEDED_LDL_CHANGE, sixRows, STARTING_BOUNDS } from "./catalog";
import { inTransaction, one, type Db } from "./db";
import { hashPassword } from "./sessions";

const STAFF = [
  ["Maya Okafor", "maya.okafor@ocotillo.example", "owner"],
  ["Priya Shah", "priya.shah@ocotillo.example", "specialist"],
  ["Theo Lindqvist", "theo.lindqvist@ocotillo.example", "specialist"],
  ["Dana Ruiz", "dana.ruiz@ocotillo.example", "coordinator"],
  ["Sam Whitfield", "sam.whitfield@ocotillo.example", "coordinator"],
  ["Jordan Pell", "jordan.pell@ocotillo.example", "billingLead"],
] as const;

const STAFF_PASSWORD = "desk-pass-2027";
const MEMBER_PASSWORD = "member-pass-2027";

interface SeedMember {
  name: string;
  email: string;
  born: string;
  sex: Sex;
  state: string;
  zone: TimeZone;
  phone: string;
  address: [string, string, string, string];
  gate: string | null;
  cadence: Cadence | null;
  receipt: number | null;
}

const MEMBERS: readonly SeedMember[] = [
  { name: "Elena Marsh", email: "elena.marsh@example.com", born: "1987-03-02", sex: "female", state: "co", zone: "denver", phone: "+1 303 555 0142", address: ["1450 Larimer St", "Apt 6B", "Denver", "80202"], gate: "Buzz 6B; the lobby door sticks.", cadence: "sixMonths", receipt: 1 },
  { name: "Marcus Bell", email: "marcus.bell@example.com", born: "1971-06-14", sex: "male", state: "ny", zone: "newYork", phone: "+1 212 555 0187", address: ["88 Orchard St", "Apt 3", "New York", "10002"], gate: "Ring twice.", cadence: "yearly", receipt: 2 },
  { name: "Rosa Delgado", email: "rosa.delgado@example.com", born: "1958-11-20", sex: "female", state: "il", zone: "chicago", phone: "+1 312 555 0119", address: ["2201 W Armitage Ave", "", "Chicago", "60647"], gate: "Side door by the garden.", cadence: "sixMonths", receipt: 3 },
  { name: "Owen Pryce", email: "owen.pryce@example.com", born: "1990-08-09", sex: "male", state: "az", zone: "phoenix", phone: "+1 480 555 0163", address: ["3300 N Scottsdale Rd", "Unit 12", "Scottsdale", "85251"], gate: null, cadence: null, receipt: null },
  { name: "Hana Sato", email: "hana.sato@example.com", born: "1979-04-27", sex: "female", state: "ca", zone: "losAngeles", phone: "+1 415 555 0175", address: ["640 Valencia St", "", "San Francisco", "94110"], gate: "Gate code 4417.", cadence: "yearly", receipt: 4 },
];

const PHLEBOTOMISTS = [
  ["Luis Carrillo", "luis.carrillo@visits.example", ["az", "co", "nm", "nv", "ut"]],
  ["Ivy Chen", "ivy.chen@visits.example", ["co", "ut"]],
  ["Bree Halvorsen", "bree.halvorsen@visits.example", ["ca", "id", "mt", "or", "wa", "wy"]],
  ["Tomas Reyes", "tomas.reyes@visits.example", ["ar", "ia", "ks", "la", "mn", "mo", "nd", "ne", "ok", "sd", "tx"]],
  ["Nia Brooks", "nia.brooks@visits.example", ["al", "il", "in", "ky", "mi", "ms", "oh", "tn", "wi"]],
  ["Grace Whitaker", "grace.whitaker@visits.example", ["ct", "de", "ma", "md", "me", "nh", "nj", "ny", "pa", "vt"]],
  ["Caleb Ford", "caleb.ford@visits.example", ["fl", "ga", "nc", "sc", "va", "wv"]],
] as const;

interface SeedDraw {
  member: string;
  zone: TimeZone;
  phlebotomist: string;
  startsAt: string;
  collectedAt: string;
  kitCode: string;
  values: Record<string, string>;
}

const DRAWS: readonly SeedDraw[] = [
  { member: "Elena Marsh", zone: "denver", phlebotomist: "Luis Carrillo", startsAt: "2025-09-15T13:00:00Z", collectedAt: "2025-09-15T13:12:00Z", kitCode: "KT-1000013-6", values: { vitaminD: "22.5", ldl: "118", hdl: "58", apoB: "92", hsCrp: "1.40", ferritin: "35" } },
  { member: "Elena Marsh", zone: "denver", phlebotomist: "Luis Carrillo", startsAt: "2026-03-09T13:00:00Z", collectedAt: "2026-03-09T13:15:00Z", kitCode: "KT-1000021-6", values: { vitaminD: "31.5", ldl: "108", hdl: "61", apoB: "84", hsCrp: "0.90", ferritin: "48" } },
  { member: "Elena Marsh", zone: "denver", phlebotomist: "Luis Carrillo", startsAt: "2026-09-14T13:00:00Z", collectedAt: "2026-09-14T13:10:00Z", kitCode: "KT-1000101-6", values: { vitaminD: "44.0", ldl: "120", hdl: "64", apoB: "78", hsCrp: "0.60", ferritin: "62" } },
  { member: "Marcus Bell", zone: "newYork", phlebotomist: "Grace Whitaker", startsAt: "2026-10-05T11:20:00Z", collectedAt: "2026-10-05T11:31:00Z", kitCode: "KT-1000110-4", values: { vitaminD: "38.2", ldl: "96", hdl: "47", apoB: "88", hsCrp: "2.10", ferritin: "180", testosterone: "520" } },
];

const ELENA_PLAN = {
  nutrition: "Build each meal around protein and vegetables.\n\n- Two portions of oily fish a week\n- Fibre at breakfast",
  movement: "- Walk 30 minutes a day\n- Strength work twice a week",
  sleep: "Lights out by 22:30 on weeknights.",
  supplements: "Take the morning packet with breakfast and the evening packet an hour before bed.",
};

const ELENA_BLEND = [
  { ingredient: "vitaminD3", capsulesPerDay: 1 },
  { ingredient: "magnesiumGlycinate", capsulesPerDay: 2 },
  { ingredient: "omega3", capsulesPerDay: 2 },
  { ingredient: "methylB12", capsulesPerDay: 1 },
  { ingredient: "ashwagandha", capsulesPerDay: 1 },
];

async function seedPeople(db: Db): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const staffHash = await hashPassword(STAFF_PASSWORD);
  for (const [name, email, role] of STAFF) {
    const id = randomUUID();
    ids.set(name, id);
    await db.query("INSERT INTO people (id, role, name, email, password_hash) VALUES ($1, $2, $3, $4, $5)", [id, role, name, email, staffHash]);
  }
  const memberHash = await hashPassword(MEMBER_PASSWORD);
  for (const member of MEMBERS) {
    const id = randomUUID();
    ids.set(member.name, id);
    await db.query("INSERT INTO people (id, role, name, email, password_hash) VALUES ($1, 'member', $2, $3, $4)", [id, member.name, member.email, memberHash]);
    const [line1, line2, city, postalCode] = member.address;
    await db.query(
      `INSERT INTO members (id, phone, date_of_birth, sex, state, time_zone, address_line1, address_line2, city, postal_code, gate_notes,
        membership_state, cadence, seed_receipt_number, thread_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'open')`,
      [
        id, member.phone, member.born, member.sex, member.state, member.zone, line1, line2, city, postalCode, member.gate,
        member.cadence ? "pending" : "free", member.cadence, member.receipt,
      ],
    );
  }
  return ids;
}

async function seedPhlebotomists(db: Db): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const [position, [name, email, states]] of PHLEBOTOMISTS.entries()) {
    const id = randomUUID();
    ids.set(name, id);
    await db.query("INSERT INTO phlebotomists (id, name, email, states, position) VALUES ($1, $2, $3, $4, $5)", [id, name, email, [...states], position]);
  }
  return ids;
}

async function seedRanges(db: Db): Promise<void> {
  for (const [marker, bounds] of Object.entries(STARTING_BOUNDS)) {
    await db.query(
      "INSERT INTO range_tables (id, marker, effective_from, rows, created_at) VALUES ($1, $2, '2020-01-01', $3, '2020-01-01T00:00:00Z')",
      [randomUUID(), marker, JSON.stringify(sixRows(bounds))],
    );
  }
  await db.query(
    "INSERT INTO range_tables (id, marker, effective_from, rows, created_by, created_at) VALUES ($1, 'ldl', '2026-07-01', $2, 'Maya Okafor', '2026-07-01T07:00:00Z')",
    [randomUUID(), JSON.stringify(sixRows(SEEDED_LDL_CHANGE))],
  );
}

async function seedDraws(db: Db, people: ReadonlyMap<string, string>, phlebotomists: ReadonlyMap<string, string>): Promise<void> {
  for (const draw of DRAWS) {
    const id = randomUUID();
    const { zone } = draw;
    const startsAt = new Date(draw.startsAt);
    await db.query(
      `INSERT INTO draws (id, member_id, phlebotomist_id, state, starts_at, local_date, local_time, collected_at, kit_codes)
       VALUES ($1, $2, $3, 'released', $4, $5, $6, $7, $8)`,
      [id, people.get(draw.member), phlebotomists.get(draw.phlebotomist), startsAt, localDate(startsAt, zone), localTime(startsAt, zone), new Date(draw.collectedAt), [draw.kitCode]],
    );
    for (const [marker, value] of Object.entries(draw.values)) {
      const resultId = randomUUID();
      const isSeededNote = draw.startsAt === "2026-09-14T13:00:00Z" && marker === "vitaminD";
      const note = isSeededNote ? "Keep the morning D3 with breakfast." : null;
      await db.query("INSERT INTO results (id, draw_id, marker, value, note) VALUES ($1, $2, $3, $4, $5)", [resultId, id, marker, value, note]);
      await db.query("INSERT INTO result_history (result_id, value, note, by_name, at) VALUES ($1, $2, $3, $4, $5)", [
        resultId, value, note, "Priya Shah", new Date(draw.collectedAt),
      ]);
    }
  }
}

async function seedElenaCare(db: Db, people: ReadonlyMap<string, string>): Promise<void> {
  const elena = people.get("Elena Marsh");
  const at = "2026-09-21T16:30:00Z";
  const blendId = randomUUID();
  await db.query("INSERT INTO blends (id, member_id, items, saved_by, saved_at) VALUES ($1, $2, $3, 'Priya Shah', $4)", [blendId, elena, JSON.stringify(ELENA_BLEND), at]);
  await db.query(
    `INSERT INTO plans (id, member_id, state, nutrition, movement, sleep, supplements, published_at, published_by, blend_id, updated_at)
     VALUES ($1, $2, 'published', $3, $4, $5, $6, $7, 'Priya Shah', $8, $7)`,
    [randomUUID(), elena, ELENA_PLAN.nutrition, ELENA_PLAN.movement, ELENA_PLAN.sleep, ELENA_PLAN.supplements, at, blendId],
  );
  await db.query("INSERT INTO messages (id, member_id, from_role, from_name, body, sent_at) VALUES ($1, $2, 'member', 'Elena Marsh', $3, $4)", [
    randomUUID(), elena, "Could we move my spring draw a little earlier?", "2026-09-22T15:00:00Z",
  ]);
  await db.query("INSERT INTO messages (id, member_id, from_role, from_name, body, sent_at) VALUES ($1, $2, 'coordinator', 'Dana Ruiz', $3, $4)", [
    randomUUID(), elena, "Yes — I'll offer you 06:20 next time.", "2026-09-22T16:10:00Z",
  ]);
  await db.query("UPDATE members SET thread_state = 'handled' WHERE id = $1", [elena]);
}

const SEED_LOCK = 71260413;

export async function seedStartingData(): Promise<void> {
  await inTransaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock($1)", [SEED_LOCK]);
    if (await one(db, "SELECT 1 FROM people LIMIT 1")) return;
    const people = await seedPeople(db);
    const phlebotomists = await seedPhlebotomists(db);
    await seedRanges(db);
    await seedDraws(db, people, phlebotomists);
    await seedElenaCare(db, people);
  });
}
