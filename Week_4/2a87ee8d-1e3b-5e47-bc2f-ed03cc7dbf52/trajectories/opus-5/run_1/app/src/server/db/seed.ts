import type { PoolClient } from 'pg';
import { pool, withTransaction } from './pool.js';
import { withSeedLock } from './schema.js';
import { hashPassword, newId, newLinkToken, newSessionToken, randomToken } from '../ids.js';
import { parseWallClock, resolveWallClock } from '../domain/schedule.js';
import { templateFrames, type TemplateCode } from '../domain/templates.js';
import type { BillingTerm, PlanCode } from '../domain/plans.js';
import type { WorkshopStatus } from '../domain/states.js';

interface SeedFacilitator {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly timeZone: string;
  readonly plan: PlanCode;
  readonly term: BillingTerm;
}

const FACILITATORS: readonly SeedFacilitator[] = [
  {
    id: 'fac_juno',
    name: 'Juno Marlowe',
    email: 'juno@lanternfold.test',
    password: 'fold-the-lantern-26',
    timeZone: 'Europe/Lisbon',
    plan: 'studio',
    term: 'monthly',
  },
  {
    id: 'fac_odile',
    name: 'Odile Brack',
    email: 'odile@lanternfold.test',
    password: 'brack-the-room-27',
    timeZone: 'America/Toronto',
    plan: 'free',
    term: 'monthly',
  },
];

interface SeedNote {
  readonly text: string;
  readonly author: string;
  readonly frame: string;
  readonly cluster?: string;
  readonly facilitatorOnly?: boolean;
  readonly x: number;
  readonly y: number;
}

interface SeedWorkshop {
  readonly id: string;
  readonly facilitatorId: string;
  readonly title: string;
  readonly template: TemplateCode;
  readonly status: WorkshopStatus;
  readonly scheduledStart: string;
  readonly scheduledEnd: string;
  readonly sponsorEmail: string;
  readonly fee: string;
  readonly roundNumber: number;
  readonly participants: readonly string[];
  readonly clusters: ReadonlyArray<{ frame: string; title: string; x: number; y: number }>;
  readonly notes: readonly SeedNote[];
  readonly connectors: ReadonlyArray<readonly [string, string]>;
}

const WORKSHOPS: readonly SeedWorkshop[] = [
  {
    id: 'wk_harbourline',
    facilitatorId: 'fac_juno',
    title: 'Harbourline Studio — discovery sprint',
    template: 'discovery',
    status: 'draft',
    scheduledStart: '2027-03-04T14:00',
    scheduledEnd: '2027-03-04T17:00',
    sponsorEmail: 'sponsor@harbourline.test',
    fee: '0.00',
    roundNumber: 0,
    participants: [],
    clusters: [],
    notes: [],
    connectors: [],
  },
  {
    id: 'wk_fernmoor',
    facilitatorId: 'fac_juno',
    title: 'Fernmoor Clinic — Q3 retrospective',
    template: 'retrospective',
    status: 'revealed',
    scheduledStart: '2027-02-11T09:00',
    scheduledEnd: '2027-02-11T11:00',
    sponsorEmail: 'lead@fernmoor.test',
    fee: '1250.10',
    roundNumber: 1,
    participants: ['Priya N.', 'Tomás R.', 'Ade K.'],
    clusters: [
      { frame: 'To improve', title: 'Handoffs', x: 940, y: 90 },
      { frame: 'To improve', title: 'Tooling', x: 1240, y: 90 },
    ],
    notes: [
      { text: 'Weekly demo kept the clinic leads close', author: 'Priya N.', frame: 'Went well', x: 60, y: 110 },
      { text: 'Release notes are finally readable', author: 'Ade K.', frame: 'Went well', x: 320, y: 230 },
      {
        text: 'Intake forms change hands three times',
        author: 'Tomás R.',
        frame: 'To improve',
        cluster: 'Handoffs',
        x: 950,
        y: 140,
      },
      {
        text: 'Nobody owns the Friday triage',
        author: 'Priya N.',
        frame: 'To improve',
        cluster: 'Handoffs',
        x: 950,
        y: 250,
      },
      {
        text: 'Night shift hears about changes last',
        author: 'Ade K.',
        frame: 'To improve',
        cluster: 'Handoffs',
        x: 950,
        y: 360,
      },
      {
        text: 'Two scheduling tools disagree',
        author: 'Tomás R.',
        frame: 'To improve',
        cluster: 'Tooling',
        x: 1250,
        y: 140,
      },
      {
        text: 'Search in the records app times out',
        author: 'Priya N.',
        frame: 'To improve',
        cluster: 'Tooling',
        x: 1250,
        y: 250,
      },
      { text: 'Too many status meetings', author: 'Ade K.', frame: 'To improve', x: 1550, y: 430 },
      {
        text: 'Sponsor bristles at any mention of the scheduling vendor',
        author: 'Juno Marlowe',
        frame: 'To improve',
        facilitatorOnly: true,
        x: 1000,
        y: 480,
      },
      {
        text: 'Pilot a single triage owner for April',
        author: 'Juno Marlowe',
        frame: 'Actions',
        x: 1860,
        y: 150,
      },
    ],
    connectors: [['Nobody owns the Friday triage', 'Pilot a single triage owner for April']],
  },
  {
    id: 'wk_kestrel',
    facilitatorId: 'fac_odile',
    title: 'Kestrel Foods — strategy offsite',
    template: 'strategy',
    status: 'draft',
    scheduledStart: '2027-04-08T10:00',
    scheduledEnd: '2027-04-08T16:00',
    sponsorEmail: 'ops@kestrelfoods.test',
    fee: '0.00',
    roundNumber: 0,
    participants: [],
    clusters: [],
    notes: [],
    connectors: [],
  },
];

function instantOf(wallClock: string, timeZone: string): Date {
  const wall = parseWallClock(wallClock);
  if (!wall) throw new Error(`Seed wall-clock time ${wallClock} is malformed`);
  const resolved = resolveWallClock(wall, timeZone);
  if (resolved.kind !== 'ok') throw new Error(`Seed wall-clock time ${wallClock} does not exist in ${timeZone}`);
  return new Date(resolved.instantMs);
}

async function seedFacilitator(client: PoolClient, facilitator: SeedFacilitator): Promise<void> {
  await client.query(
    `INSERT INTO facilitators (id, email, name, password_hash, time_zone, seed_plan, seed_term)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO NOTHING`,
    [
      facilitator.id,
      facilitator.email,
      facilitator.name,
      hashPassword(facilitator.password),
      facilitator.timeZone,
      facilitator.plan,
      facilitator.term,
    ],
  );
  // Before the first successful refresh, the mirror holds the seed plan.
  await client.query(
    `INSERT INTO billing_mirror (facilitator_id, plan, term)
     VALUES ($1, $2, $3)
     ON CONFLICT (facilitator_id) DO NOTHING`,
    [facilitator.id, facilitator.plan, facilitator.term],
  );
}

async function seedWorkshop(client: PoolClient, workshop: SeedWorkshop): Promise<void> {
  const facilitator = FACILITATORS.find((candidate) => candidate.id === workshop.facilitatorId);
  if (!facilitator) throw new Error(`Seed workshop ${workshop.id} names an unknown facilitator`);
  const existing = await client.query('SELECT 1 FROM workshops WHERE id = $1', [workshop.id]);
  if (existing.rowCount !== 0) return;

  const startAt = instantOf(workshop.scheduledStart, facilitator.timeZone);
  const endAt = instantOf(workshop.scheduledEnd, facilitator.timeZone);
  await client.query(
    `INSERT INTO workshops (id, facilitator_id, title, template, status, scheduled_start, scheduled_end,
       start_at, end_at, sponsor_email, fee, version, round_number, rounds_used)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,$12)`,
    [
      workshop.id,
      workshop.facilitatorId,
      workshop.title,
      workshop.template,
      workshop.status,
      workshop.scheduledStart,
      workshop.scheduledEnd,
      startAt,
      endAt,
      workshop.sponsorEmail,
      workshop.fee,
      workshop.roundNumber,
    ],
  );

  const joinLinkId = newId('jl');
  await client.query('INSERT INTO join_links (id, workshop_id, token) VALUES ($1, $2, $3)', [
    joinLinkId,
    workshop.id,
    newLinkToken(),
  ]);

  const frameIds = new Map<string, string>();
  for (const frame of templateFrames(workshop.template)) {
    const frameId = newId('fr');
    frameIds.set(frame.title, frameId);
    await client.query(
      `INSERT INTO frames (id, workshop_id, title, x, y, width, height, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [frameId, workshop.id, frame.title, frame.x, frame.y, frame.width, frame.height, frame.position],
    );
  }

  const participantIds = new Map<string, string>();
  for (const [index, displayName] of workshop.participants.entries()) {
    const participantId = newId('pt');
    participantIds.set(displayName, participantId);
    await client.query(
      `INSERT INTO participants (id, workshop_id, join_link_id, display_name, cursor_id, hue)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [participantId, workshop.id, joinLinkId, displayName, randomToken(16), (index * 97) % 360],
    );
    await client.query(
      `INSERT INTO sessions (token, kind, participant_id, workshop_id) VALUES ($1,'participant',$2,$3)`,
      [newSessionToken(), participantId, workshop.id],
    );
  }

  const clusterIds = new Map<string, string>();
  for (const cluster of workshop.clusters) {
    const frameId = frameIds.get(cluster.frame);
    if (!frameId) throw new Error(`Seed cluster ${cluster.title} names an unknown frame`);
    const clusterId = newId('cl');
    clusterIds.set(cluster.title, clusterId);
    await client.query(
      `INSERT INTO clusters (id, workshop_id, frame_id, title, x, y) VALUES ($1,$2,$3,$4,$5,$6)`,
      [clusterId, workshop.id, frameId, cluster.title, cluster.x, cluster.y],
    );
  }

  const noteIds = new Map<string, string>();
  const clusterNextIndex = new Map<string, number>();
  for (const note of workshop.notes) {
    const frameId = frameIds.get(note.frame);
    if (!frameId) throw new Error(`Seed note names an unknown frame ${note.frame}`);
    const clusterId = note.cluster ? (clusterIds.get(note.cluster) ?? null) : null;
    const clusterIndex =
      clusterId === null ? null : (clusterNextIndex.get(clusterId) ?? 0);
    if (clusterId !== null) clusterNextIndex.set(clusterId, (clusterIndex ?? 0) + 1);
    const isFacilitatorAuthor = note.author === facilitator.name;
    const noteId = newId('nt');
    noteIds.set(note.text, noteId);
    await client.query(
      `INSERT INTO notes (id, workshop_id, frame_id, cluster_id, cluster_index, kind, text, x, y,
         revealed, facilitator_only, author_kind, author_participant_id, author_name, round_number)
       VALUES ($1,$2,$3,$4,$5,'text',$6,$7,$8,true,$9,$10,$11,$12,$13)`,
      [
        noteId,
        workshop.id,
        frameId,
        clusterId,
        clusterIndex,
        note.text,
        note.x,
        note.y,
        note.facilitatorOnly ?? false,
        isFacilitatorAuthor ? 'facilitator' : 'participant',
        isFacilitatorAuthor ? null : (participantIds.get(note.author) ?? null),
        note.author,
        workshop.roundNumber,
      ],
    );
  }

  for (const [fromText, toText] of workshop.connectors) {
    const fromNoteId = noteIds.get(fromText);
    const toNoteId = noteIds.get(toText);
    if (!fromNoteId || !toNoteId) throw new Error('Seed connector names an unknown note');
    await client.query(
      `INSERT INTO connectors (id, workshop_id, from_note_id, to_note_id) VALUES ($1,$2,$3,$4)`,
      [newId('cn'), workshop.id, fromNoteId, toNoteId],
    );
  }
}

export async function applySeed(): Promise<void> {
  await withSeedLock(async () => {
    await withTransaction(async (client) => {
      for (const facilitator of FACILITATORS) await seedFacilitator(client, facilitator);
      for (const workshop of WORKSHOPS) await seedWorkshop(client, workshop);
    });
  });
}
