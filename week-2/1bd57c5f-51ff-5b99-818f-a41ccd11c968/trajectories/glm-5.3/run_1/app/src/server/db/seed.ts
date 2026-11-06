import type { PoolClient } from "pg";
import { hashPassword, newId } from "../identity.js";
import { makePlanImage } from "../plan_image.js";
import { storage } from "../storage.js";
import { localToUtc } from "../times.js";

const PASSWORD = "paper-plan-2026";

type SeedRoom = { name: string; corners: [number, number][] };

const HALE_ROOMS: SeedRoom[] = [
  { name: "Kitchen", corners: [[0.04, 0.05], [0.52, 0.05], [0.52, 0.3], [0.4, 0.3], [0.4, 0.47], [0.04, 0.47]] },
  { name: "Primary bath", corners: [[0.58, 0.05], [0.96, 0.05], [0.96, 0.45], [0.58, 0.45]] },
  { name: "Hall", corners: [[0.04, 0.53], [0.44, 0.53], [0.44, 0.75], [0.5, 0.75], [0.5, 0.95], [0.04, 0.95]] },
  { name: "Laundry", corners: [[0.5, 0.53], [0.96, 0.53], [0.96, 0.95], [0.5, 0.95]] },
];

const ODUYA_ROOMS: SeedRoom[] = [
  { name: "Rec room", corners: [[0.05, 0.05], [0.65, 0.05], [0.65, 0.65], [0.05, 0.65]] },
  { name: "Utility", corners: [[0.7, 0.05], [0.95, 0.05], [0.95, 0.45], [0.7, 0.45]] },
];

const PEOPLE: { id: string; name: string; email: string; phone: string; isOwner: boolean }[] = [
  { id: "person_dana", name: "Dana Whitcombe", email: "dana@larchmere.example", phone: "555-0101", isOwner: true },
  { id: "person_ravi", name: "Ravi Okafor", email: "ravi@larchmere.example", phone: "555-0102", isOwner: false },
  { id: "person_marco", name: "Marco Ruiz", email: "marco@brightwire.example", phone: "555-0141", isOwner: false },
  { id: "person_tess", name: "Tess Lindqvist", email: "tess@lindqvisttile.example", phone: "555-0142", isOwner: false },
  { id: "person_paul", name: "Paul Ferrante", email: "paul@ferrantepaint.example", phone: "555-0143", isOwner: false },
  { id: "person_priya", name: "Priya Hale", email: "priya.hale@example.com", phone: "555-0177", isOwner: false },
  { id: "person_sam", name: "Sam Oduya", email: "sam.oduya@example.net", phone: "555-0188", isOwner: false },
];

type SeedItem = {
  number: number;
  room: string;
  title: string;
  trade: string | null;
  status: string;
  pin: [number, number] | null;
  costNote: string | null;
  by: "ravi" | "dana";
};

const HALE_ITEMS: SeedItem[] = [
  { number: 1, room: "Kitchen", title: "Touch-up paint by the window", trade: "paint", status: "open", pin: [0.3, 0.12], costNote: "Leftover wall paint in garage; no charge", by: "ravi" },
  { number: 2, room: "Kitchen", title: "Pendant over island flickers", trade: "electrical", status: "in_progress", pin: [0.24, 0.3], costNote: "Fixture under supplier warranty", by: "ravi" },
  { number: 3, room: "Primary bath", title: "Regrout shower corner", trade: "tile", status: "in_progress", pin: [0.86, 0.16], costNote: null, by: "ravi" },
  { number: 4, room: "Primary bath", title: "Caulk gap behind vanity", trade: null, status: "open", pin: [0.7, 0.32], costNote: null, by: "ravi" },
  { number: 5, room: "Hall", title: "Outlet cover missing by closet", trade: "electrical", status: "open", pin: null, costNote: null, by: "dana" },
  { number: 6, room: "Hall", title: "Door sticks at the head", trade: null, status: "verified", pin: [0.2, 0.72], costNote: null, by: "ravi" },
];

const ODUYA_ITEMS: SeedItem[] = [
  { number: 1, room: "Rec room", title: "Baseboard gap at stair", trade: "paint", status: "open", pin: [0.3, 0.3], costNote: null, by: "ravi" },
  { number: 2, room: "Utility", title: "Label the panel circuits", trade: "electrical", status: "open", pin: null, costNote: null, by: "ravi" },
];

function charsFor(body: string): { ch: string; ins: number; del: number[] }[] {
  return [...body].map((ch) => ({ ch, ins: 0, del: [] }));
}

export async function seed(db: PoolClient): Promise<void> {
  // One process seeds at a time; the count check inside the lock keeps restarts
  // and simultaneous starts from ever duplicating seed data.
  await db.query("SELECT pg_advisory_xact_lock(918273645)");
  const peopleCount = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM people");
  if ((peopleCount.rows[0]?.n ?? 0) > 0) return;

  await db.query("INSERT INTO firms (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING", ["firm_larchmere", "Larchmere Renovation Co."]);
  const hash = await hashPassword(PASSWORD);
  for (const p of PEOPLE) {
    await db.query(
      `INSERT INTO people (id, firm_id, name, email, phone, password_hash, is_owner)
       VALUES ($1, 'firm_larchmere', $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [p.id, p.name, p.email, p.phone, hash, p.isOwner],
    );
  }

  const seedJobs: {
    id: string;
    name: string;
    address: string;
    tz: string;
    rooms: SeedRoom[];
    items: SeedItem[];
    nextItem: number;
    access: [string, string, string, string];
    members: { person: string; role: string; trade: string | null }[];
    visits: { person: string; date: string; start: string; end: string }[];
    planTitle: string;
  }[] = [
    {
      id: "job_hale",
      name: "Hale kitchen and bath",
      address: "14 Orchard Lane, Maple Falls",
      tz: "America/Chicago",
      rooms: HALE_ROOMS,
      items: HALE_ITEMS,
      nextItem: 7,
      access: ["4826", "7319", "5550", "Biscuit the dog stays in the laundry room; keep that door shut."],
      members: [
        { person: "person_dana", role: "owner", trade: null },
        { person: "person_ravi", role: "lead", trade: null },
        { person: "person_marco", role: "trade", trade: "electrical" },
        { person: "person_tess", role: "trade", trade: "tile" },
        { person: "person_paul", role: "trade", trade: "paint" },
        { person: "person_priya", role: "homeowner", trade: null },
      ],
      visits: [{ person: "person_marco", date: "2030-03-04", start: "08:00", end: "12:00" }],
      planTitle: "HALE KITCHEN AND BATH",
    },
    {
      id: "job_oduya",
      name: "Oduya basement",
      address: "9 Quarry Road, Ridgeview",
      tz: "America/Denver",
      rooms: ODUYA_ROOMS,
      items: ODUYA_ITEMS,
      nextItem: 3,
      access: ["1193", "6604", "2871", "Side door sticks; lift the handle."],
      members: [
        { person: "person_dana", role: "owner", trade: null },
        { person: "person_ravi", role: "lead", trade: null },
        { person: "person_paul", role: "trade", trade: "paint" },
        { person: "person_sam", role: "homeowner", trade: null },
      ],
      visits: [],
      planTitle: "ODUYA BASEMENT",
    },
  ];

  for (const job of seedJobs) {
    await db.query(
      `INSERT INTO jobs (id, firm_id, name, address, time_zone, status, next_item_number)
       VALUES ($1, 'firm_larchmere', $2, $3, $4, 'active', $5) ON CONFLICT DO NOTHING`,
      [job.id, job.name, job.address, job.tz, job.nextItem],
    );
    await db.query(
      `INSERT INTO access_cards (job_id, lockbox_code, alarm_code, garage_code, house_note)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [job.id, ...job.access],
    );

    const memberIds = new Map<string, string>();
    for (const m of job.members) {
      const mid = `${job.id}_${m.person}`;
      memberIds.set(m.person, mid);
      await db.query(
        `INSERT INTO job_members (id, job_id, person_id, role, trade) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [mid, job.id, m.person, m.role, m.trade],
      );
    }

    const roomIds = new Map<string, string>();
    let order = 0;
    for (const r of job.rooms) {
      const rid = `${job.id}_room_${order + 1}`;
      roomIds.set(r.name, rid);
      await db.query(
        `INSERT INTO rooms (id, job_id, name, outline, sort_order) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [rid, job.id, r.name, JSON.stringify(r.corners.map(([x, y]) => ({ x, y }))), order],
      );
      order++;
    }

    const objectKey = `jobs/${job.id}/plan/seed-revision-1.png`;
    const image = makePlanImage(
      job.rooms.map((r) => ({ name: r.name, corners: r.corners })),
      job.planTitle,
    );
    // The image uploads on the first start where storage is reachable; the row
    // commits either way and a later start retries the upload.
    try {
      await storage.put(objectKey, image, "image/png");
    } catch {
      // Storage unreachable: the database seed still completes.
    }
    await db.query(
      `INSERT INTO plan_revisions (job_id, revision, object_key, content_type, reference_points, uploaded_by, moved, needs_review)
       VALUES ($1, 1, $2, 'image/png', NULL, 'person_dana', 0, 0) ON CONFLICT DO NOTHING`,
      [job.id, objectKey],
    );

    for (const item of job.items) {
      const itemId = `${job.id}_item_${item.number}`;
      const creator = item.by === "dana" ? memberIds.get("person_dana") : memberIds.get("person_ravi");
      await db.query(
        `INSERT INTO items (id, job_id, number, title, room_id, trade, status, pin_x, pin_y, pin_status, cost_note, created_by, last_edited_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) ON CONFLICT DO NOTHING`,
        [
          itemId,
          job.id,
          item.number,
          item.title,
          roomIds.get(item.room),
          item.trade,
          item.status,
          item.pin === null ? null : item.pin[0].toFixed(4),
          item.pin === null ? null : item.pin[1].toFixed(4),
          item.pin === null ? "unpinned" : "placed",
          item.costNote,
          creator,
        ],
      );
    }

    if (job.id === "job_hale") {
      const item2 = "job_hale_item_2";
      const item1 = "job_hale_item_1";
      const note1 = newId("note");
      const note2 = newId("note");
      const reply = newId("note");
      await db.query(
        `INSERT INTO notes (id, job_id, item_id, parent_id, body, audience, author_id, rev, chars)
         VALUES ($1, $2, $3, NULL, $4, 'crew', $5, 0, $6) ON CONFLICT DO NOTHING`,
        [note1, job.id, item2, "Marco thinks it's the dimmer; bring a spare.", memberIds.get("person_ravi"), JSON.stringify(charsFor("Marco thinks it's the dimmer; bring a spare."))],
      );
      await db.query(
        `INSERT INTO note_revisions (note_id, rev, kind, author_id, edit_json, body) VALUES ($1, 0, 'create', $2, NULL, $3) ON CONFLICT DO NOTHING`,
        [note1, memberIds.get("person_ravi"), "Marco thinks it's the dimmer; bring a spare."],
      );
      await db.query(
        `INSERT INTO notes (id, job_id, item_id, parent_id, body, audience, author_id, rev, chars)
         VALUES ($1, $2, $3, NULL, $4, 'everyone', $5, 0, $6) ON CONFLICT DO NOTHING`,
        [note2, job.id, item1, "There's also a scuff on the base cabinet.", memberIds.get("person_priya"), JSON.stringify(charsFor("There's also a scuff on the base cabinet."))],
      );
      await db.query(
        `INSERT INTO note_revisions (note_id, rev, kind, author_id, edit_json, body) VALUES ($1, 0, 'create', $2, NULL, $3) ON CONFLICT DO NOTHING`,
        [note2, memberIds.get("person_priya"), "There's also a scuff on the base cabinet."],
      );
      await db.query(
        `INSERT INTO notes (id, job_id, item_id, parent_id, body, audience, author_id, rev, chars)
         VALUES ($1, $2, $3, $4, $5, 'everyone', $6, 0, $7) ON CONFLICT DO NOTHING`,
        [reply, job.id, item1, note2, "We'll cover it with the window touch-up.", memberIds.get("person_ravi"), JSON.stringify(charsFor("We'll cover it with the window touch-up."))],
      );
      await db.query(
        `INSERT INTO note_revisions (note_id, rev, kind, author_id, edit_json, body) VALUES ($1, 0, 'create', $2, NULL, $3) ON CONFLICT DO NOTHING`,
        [reply, memberIds.get("person_ravi"), "We'll cover it with the window touch-up."],
      );
    }

    for (const v of job.visits) {
      const visitId = newId("visit");
      const start = localToUtc(v.date, Number(v.start.slice(0, 2)), Number(v.start.slice(3, 5)), 0, job.tz);
      const end = localToUtc(v.date, Number(v.end.slice(0, 2)), Number(v.end.slice(3, 5)), 0, job.tz);
      await db.query(
        `INSERT INTO visits (id, job_id, member_id, starts_at_local, ends_at_local, starts_at_utc, ends_at_utc, recurrence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL) ON CONFLICT DO NOTHING`,
        [visitId, job.id, memberIds.get(v.person), `${v.date}T${v.start}`, `${v.date}T${v.end}`, start.utc.toISOString(), end.utc.toISOString()],
      );
      await db.query(
        `INSERT INTO visit_occurrences (visit_id, date, starts_at_utc, ends_at_utc, status)
         VALUES ($1, $2, $3, $4, 'scheduled') ON CONFLICT DO NOTHING`,
        [visitId, v.date, start.utc.toISOString(), end.utc.toISOString()],
      );
    }
  }
}
