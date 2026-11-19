/**
 * Rotations, overrides, escalation policies and pages.
 */

import { randomUUID } from 'node:crypto';

import { iso, now, nowMs } from '../clock';
import { settings } from '../config';
import { query, transaction } from '../db';
import { ApiError, conflict, notFound, validation } from '../errors';
import { eventTexts } from '../domain/inbox';
import {
  ackDue,
  acknowledgeLine,
  lateAcknowledgeLine,
  onCallAt,
  shiftsBetween,
  type EscalationPolicy,
  type PageLevel,
  type PageStatus,
} from '../domain/oncall';
import { isValidZone, parseDisplayTime } from '../domain/zone';
import { requireCaller, requireOperator, requireRoles, type RequestContext } from '../http/context';
import { Engine, type Caller } from '../services/engine';
import { publish } from '../services/live';
import { deliver, operators, unreadCount } from '../services/notify';
import { insertActivity } from '../services/store';
import { created, ok, route } from './router';

async function engineFor(context: RequestContext): Promise<{ engine: Engine; caller: Caller }> {
  const caller = requireCaller(context);
  return { engine: await Engine.load(caller.workspace), caller };
}

const deskRoles = ['operator', 'technician'] as const;

route('GET', '/api/rotations', async (context) => {
  const { engine } = await engineFor(context);
  requireRoles(context, [...deskRoles]);
  return ok({
    rotations: [...engine.rotations.values()].map((r) => ({
      name: r.name,
      time_zone: r.timeZone,
      handover_weekday: r.handoverWeekday,
      handover_time: r.handoverTime,
      members: r.members,
      anchor_date: r.anchorDate,
    })),
  });
});

route('POST', '/api/rotations', async (context) => {
  requireOperator(context);
  const name = String(context.body.name ?? '').trim();
  const zone = String(context.body.time_zone ?? 'Europe/Berlin');
  const anchor = String(context.body.anchor_date ?? '');
  if (name === '') throw validation('Name is required.', { name: 'Name is required.' });
  if (!isValidZone(zone)) throw validation('Time zone is not a zone.', { time_zone: 'Time zone is not a zone.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) {
    throw validation('An anchor date looks like YYYY-MM-DD.', {
      anchor_date: 'An anchor date looks like YYYY-MM-DD.',
    });
  }
  await query(
    `INSERT INTO rotation (name, time_zone, handover_weekday, handover_time, members, anchor_date)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (name) DO UPDATE SET time_zone = $2, handover_weekday = $3, handover_time = $4,
       members = $5::jsonb, anchor_date = $6`,
    [
      name,
      zone,
      String(context.body.handover_weekday ?? 'monday'),
      String(context.body.handover_time ?? '09:00'),
      JSON.stringify(context.body.members ?? []),
      anchor,
    ],
  );
  return created({ rotation: { name, time_zone: zone, anchor_date: anchor } });
});

route('POST', '/api/rotations/:name/overrides', async (context, params) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const rotation = engine.rotations.get(params.name);
  if (!rotation) throw notFound();
  // An override's start and end are read in the chosen rotation's zone.
  const start = readTime(String(context.body.start ?? ''), rotation.timeZone);
  const end = readTime(String(context.body.end ?? ''), rotation.timeZone);
  const username = String(context.body.username ?? '');
  if (start === null || end === null || end <= start) {
    throw validation('An override needs a start before its end.', {
      start: 'An override needs a start before its end.',
    });
  }
  if (!engine.person(username)) throw validation('That person does not exist.', { username: 'That person does not exist.' });
  const row = await query<{ id: string }>(
    `INSERT INTO rotation_override (rotation, username, start_at, end_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [rotation.name, username, new Date(start), new Date(end)],
  );
  return created({
    override: {
      id: Number(row[0].id),
      rotation: rotation.name,
      username,
      start: iso(new Date(start)),
      end: iso(new Date(end)),
    },
  });
});

function readTime(text: string, zone: string): number | null {
  const direct = Date.parse(text);
  if (!Number.isNaN(direct)) return direct;
  return parseDisplayTime(zone, text);
}

route('GET', '/api/rotations/:name/oncall', async (context, params) => {
  const { engine } = await engineFor(context);
  requireRoles(context, [...deskRoles]);
  const rotation = engine.rotations.get(params.name);
  if (!rotation) throw notFound();
  const atText = context.url.searchParams.get('at');
  const at = atText ? Date.parse(atText) : engine.at;
  const shift = onCallAt(rotation, engine.overrides, Number.isNaN(at) ? engine.at : at);
  return ok({
    username: shift.username,
    display_name: engine.displayName(shift.username),
    shift_start: iso(new Date(shift.start)),
    shift_end: iso(new Date(shift.end)),
    override: shift.override,
  });
});

route('GET', '/api/rotations/:name/shifts', async (context, params) => {
  const { engine } = await engineFor(context);
  requireRoles(context, [...deskRoles]);
  const rotation = engine.rotations.get(params.name);
  if (!rotation) throw notFound();
  const fromText = context.url.searchParams.get('from');
  const toText = context.url.searchParams.get('to');
  const from = fromText ? Date.parse(fromText) : engine.at;
  const to = toText ? Date.parse(toText) : engine.at + 8 * 7 * 86_400_000;
  const shifts = shiftsBetween(rotation, engine.overrides, from, to);
  return ok({
    shifts: shifts.map((s) => ({
      username: s.username,
      display_name: engine.displayName(s.username),
      start: iso(new Date(s.start)),
      end: iso(new Date(s.end)),
      override: s.override,
    })),
  });
});

route('GET', '/api/escalation-policies', async (context) => {
  const { engine } = await engineFor(context);
  requireRoles(context, [...deskRoles]);
  return ok({
    escalation_policies: [...engine.escalationPolicies.values()].map((p) => ({
      name: p.name,
      levels: p.levels,
    })),
  });
});

route('POST', '/api/escalation-policies', async (context) => {
  requireOperator(context);
  const name = String(context.body.name ?? '').trim();
  if (name === '') throw validation('Name is required.', { name: 'Name is required.' });
  await query(
    `INSERT INTO escalation_policy (name, levels) VALUES ($1, $2::jsonb)
     ON CONFLICT (name) DO UPDATE SET levels = $2::jsonb`,
    [name, JSON.stringify(context.body.levels ?? [])],
  );
  return created({ escalation_policy: { name, levels: context.body.levels ?? [] } });
});

interface PageRow {
  id: string;
  number: string;
  policy: string;
  status: string;
  level: number;
  levels: PageLevel[];
  acknowledged_by: string | null;
  acknowledged_level: number | null;
  late: boolean;
}

function pageJson(engine: Engine, row: PageRow): Record<string, unknown> {
  return {
    id: row.id,
    record: row.number,
    policy: row.policy,
    status: row.status as PageStatus,
    level: row.level,
    levels: (row.levels ?? []).map((level) => ({
      level: level.level,
      username: level.username,
      display_name: engine.displayName(level.username),
      notified_at: iso(new Date(level.notifiedAt)),
      ack_due_at: iso(new Date(level.ackDueAt)),
    })),
    acknowledged_by: row.acknowledged_by,
    acknowledged_level: row.acknowledged_level,
    late: row.late,
  };
}

/** The person a level notifies: the rotation's on-call now, or the named user. */
export function targetOf(engine: Engine, policy: EscalationPolicy, level: number, at: number): string | null {
  const spec = policy.levels[level - 1];
  if (!spec) return null;
  if (spec.target.user) return spec.target.user;
  if (spec.target.rotation) {
    const rotation = engine.rotations.get(spec.target.rotation);
    if (!rotation) return null;
    return onCallAt(rotation, engine.overrides, at).username;
  }
  return null;
}

export async function startPage(
  engine: Engine,
  number: string,
  policyName: string,
): Promise<Record<string, unknown>> {
  const policy = engine.escalationPolicies.get(policyName);
  if (!policy) throw notFound();
  const existing = (
    await query<{ id: string }>(`SELECT id FROM page WHERE number = $1 AND status = 'paging'`, [number])
  )[0];
  if (existing) throw conflict('already_paging', 'This record is already paging.');

  const at = nowMs();
  const username = targetOf(engine, policy, 1, at);
  if (username === null) throw validation('That policy has no first level.', { policy: 'That policy has no first level.' });
  const id = randomUUID();
  const levels: PageLevel[] = [
    {
      level: 1,
      username,
      notifiedAt: at,
      ackDueAt: ackDue(policy.levels[0], at, settings().ONCALL_ACK_MINUTES),
    },
  ];
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO page (id, number, policy, status, level, levels, created_at)
       VALUES ($1, $2, $3, 'paging', 1, $4::jsonb, $5)`,
      [id, number, policyName, JSON.stringify(levels), new Date(at)],
    );
    const delivered = await deliver(
      client,
      engine.inboxRules,
      engine.people,
      'page',
      [username],
      eventTexts.page(number),
      number,
    );
    for (const who of delivered) {
      publish({ topic: 'inbox', event: 'unread', data: { username: who, unread: await unreadCount(client, who) } });
    }
  });
  publish({ topic: 'pages', event: 'paging', data: { id, record: number, level: 1, username } });
  const row = (await query<PageRow>(`SELECT * FROM page WHERE id = $1`, [id]))[0];
  return pageJson(engine, row);
}

route('POST', '/api/records/:number/page', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  requireRoles(context, [...deskRoles]);
  const record = engine.requireVisible(caller, params.number);
  const page = await startPage(engine, record.number, String(context.body.policy ?? ''));
  return created({ page });
});

route('GET', '/api/pages', async (context) => {
  const { engine } = await engineFor(context);
  requireRoles(context, [...deskRoles]);
  const rows = await query<PageRow>(`SELECT * FROM page ORDER BY created_at DESC, id DESC`);
  return ok({ pages: rows.map((row) => pageJson(engine, row)) });
});

route('POST', '/api/pages/:id/acknowledge', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  const row = (await query<PageRow>(`SELECT * FROM page WHERE id = $1`, [params.id]))[0];
  if (!row) throw notFound();

  const levels = row.levels ?? [];
  const notified = levels.find((level) => level.username === caller.username);
  const isOperator = caller.roles.includes('operator');
  if (!notified && !isOperator) {
    throw new ApiError(403, 'not_paged', 'You were not paged for this.');
  }
  if (row.status === 'acknowledged') {
    throw conflict('already_acknowledged', `Already acknowledged by ${engine.displayName(row.acknowledged_by)}.`);
  }

  const level = notified?.level ?? row.level;
  // A late acknowledge is one from an earlier level, or one after exhaustion.
  const late = row.status === 'exhausted' || level < row.level;
  const line = late
    ? lateAcknowledgeLine(caller.displayName, level, row.level)
    : acknowledgeLine(caller.displayName, level);

  await transaction(async (client) => {
    await client.query(
      `UPDATE page SET status = 'acknowledged', acknowledged_by = $2, acknowledged_level = $3, late = $4
       WHERE id = $1`,
      [params.id, caller.username, level, late],
    );
    await insertActivity(client, row.number, now(), 'page', line, caller.actor);
  });
  publish({
    topic: 'pages',
    event: 'acknowledged',
    data: { id: params.id, record: row.number, by: caller.username, late, text: line },
  });
  publish({ topic: `record:${row.number}`, event: 'page', data: { text: line, late } });
  const after = (await query<PageRow>(`SELECT * FROM page WHERE id = $1`, [params.id]))[0];
  return ok({ page: pageJson(engine, after) });
});

export { operators, pageJson, type PageRow };
