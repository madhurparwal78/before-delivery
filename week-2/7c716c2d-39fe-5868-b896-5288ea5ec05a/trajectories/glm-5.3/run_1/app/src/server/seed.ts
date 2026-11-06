import type { Client } from "./db.ts";
import { uuid, sha256 } from "./ids.ts";
import { nowMs } from "./clock.ts";

interface SeedPerson {
  name: string;
  email: string;
  handle: string;
  role: string;
}

export async function seedIfEmpty(client: Client): Promise<boolean> {
  // One copy seeds: the lock plus the re-check inside the transaction close the race.
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(918273645)");
    const count = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM workspaces");
    if (Number(count.rows[0].n) > 0) {
      await client.query("COMMIT");
      return false;
    }
    const now = new Date(nowMs()).toISOString();
    await seedWorkspace(client, {
    name: "Kereru Labs",
    slug: "kereru",
    seatLimit: 8,
    zone: "Pacific/Auckland",
    weekdays: [1, 2, 3, 4, 5],
    holidays: [
      { date: "2026-12-25", name: "Christmas Day" },
      { date: "2026-12-28", name: "Boxing Day (observed)" },
    ],
    anchor: "2026-10-19",
    people: [
      { name: "Ana Whitlow", email: "ana@kereru.test", handle: "ana", role: "owner" },
      { name: "Ben Ostrow", email: "ben@kereru.test", handle: "ben", role: "member" },
      { name: "Chiara Lund", email: "chiara@kereru.test", handle: "chiara", role: "member" },
      { name: "Dev Ramaswamy", email: "dev@kereru.test", handle: "dev", role: "member" },
      { name: "Elin Park", email: "elin@kereru.test", handle: "elin", role: "member" },
      { name: "Femi Ade", email: "femi@kereru.test", handle: "femi", role: "guest" },
    ],
    guestProjects: ["KIL"],
    guestChannels: ["kiln-review"],
    projects: [
      { key: "KIL", name: "Kiln" },
      { key: "ATL", name: "Atlas" },
    ],
    issues: [
      { key: "KIL", num: 1, title: "Kiln onboarding checklist", status: "todo", assignee: "ben", cycle: 1 },
      { key: "KIL", num: 2, title: "Kiln billing export", status: "in_progress", assignee: "chiara", cycle: 1 },
      { key: "KIL", num: 3, title: "Export CSV header row", status: "done", assignee: "chiara", cycle: 1, parent: 2, closedAt: "2026-10-21T10:00:00+13:00" },
      { key: "KIL", num: 4, title: "Export date format", status: "todo", assignee: "dev", cycle: 1, parent: 2 },
      { key: "KIL", num: 5, title: "Kiln review checklist", status: "in_review", assignee: "femi", cycle: 1 },
      { key: "KIL", num: 6, title: "Kiln empty states", status: "backlog", assignee: null, cycle: null },
      { key: "ATL", num: 1, title: "Atlas search index", status: "todo", assignee: "elin", cycle: 1 },
      { key: "ATL", num: 2, title: "Atlas rate limits", status: "backlog", assignee: "dev", cycle: null },
    ],
    channels: [
      { name: "general", members: ["ana", "ben", "chiara", "dev", "elin"] },
      { name: "kiln-review", members: ["ana", "ben", "femi"] },
      { name: "random", members: ["ana", "ben", "chiara", "dev", "elin"] },
    ],
    messages: [
      { channel: "general", author: "ana", body: "Welcome to cycle 1." },
      { channel: "general", author: "ben", body: "Kiln export is in progress." },
      { channel: "general", author: "chiara", body: "Atlas notes are up." },
      { channel: "kiln-review", author: "femi", body: "Review checklist is ready." },
    ],
    threads: [{ channel: "kiln-review", rootIndex: 0, author: "ben", body: "Looking now." }],
    docs: [
      { title: "Kiln launch spec", project: "KIL", body: "Launch scope for Kiln." },
      { title: "Atlas notes", project: "ATL", body: "Notes on Atlas search." },
    ],
    rooms: [
      { name: "Lobby", kind: "open", x: 1, y: 1, w: 6, h: 4 },
      { name: "Studio", kind: "open", x: 8, y: 1, w: 6, h: 4 },
      { name: "Review Room", kind: "private", x: 1, y: 6, w: 6, h: 4 },
      { name: "Focus Booth", kind: "private", x: 8, y: 6, w: 6, h: 4 },
    ],
  }, now);
  await seedWorkspace(client, {
    name: "Halyard Works",
    slug: "halyard",
    seatLimit: 5,
    zone: "America/New_York",
    weekdays: [1, 2, 3, 4, 5],
    holidays: [],
    anchor: "2026-10-26",
    people: [
      { name: "Hal Booker", email: "hal@halyard.test", handle: "hal", role: "owner" },
      { name: "Iris Vane", email: "iris@halyard.test", handle: "iris", role: "member" },
    ],
    guestProjects: [],
    guestChannels: [],
    projects: [{ key: "RIG", name: "Rig" }],
    issues: [
      { key: "RIG", num: 1, title: "Rig inventory sync", status: "todo", assignee: "iris", cycle: 1 },
      { key: "RIG", num: 2, title: "Rig label printer", status: "backlog", assignee: null, cycle: null },
    ],
    channels: [{ name: "general", members: ["hal", "iris"] }],
    messages: [],
    threads: [],
    docs: [],
    rooms: [
      { name: "Lobby", kind: "open", x: 1, y: 1, w: 6, h: 4 },
      { name: "Huddle", kind: "private", x: 8, y: 1, w: 6, h: 4 },
    ],
  }, now);
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

interface SeedWorkspace {
  name: string;
  slug: string;
  seatLimit: number;
  zone: string;
  weekdays: number[];
  holidays: { date: string; name: string }[];
  anchor: string;
  people: SeedPerson[];
  guestProjects: string[];
  guestChannels: string[];
  projects: { key: string; name: string }[];
  issues: SeedIssue[];
  channels: { name: string; members: string[] }[];
  messages: { channel: string; author: string; body: string }[];
  threads: { channel: string; rootIndex: number; author: string; body: string }[];
  docs: { title: string; project: string; body: string }[];
  rooms: { name: string; kind: string; x: number; y: number; w: number; h: number }[];
}

interface SeedIssue {
  key: string;
  num: number;
  title: string;
  status: string;
  assignee: string | null;
  cycle: number | null;
  parent?: number;
  closedAt?: string;
}

async function seedWorkspace(client: Client, w: SeedWorkspace, now: string): Promise<void> {
  const wsId = uuid();
  await client.query(
    "INSERT INTO workspaces (id, name, slug, seat_limit, created_at) VALUES ($1,$2,$3,$4,$5)",
    [wsId, w.name, w.slug, w.seatLimit, now]
  );
  await client.query(
    "INSERT INTO calendar_states (workspace_id, seq, effective_from, time_zone, working_weekdays, holidays, cycle_anchor) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [wsId, 0, "0000-01-01", w.zone, w.weekdays, JSON.stringify(w.holidays), w.anchor]
  );

  const personIds = new Map<string, string>();
  const passwordHex = sha256("tally-demo-1");
  for (const p of w.people) {
    const id = uuid();
    personIds.set(p.handle, id);
    await client.query(
      "INSERT INTO people (id, workspace_id, name, email, handle, role, password_hex, removed, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8)",
      [id, wsId, p.name, p.email, p.handle, p.role, passwordHex, now]
    );
  }

  const projectIds = new Map<string, string>();
  let projectSeq = 0;
  for (const p of w.projects) {
    const id = uuid();
    projectIds.set(p.key, id);
    projectSeq++;
    await client.query(
      "INSERT INTO projects (id, workspace_id, key, name, seq) VALUES ($1,$2,$3,$4,$5)",
      [id, wsId, p.key, p.name, projectSeq]
    );
  }

  const guestHandles = w.people.filter((p) => p.role === "guest").map((p) => p.handle);
  for (const g of guestHandles) {
    for (const key of w.guestProjects) {
      await client.query("INSERT INTO project_guests (project_id, person_id) VALUES ($1,$2)", [
        projectIds.get(key)!,
        personIds.get(g)!,
      ]);
    }
  }

  const issueIds = new Map<string, string>();
  for (const i of w.issues) {
    const id = uuid();
    issueIds.set(`${i.key}-${i.num}`, id);
    await client.query(
      "INSERT INTO issues (id, workspace_id, project_id, number, title, description, status, assignee_id, parent_id, cycle_number, due_date, closed_at, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
      [
        id,
        wsId,
        projectIds.get(i.key)!,
        i.num,
        i.title,
        "",
        i.status,
        i.assignee ? personIds.get(i.assignee)! : null,
        i.parent ? issueIds.get(`${i.key}-${i.parent}`)! : null,
        i.cycle,
        null,
        i.closedAt ?? null,
        now,
        now,
      ]
    );
  }

  const channelIds = new Map<string, string>();
  for (const c of w.channels) {
    const id = uuid();
    channelIds.set(c.name, id);
    await client.query("INSERT INTO channels (id, workspace_id, name) VALUES ($1,$2,$3)", [id, wsId, c.name]);
    for (const m of c.members) {
      await client.query("INSERT INTO channel_members (channel_id, person_id) VALUES ($1,$2)", [
        id,
        personIds.get(m)!,
      ]);
    }
  }


  const rootIds: { channel: string; ids: number[] }[] = [];
  for (const m of w.messages) {
    const res = await client.query<{ id: string }>(
      "INSERT INTO messages (workspace_id, channel_id, author_id, body, thread_root_id, client_key, mentions, created_at, deleted) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false) RETURNING id",
      [wsId, channelIds.get(m.channel)!, personIds.get(m.author)!, m.body, null, null, "{}", now]
    );
    const list = rootIds.find((r) => r.channel === m.channel);
    if (list) list.ids.push(Number(res.rows[0].id));
    else rootIds.push({ channel: m.channel, ids: [Number(res.rows[0].id)] });
  }
  for (const t of w.threads) {
    const list = rootIds.find((r) => r.channel === t.channel)!;
    const rootId = list.ids[t.rootIndex];
    await client.query(
      "INSERT INTO messages (workspace_id, channel_id, author_id, body, thread_root_id, client_key, mentions, created_at, deleted) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false)",
      [wsId, channelIds.get(t.channel)!, personIds.get(t.author)!, t.body, rootId, null, "{}", now]
    );
  }

  // Everyone starts with every seeded message read.
  const allMessageIds = await client.query<{ id: string; channel_id: string }>(
    "SELECT id, channel_id FROM messages WHERE workspace_id = $1",
    [wsId]
  );
  for (const p of w.people) {
    const pid = personIds.get(p.handle)!;
    for (const row of allMessageIds.rows) {
      await client.query(
        "INSERT INTO read_markers (person_id, scope, scope_id, last_read) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [pid, "channel", row.channel_id, Number(row.id)]
      );
    }
    for (const t of w.threads) {
      const list = rootIds.find((r) => r.channel === t.channel)!;
      const replies = await client.query<{ id: string }>(
        "SELECT id FROM messages WHERE workspace_id = $1 AND thread_root_id = $2 ORDER BY id",
        [wsId, list.ids[t.rootIndex]]
      );
      for (const r of replies.rows) {
        await client.query(
          "INSERT INTO read_markers (person_id, scope, scope_id, last_read) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [pid, "thread", String(list.ids[t.rootIndex]), Number(r.id)]
        );
      }
    }
  }

  for (const d of w.docs) {
    const id = uuid();
    await client.query(
      "INSERT INTO docs (id, workspace_id, project_id, title, body, version, updated_by, updated_at, created_at) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$7)",
      [id, wsId, projectIds.get(d.project)!, d.title, d.body, personIds.get(w.people[0].handle)!, now]
    );
    await client.query(
      "INSERT INTO doc_versions (doc_id, version, title, body, saved_at, saved_by) VALUES ($1,1,$2,$3,$4,$5)",
      [id, d.title, d.body, now, personIds.get(w.people[0].handle)!]
    );
  }

  let roomSeq = 0;
  for (const r of w.rooms) {
    roomSeq++;
    await client.query(
      "INSERT INTO rooms (id, workspace_id, name, kind, x, y, w, h, seq) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [uuid(), wsId, r.name, r.kind, r.x, r.y, r.w, r.h, roomSeq]
    );
  }

  // Guests join only their invited channels; every other member is in their channels already.
  for (const g of guestHandles) {
    for (const name of w.guestChannels) {
      await client.query("INSERT INTO channel_members (channel_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [
        channelIds.get(name)!,
        personIds.get(g)!,
      ]);
    }
  }
}
