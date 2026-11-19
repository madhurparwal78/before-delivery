import type { PoolClient } from 'pg';
import { pool, withTransaction } from './pool.js';
import type { MemberRow, WorkspaceRow } from './records.js';
import { config } from '../config.js';
import { hashPassword, newId, randomToken } from '../services/auth.js';
import { enqueue } from '../services/outbox.js';
import { addDays, instantAtLocalTime, todayInZone } from '../../shared/time.js';
import type { RoutineRepeats } from '../../shared/types.js';

const SEED_PASSWORD = 'daybook-demo-2026';

interface SeedTask {
  title: string;
  estimateMinutes: number | null;
  day: 'backlog' | 'today' | 'tomorrow';
  source?: string;
  externalId?: string;
}

interface SeedMeeting {
  uid: string;
  summary: string;
  startTime: string;
  endTime: string;
}

interface SeedMember {
  name: string;
  email: string;
  role: 'owner' | 'member';
  timeZone: string;
  thresholdMinutes: number;
  tasks: SeedTask[];
  meetings?: SeedMeeting[];
}

interface SeedWorkspace {
  seedKey: string;
  name: string;
  createdOffsetSeconds: number;
  members: SeedMember[];
  billingEvents: { eventId: string; type: string; offsetSeconds: number }[];
}

const WORKSPACES: SeedWorkspace[] = [
  {
    seedKey: 'harbour-lane',
    name: 'Harbour Lane Studio',
    createdOffsetSeconds: 0,
    billingEvents: [],
    members: [
      {
        name: 'Wren Castell',
        email: 'wren@harbourlane.test',
        role: 'owner',
        timeZone: 'Europe/London',
        thresholdMinutes: 360,
        tasks: [
          { title: 'Draft Q4 proposal', estimateMinutes: 45, day: 'backlog', source: 'tracker', externalId: 'TRK-101' },
          { title: 'Review pull request queue', estimateMinutes: 30, day: 'backlog', source: 'tracker', externalId: 'TRK-102' },
          { title: 'Invoice October', estimateMinutes: 15, day: 'backlog' },
          { title: 'Sketch onboarding flow', estimateMinutes: null, day: 'backlog' },
          { title: 'Client call prep', estimateMinutes: 60, day: 'today' },
          { title: 'Write case study', estimateMinutes: 300, day: 'tomorrow' },
        ],
        meetings: [
          { uid: 'seed-standup@harbourlane.test', summary: 'Studio stand-up', startTime: '09:30', endTime: '10:00' },
          { uid: 'seed-client-review@harbourlane.test', summary: 'Client review', startTime: '14:00', endTime: '15:30' },
        ],
      },
      {
        name: 'Tama Rewiti',
        email: 'tama@harbourlane.test',
        role: 'member',
        timeZone: 'Pacific/Auckland',
        thresholdMinutes: 300,
        tasks: [{ title: 'Prepare workshop slides', estimateMinutes: 90, day: 'backlog' }],
      },
      {
        name: 'Leilani Kahale',
        email: 'leilani@harbourlane.test',
        role: 'member',
        timeZone: 'Pacific/Honolulu',
        thresholdMinutes: 420,
        tasks: [{ title: 'Audit design tokens', estimateMinutes: 60, day: 'backlog' }],
      },
    ],
  },
  {
    seedKey: 'saltmarsh',
    name: 'Saltmarsh Consulting',
    createdOffsetSeconds: -2_592_000,
    billingEvents: [
      {
        eventId: 'seed-saltmarsh-trial-converted',
        type: 'subscription.trial_converted',
        offsetSeconds: -2_592_000 + 1,
      },
    ],
    members: [
      {
        name: 'Ossian Pell',
        email: 'ossian@saltmarsh.test',
        role: 'owner',
        timeZone: 'America/New_York',
        thresholdMinutes: 360,
        tasks: [
          { title: 'Saltmarsh retainer report', estimateMinutes: 120, day: 'backlog' },
          { title: 'Estuary survey notes', estimateMinutes: 30, day: 'backlog' },
        ],
      },
    ],
  },
];

const ROUTINE: { name: string; startTime: string; durationMinutes: number; repeats: RoutineRepeats } = {
  name: 'Inbox zero',
  startTime: '08:30',
  durationMinutes: 30,
  repeats: 'daily',
};

async function seedWorkspace(tx: PoolClient, spec: SeedWorkspace, passwordHash: string): Promise<void> {
  const existing = await tx.query('select 1 from workspaces where seed_key = $1', [spec.seedKey]);
  if ((existing.rowCount ?? 0) > 0) return;

  const workspaceId = newId();
  const createdAtSql = `now() + ($2 || ' seconds')::interval`;
  const workspace = await tx.query<WorkspaceRow>(
    `insert into workspaces (id, name, created_at, trial_ends_at, seed_key)
     values ($1, $3, ${createdAtSql}, ${createdAtSql} + ($4 || ' seconds')::interval, $5)
     returning *`,
    [
      workspaceId,
      String(spec.createdOffsetSeconds),
      spec.name,
      String(config.trialLengthSeconds),
      spec.seedKey,
    ],
  );

  for (const event of spec.billingEvents) {
    await tx.query(
      `insert into billing_events (event_id, workspace_id, type, occurred_at, seats, received_at)
       values ($1, $2, $3, now() + ($4 || ' seconds')::interval, null, now())
       on conflict (event_id) do nothing`,
      [event.eventId, workspaceId, event.type, String(event.offsetSeconds)],
    );
  }

  for (const spec_member of spec.members) {
    const memberId = newId();
    const member = await tx.query<MemberRow>(
      `insert into members (id, workspace_id, name, email, email_lower, password_hash, role, time_zone,
                            threshold_minutes, status, feed_token, created_at, updated_at)
       values ($1, $2, $3, $4, lower($4), $5, $6, $7, $8, 'active', $9, clock_timestamp(), clock_timestamp())
       returning *`,
      [
        memberId,
        workspaceId,
        spec_member.name,
        spec_member.email,
        passwordHash,
        spec_member.role,
        spec_member.timeZone,
        spec_member.thresholdMinutes,
        randomToken(),
      ],
    );
    const today = todayInZone(member.rows[0]!.time_zone);
    const tomorrow = addDays(today, 1);

    await tx.query(
      `insert into routines (id, member_id, name, start_time, duration_minutes, repeats, created_at)
       values ($1, $2, $3, $4, $5, $6, now())`,
      [newId(), memberId, ROUTINE.name, ROUTINE.startTime, ROUTINE.durationMinutes, ROUTINE.repeats],
    );

    const positions = new Map<string, number>();
    for (const task of spec_member.tasks) {
      const dayDate = task.day === 'backlog' ? null : task.day === 'today' ? today : tomorrow;
      const columnKey = dayDate ?? 'backlog';
      const position = positions.get(columnKey) ?? 0;
      positions.set(columnKey, position + 1);
      await tx.query(
        `insert into tasks (id, member_id, workspace_id, title, estimate_minutes, day_date, position,
                            status, source, external_id, due_date, version, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9, null, 1, now(), now())`,
        [
          newId(),
          memberId,
          workspaceId,
          task.title,
          task.estimateMinutes,
          dayDate,
          position,
          task.source ?? null,
          task.externalId ?? null,
        ],
      );
    }

    for (const meeting of spec_member.meetings ?? []) {
      await tx.query(
        `insert into meetings (id, member_id, uid, summary, start_instant, end_instant, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, now(), now())
         on conflict (member_id, uid) do nothing`,
        [
          newId(),
          memberId,
          meeting.uid,
          meeting.summary,
          instantAtLocalTime(today, meeting.startTime, spec_member.timeZone),
          instantAtLocalTime(today, meeting.endTime, spec_member.timeZone),
        ],
      );
    }

    await enqueue(
      tx,
      'killbill_register_workspace',
      { workspaceId, memberId },
      `seat:${workspaceId}:${memberId}`,
    );
  }

  void workspace;
}

async function seedOperator(tx: PoolClient, passwordHash: string): Promise<void> {
  await tx.query(
    `insert into members (id, workspace_id, name, email, email_lower, password_hash, role, time_zone,
                          threshold_minutes, status, feed_token, created_at, updated_at)
     select $1, null, 'Juno Ferreira', 'operator@tidemark.test', 'operator@tidemark.test', $2,
            'operator', 'UTC', 360, 'active', null, now(), now()
      where not exists (
        select 1 from members where email_lower = 'operator@tidemark.test' and status <> 'removed'
      )`,
    [newId(), passwordHash],
  );
}

/** The seed is written only when a seeded workspace is missing, so it is safe on every boot. */
export async function applySeed(): Promise<void> {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  await withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(841125)');
    await seedOperator(tx, passwordHash);
    for (const spec of WORKSPACES) {
      await seedWorkspace(tx, spec, passwordHash);
    }
  });
  await pool.query('select 1');
}
