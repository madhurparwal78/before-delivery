import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { hashPassword } from "./auth";
import { affineToJson, IDENTITY, type Outline } from "../shared/geometry";
import { pool, rows, transaction, type Tx } from "./db";
import { ApiError } from "./errors";
import { startEventLog } from "./events";
import { createNote } from "./notetext";
import { putObject } from "./storage";

// The seeded firm, inserted once when it is missing and never duplicated. Every person,
// address and code here is invented. Seed plan images ship with the app and go to the
// object store on the first start where storage is reachable.

const SEED_PASSWORD = "paper-plan-2026";
const PLAN_FILES = fileURLToPath(new URL("../../seed/plans/", import.meta.url));

const FIRM = "5eed0000-0000-4000-8000-000000000001";
const HALE = "5eed0000-0000-4000-8000-0000000000a1";
const ODUYA = "5eed0000-0000-4000-8000-0000000000a2";

const PEOPLE = {
  dana: { id: "5eed0000-0000-4000-8000-000000000101", name: "Dana Whitcombe", email: "dana@larchmere.example", phone: "555-0101" },
  ravi: { id: "5eed0000-0000-4000-8000-000000000102", name: "Ravi Okafor", email: "ravi@larchmere.example", phone: "555-0102" },
  marco: { id: "5eed0000-0000-4000-8000-000000000141", name: "Marco Ruiz", email: "marco@brightwire.example", phone: "555-0141" },
  tess: { id: "5eed0000-0000-4000-8000-000000000142", name: "Tess Lindqvist", email: "tess@lindqvisttile.example", phone: "555-0142" },
  paul: { id: "5eed0000-0000-4000-8000-000000000143", name: "Paul Ferrante", email: "paul@ferrantepaint.example", phone: "555-0143" },
  priya: { id: "5eed0000-0000-4000-8000-000000000177", name: "Priya Hale", email: "priya.hale@example.com", phone: "555-0177" },
  sam: { id: "5eed0000-0000-4000-8000-000000000188", name: "Sam Oduya", email: "sam.oduya@example.net", phone: "555-0188" },
} as const;

type Who = keyof typeof PEOPLE;

interface SeedJob {
  id: string;
  name: string;
  address: string;
  timeZone: string;
  planFile: string;
  card: [string, string, string, string];
  members: Array<[Who, "owner" | "lead" | "trade" | "homeowner", string | null]>;
  rooms: Array<[string, [number, number][]]>;
  items: Array<{
    room: string;
    title: string;
    trade: string | null;
    status: string;
    pin: [number, number] | null;
    cost: string | null;
    by: Who;
  }>;
}

const JOBS: SeedJob[] = [
  {
    id: HALE,
    name: "Hale kitchen and bath",
    address: "14 Orchard Lane, Maple Falls",
    timeZone: "America/Chicago",
    planFile: "hale.png",
    card: ["4826", "7319", "5550", "Biscuit the dog stays in the laundry room; keep that door shut."],
    members: [
      ["dana", "owner", null],
      ["ravi", "lead", null],
      ["marco", "trade", "electrical"],
      ["tess", "trade", "tile"],
      ["paul", "trade", "paint"],
      ["priya", "homeowner", null],
    ],
    rooms: [
      ["Kitchen", [[0.04, 0.05], [0.52, 0.05], [0.52, 0.3], [0.4, 0.3], [0.4, 0.47], [0.04, 0.47]]],
      ["Primary bath", [[0.58, 0.05], [0.96, 0.05], [0.96, 0.45], [0.58, 0.45]]],
      ["Hall", [[0.04, 0.53], [0.44, 0.53], [0.44, 0.75], [0.5, 0.75], [0.5, 0.95], [0.04, 0.95]]],
      ["Laundry", [[0.5, 0.53], [0.96, 0.53], [0.96, 0.95], [0.5, 0.95]]],
    ],
    items: [
      { room: "Kitchen", title: "Touch-up paint by the window", trade: "paint", status: "open", pin: [0.3, 0.12], cost: "Leftover wall paint in garage; no charge", by: "ravi" },
      { room: "Kitchen", title: "Pendant over island flickers", trade: "electrical", status: "in_progress", pin: [0.24, 0.3], cost: "Fixture under supplier warranty", by: "ravi" },
      { room: "Primary bath", title: "Regrout shower corner", trade: "tile", status: "in_progress", pin: [0.86, 0.16], cost: null, by: "ravi" },
      { room: "Primary bath", title: "Caulk gap behind vanity", trade: null, status: "open", pin: [0.7, 0.32], cost: null, by: "ravi" },
      { room: "Hall", title: "Outlet cover missing by closet", trade: "electrical", status: "open", pin: null, cost: null, by: "dana" },
      { room: "Hall", title: "Door sticks at the head", trade: null, status: "verified", pin: [0.2, 0.72], cost: null, by: "ravi" },
    ],
  },
  {
    id: ODUYA,
    name: "Oduya basement",
    address: "9 Quarry Road, Ridgeview",
    timeZone: "America/Denver",
    planFile: "oduya.png",
    card: ["1193", "6604", "2871", "Side door sticks; lift the handle."],
    members: [
      ["dana", "owner", null],
      ["ravi", "lead", null],
      ["paul", "trade", "paint"],
      ["sam", "homeowner", null],
    ],
    rooms: [
      ["Rec room", [[0.05, 0.05], [0.65, 0.05], [0.65, 0.65], [0.05, 0.65]]],
      ["Utility", [[0.7, 0.05], [0.95, 0.05], [0.95, 0.45], [0.7, 0.45]]],
    ],
    items: [
      { room: "Rec room", title: "Baseboard gap at stair", trade: "paint", status: "open", pin: [0.3, 0.3], cost: null, by: "ravi" },
      { room: "Utility", title: "Label the panel circuits", trade: "electrical", status: "open", pin: null, cost: null, by: "ravi" },
    ],
  },
];

/** Deterministic ids keep the seed idempotent: `<prefix><job digit><n>`. */
function seedId(job: SeedJob, kind: number, n: number): string {
  const jobDigit = job.id === HALE ? "1" : "2";
  return `5eed0000-0000-4000-8${kind}${jobDigit}0-${String(n).padStart(12, "0")}`;
}

function memberRole(job: SeedJob, who: Who): string {
  return job.members.find(([member]) => member === who)![1];
}

async function insertJob(tx: Tx, job: SeedJob): Promise<void> {
  const dana = PEOPLE.dana.id;
  await tx.query(
    "INSERT INTO jobs (id, firm_id, name, address, time_zone, next_item_number) VALUES ($1, $2, $3, $4, $5, $6)",
    [job.id, FIRM, job.name, job.address, job.timeZone, job.items.length + 1],
  );
  await tx.query("INSERT INTO access_cards (job_id, lockbox_code, alarm_code, garage_code, house_note) VALUES ($1, $2, $3, $4, $5)", [
    job.id,
    ...job.card,
  ]);
  await tx.query(
    `INSERT INTO plan_revisions (id, job_id, revision, object_key, content_type, transform, uploaded_by, uploaded_by_role, awaiting_seed_upload)
     VALUES ($1, $2, 1, $3, 'image/png', $4::jsonb, $5, 'owner', true)`,
    [seedId(job, 1, 1), job.id, `jobs/${job.id}/plan/${seedId(job, 1, 1)}.png`, JSON.stringify(affineToJson(IDENTITY)), dana],
  );
  for (const [index, [who, role, trade]] of job.members.entries()) {
    await tx.query("INSERT INTO job_members (id, job_id, person_id, role, trade) VALUES ($1, $2, $3, $4, $5)", [
      seedId(job, 2, index + 1),
      job.id,
      PEOPLE[who].id,
      role,
      trade,
    ]);
  }
  const roomIds = new Map<string, string>();
  for (const [index, [name, corners]] of job.rooms.entries()) {
    roomIds.set(name, seedId(job, 3, index + 1));
    const outline: Outline = corners.map(([x, y]) => ({ x, y }));
    await tx.query("INSERT INTO rooms (id, job_id, name, outline) VALUES ($1, $2, $3, $4::jsonb)", [
      roomIds.get(name),
      job.id,
      name,
      JSON.stringify(outline),
    ]);
  }
  for (const [index, item] of job.items.entries()) {
    const by = PEOPLE[item.by].id;
    const setBy = JSON.stringify({ title: by, room_id: by, trade: by, cost_note: by, quantity: by, unit_cost: by, pin: by });
    await tx.query(
      `INSERT INTO items (id, job_id, number, title, room_id, trade, status, pin_x, pin_y, pin_status, cost_note, created_by,
         created_by_role, set_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
      [seedId(job, 4, index + 1), job.id, index + 1, item.title, roomIds.get(item.room), item.trade, item.status,
        item.pin?.[0] ?? null, item.pin?.[1] ?? null, item.pin ? "placed" : "unpinned", item.cost, by, memberRole(job, item.by), setBy],
    );
  }
}

async function insertHaleExtras(tx: Tx): Promise<void> {
  const hale = JOBS[0]!;
  const item = (n: number) => seedId(hale, 4, n);
  const member = (who: Who) => seedId(hale, 2, hale.members.findIndex(([candidate]) => candidate === who) + 1);
  const notes: Array<[number, number, string | null, string, "crew" | "everyone", Who]> = [
    [1, 2, null, "Marco thinks it's the dimmer; bring a spare.", "crew", "ravi"],
    [2, 1, null, "There's also a scuff on the base cabinet.", "everyone", "priya"],
    [3, 1, seedId(hale, 5, 2), "We'll cover it with the window touch-up.", "everyone", "ravi"],
  ];
  for (const [n, itemNumber, parent, body, audience, who] of notes) {
    const role = memberRole(hale, who);
    await tx.query(
      `INSERT INTO notes (id, item_id, parent_id, body, audience, author_id, author_role, rev, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8::jsonb)`,
      [seedId(hale, 5, n), item(itemNumber), parent, body, audience, PEOPLE[who].id, role, JSON.stringify(createNote(body, member(who)))],
    );
    await tx.query("INSERT INTO note_revisions (note_id, rev, author_id, author_role) VALUES ($1, 0, $2, $3)", [
      seedId(hale, 5, n),
      PEOPLE[who].id,
      role,
    ]);
  }
  const visitDate = "2030-03-04";
  const localTime = (hhmm: string) => `${visitDate}T${hhmm}:00`;
  await tx.query(
    "INSERT INTO visit_series (id, job_id, member_id, starts_local, ends_local, recurrence, dates) VALUES ($1, $2, $3, $4, $5, NULL, $6::jsonb)",
    [seedId(hale, 6, 1), hale.id, member("marco"), localTime("08:00"), localTime("12:00"), JSON.stringify([visitDate])],
  );
}

/** Inserts the seed when the firm is missing, all in one transaction. */
export async function seedDatabase(): Promise<void> {
  const hash = await hashPassword(SEED_PASSWORD);
  await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(4174)");
    const existing = await tx.query("SELECT 1 FROM firms WHERE id = $1", [FIRM]);
    if (existing.rowCount) return;
    await tx.query("INSERT INTO firms (id, name) VALUES ($1, 'Larchmere Renovation Co.')", [FIRM]);
    for (const person of Object.values(PEOPLE)) {
      await tx.query("INSERT INTO people (id, firm_id, name, email, phone, password_hash, is_owner) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
        person.id,
        FIRM,
        person.name,
        person.email,
        person.phone,
        hash,
        person.id === PEOPLE.dana.id,
      ]);
    }
    for (const job of JOBS) await insertJob(tx, job);
    await insertHaleExtras(tx);
    for (const job of JOBS) await startEventLog(tx, job.id);
  });
}

/** Uploads seed plan images still waiting for a reachable object store. */
export async function uploadSeedPlans(): Promise<void> {
  const waiting = await rows<{ id: string; job_id: string; object_key: string }>(
    pool,
    "SELECT id, job_id, object_key FROM plan_revisions WHERE awaiting_seed_upload",
  );
  for (const plan of waiting) {
    const job = JOBS.find((candidate) => candidate.id === plan.job_id);
    if (!job) continue;
    try {
      await putObject(plan.object_key, await readFile(PLAN_FILES + job.planFile), "image/png");
      await pool.query("UPDATE plan_revisions SET awaiting_seed_upload = false WHERE id = $1", [plan.id]);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      console.error("seed plan not uploaded yet: the object store is unreachable");
      return;
    }
  }
}
