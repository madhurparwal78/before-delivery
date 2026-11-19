// On-call endpoints: rotations, overrides, shifts, escalation policies, pages.

import { RouteContext } from '../api.js';
import { SessionUser } from '../auth.js';
import { sendJson } from '../apibase.js';
import { ApiError, notFound, forbidden, operatorOnly } from '../errors.js';
import { clock, randomBytes } from '../db.js';
import { civilToEpoch, partsOf, fmtStamp } from '../../shared/time.js';

const WEEKDAY_NUM: Record<string, number> = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };

export async function oncall(route: RouteContext, user: SessionUser, pathIn?: string): Promise<boolean> {
  const { method } = route;
  const path = pathIn ?? route.path;

  if (path === '/api/rotations' && method === 'GET') return rotationsList(route, user);
  if (path === '/api/rotations' && method === 'POST') return rotationCreate(route, user);
  const oncallMatch = /^\/api\/rotations\/([^/]+)\/oncall$/.exec(path);
  if (oncallMatch && method === 'GET') return rotationOnCall(route, user, oncallMatch[1]);
  const shiftsMatch = /^\/api\/rotations\/([^/]+)\/shifts$/.exec(path);
  if (shiftsMatch && method === 'GET') return rotationShifts(route, user, shiftsMatch[1]);
  const overrideMatch = /^\/api\/rotations\/([^/]+)\/overrides$/.exec(path);
  if (overrideMatch && method === 'POST') return overrideCreate(route, user, overrideMatch[1]);

  if (path === '/api/escalation-policies' && method === 'GET') return policiesList(route, user);
  if (path === '/api/escalation-policies' && method === 'POST') return policyCreate(route, user);

  const pageMatch = /^\/api\/records\/([A-Za-z]+-\d+)\/page$/.exec(path);
  if (pageMatch && method === 'POST') return pageCreate(route, user, pageMatch[1]);

  if (path === '/api/pages' && method === 'GET') return pagesList(route, user);
  const ackMatch = /^\/api\/pages\/([^/]+)\/acknowledge$/.exec(path);
  if (ackMatch && method === 'POST') return pageAcknowledge(route, user, ackMatch[1]);

  return false;
}

function isDesk(user: SessionUser): boolean {
  return user.roles.includes('operator') || user.roles.includes('technician');
}

interface RotationRow {
  name: string; time_zone: string; handover_weekday: string; handover_time: string;
  members: string[]; anchor_date: string;
}

async function loadRotation(db: RouteContext['ctx']['db'], name: string): Promise<RotationRow | null> {
  const res = await db.query(`SELECT name, time_zone, handover_weekday, handover_time, members, anchor_date FROM rotations WHERE name = $1`, [name]);
  if (!res.rows.length) return null;
  const r = res.rows[0];
  return {
    name: String(r.name), time_zone: String(r.time_zone),
    handover_weekday: String(r.handover_weekday), handover_time: String(r.handover_time),
    members: r.members as string[], anchor_date: String(r.anchor_date),
  };
}

/** Shift boundaries: weekly, at the handover wall time in the rotation's zone.
 *  The anchor date's shift is member 0; each later shift goes to the next
 *  member. Handover keeps the wall time across daylight saving changes. */
async function shiftStarts(rotation: RotationRow, at: number): Promise<number[]> {
  const [h, m] = rotation.handover_time.split(':').map(Number);
  const tz = rotation.time_zone;
  const target = WEEKDAY_NUM[rotation.handover_weekday] ?? 0;

  // The anchor shift start: the handover weekday at or before the anchor date.
  const [ay, am, ad] = rotation.anchor_date.split('-').map(Number);
  const anchorDayStart = civilToEpoch(ay, am, ad, 0, 0, 0, tz);
  const anchorWeekday = partsOf(anchorDayStart, tz).weekday;
  const anchorShift = civilToEpoch(ay, am, ad - anchorWeekday + target, h, m, 0, tz);

  // Shifts are anchorShift + k weeks by wall time; find those around `at`.
  const week = 7 * 86_400_000;
  const k0 = Math.floor((at - anchorShift) / week) - 2;
  const out: number[] = [];
  for (let i = 0; i < 6; i++) {
    const p = partsOf(new Date(anchorShift + (k0 + i) * week).getTime(), tz);
    out.push(civilToEpoch(p.y, p.mo, p.d, h, m, 0, tz));
  }
  return out.sort((a, b) => a - b);
}

/** Who is on call at an instant: overrides first, then the weekly rotation. */
async function onCallAt(route: RouteContext, rotation: RotationRow, at: number): Promise<{ username: string; shift_start: number; shift_end: number; override: boolean }> {
  const overrides = await route.ctx.db.query(
    `SELECT username, start, "end" FROM rotation_overrides WHERE rotation = $1 ORDER BY id DESC`,
    [rotation.name],
  );
  for (const o of overrides.rows) {
    const start = new Date(o.start as Date).getTime();
    const end = new Date(o.end as Date).getTime();
    if (at >= start && at < end) {
      return { username: String(o.username), shift_start: start, shift_end: end, override: true };
    }
  }

  const starts = await shiftStarts(rotation, at);
  const week = 7 * 86_400_000;

  // Which shift index is this, counting from the anchor shift?
  const [ay, am, ad] = rotation.anchor_date.split('-').map(Number);
  const anchorDayStart = civilToEpoch(ay, am, ad, 0, 0, 0, rotation.time_zone);
  const anchorWeekday = partsOf(anchorDayStart, rotation.time_zone).weekday;
  const target = WEEKDAY_NUM[rotation.handover_weekday] ?? 0;
  const [h, m] = rotation.handover_time.split(':').map(Number);
  const anchorShift = civilToEpoch(ay, am, ad - anchorWeekday + target, h, m, 0, rotation.time_zone);

  let index = 0;
  for (let i = 0; i < starts.length - 1; i++) {
    if (at >= starts[i] && at < starts[i + 1]) { index = i; break; }
  }
  const k = Math.round((starts[index] - anchorShift) / week);
  const memberIndex = ((k % rotation.members.length) + rotation.members.length) % rotation.members.length;
  return {
    username: rotation.members[memberIndex] ?? '',
    shift_start: starts[index],
    shift_end: starts[index + 1],
    override: false,
  };
}

async function rotationsList(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!isDesk(user)) throw forbidden();
  const res = await route.ctx.db.query(`SELECT name, time_zone, handover_weekday, handover_time, members, anchor_date FROM rotations ORDER BY name`);
  sendJson(route.res, 200, { rotations: res.rows });
  return true;
}

async function rotationCreate(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  await route.ctx.db.query(
    `INSERT INTO rotations(name, time_zone, handover_weekday, handover_time, members, anchor_date) VALUES ($1,$2,$3,$4,$5,$6)`,
    [body.name, body.time_zone, body.handover_weekday ?? 'monday', body.handover_time ?? '09:00', body.members ?? [], body.anchor_date],
  );
  sendJson(route.res, 201, { rotation: body });
  return true;
}

async function rotationOnCall(route: RouteContext, user: SessionUser, name: string): Promise<boolean> {
  if (!isDesk(user)) throw forbidden();
  const rotation = await loadRotation(route.ctx.db, name);
  if (!rotation) throw notFound();
  const atParam = route.url.searchParams.get('at');
  const at = atParam ? Date.parse(atParam) : clock.nowMs();
  const result = await onCallAt(route, rotation, at);
  sendJson(route.res, 200, {
    username: result.username,
    shift_start: new Date(result.shift_start).toISOString(),
    shift_end: new Date(result.shift_end).toISOString(),
    override: result.override,
  });
  return true;
}

async function rotationShifts(route: RouteContext, user: SessionUser, name: string): Promise<boolean> {
  if (!isDesk(user)) throw forbidden();
  const rotation = await loadRotation(route.ctx.db, name);
  if (!rotation) throw notFound();
  const from = route.url.searchParams.get('from') ? Date.parse(route.url.searchParams.get('from')!) : clock.nowMs();
  const to = route.url.searchParams.get('to') ? Date.parse(route.url.searchParams.get('to')!) : from + 56 * 86_400_000;

  const starts = await shiftStarts(rotation, from);
  const week = 7 * 86_400_000;
  const [ay, am, ad] = rotation.anchor_date.split('-').map(Number);
  const anchorDayStart = civilToEpoch(ay, am, ad, 0, 0, 0, rotation.time_zone);
  const anchorWeekday = partsOf(anchorDayStart, rotation.time_zone).weekday;
  const target = WEEKDAY_NUM[rotation.handover_weekday] ?? 0;
  const [h, m] = rotation.handover_time.split(':').map(Number);
  const base = civilToEpoch(ay, am, ad - anchorWeekday + target, h, m, 0, rotation.time_zone);
  const shifts: unknown[] = [];
  for (let i = 0; i < starts.length - 1; i++) {
    if (starts[i] < from || starts[i] >= to) continue;
    const k = Math.round((starts[i] - base) / week);
    const memberIndex = ((k % rotation.members.length) + rotation.members.length) % rotation.members.length;
    const override = await route.ctx.db.query(
      `SELECT username, start, "end" FROM rotation_overrides WHERE rotation = $1 ORDER BY id DESC`,
      [name],
    );
    let assigned: { username: string; start: number; end: number; override: boolean } | null = null;
    for (const o of override.rows) {
      const os = new Date(o.start as Date).getTime();
      const oe = new Date(o.end as Date).getTime();
      const mid = Math.max(starts[i], os);
      if (os < starts[i + 1] && oe > starts[i] && os >= starts[i] && os < starts[i + 1]) {
        assigned = { username: String(o.username), start: os, end: oe, override: true };
        break;
      }
    }
    shifts.push({
      username: assigned ? assigned.username : rotation.members[memberIndex] ?? '',
      start: new Date(starts[i]).toISOString(),
      end: new Date(starts[i + 1]).toISOString(),
      override: assigned ? true : false,
    });
  }
  void week;
  sendJson(route.res, 200, { shifts });
  return true;
}

async function overrideCreate(route: RouteContext, user: SessionUser, name: string): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  const res = await route.ctx.db.query(
    `INSERT INTO rotation_overrides(rotation, username, start, "end") VALUES ($1,$2,$3,$4) RETURNING id`,
    [name, body.username, new Date(String(body.start)), new Date(String(body.end))],
  );
  sendJson(route.res, 201, { override: { id: Number(res.rows[0].id), rotation: name, username: body.username, start: body.start, end: body.end } });
  return true;
}

async function policiesList(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!isDesk(user)) throw forbidden();
  const res = await route.ctx.db.query(`SELECT name, levels FROM escalation_policies ORDER BY name`);
  sendJson(route.res, 200, { escalation_policies: res.rows });
  return true;
}

async function policyCreate(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  await route.ctx.db.query(`INSERT INTO escalation_policies(name, levels) VALUES ($1,$2)`, [body.name, JSON.stringify(body.levels ?? [])]);
  sendJson(route.res, 201, { escalation_policy: body });
  return true;
}

/** A page starts at level 1; each level notifies its target. */
async function pageCreate(route: RouteContext, user: SessionUser, number: string): Promise<boolean> {
  if (!isDesk(user)) throw forbidden();
  const existing = await route.ctx.db.query(`SELECT id FROM pages WHERE record = $1 AND status IN ('paging','acknowledged')`, [number]);
  if (existing.rows.length) throw new ApiError(409, 'already_paging', 'This record is already being paged.');

  const policyName = String(route.body.policy ?? '');
  const policy = await route.ctx.db.query(`SELECT levels FROM escalation_policies WHERE name = $1`, [policyName]);
  if (!policy.rows.length) throw notFound();

  const ackMinutes = Number(route.ctx.settings.get('ONCALL_ACK_MINUTES') ?? 15);
  const now = clock.nowMs();
  const id = randomBytes(8);

  const levels: Array<{ level: number; username: string; notified_at: string; ack_due_at: string | null }> = [];
  const rawLevels = policy.rows[0].levels as Array<{ target: { rotation?: string; user?: string }; ack_minutes: number | null }>;
  for (let i = 0; i < rawLevels.length; i++) {
    const level = rawLevels[i];
    let username = '';
    if (level.target.user) {
      username = level.target.user;
    } else if (level.target.rotation) {
      const rotation = await loadRotation(route.ctx.db, level.target.rotation);
      if (rotation) {
        const onCall = await onCallAt(route, rotation, now);
        username = onCall.username;
      }
    }
    const minutes = level.ack_minutes ?? ackMinutes;
    levels.push({
      level: i + 1,
      username,
      notified_at: new Date(now).toISOString(),
      ack_due_at: minutes ? new Date(now + minutes * 60_000).toISOString() : null,
    });
  }

  await route.ctx.db.query(
    `INSERT INTO pages(id, record, policy, status, level, levels, created_at) VALUES ($1,$2,$3,'paging',1,$4,$5)`,
    [id, number, policyName, JSON.stringify(levels), new Date(now)],
  );

  // The level's target gets an inbox item.
  if (levels.length && levels[0].username) {
    const { deliver, loadRules } = await import('./inboxdata.js');
    const rules = await loadRules(route.ctx.db);
    await deliver(route.ctx.db, rules, 'page', levels[0].username, `Page for ${number}: please acknowledge.`, number);
    route.ctx.live.publish('inbox', 'updated', {});
  }

  const view = await pageView(route, id);
  sendJson(route.res, 201, { page: view });
  return true;
}

async function pagesList(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!isDesk(user)) throw forbidden();
  const res = await route.ctx.db.query(`SELECT id FROM pages ORDER BY created_at DESC`);
  const pages: unknown[] = [];
  for (const row of res.rows) {
    pages.push(await pageView(route, String(row.id)));
  }
  sendJson(route.res, 200, { pages });
  return true;
}

async function pageView(route: RouteContext, id: string): Promise<unknown> {
  const res = await route.ctx.db.query(`SELECT * FROM pages WHERE id = $1`, [id]);
  if (!res.rows.length) throw notFound();
  const row = res.rows[0];
  return {
    id: row.id,
    record: row.record,
    policy: row.policy,
    status: row.status,
    level: Number(row.level),
    levels: row.levels,
    acknowledged_by: row.acknowledged_by,
    acknowledged_level: row.acknowledged_level === null ? null : Number(row.acknowledged_level),
    late: Boolean(row.late),
  };
}

async function pageAcknowledge(route: RouteContext, user: SessionUser, id: string): Promise<boolean> {
  const res = await route.ctx.db.query(`SELECT * FROM pages WHERE id = $1`, [id]);
  if (!res.rows.length) throw notFound();
  const row = res.rows[0];
  const levels = row.levels as Array<{ level: number; username: string }>;

  // Any person notified at any level so far, or the operator, may acknowledge.
  const notified = new Set(levels.filter(l => l.level <= Number(row.level)).map(l => l.username).filter(Boolean));
  if (!notified.has(user.username) && !user.roles.includes('operator')) {
    throw new ApiError(403, 'not_paged', 'You were not paged for this.');
  }
  if (row.status === 'acknowledged') {
    const person = await route.ctx.db.query(`SELECT display_name FROM people WHERE username = $1`, [row.acknowledged_by]);
    throw new ApiError(409, 'already_acknowledged', `Already acknowledged by ${String(person.rows[0]?.display_name ?? 'someone')}.`);
  }

  const person = await route.ctx.db.query(`SELECT display_name FROM people WHERE username = $1`, [user.username]);
  const displayName = String(person.rows[0]?.display_name ?? user.username);
  const ackLevel = levels.findIndex(l => l.username === user.username) + 1;
  const currentLevel = Number(row.level);
  const late = row.status === 'exhausted' || (ackLevel > 0 && ackLevel < currentLevel);

  await route.ctx.db.query(
    `UPDATE pages SET status = 'acknowledged', acknowledged_by = $2, acknowledged_level = $3, late = $4, acknowledged_at = $5 WHERE id = $1`,
    [id, user.username, ackLevel > 0 ? ackLevel : null, late, new Date(clock.nowMs())],
  );

  const text = late
    ? `Late acknowledge from ${displayName} at level ${ackLevel || currentLevel}; paging had reached level ${currentLevel}.`
    : `Acknowledged by ${displayName} at level ${ackLevel || currentLevel}.`;
  await route.ctx.db.query(
    `INSERT INTO activity(record, at, actor, acting_for, kind, text) VALUES ($1,$2,$3,NULL,'acknowledge',$4)`,
    [row.record, new Date(clock.nowMs()), user.username, text],
  );
  route.ctx.live.publish(`record:${row.record}`, 'activity', { text });
  route.ctx.live.publish('inbox', 'updated', {});

  sendJson(route.res, 200, { page: await pageView(route, id) });
  return true;
}
