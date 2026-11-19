// The seed: two invented facilitators and their workshops, applied idempotently on every start.
import { newId, tx, type Db } from "./db.js";
import { hashPassword, hashToken, newToken } from "./auth.js";
import { resolveWallTime } from "./zone.js";
import { addTemplateFrames, joinToken } from "./workshops.js";
import type { Template } from "../shared/templates.js";
import type { Plan, Term } from "../shared/plans.js";

interface SeedFacilitator {
  name: string;
  email: string;
  password: string;
  timeZone: string;
  plan: Plan;
  term: Term;
}

const FACILITATORS: SeedFacilitator[] = [
  { name: "Juno Marlowe", email: "juno@lanternfold.test", password: "fold-the-lantern-26", timeZone: "Europe/Lisbon", plan: "studio", term: "monthly" },
  { name: "Odile Brack", email: "odile@lanternfold.test", password: "brack-the-room-27", timeZone: "America/Toronto", plan: "free", term: "monthly" },
];

interface SeedNote {
  frame: string;
  text: string;
  author: string | null;
  x: number;
  y: number;
  cluster?: string;
  facilitatorOnly?: boolean;
}

interface SeedWorkshop {
  key: string;
  owner: string;
  title: string;
  template: Template;
  status: "draft" | "revealed";
  start: string;
  end: string;
  sponsor: string;
  feeCents: number;
  participants: string[];
  clusters: { frame: string; title: string; x: number; y: number }[];
  notes: SeedNote[];
  connector?: [string, string];
}

const WORKSHOPS: SeedWorkshop[] = [
  {
    key: "harbourline",
    owner: "juno@lanternfold.test",
    title: "Harbourline Studio — discovery sprint",
    template: "discovery",
    status: "draft",
    start: "2027-03-04T14:00",
    end: "2027-03-04T17:00",
    sponsor: "sponsor@harbourline.test",
    feeCents: 0,
    participants: [],
    clusters: [],
    notes: [],
  },
  {
    key: "fernmoor",
    owner: "juno@lanternfold.test",
    title: "Fernmoor Clinic — Q3 retrospective",
    template: "retrospective",
    status: "revealed",
    start: "2027-02-11T09:00",
    end: "2027-02-11T11:00",
    sponsor: "lead@fernmoor.test",
    feeCents: 125010,
    participants: ["Priya N.", "Tomás R.", "Ade K."],
    clusters: [
      { frame: "To improve", title: "Handoffs", x: 24, y: 76 },
      { frame: "To improve", title: "Tooling", x: 236, y: 76 },
    ],
    notes: [
      { frame: "Went well", text: "Weekly demo kept the clinic leads close", author: "Priya N.", x: 40, y: 96 },
      { frame: "Went well", text: "Release notes are finally readable", author: "Ade K.", x: 260, y: 160 },
      { frame: "To improve", text: "Intake forms change hands three times", author: "Tomás R.", x: 0, y: 0, cluster: "Handoffs" },
      { frame: "To improve", text: "Nobody owns the Friday triage", author: "Priya N.", x: 0, y: 0, cluster: "Handoffs" },
      { frame: "To improve", text: "Night shift hears about changes last", author: "Ade K.", x: 0, y: 0, cluster: "Handoffs" },
      { frame: "To improve", text: "Two scheduling tools disagree", author: "Tomás R.", x: 0, y: 0, cluster: "Tooling" },
      { frame: "To improve", text: "Search in the records app times out", author: "Priya N.", x: 0, y: 0, cluster: "Tooling" },
      { frame: "To improve", text: "Too many status meetings", author: "Ade K.", x: 470, y: 96 },
      { frame: "To improve", text: "Sponsor bristles at any mention of the scheduling vendor", author: null, x: 470, y: 380, facilitatorOnly: true },
      { frame: "Actions", text: "Pilot a single triage owner for April", author: null, x: 40, y: 96 },
    ],
    connector: ["Nobody owns the Friday triage", "Pilot a single triage owner for April"],
  },
  {
    key: "kestrel",
    owner: "odile@lanternfold.test",
    title: "Kestrel Foods — strategy offsite",
    template: "strategy",
    status: "draft",
    start: "2027-04-08T10:00",
    end: "2027-04-08T16:00",
    sponsor: "ops@kestrelfoods.test",
    feeCents: 0,
    participants: [],
    clusters: [],
    notes: [],
  },
];

function instant(wall: string, zone: string): Date {
  const resolved = resolveWallTime(wall, zone);
  if (!resolved.ok) throw new Error(`seed time ${wall} does not resolve in ${zone}`);
  return resolved.instant;
}

async function seedWorkshop(t: Db, facilitator: { id: string; time_zone: string }, s: SeedWorkshop): Promise<void> {
  const id = newId();
  const inserted = await t.one(
    `INSERT INTO workshops (id, facilitator_id, seed_key, title, template, status, scheduled_start, scheduled_end, start_at, end_at, sponsor_email, fee_cents, round_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (seed_key) DO NOTHING RETURNING id`,
    [
      id, facilitator.id, s.key, s.title, s.template, s.status, s.start, s.end,
      instant(s.start, facilitator.time_zone), instant(s.end, facilitator.time_zone), s.sponsor, s.feeCents, s.status === "revealed" ? 1 : 0,
    ],
  );
  if (!inserted) return;
  const frameIds = await addTemplateFrames(t, id, s.template);
  const frames = new Map((await t.rows<{ id: string; title: string }>("SELECT id, title FROM frames WHERE workshop_id = $1", [id])).map((f) => [f.title, f.id]));
  const linkId = newId();
  await t.run("INSERT INTO join_links (id, workshop_id, token) VALUES ($1, $2, $3)", [linkId, id, joinToken()]);
  const people = new Map<string, string>();
  for (const name of s.participants) {
    const pid = newId();
    people.set(name, pid);
    await t.run("INSERT INTO participants (id, workshop_id, link_id, display_name, session_hash, cursor_id, hue) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
      pid, id, linkId, name, hashToken(newToken()), newId(), 60 + people.size * 97,
    ]);
  }
  const clusters = new Map<string, string>();
  for (const c of s.clusters) {
    const cid = newId();
    clusters.set(c.title, cid);
    await t.run("INSERT INTO clusters (id, workshop_id, frame_id, title, x, y) VALUES ($1, $2, $3, $4, $5, $6)", [cid, id, frames.get(c.frame) ?? frameIds[0] ?? "", c.title, c.x, c.y]);
  }
  const notes = new Map<string, string>();
  const order = new Map<string, number>();
  for (const n of s.notes) {
    const nid = newId();
    notes.set(n.text, nid);
    const cluster = n.cluster ? clusters.get(n.cluster) ?? null : null;
    const index = cluster ? order.get(cluster) ?? 0 : null;
    if (cluster) order.set(cluster, (index ?? 0) + 1);
    await t.run(
      `INSERT INTO notes (id, workshop_id, frame_id, cluster_id, cluster_index, kind, text, x, y, revealed, facilitator_only, author_participant_id, round)
       VALUES ($1, $2, $3, $4, $5, 'text', $6, $7, $8, true, $9, $10, 1)`,
      [nid, id, frames.get(n.frame) ?? "", cluster, index, n.text, n.x, n.y, n.facilitatorOnly === true, n.author ? people.get(n.author) ?? null : null],
    );
  }
  if (s.connector) {
    await t.run("INSERT INTO connectors (id, workshop_id, from_note, to_note) VALUES ($1, $2, $3, $4)", [
      newId(), id, notes.get(s.connector[0]) ?? "", notes.get(s.connector[1]) ?? "",
    ]);
  }
}

/** Applies the seed idempotently; a transaction lost to another booting instance (a deadlock) is tried again. */
export async function seed(): Promise<void> {
  for (;;) {
    try {
      await applySeed();
      return;
    } catch (error) {
      console.error(`seed retry: ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

async function applySeed(): Promise<void> {
  await tx(async (t) => {
    await t.run("SELECT pg_advisory_xact_lock(4173003)");
    for (const f of FACILITATORS) {
      await t.run(
        `INSERT INTO facilitators (id, email, name, password_hash, time_zone, seed_plan, seed_term) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (email) DO NOTHING`,
        [newId(), f.email, f.name, hashPassword(f.password), f.timeZone, f.plan, f.term],
      );
      const row = await t.one<{ id: string }>("SELECT id FROM facilitators WHERE email = $1", [f.email]);
      if (!row) throw new Error(`seed facilitator ${f.email} missing`);
      await t.run("INSERT INTO billing (facilitator_id, plan, term) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [row.id, f.plan, f.term]);
    }
    for (const s of WORKSHOPS) {
      const owner = await t.one<{ id: string; time_zone: string }>("SELECT id, time_zone FROM facilitators WHERE email = $1", [s.owner]);
      if (owner) await seedWorkshop(t, owner, s);
    }
  });
}
