// Seed data from the brief, loaded once into an empty database. Ids are random per database.
import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import { hashPassword } from "./passwords.js";
import { localTime, nowMs } from "./time.js";

const PASSWORD = "tally-demo-1";

interface SeedPerson {
  name: string;
  email: string;
  handle: string;
  role: "owner" | "member" | "guest";
}

interface SeedIssue {
  key: string;
  title: string;
  status: string;
  assignee: string | null;
  cycle: number | null;
  parent?: string;
  closedAt?: number;
}

interface SeedRoom {
  name: string;
  kind: "open" | "private";
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SeedWorkspace {
  name: string;
  slug: string;
  zone: string;
  holidays: { date: string; name: string }[];
  anchor: string;
  seats: number;
  people: SeedPerson[];
  projects: { key: string; name: string }[];
  issues: SeedIssue[];
  channels: { name: string; members: string[]; isDefault: boolean; messages: { from: string; body: string; replies?: { from: string; body: string }[] }[] }[];
  guestProjects: { handle: string; project: string }[];
  docs: { title: string; project: string; body: string }[];
  rooms: SeedRoom[];
}

const KERERU: SeedWorkspace = {
  name: "Kereru Labs",
  slug: "kereru",
  zone: "Pacific/Auckland",
  holidays: [
    { date: "2026-12-25", name: "Christmas Day" },
    { date: "2026-12-28", name: "Boxing Day (observed)" },
  ],
  anchor: "2026-10-19",
  seats: 8,
  people: [
    { name: "Ana Whitlow", email: "ana@kereru.test", handle: "ana", role: "owner" },
    { name: "Ben Ostrow", email: "ben@kereru.test", handle: "ben", role: "member" },
    { name: "Chiara Lund", email: "chiara@kereru.test", handle: "chiara", role: "member" },
    { name: "Dev Ramaswamy", email: "dev@kereru.test", handle: "dev", role: "member" },
    { name: "Elin Park", email: "elin@kereru.test", handle: "elin", role: "member" },
    { name: "Femi Ade", email: "femi@kereru.test", handle: "femi", role: "guest" },
  ],
  projects: [
    { key: "KIL", name: "Kiln" },
    { key: "ATL", name: "Atlas" },
  ],
  issues: [
    { key: "KIL-1", title: "Kiln onboarding checklist", status: "todo", assignee: "ben", cycle: 1 },
    { key: "KIL-2", title: "Kiln billing export", status: "in_progress", assignee: "chiara", cycle: 1 },
    { key: "KIL-3", title: "Export CSV header row", status: "done", assignee: "chiara", cycle: 1, parent: "KIL-2", closedAt: localTime("2026-10-21", 10, "Pacific/Auckland") },
    { key: "KIL-4", title: "Export date format", status: "todo", assignee: "dev", cycle: 1, parent: "KIL-2" },
    { key: "KIL-5", title: "Kiln review checklist", status: "in_review", assignee: "femi", cycle: 1 },
    { key: "KIL-6", title: "Kiln empty states", status: "backlog", assignee: null, cycle: null },
    { key: "ATL-1", title: "Atlas search index", status: "todo", assignee: "elin", cycle: 1 },
    { key: "ATL-2", title: "Atlas rate limits", status: "backlog", assignee: "dev", cycle: null },
  ],
  channels: [
    {
      name: "general",
      members: ["ana", "ben", "chiara", "dev", "elin"],
      isDefault: true,
      messages: [
        { from: "ana", body: "Welcome to cycle 1." },
        { from: "ben", body: "Kiln export is in progress." },
        { from: "chiara", body: "Atlas notes are up." },
      ],
    },
    {
      name: "kiln-review",
      members: ["ana", "ben", "femi"],
      isDefault: false,
      messages: [{ from: "femi", body: "Review checklist is ready.", replies: [{ from: "ben", body: "Looking now." }] }],
    },
    { name: "random", members: ["ana", "ben", "chiara", "dev", "elin"], isDefault: true, messages: [] },
  ],
  guestProjects: [{ handle: "femi", project: "KIL" }],
  docs: [
    { title: "Kiln launch spec", project: "KIL", body: "Launch scope for Kiln." },
    { title: "Atlas notes", project: "ATL", body: "Notes on Atlas search." },
  ],
  rooms: [
    { name: "Lobby", kind: "open", x: 0, y: 0, w: 9, h: 7 },
    { name: "Studio", kind: "open", x: 9, y: 0, w: 11, h: 7 },
    { name: "Review Room", kind: "private", x: 0, y: 7, w: 11, h: 6 },
    { name: "Focus Booth", kind: "private", x: 11, y: 7, w: 9, h: 6 },
  ],
};

const HALYARD: SeedWorkspace = {
  name: "Halyard Works",
  slug: "halyard",
  zone: "America/New_York",
  holidays: [],
  anchor: "2026-10-26",
  seats: 5,
  people: [
    { name: "Hal Booker", email: "hal@halyard.test", handle: "hal", role: "owner" },
    { name: "Iris Vane", email: "iris@halyard.test", handle: "iris", role: "member" },
  ],
  projects: [{ key: "RIG", name: "Rig" }],
  issues: [
    { key: "RIG-1", title: "Rig inventory sync", status: "todo", assignee: "iris", cycle: 1 },
    { key: "RIG-2", title: "Rig label printer", status: "backlog", assignee: null, cycle: null },
  ],
  channels: [{ name: "general", members: ["hal", "iris"], isDefault: true, messages: [] }],
  guestProjects: [],
  docs: [],
  rooms: [
    { name: "Lobby", kind: "open", x: 0, y: 0, w: 11, h: 8 },
    { name: "Huddle", kind: "private", x: 11, y: 0, w: 7, h: 8 },
  ],
};

async function seedWorkspace(db: Db, seed: SeedWorkspace, now: number): Promise<void> {
  const workspaceId = randomUUID();
  await db.query("INSERT INTO workspaces (id, name, slug, seat_limit) VALUES ($1, $2, $3, $4)", [workspaceId, seed.name, seed.slug, seed.seats]);
  await db.query(
    "INSERT INTO calendar_saves (workspace_id, effective_date, time_zone, working_weekdays, holidays, cycle_anchor) VALUES ($1, '0001-01-01', $2, $3, $4, $5)",
    [workspaceId, seed.zone, [1, 2, 3, 4, 5], JSON.stringify(seed.holidays), seed.anchor],
  );
  const people = new Map<string, string>();
  for (const person of seed.people) {
    const id = randomUUID();
    people.set(person.handle, id);
    await db.query(
      "INSERT INTO people (id, name, email, email_key, handle, password_hash, workspace_id, role, last_active_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)",
      [id, person.name, person.email, person.email.toLowerCase(), person.handle, await hashPassword(PASSWORD), workspaceId, person.role, now],
    );
  }
  const person = (handle: string): string => people.get(handle) as string;
  const projects = new Map<string, string>();
  for (const project of seed.projects) {
    const id = randomUUID();
    projects.set(project.key, id);
    const count = seed.issues.filter((issue) => issue.key.startsWith(`${project.key}-`)).length;
    await db.query("INSERT INTO projects (id, workspace_id, key, name, next_number) VALUES ($1, $2, $3, $4, $5)", [id, workspaceId, project.key, project.name, count + 1]);
  }
  for (const grant of seed.guestProjects) {
    await db.query("INSERT INTO project_guests (project_id, person_id) VALUES ($1, $2)", [projects.get(grant.project), person(grant.handle)]);
  }
  const issueIds = new Map<string, string>();
  for (const issue of seed.issues) {
    const id = randomUUID();
    issueIds.set(issue.key, id);
    const [projectKey, number] = issue.key.split("-") as [string, string];
    await db.query(
      `INSERT INTO issues (id, workspace_id, project_id, number, key, title, status, assignee_id, parent_id, planned_cycle, closed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
      [id, workspaceId, projects.get(projectKey), Number(number), issue.key, issue.title, issue.status, issue.assignee ? person(issue.assignee) : null, issue.parent ? issueIds.get(issue.parent) : null, issue.cycle, issue.closedAt ?? null, now],
    );
  }
  for (const channel of seed.channels) {
    const channelId = randomUUID();
    await db.query("INSERT INTO channels (id, workspace_id, name, is_default) VALUES ($1, $2, $3, $4)", [channelId, workspaceId, channel.name, channel.isDefault]);
    for (const handle of channel.members) {
      await db.query("INSERT INTO channel_members (channel_id, person_id) VALUES ($1, $2)", [channelId, person(handle)]);
    }
    let newest = 0;
    for (const message of channel.messages) {
      const [root] = (await db.query<{ id: number }>("INSERT INTO messages (workspace_id, channel_id, author_id, body, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [workspaceId, channelId, person(message.from), message.body, now])).rows;
      newest = Math.max(newest, root?.id ?? 0);
      for (const reply of message.replies ?? []) {
        const [row] = (await db.query<{ id: number }>("INSERT INTO messages (workspace_id, channel_id, author_id, body, thread_root_id, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id", [workspaceId, channelId, person(reply.from), reply.body, root?.id, now])).rows;
        newest = Math.max(newest, row?.id ?? 0);
        for (const handle of channel.members) {
          await db.query("INSERT INTO thread_markers (person_id, root_id, up_to) VALUES ($1, $2, $3) ON CONFLICT (person_id, root_id) DO UPDATE SET up_to = EXCLUDED.up_to", [person(handle), root?.id, row?.id]);
        }
      }
    }
    for (const handle of channel.members) {
      await db.query("INSERT INTO read_markers (person_id, channel_id, up_to) VALUES ($1, $2, $3)", [person(handle), channelId, newest]);
    }
  }
  const owner = person(seed.people[0]?.handle ?? "");
  for (const doc of seed.docs) {
    const docId = randomUUID();
    await db.query("INSERT INTO docs (id, workspace_id, project_id, title, body, version, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, 1, $6, $7)", [docId, workspaceId, projects.get(doc.project), doc.title, doc.body, owner, now]);
    await db.query("INSERT INTO doc_versions (doc_id, version, title, body, saved_by, saved_at) VALUES ($1, 1, $2, $3, $4, $5)", [docId, doc.title, doc.body, owner, now]);
  }
  for (const [position, room] of seed.rooms.entries()) {
    await db.query("INSERT INTO rooms (id, workspace_id, name, kind, x, y, w, h, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)", [randomUUID(), workspaceId, room.name, room.kind, room.x, room.y, room.w, room.h, position]);
  }
}

export async function seedIfEmpty(db: Db): Promise<void> {
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM workspaces");
  if ((rows[0]?.n ?? 0) > 0) return;
  const now = nowMs();
  await seedWorkspace(db, KERERU, now);
  await seedWorkspace(db, HALYARD, now);
}
