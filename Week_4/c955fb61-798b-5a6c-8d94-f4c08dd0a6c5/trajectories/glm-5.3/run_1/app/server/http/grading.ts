// The grading setup route: builds the people, workspace, projects, items, links and baseline it is given.

import type { Pool } from '../store/db.ts';
import * as q from '../store/queries.ts';
import type { Config } from '../config.ts';
import type { RequestCtx } from './plumbing.ts';
import { sendJson } from './plumbing.ts';
import { ApiError, notFound } from './errors.ts';
import { hashPassword } from '../services/auth.ts';
import { readProject } from '../services/projects.ts';
import { WorkingCalendar, isIsoDate } from '../domain/calendar.ts';
import type { LinkType } from '../domain/schedule.ts';

type Json = Record<string, unknown>;

function field(body: unknown, path: string): unknown {
  let current: unknown = body;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') throw invalidJson(path);
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function invalidJson(path: string): ApiError {
  return new ApiError(422, 'invalid_field', { field: path });
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw invalidJson(path);
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw invalidJson(path);
  return value;
}

export async function gradingSetup(pool: Pool, config: Config, ctx: RequestCtx): Promise<void> {
  const key = ctx.raw.headers['x-grading-key'];
  if (config.gradingKey === null || key !== config.gradingKey) throw notFound();
  const body = ctx.body as Json;

  const users = asArray(body.users, 'users');
  const workspace = field(body, 'workspace') as Json;
  const workspaceName = asString(workspace.name, 'workspace.name');
  const members = asArray(workspace.members, 'workspace.members');
  const projects = asArray(body.projects, 'projects');

  const emailToPerson = new Map<string, q.PersonRow>();
  const createdUsers: { email: string; id: string }[] = [];
  for (const entry of users) {
    const record = entry as Json;
    const email = asString(record.email, 'users.email').trim().toLowerCase();
    const name = asString(record.name, 'users.name');
    const password = asString(record.password, 'users.password');
    const capacity = record.capacity === undefined ? 8 : Number(record.capacity);
    const existing = await q.personByEmail(pool, email);
    if (existing === null) {
      const person = await q.insertPerson(pool, { name, email, passwordHash: hashPassword(password), capacity });
      emailToPerson.set(email, person);
      createdUsers.push({ email, id: person.id });
    } else {
      await q.updatePerson(pool, existing.id, { name, passwordHash: hashPassword(password), capacity });
      const updated = await q.personByEmail(pool, email);
      if (updated !== null) emailToPerson.set(email, updated);
      createdUsers.push({ email, id: existing.id });
    }
  }

  const workspaceRow = await q.insertWorkspace(pool, workspaceName);
  const roleByEmail = new Map<string, q.Role>();
  for (const entry of members) {
    const record = entry as Json;
    const email = asString(record.email, 'workspace.members.email').trim().toLowerCase();
    const role = asString(record.role, 'workspace.members.role') as q.Role;
    const person = emailToPerson.get(email);
    if (person === undefined) throw invalidJson('workspace.members.email');
    await q.insertMember(pool, workspaceRow.id, person.id, role);
    roleByEmail.set(email, role);
  }
  const firstOwner = [...roleByEmail.entries()].find(([, role]) => role === 'owner')?.[0];
  const firstOwnerId = firstOwner === undefined ? '' : emailToPerson.get(firstOwner)!.id;

  const projectResults: { name: string; id: string; items: Record<string, string> }[] = [];
  for (const entry of projects) {
    const record = entry as Json;
    const name = asString(record.name, 'projects.name');
    const project = await q.insertProject(pool, workspaceRow.id, name);
    const itemIds: Record<string, string> = {};

    const holidays = asArray(record.holidays ?? [], 'projects.holidays');
    for (const holiday of holidays) {
      const h = holiday as Json;
      const date = asString(h.date, 'projects.holidays.date');
      const holidayName = asString(h.name, 'projects.holidays.name');
      if (!isIsoDate(date)) throw invalidJson('projects.holidays.date');
      await q.insertHoliday(pool, project.id, date, holidayName);
    }
    const calendar = new WorkingCalendar(holidays.map((h) => asString((h as Json).date, 'projects.holidays.date')));

    const items = asArray(record.items ?? [], 'projects.items');
    let row = 0;
    for (const itemEntry of items) {
      const item = itemEntry as Json;
      const key = asString(item.key, 'projects.items.key');
      const itemName = asString(item.name, 'projects.items.name');
      const kind = asString(item.kind, 'projects.items.kind') as 'task' | 'milestone' | 'group';
      const groupKey = item.group === undefined || item.group === null ? null : asString(item.group, 'projects.items.group');
      const groupId = groupKey === null ? null : itemIds[groupKey] ?? null;
      const start = item.start === undefined ? null : asString(item.start, 'projects.items.start');
      const duration = item.duration === undefined ? 0 : Number(item.duration);
      const percent = item.percent === undefined ? 0 : Number(item.percent);
      row += 1;
      const effectiveStart = kind === 'group' ? null : start === null ? calendar.nextWorking(config.today) : calendar.nextWorking(start);
      const effectiveDuration = kind === 'group' ? 0 : kind === 'milestone' ? 0 : duration === 0 ? 1 : duration;
      const inserted = await q.insertItem(pool, {
        projectId: project.id,
        row,
        name: itemName,
        kind,
        groupId,
        chosenStart: effectiveStart,
        duration: effectiveDuration,
        percent,
        versionBy: firstOwnerId,
      });
      itemIds[key] = inserted.id;

      const assignees = asArray(item.assignees ?? [], 'projects.items.assignees');
      for (const assignee of assignees) {
        const a = assignee as Json;
        const email = asString(a.email, 'projects.items.assignees.email').trim().toLowerCase();
        const hours = Number(a.hours);
        const person = emailToPerson.get(email);
        if (person === undefined) throw invalidJson('projects.items.assignees.email');
        await q.insertAssignment(pool, inserted.id, person.id, hours);
      }
    }

    const links = asArray(record.links ?? [], 'projects.links');
    for (const linkEntry of links) {
      const link = linkEntry as Json;
      const fromKey = asString(link.from, 'projects.links.from');
      const toKey = asString(link.to, 'projects.links.to');
      const type = asString(link.type, 'projects.links.type') as LinkType;
      const lag = Number(link.lag ?? 0);
      const fromId = itemIds[fromKey];
      const toId = itemIds[toKey];
      if (fromId === undefined || toId === undefined) throw invalidJson('projects.links.from');
      await q.insertLink(pool, { projectId: project.id, fromId, toId, type, lag });
    }

    if (record.baseline !== null && record.baseline !== undefined) {
      const baseline = record.baseline as Json;
      const baselineName = asString(baseline.name, 'projects.baseline.name');
      const snapshot = await readProject(pool, project.id, config.today);
      if (snapshot !== null && snapshot.project.finish !== null) {
        await q.saveBaseline(
          pool,
          project.id,
          baselineName,
          snapshot.project.finish,
          snapshot.project.items
            .filter((item) => item.kind !== 'group' && item.start !== null && item.end !== null)
            .map((item) => ({ itemId: item.id, start: item.start!, end: item.end! })),
        );
      }
    }

    projectResults.push({ name, id: project.id, items: itemIds });
  }

  sendJson(ctx.res, 201, {
    workspace: { id: workspaceRow.id },
    users: createdUsers,
    projects: projectResults,
  });
}
