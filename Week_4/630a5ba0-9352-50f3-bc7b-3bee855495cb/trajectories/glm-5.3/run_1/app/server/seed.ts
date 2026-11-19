import type { PoolClient } from 'pg';
import { Database } from './db.js';
import { hashPassword, newFeedToken, newId } from './ids.js';
import { addDays, isoInstant, localDateOf, wallClockToInstant } from '../src-shared/domain.js';
import type { Config } from './config.js';
import { enqueueOutbox, type OutboxItem } from './outbox.js';

const SEED_PASSWORD = 'daybook-demo-2026';
const SEED_KEY = 'seed:v1';

export interface SeedResult {
  readonly ran: boolean;
}

/**
 * Creates the seed data only when the seeded workspace is missing.
 * All "today"/"tomorrow" dates are relative to each member's local date.
 */
export async function runSeed(db: Database, config: Config): Promise<SeedResult> {
  const existing = await db.query<{ id: string }>("SELECT id FROM workspaces WHERE id = 'ws_harbourlane'");
  if (existing.length > 0) return { ran: false };
  const now = new Date();
  const saltCreated = now;

  await db.withTransaction(async (client) => {
    // Harbour Lane Studio: created at seed time, trialing, no stored billing events.
    const harbourId = 'ws_harbourlane';
    const harbourTrialEnds = new Date(saltCreated.getTime() + config.timing.trialLengthSeconds * 1000);
    await client.query(
      `INSERT INTO workspaces (id, name, state, trial_ends_at, created_at) VALUES ($1, $2, 'trialing', $3, $4)`,
      [harbourId, 'Harbour Lane Studio', harbourTrialEnds, saltCreated],
    );

    const owner = (await insertMember(client, {
      id: 'mem_wren',
      workspaceId: harbourId,
      name: 'Wren Castell',
      email: 'wren@harbourlane.test',
      role: 'owner',
      timeZone: 'Europe/London',
      threshold: 360,
    }));
    const tama = (await insertMember(client, {
      id: 'mem_tama',
      workspaceId: harbourId,
      name: 'Tama Rewiti',
      email: 'tama@harbourlane.test',
      role: 'member',
      timeZone: 'Pacific/Auckland',
      threshold: 300,
    }));
    const leilani = (await insertMember(client, {
      id: 'mem_leilani',
      workspaceId: harbourId,
      name: 'Leilani Kahale',
      email: 'leilani@harbourlane.test',
      role: 'member',
      timeZone: 'Pacific/Honolulu',
      threshold: 420,
    }));

    // Wren's tasks, relative to her local dates.
    const wrenToday = localDateOf(now, 'Europe/London');
    const wrenTomorrow = addDays(wrenToday, 1);
    await insertTask(client, {
      id: 'task_wren_1', memberId: owner, title: 'Draft Q4 proposal', estimate: 45, day: null, position: 0,
      source: 'tracker', externalId: 'TRK-101',
    });
    await insertTask(client, {
      id: 'task_wren_2', memberId: owner, title: 'Review pull request queue', estimate: 30, day: null, position: 1,
      source: 'tracker', externalId: 'TRK-102',
    });
    await insertTask(client, { id: 'task_wren_3', memberId: owner, title: 'Invoice October', estimate: 15, day: null, position: 2 });
    await insertTask(client, { id: 'task_wren_4', memberId: owner, title: 'Sketch onboarding flow', estimate: null, day: null, position: 3 });
    await insertTask(client, { id: 'task_wren_5', memberId: owner, title: 'Client call prep', estimate: 60, day: wrenToday, position: 0 });

    await insertTask(client, { id: 'task_tama_1', memberId: tama, title: 'Prepare workshop slides', estimate: 90, day: null, position: 0 });
    await insertTask(client, { id: 'task_leilani_1', memberId: leilani, title: 'Audit design tokens', estimate: 60, day: null, position: 0 });

    // Wren's today meetings: 09:30–10:00 and 14:00–15:30 local.
    const standupStart = wallToInstant('Europe/London', wrenToday, '09:30');
    const standupEnd = new Date(standupStart.getTime() + 30 * 60_000);
    await insertMeeting(client, {
      id: newId('meet'), memberId: owner, uid: 'standup-harbourlane', summary: 'Studio stand-up',
      start: standupStart, end: standupEnd,
    });
    const reviewStart = wallToInstant('Europe/London', wrenToday, '14:00');
    const reviewEnd = new Date(reviewStart.getTime() + 90 * 60_000);
    await insertMeeting(client, {
      id: newId('meet'), memberId: owner, uid: 'client-review-harbourlane', summary: 'Client review',
      start: reviewStart, end: reviewEnd,
    });

    await insertTask(client, {
      id: 'task_wren_6', memberId: owner, title: 'Write case study', estimate: 300, day: wrenTomorrow, position: 0,
    });

    // Each seeded member has the daily routine "Inbox zero" at 08:30 for 30 minutes.
    for (const memberId of [owner, tama, leilani]) {
      await client.query(
        'INSERT INTO routines (id, member_id, name, start_time, duration_minutes, repeats) VALUES ($1, $2, $3, $4, $5, $6)',
        [newId('routine'), memberId, 'Inbox zero', '08:30', 30, 'daily'],
      );
    }

    // Saltmarsh Consulting: creation 30 days ago, active via a stored conversion 1s after creation.
    const saltmarshCreated = new Date(saltCreated.getTime() - 2_592_000 * 1000);
    const saltmarshTrialEnds = new Date(saltmarshCreated.getTime() + config.timing.trialLengthSeconds * 1000);
    await client.query(
      `INSERT INTO workspaces (id, name, state, trial_ends_at, created_at) VALUES ('ws_saltmarsh', 'Saltmarsh Consulting', 'active', $1, $2)`,
      [saltmarshTrialEnds, saltmarshCreated],
    );
    const ossian = (await insertMember(client, {
      id: 'mem_ossian',
      workspaceId: 'ws_saltmarsh',
      name: 'Ossian Pell',
      email: 'ossian@saltmarsh.test',
      role: 'owner',
      timeZone: 'America/New_York',
      threshold: 360,
    }));
    await insertTask(client, { id: 'task_ossian_1', memberId: ossian, title: 'Saltmarsh retainer report', estimate: 120, day: null, position: 0 });
    await insertTask(client, { id: 'task_ossian_2', memberId: ossian, title: 'Estuary survey notes', estimate: 30, day: null, position: 1 });
    await client.query(
      'INSERT INTO routines (id, member_id, name, start_time, duration_minutes, repeats) VALUES ($1, $2, $3, $4, $5, $6)',
      [newId('routine'), ossian, 'Inbox zero', '08:30', 30, 'daily'],
    );
    await client.query(
      `INSERT INTO billing_events (event_id, workspace_id, type, occurred_at) VALUES ('seed-saltmarsh-trial-converted', 'ws_saltmarsh', 'subscription.trial_converted', $1)`,
      [new Date(saltmarshCreated.getTime() + 1000)],
    );

    // The operator, in no workspace.
    await client.query(
      `INSERT INTO workspaces (id, name, state, trial_ends_at, created_at) VALUES ('ws_operator', 'Tidemark Operations', 'active', $1, $2)`,
      [new Date(saltCreated.getTime() + 2_592_000 * 1000), saltCreated],
    );
    (await insertMember(client, {
      id: 'mem_operator',
      workspaceId: 'ws_operator',
      name: 'Juno Ferreira',
      email: 'operator@tidemark.test',
      role: 'operator',
      timeZone: 'UTC',
      threshold: 360,
    }));

    // Register the seeded workspaces' accounts and seats in Kill Bill through the outbox,
    // so the effect is queued exactly once and completes when billing is reachable.
    await enqueueOutbox(client, [
      { kind: 'billing_account', workspaceId: harbourId, memberId: owner, workspaceName: 'Harbour Lane Studio', ownerEmail: 'wren@harbourlane.test' },
      { kind: 'billing_seat', workspaceId: harbourId, memberId: tama },
      { kind: 'billing_seat', workspaceId: harbourId, memberId: leilani },
      { kind: 'billing_account', workspaceId: 'ws_saltmarsh', memberId: ossian, workspaceName: 'Saltmarsh Consulting', ownerEmail: 'ossian@saltmarsh.test' },
    ]);

    await client.query('INSERT INTO seed_state (key, value) VALUES ($1, $2)', [SEED_KEY, isoInstant(now)]);
  });
  return { ran: true };
}

interface MemberSeed {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly email: string;
  readonly role: 'owner' | 'member' | 'operator';
  readonly timeZone: string;
  readonly threshold: number;
}

async function insertMember(client: PoolClient, seed: MemberSeed): Promise<string> {
  await client.query(
    `INSERT INTO members (id, workspace_id, name, email, password_hash, role, status, time_zone, threshold_minutes, feed_token, invite_token, invite_used)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, NULL, false)`,
    [
      seed.id, seed.workspaceId, seed.name, seed.email, hashPassword(SEED_PASSWORD), seed.role,
      seed.timeZone, seed.threshold, newFeedToken(),
    ],
  );
  return seed.id;
}

interface TaskSeed {
  readonly id: string;
  readonly memberId: string;
  readonly title: string;
  readonly estimate: number | null;
  readonly day: string | null;
  readonly position: number;
  readonly source?: string;
  readonly externalId?: string;
}

async function insertTask(client: PoolClient, seed: TaskSeed): Promise<void> {
  await client.query(
    `INSERT INTO tasks (id, member_id, title, estimate_minutes, day_date, position, status, source, external_id, version)
     VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, 1)`,
    [seed.id, seed.memberId, seed.title, seed.estimate, seed.day, seed.position, seed.source ?? null, seed.externalId ?? null],
  );
}

interface MeetingSeed {
  readonly id: string;
  readonly memberId: string;
  readonly uid: string;
  readonly summary: string;
  readonly start: Date;
  readonly end: Date;
}

async function insertMeeting(client: PoolClient, seed: MeetingSeed): Promise<void> {
  await client.query(
    `INSERT INTO meetings (id, member_id, uid, summary, start_at, end_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [seed.id, seed.memberId, seed.uid, seed.summary, seed.start, seed.end],
  );
}

function wallToInstant(timeZone: string, date: string, hhmm: string): Date {
  const instant = wallClockToInstant(date, hhmm, timeZone);
  if (instant === null) throw new Error('seed wall clock not representable');
  return instant;
}
