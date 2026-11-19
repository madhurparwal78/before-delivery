// Links, predecessors, holidays, the baseline, assignments, comments, workload and exports.

import * as q from '../store/queries.ts';
import type { RequestCtx } from './plumbing.ts';
import { sendJson } from './plumbing.ts';
import { ApiError, invalidField, notFound, readOnly } from './errors.ts';
import { requireSession, asRecord, type RouteDeps } from './routes.ts';
import { readProject, movedItems } from '../services/projects.ts';
import { WorkingCalendar, isIsoDate, weekday } from '../domain/calendar.ts';
import { findCycle, type LinkType } from '../domain/schedule.ts';

const LINK_TYPES: LinkType[] = ['FS', 'SS', 'FF', 'SF'];

export async function createLink(deps: RouteDeps, ctx: RequestCtx, projectId: string): Promise<void> {
  const userId = requireSession(ctx);
  const { project, role } = await deps.requireProject(ctx, projectId);
  if (role === 'viewer') throw readOnly();
  const record = asRecord(ctx.body);
  const from = typeof record.from === 'string' ? record.from : null;
  const to = typeof record.to === 'string' ? record.to : null;
  const type = typeof record.type === 'string' ? record.type : null;
  const lag = record.lag;
  if (from === null || to === null) throw invalidField('from');
  if (type === null || !LINK_TYPES.includes(type as LinkType)) throw invalidField('type');
  if (typeof lag !== 'number' || !Number.isInteger(lag) || lag < -30 || lag > 30) throw invalidField('lag');

  const before = await readProject(deps.pool, project.id, deps.today());
  if (before === null) throw notFound();
  const items = before.project.items;
  const fromItem = items.find((item) => item.id === from);
  const toItem = items.find((item) => item.id === to);
  if (fromItem === undefined || toItem === undefined) throw invalidField(fromItem === undefined ? 'from' : 'to');
  if (from === to) throw new ApiError(422, 'self_link');
  if (fromItem.kind === 'group' || toItem.kind === 'group') throw new ApiError(422, 'group_link');
  if (before.project.links.some((link) => link.from === from && link.to === to)) {
    throw new ApiError(409, 'duplicate_link');
  }

  const rows = new Map(items.map((item) => [item.id, item.row]));
  const edges = [...before.project.links.map((link) => ({ from: link.from, to: link.to })), { from, to }];
  const cycle = findCycle(edges, (id) => rows.get(id) ?? 0, from);
  if (cycle !== null) {
    const names = cycle.map((id) => items.find((item) => item.id === id)?.name ?? '');
    throw new ApiError(422, 'loop', {
      path: cycle,
      message: `That link would make the project wait on itself: ${names.join(' -> ')}.`,
    });
  }

  const link = await q.insertLink(deps.pool, { projectId: project.id, fromId: from, toId: to, type: type as LinkType, lag });
  const after = await readProject(deps.pool, project.id, deps.today());
  const moved = before !== null && after !== null ? movedItems(before.project, after.project, from) : [];
  await deps.afterEdit(project.id, userId, 'link', from);
  sendJson(ctx.res, 201, {
    link: { id: link.id, from: link.fromId, to: link.toId, type: link.type, lag: link.lag },
    moved,
    finish: after?.project.finish ?? null,
  });
}

export async function deleteLink(deps: RouteDeps, ctx: RequestCtx, linkId: string): Promise<void> {
  const userId = requireSession(ctx);
  const link = await q.linkById(deps.pool, linkId);
  if (link === null) throw notFound();
  const { project, role } = await deps.requireProject(ctx, link.projectId);
  if (role === 'viewer') throw readOnly();
  const before = await readProject(deps.pool, project.id, deps.today());
  await q.deleteLinkRow(deps.pool, linkId);
  const after = await readProject(deps.pool, project.id, deps.today());
  const moved = before !== null && after !== null ? movedItems(before.project, after.project, link.fromId) : [];
  await deps.afterEdit(project.id, userId, 'link', link.fromId);
  sendJson(ctx.res, 200, { moved, finish: after?.project.finish ?? null });
}

/** Parse the Predecessors cell text into link entries, or return the first failure. */
export function parsePredecessors(
  text: string,
  items: { id: string; row: number; name: string; kind: 'task' | 'milestone' | 'group' }[],
): { entries: { fromId: string; type: LinkType; lag: number }[]; error?: undefined } | { entries?: undefined; error: string } {
  const byRow = new Map(items.map((item) => [item.row, item]));
  const entries: { fromId: string; type: LinkType; lag: number }[] = [];
  const raw = text.trim();
  if (raw === '') return { entries };
  for (const part of raw.split(',')) {
    const token = part.replace(/\s+/g, '');
    const match = /^(\d+)(FS|SS|FF|SF)?([+-]\d+)?$/i.exec(token);
    if (match === null) return { error: 'Write predecessors like 2FS+1, 3SS-2.' };
    const row = Number.parseInt(match[1], 10);
    const item = byRow.get(row);
    if (item === undefined) return { error: `There is no row ${row}.` };
    const type = (match[2] ?? 'FS').toUpperCase() as LinkType;
    const lag = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);
    entries.push({ fromId: item.id, type, lag });
  }
  return { entries };
}

export async function putPredecessors(deps: RouteDeps, ctx: RequestCtx, itemId: string): Promise<void> {
  const userId = requireSession(ctx);
  const item = await q.itemById(deps.pool, itemId);
  if (item === null) throw notFound();
  const { project, role } = await deps.requireProject(ctx, item.projectId);
  if (role === 'viewer') throw readOnly();
  const record = asRecord(ctx.body);
  if (typeof record.baseVersion !== 'number' || !Number.isInteger(record.baseVersion)) throw invalidField('baseVersion');
  const text = typeof record.text === 'string' ? record.text : '';

  const before = await readProject(deps.pool, project.id, deps.today());
  if (before === null) throw notFound();
  const beforeItem = before.project.items.find((entry) => entry.id === itemId);
  if (beforeItem === undefined) throw notFound();
  if (beforeItem.version !== record.baseVersion) {
    const by = await q.personById(deps.pool, item.versionBy);
    throw new ApiError(409, 'version_conflict', { item: beforeItem, by: by?.name ?? '' });
  }

  const items = before.project.items;
  const parsed = parsePredecessors(text, items.map((entry) => ({ id: entry.id, row: entry.row, name: entry.name, kind: entry.kind })));
  if ('error' in parsed) throw new ApiError(422, 'invalid_predecessors', { message: parsed.error });

  // Self, group, lag-range and repeated-row checks, entry by entry, left to right.
  const rows = new Map(items.map((entry) => [entry.row, entry]));
  const seen = new Set<string>();
  const seenRowNumbers = new Set<number>();
  for (const part of text.trim() === '' ? [] : text.split(',')) {
    const token = part.replace(/\s+/g, '');
    const match = /^(\d+)(FS|SS|FF|SF)?([+-]\d+)?$/i.exec(token);
    if (match === null) throw new ApiError(422, 'invalid_predecessors', { message: 'Write predecessors like 2FS+1, 3SS-2.' });
    const rowNumber = Number.parseInt(match[1], 10);
    const target = rows.get(rowNumber);
    if (target === undefined) throw new ApiError(422, 'invalid_predecessors', { message: `There is no row ${rowNumber}.` });
    if (target.id === itemId) throw new ApiError(422, 'invalid_predecessors', { message: 'A task cannot wait for itself.' });
    if (target.kind === 'group') throw new ApiError(422, 'invalid_predecessors', { message: 'Groups cannot be linked.' });
    const lag = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);
    if (lag < -30 || lag > 30) throw new ApiError(422, 'invalid_predecessors', { message: 'Lag must be between -30 and 30 working days.' });
    if (seen.has(target.id)) throw new ApiError(422, 'invalid_predecessors', { message: `Row ${rowNumber} is listed twice.` });
    seen.add(target.id);
    seenRowNumbers.add(rowNumber);
  }

  const edges = [
    ...before.project.links.filter((link) => link.to !== itemId).map((link) => ({ from: link.from, to: link.to })),
    ...parsed.entries.map((entry) => ({ from: entry.fromId, to: itemId })),
  ];
  const cycle = findCycle(edges, (id) => items.find((entry) => entry.id === id)?.row ?? 0, parsed.entries[0]?.fromId ?? itemId);
  if (cycle !== null) {
    const names = cycle.map((id) => items.find((entry) => entry.id === id)?.name ?? '');
    throw new ApiError(422, 'invalid_predecessors', { message: `That link would make the project wait on itself: ${names.join(' -> ')}.` });
  }

  await deps.pool.query('delete from links where to_id = $1', [itemId]);
  for (const entry of parsed.entries) {
    await q.insertLink(deps.pool, { projectId: project.id, fromId: entry.fromId, toId: itemId, type: entry.type, lag: entry.lag });
  }
  await deps.pool.query('update items set version = version + 1, version_by = $2 where id = $1', [itemId, userId]);
  const after = await readProject(deps.pool, project.id, deps.today());
  const moved = movedItems(before.project, after?.project ?? before.project, null);
  await deps.afterEdit(project.id, userId, 'predecessors', itemId);
  sendJson(ctx.res, 200, {
    item: after?.project.items.find((entry) => entry.id === itemId),
    moved,
    finish: after?.project.finish ?? null,
  });
}

export async function addHoliday(deps: RouteDeps, ctx: RequestCtx, projectId: string): Promise<void> {
  const userId = requireSession(ctx);
  const { project, role } = await deps.requireProject(ctx, projectId);
  if (role === 'viewer') throw readOnly();
  const record = asRecord(ctx.body);
  const date = typeof record.date === 'string' ? record.date : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!isIsoDate(date)) throw invalidField('date');
  if (name.length < 1 || name.length > 60) throw invalidField('name');
  const cal = new WorkingCalendar([date]);
  if (cal.isWorking(date) && weekday(date) >= 1 && weekday(date) <= 5) {
    if (weekday(date) >= 1 && weekday(date) <= 5) {
      // A weekday that is a holiday is a working day turned off, not a weekend.
    }
  }
  if (weekday(date) === 6 || weekday(date) === 7) throw new ApiError(422, 'weekend');
  const existing = await q.projectHolidays(deps.pool, projectId);
  if (existing.some((h) => h.date === date)) throw new ApiError(409, 'duplicate_holiday');
  const before = await readProject(deps.pool, project.id, deps.today());
  await q.insertHoliday(deps.pool, projectId, date, name);
  const after = await readProject(deps.pool, project.id, deps.today());
  const moved = before !== null && after !== null ? movedItems(before.project, after.project, null) : [];
  await deps.afterEdit(project.id, userId, 'holiday');
  sendJson(ctx.res, 201, { holiday: { date, name }, moved, finish: after?.project.finish ?? null });
}

export async function removeHoliday(deps: RouteDeps, ctx: RequestCtx, projectId: string, date: string): Promise<void> {
  const userId = requireSession(ctx);
  const { project, role } = await deps.requireProject(ctx, projectId);
  if (role === 'viewer') throw readOnly();
  const existing = await q.projectHolidays(deps.pool, projectId);
  if (!existing.some((h) => h.date === date)) throw notFound();
  const before = await readProject(deps.pool, project.id, deps.today());
  await q.deleteHoliday(deps.pool, projectId, date);
  const after = await readProject(deps.pool, project.id, deps.today());
  const moved = before !== null && after !== null ? movedItems(before.project, after.project, null) : [];
  await deps.afterEdit(project.id, userId, 'holiday');
  sendJson(ctx.res, 200, { moved, finish: after?.project.finish ?? null });
}

export async function saveBaseline(deps: RouteDeps, ctx: RequestCtx, projectId: string): Promise<void> {
  const userId = requireSession(ctx);
  const { project, role } = await deps.requireProject(ctx, projectId);
  if (role === 'viewer') throw readOnly();
  const record = asRecord(ctx.body);
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (name.length < 1 || name.length > 60) throw invalidField('name');
  const existing = await q.baselineOf(deps.pool, projectId);
  if (existing !== null && record.replace !== true) {
    throw new ApiError(409, 'baseline_exists', { name: existing.name });
  }
  const snapshot = await readProject(deps.pool, project.id, deps.today());
  if (snapshot === null || snapshot.project.finish === null) throw notFound();
  const items = snapshot.project.items
    .filter((item) => item.kind !== 'group' && item.start !== null && item.end !== null)
    .map((item) => ({ itemId: item.id, start: item.start!, end: item.end! }));
  await q.saveBaseline(deps.pool, projectId, name, snapshot.project.finish, items);
  await deps.afterEdit(project.id, userId, 'baseline');
  const baseline = await q.baselineOf(deps.pool, projectId);
  const after = await readProject(deps.pool, project.id, deps.today());
  const finishVariance = after?.project.baseline?.finishVariance ?? 0;
  sendJson(ctx.res, 201, { baseline: { name, finish: baseline?.finish ?? snapshot.project.finish, finishVariance } });
}

export async function addAssignee(deps: RouteDeps, ctx: RequestCtx, itemId: string): Promise<void> {
  const userId = requireSession(ctx);
  const item = await q.itemById(deps.pool, itemId);
  if (item === null) throw notFound();
  const { project, role } = await deps.requireProject(ctx, item.projectId);
  if (role === 'viewer') throw readOnly();
  if (item.kind !== 'task') throw new ApiError(422, 'not_a_task');
  const record = asRecord(ctx.body);
  const targetId = typeof record.userId === 'string' ? record.userId : null;
  if (targetId === null) throw invalidField('userId');
  const hours = record.hours;
  if (typeof hours !== 'number' || hours < 0.5 || hours > 24 || hours * 2 !== Math.round(hours * 2)) throw invalidField('hours');
  const members = await q.workspaceMembers(deps.pool, project.workspaceId);
  const member = members.find((entry) => entry.userId === targetId);
  if (member === undefined || member.role === 'viewer') throw invalidField('userId');
  const assignments = await q.itemAssignments(deps.pool, [itemId]);
  if (assignments.some((entry) => entry.userId === targetId)) throw new ApiError(409, 'already_assigned');
  await q.insertAssignment(deps.pool, itemId, targetId, hours);
  await deps.pool.query('update items set version = version + 1, version_by = $2 where id = $1', [itemId, userId]);
  if (targetId !== userId) {
    await deps.notices?.queue({ assignerId: userId, assigneeId: targetId, itemId, projectId: project.id, hours });
  }
  const after = await readProject(deps.pool, project.id, deps.today());
  await deps.afterEdit(project.id, userId, 'assignment', itemId);
  sendJson(ctx.res, 201, { item: after?.project.items.find((entry) => entry.id === itemId) });
}

export async function removeAssignee(deps: RouteDeps, ctx: RequestCtx, itemId: string, targetId: string): Promise<void> {
  const userId = requireSession(ctx);
  const item = await q.itemById(deps.pool, itemId);
  if (item === null) throw notFound();
  const { project, role } = await deps.requireProject(ctx, item.projectId);
  if (role === 'viewer') throw readOnly();
  const assignments = await q.itemAssignments(deps.pool, [itemId]);
  if (!assignments.some((entry) => entry.userId === targetId)) throw notFound();
  await q.deleteAssignment(deps.pool, itemId, targetId);
  await deps.pool.query('update items set version = version + 1, version_by = $2 where id = $1', [itemId, userId]);
  await deps.notices?.cancel(itemId, targetId);
  const after = await readProject(deps.pool, project.id, deps.today());
  await deps.afterEdit(project.id, userId, 'assignment', itemId);
  sendJson(ctx.res, 200, { item: after?.project.items.find((entry) => entry.id === itemId) });
}

export async function listComments(deps: RouteDeps, ctx: RequestCtx, itemId: string): Promise<void> {
  requireSession(ctx);
  const item = await q.itemById(deps.pool, itemId);
  if (item === null) throw notFound();
  await deps.requireProject(ctx, item.projectId);
  const comments = await q.itemComments(deps.pool, itemId);
  sendJson(ctx.res, 200, {
    comments: comments.map((comment) => ({
      id: comment.id,
      author: { userId: comment.authorId, name: comment.authorName },
      text: comment.text,
      createdAt: comment.createdAt.toISOString(),
    })),
  });
}

export async function postComment(deps: RouteDeps, ctx: RequestCtx, itemId: string): Promise<void> {
  const userId = requireSession(ctx);
  const item = await q.itemById(deps.pool, itemId);
  if (item === null) throw notFound();
  const { project, role } = await deps.requireProject(ctx, item.projectId);
  if (role === 'viewer') throw readOnly();
  const record = asRecord(ctx.body);
  const text = typeof record.text === 'string' ? record.text.trim() : '';
  if (text.length < 1 || text.length > 1000) throw invalidField('text');
  const comment = await q.insertComment(deps.pool, itemId, userId, text);
  const author = await q.personById(deps.pool, userId);
  await deps.afterComment(project.id, userId, itemId, { id: comment.id, authorId: userId, text, createdAt: comment.createdAt });
  sendJson(ctx.res, 201, {
    comment: {
      id: comment.id,
      author: { userId, name: author?.name ?? '' },
      text,
      createdAt: comment.createdAt.toISOString(),
    },
  });
}

export async function workload(deps: RouteDeps, ctx: RequestCtx, workspaceId: string): Promise<void> {
  requireSession(ctx);
  await deps.requireWorkspace(ctx, workspaceId);
  const from = ctx.query.get('from') ?? '';
  if (!isIsoDate(from) || weekday(from) !== 1) throw invalidField('from');
  const assignments = await q.workspaceAssignments(deps.pool, workspaceId);
  const people = await q.workspacePeople(deps.pool, workspaceId, ['owner', 'editor']);
  const projects = await deps.pool.query('select id from projects where workspace_id = $1', [workspaceId]);
  const projectIds: string[] = projects.rows.map((row: { id: string }) => row.id);
  const calendars = new Map<string, WorkingCalendar>();
  const itemById = new Map<string, { projectId: string; start: string | null; end: string | null; name: string; row: number }>();
  for (const projectId of projectIds) {
    const snapshot = await readProject(deps.pool, projectId, deps.today());
    if (snapshot === null) continue;
    calendars.set(projectId, snapshot.calendar);
    for (const item of snapshot.project.items) {
      itemById.set(item.id, { projectId, start: item.start, end: item.end, name: item.name, row: item.row });
    }
  }
  const dayDates: string[] = [];
  let cursor = from;
  for (let i = 0; i < 10; i += 1) {
    dayDates.push(cursor);
    cursor = nextWeekday(cursor);
  }
  const projectNames = new Map<string, string>();
  for (const projectId of projectIds) {
    const row = await q.projectById(deps.pool, projectId);
    projectNames.set(projectId, row?.name ?? '');
  }
  const peopleOut = people.map((person) => {
    const days = dayDates.map((date) => {
      const entries: { project: string; item: string; hours: number }[] = [];
      let hours = 0;
      for (const assignment of assignments) {
        if (assignment.userId !== person.id) continue;
        const item = itemById.get(assignment.itemId);
        if (item === undefined || item.start === null || item.end === null) continue;
        if (date < item.start || date > item.end) continue;
        const calendar = calendars.get(item.projectId);
        if (calendar === undefined || !calendar.isWorking(date)) continue;
        hours += assignment.hours;
        entries.push({ project: projectNames.get(item.projectId) ?? '', item: item.name, hours: assignment.hours });
      }
      return { date, hours, over: hours > person.capacity, assignments: entries };
    });
    return {
      userId: person.id,
      name: person.name,
      capacity: person.capacity,
      overDays: days.filter((day) => day.over).length,
      days,
    };
  });
  sendJson(ctx.res, 200, { from, days: dayDates, people: peopleOut });
}

/** The next weekday, skipping Saturday and Sunday. */
function nextWeekday(date: string): string {
  let epoch = Date.parse(`${date}T00:00:00Z`) + 86_400_000;
  let next = new Date(epoch).toISOString().slice(0, 10);
  while (weekday(next) === 6 || weekday(next) === 7) {
    epoch += 86_400_000;
    next = new Date(epoch).toISOString().slice(0, 10);
  }
  return next;
}
