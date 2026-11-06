import { randomUUID } from 'node:crypto';
import { nowDate } from './clock.js';
import type { Queryable } from './db.js';
import { hashPassword } from './passwords.js';
import type { IssueStatus, Role } from '../shared/types.js';

type SeedPerson = { name: string; email: string; handle: string; role: Role };
type SeedIssue = {
  key: string;
  title: string;
  status: IssueStatus;
  assignee: string | null;
  cycle: number | null;
  parent: string | null;
  closedAt: string | null;
};

const SEED_PASSWORD = 'tally-demo-1';

const kereruPeople: SeedPerson[] = [
  { name: 'Ana Whitlow', email: 'ana@kereru.test', handle: 'ana', role: 'owner' },
  { name: 'Ben Ostrow', email: 'ben@kereru.test', handle: 'ben', role: 'member' },
  { name: 'Chiara Lund', email: 'chiara@kereru.test', handle: 'chiara', role: 'member' },
  { name: 'Dev Ramaswamy', email: 'dev@kereru.test', handle: 'dev', role: 'member' },
  { name: 'Elin Park', email: 'elin@kereru.test', handle: 'elin', role: 'member' },
  { name: 'Femi Ade', email: 'femi@kereru.test', handle: 'femi', role: 'guest' },
];

const kereruIssues: SeedIssue[] = [
  { key: 'KIL-1', title: 'Kiln onboarding checklist', status: 'todo', assignee: 'ben', cycle: 1, parent: null, closedAt: null },
  { key: 'KIL-2', title: 'Kiln billing export', status: 'in_progress', assignee: 'chiara', cycle: 1, parent: null, closedAt: null },
  {
    key: 'KIL-3',
    title: 'Export CSV header row',
    status: 'done',
    assignee: 'chiara',
    cycle: 1,
    parent: 'KIL-2',
    closedAt: '2026-10-21T10:00:00+13:00',
  },
  { key: 'KIL-4', title: 'Export date format', status: 'todo', assignee: 'dev', cycle: 1, parent: 'KIL-2', closedAt: null },
  { key: 'KIL-5', title: 'Kiln review checklist', status: 'in_review', assignee: 'femi', cycle: 1, parent: null, closedAt: null },
  { key: 'KIL-6', title: 'Kiln empty states', status: 'backlog', assignee: null, cycle: null, parent: null, closedAt: null },
  { key: 'ATL-1', title: 'Atlas search index', status: 'todo', assignee: 'elin', cycle: 1, parent: null, closedAt: null },
  { key: 'ATL-2', title: 'Atlas rate limits', status: 'backlog', assignee: 'dev', cycle: null, parent: null, closedAt: null },
];

const halyardPeople: SeedPerson[] = [
  { name: 'Hal Booker', email: 'hal@halyard.test', handle: 'hal', role: 'owner' },
  { name: 'Iris Vane', email: 'iris@halyard.test', handle: 'iris', role: 'member' },
];

const halyardIssues: SeedIssue[] = [
  { key: 'RIG-1', title: 'Rig inventory sync', status: 'todo', assignee: 'iris', cycle: 1, parent: null, closedAt: null },
  { key: 'RIG-2', title: 'Rig label printer', status: 'backlog', assignee: null, cycle: null, parent: null, closedAt: null },
];

type RoomSeed = { name: string; kind: 'open' | 'private'; x: number; y: number; w: number; h: number };

const kereruRooms: RoomSeed[] = [
  { name: 'Lobby', kind: 'open', x: 1, y: 1, w: 9, h: 6 },
  { name: 'Studio', kind: 'open', x: 11, y: 1, w: 8, h: 6 },
  { name: 'Review Room', kind: 'private', x: 1, y: 8, w: 8, h: 6 },
  { name: 'Focus Booth', kind: 'private', x: 10, y: 8, w: 9, h: 6 },
];

const halyardRooms: RoomSeed[] = [
  { name: 'Lobby', kind: 'open', x: 1, y: 1, w: 9, h: 6 },
  { name: 'Huddle', kind: 'private', x: 11, y: 1, w: 8, h: 6 },
];

export async function seedDatabase(client: Queryable): Promise<void> {
  const createdAt = nowDate().toISOString();
  const passwordHash = await hashPassword(SEED_PASSWORD);

  const kereru = await seedWorkspace(client, {
    name: 'Kereru Labs',
    slug: 'kereru',
    seats: 8,
    timeZone: 'Pacific/Auckland',
    workingWeekdays: [1, 2, 3, 4, 5],
    holidays: [
      { date: '2026-12-25', name: 'Christmas Day' },
      { date: '2026-12-28', name: 'Boxing Day (observed)' },
    ],
    cycleAnchor: '2026-10-19',
    people: kereruPeople,
    projects: [
      { key: 'KIL', name: 'Kiln' },
      { key: 'ATL', name: 'Atlas' },
    ],
    issues: kereruIssues,
    channels: [
      { name: 'general', members: ['ana', 'ben', 'chiara', 'dev', 'elin'] },
      { name: 'kiln-review', members: ['ana', 'ben', 'femi'] },
      { name: 'random', members: ['ana', 'ben', 'chiara', 'dev', 'elin'] },
    ],
    guestProjects: [{ handle: 'femi', projectKey: 'KIL' }],
    docs: [
      { title: 'Kiln launch spec', projectKey: 'KIL', body: 'Launch scope for Kiln.' },
      { title: 'Atlas notes', projectKey: 'ATL', body: 'Notes on Atlas search.' },
    ],
    rooms: kereruRooms,
    createdAt,
    passwordHash,
  });

  await client.query(
    `insert into messages (id, workspace_id, channel_id, author_id, body, thread_root_id, mentions, client_key, created_at)
     values (nextval('message_ids'), $1, $2, $3, $4, null, '{}', null, $5)`,
    [kereru.workspaceId, kereru.channels.general, kereru.people.ana, 'Welcome to cycle 1.', createdAt],
  );
  await client.query(
    `insert into messages (id, workspace_id, channel_id, author_id, body, thread_root_id, mentions, client_key, created_at)
     values (nextval('message_ids'), $1, $2, $3, $4, null, '{}', null, $5)`,
    [kereru.workspaceId, kereru.channels.general, kereru.people.ben, 'Kiln export is in progress.', createdAt],
  );
  await client.query(
    `insert into messages (id, workspace_id, channel_id, author_id, body, thread_root_id, mentions, client_key, created_at)
     values (nextval('message_ids'), $1, $2, $3, $4, null, '{}', null, $5)`,
    [kereru.workspaceId, kereru.channels.general, kereru.people.chiara, 'Atlas notes are up.', createdAt],
  );
  const reviewRoot = await client.one<{ id: number }>(
    `insert into messages (id, workspace_id, channel_id, author_id, body, thread_root_id, mentions, client_key, created_at)
     values (nextval('message_ids'), $1, $2, $3, $4, null, '{}', null, $5) returning id`,
    [kereru.workspaceId, kereru.channels['kiln-review'], kereru.people.femi, 'Review checklist is ready.', createdAt],
  );
  if (reviewRoot === undefined) throw new Error('Seed message was not stored');
  await client.query(
    `insert into messages (id, workspace_id, channel_id, author_id, body, thread_root_id, mentions, client_key, created_at)
     values (nextval('message_ids'), $1, $2, $3, $4, $5, '{}', null, $6)`,
    [kereru.workspaceId, kereru.channels['kiln-review'], kereru.people.ben, 'Looking now.', reviewRoot.id, createdAt],
  );

  // Every seeded message starts read by everyone who can see it.
  await client.query(
    `insert into read_markers (person_id, channel_id, thread_root_id, up_to)
     select cm.person_id, cm.channel_id, 0, max(m.id)
       from channel_members cm
       join messages m on m.channel_id = cm.channel_id and m.thread_root_id is null
      where cm.channel_id in (select id from channels where workspace_id = $1)
      group by cm.person_id, cm.channel_id
     on conflict do nothing`,
    [kereru.workspaceId],
  );
  await client.query(
    `insert into read_markers (person_id, channel_id, thread_root_id, up_to)
     select cm.person_id, cm.channel_id, m.thread_root_id, max(m.id)
       from channel_members cm
       join messages m on m.channel_id = cm.channel_id and m.thread_root_id is not null
      where cm.channel_id in (select id from channels where workspace_id = $1)
      group by cm.person_id, cm.channel_id, m.thread_root_id
     on conflict do nothing`,
    [kereru.workspaceId],
  );

  await seedWorkspace(client, {
    name: 'Halyard Works',
    slug: 'halyard',
    seats: 5,
    timeZone: 'America/New_York',
    workingWeekdays: [1, 2, 3, 4, 5],
    holidays: [],
    cycleAnchor: '2026-10-26',
    people: halyardPeople,
    projects: [{ key: 'RIG', name: 'Rig' }],
    issues: halyardIssues,
    channels: [{ name: 'general', members: ['hal', 'iris'] }],
    guestProjects: [],
    docs: [],
    rooms: halyardRooms,
    createdAt,
    passwordHash,
  });
}

type WorkspaceSeed = {
  name: string;
  slug: string;
  seats: number;
  timeZone: string;
  workingWeekdays: number[];
  holidays: { date: string; name: string }[];
  cycleAnchor: string;
  people: SeedPerson[];
  projects: { key: string; name: string }[];
  issues: SeedIssue[];
  channels: { name: string; members: string[] }[];
  guestProjects: { handle: string; projectKey: string }[];
  docs: { title: string; projectKey: string; body: string }[];
  rooms: RoomSeed[];
  createdAt: string;
  passwordHash: string;
};

async function seedWorkspace(
  client: Queryable,
  seed: WorkspaceSeed,
): Promise<{
  workspaceId: string;
  people: Record<string, string>;
  channels: Record<string, string>;
}> {
  const workspaceId = randomUUID();
  await client.query(
    `insert into workspaces (id, name, slug, seats_limit, seats_confirmed_at, event_seq, created_at)
     values ($1, $2, $3, $4, null, 0, $5)`,
    [workspaceId, seed.name, seed.slug, seed.seats, seed.createdAt],
  );
  await client.query(
    `insert into calendars (workspace_id, effective_date, time_zone, working_weekdays, holidays, cycle_anchor, created_at)
     values ($1, '0001-01-01', $2, $3, $4::jsonb, $5, $6)`,
    [
      workspaceId,
      seed.timeZone,
      seed.workingWeekdays,
      JSON.stringify(seed.holidays),
      seed.cycleAnchor,
      seed.createdAt,
    ],
  );

  const people: Record<string, string> = {};
  for (const person of seed.people) {
    const id = randomUUID();
    people[person.handle] = id;
    await client.query(
      `insert into people (id, workspace_id, name, email, email_lower, handle, role, password_hash, created_at, last_seen_at, away)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, false)`,
      [
        id,
        workspaceId,
        person.name,
        person.email,
        person.email.toLowerCase(),
        person.handle,
        person.role,
        seed.passwordHash,
        seed.createdAt,
      ],
    );
  }

  const projects: Record<string, string> = {};
  for (const project of seed.projects) {
    const id = randomUUID();
    projects[project.key] = id;
    const count = seed.issues.filter((issue) => issue.key.startsWith(`${project.key}-`)).length;
    await client.query(
      `insert into projects (id, workspace_id, key, name, next_issue_number) values ($1, $2, $3, $4, $5)`,
      [id, workspaceId, project.key, project.name, count + 1],
    );
  }

  for (const grant of seed.guestProjects) {
    await client.query(`insert into project_guests (project_id, person_id) values ($1, $2)`, [
      projects[grant.projectKey],
      people[grant.handle],
    ]);
  }

  const issueIds: Record<string, string> = {};
  for (const issue of seed.issues) {
    issueIds[issue.key] = randomUUID();
  }
  for (const issue of seed.issues) {
    const [projectKey, numberText] = issue.key.split('-');
    if (projectKey === undefined || numberText === undefined) throw new Error('Bad seed issue key');
    await client.query(
      `insert into issues (id, workspace_id, project_id, number, key, title, description, status, assignee_id,
                           parent_id, cycle_number, due_date, closed_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, '', $7, $8, $9, $10, null, $11, $12, $12)`,
      [
        issueIds[issue.key],
        workspaceId,
        projects[projectKey],
        Number(numberText),
        issue.key,
        issue.title,
        issue.status,
        issue.assignee === null ? null : people[issue.assignee],
        issue.parent === null ? null : issueIds[issue.parent],
        issue.cycle,
        issue.closedAt,
        seed.createdAt,
      ],
    );
  }

  const channels: Record<string, string> = {};
  for (const channel of seed.channels) {
    const id = randomUUID();
    channels[channel.name] = id;
    await client.query(`insert into channels (id, workspace_id, name, created_at) values ($1, $2, $3, $4)`, [
      id,
      workspaceId,
      channel.name,
      seed.createdAt,
    ]);
    for (const handle of channel.members) {
      await client.query(
        `insert into channel_members (channel_id, person_id, joined_at) values ($1, $2, $3)`,
        [id, people[handle], seed.createdAt],
      );
    }
  }

  for (const doc of seed.docs) {
    const id = randomUUID();
    await client.query(
      `insert into docs (id, workspace_id, project_id, title, body, version, updated_by, updated_at, created_at)
       values ($1, $2, $3, $4, $5, 1, null, $6, $6)`,
      [id, workspaceId, projects[doc.projectKey], doc.title, doc.body, seed.createdAt],
    );
    await client.query(
      `insert into doc_versions (doc_id, version, title, body, saved_by, saved_at) values ($1, 1, $2, $3, null, $4)`,
      [id, doc.title, doc.body, seed.createdAt],
    );
  }

  let sort = 0;
  for (const room of seed.rooms) {
    await client.query(
      `insert into rooms (id, workspace_id, name, kind, x, y, w, h, sort) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [randomUUID(), workspaceId, room.name, room.kind, room.x, room.y, room.w, room.h, sort],
    );
    sort += 1;
  }

  return { workspaceId, people, channels };
}
