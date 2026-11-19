import { query } from '../db.js';
import { ApiError } from '../http.js';
import { hashPassword, newId } from '../auth.js';
import { today } from '../config.js';
import { Calendar } from '../../shared/calendar.js';
import { loadProjectState, scheduleOf } from '../repo.js';
import { isDate, isHours, isInteger, isKind, isLinkType, isName, isEmail, isPercent } from './validate.js';
import { saveBaselineRows } from './baseline.js';
import type { ItemKind, LinkType, Role } from '../../shared/types.js';

function bad(path: string): never {
  throw new ApiError(422, { error: 'invalid_field', field: path });
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) bad(path);
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) bad(path);
  return value;
}

interface SetupUser {
  email: string;
  name: string;
  password: string;
  capacity: number;
}

interface SetupItem {
  key: string;
  name: string;
  kind: ItemKind;
  group: string | null;
  start: string | null;
  duration: number | null;
  percent: number;
  assignees: { email: string; hours: number }[];
}

interface SetupProject {
  name: string;
  holidays: { date: string; name: string }[];
  items: SetupItem[];
  links: { from: string; to: string; type: LinkType; lag: number }[];
  baseline: { name: string } | null;
}

export interface SetupAnswer {
  workspace: { id: string };
  users: { email: string; id: string }[];
  projects: { name: string; id: string; items: Record<string, string> }[];
}

export async function gradingSetup(body: Record<string, unknown>): Promise<SetupAnswer> {
  const users: SetupUser[] = array(body.users, 'users').map((raw, index) => {
    const entry = object(raw, `users[${index}]`);
    if (!isEmail(entry.email)) bad(`users[${index}].email`);
    if (!isName(entry.name, 80)) bad(`users[${index}].name`);
    if (typeof entry.password !== 'string' || entry.password.length < 1) bad(`users[${index}].password`);
    const capacity = entry.capacity === undefined ? 8 : entry.capacity;
    if (typeof capacity !== 'number' || !(capacity > 0)) bad(`users[${index}].capacity`);
    return { email: entry.email, name: entry.name, password: entry.password, capacity };
  });

  const workspaceRaw = object(body.workspace, 'workspace');
  if (!isName(workspaceRaw.name, 80)) bad('workspace.name');
  const members = array(workspaceRaw.members, 'workspace.members').map((raw, index) => {
    const entry = object(raw, `workspace.members[${index}]`);
    if (!isEmail(entry.email)) bad(`workspace.members[${index}].email`);
    if (entry.role !== 'owner' && entry.role !== 'editor' && entry.role !== 'viewer') {
      bad(`workspace.members[${index}].role`);
    }
    return { email: entry.email, role: entry.role as Role };
  });

  const projects: SetupProject[] = array(body.projects, 'projects').map((raw, projectIndex) => {
    const entry = object(raw, `projects[${projectIndex}]`);
    if (!isName(entry.name, 80)) bad(`projects[${projectIndex}].name`);
    const holidays = array(entry.holidays ?? [], `projects[${projectIndex}].holidays`).map((holidayRaw, index) => {
      const holiday = object(holidayRaw, `projects[${projectIndex}].holidays[${index}]`);
      if (!isDate(holiday.date)) bad(`projects[${projectIndex}].holidays[${index}].date`);
      if (!isName(holiday.name, 60)) bad(`projects[${projectIndex}].holidays[${index}].name`);
      return { date: holiday.date, name: holiday.name };
    });
    const items = array(entry.items ?? [], `projects[${projectIndex}].items`).map((itemRaw, index) => {
      const path = `projects[${projectIndex}].items[${index}]`;
      const item = object(itemRaw, path);
      if (typeof item.key !== 'string' || item.key === '') bad(`${path}.key`);
      if (!isName(item.name, 120)) bad(`${path}.name`);
      if (!isKind(item.kind)) bad(`${path}.kind`);
      const group = item.group === undefined || item.group === null ? null : item.group;
      if (group !== null && typeof group !== 'string') bad(`${path}.group`);
      const start = item.start === undefined || item.start === null ? null : item.start;
      if (start !== null && !isDate(start)) bad(`${path}.start`);
      const duration = item.duration === undefined || item.duration === null ? null : item.duration;
      if (duration !== null && (!isInteger(duration) || duration < 0 || duration > 999)) bad(`${path}.duration`);
      const percent = item.percent === undefined ? 0 : item.percent;
      if (!isPercent(percent)) bad(`${path}.percent`);
      const assignees = array(item.assignees ?? [], `${path}.assignees`).map((assigneeRaw, a) => {
        const assignee = object(assigneeRaw, `${path}.assignees[${a}]`);
        if (!isEmail(assignee.email)) bad(`${path}.assignees[${a}].email`);
        if (!isHours(assignee.hours)) bad(`${path}.assignees[${a}].hours`);
        return { email: assignee.email, hours: assignee.hours };
      });
      return {
        key: item.key,
        name: item.name,
        kind: item.kind,
        group: group as string | null,
        start: start as string | null,
        duration,
        percent,
        assignees,
      };
    });
    const links = array(entry.links ?? [], `projects[${projectIndex}].links`).map((linkRaw, index) => {
      const path = `projects[${projectIndex}].links[${index}]`;
      const link = object(linkRaw, path);
      if (typeof link.from !== 'string') bad(`${path}.from`);
      if (typeof link.to !== 'string') bad(`${path}.to`);
      if (!isLinkType(link.type)) bad(`${path}.type`);
      const lag = link.lag === undefined ? 0 : link.lag;
      if (!isInteger(lag) || lag < -30 || lag > 30) bad(`${path}.lag`);
      return { from: link.from, to: link.to, type: link.type, lag };
    });
    const baselineRaw = entry.baseline === undefined || entry.baseline === null ? null : object(entry.baseline, `projects[${projectIndex}].baseline`);
    if (baselineRaw && !isName(baselineRaw.name, 60)) bad(`projects[${projectIndex}].baseline.name`);
    return {
      name: entry.name,
      holidays,
      items,
      links,
      baseline: baselineRaw ? { name: baselineRaw.name as string } : null,
    };
  });

  const userIds = new Map<string, string>();
  for (const user of users) {
    const existing = await query<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1)', [
      user.email,
    ]);
    if (existing[0]) {
      await query('UPDATE users SET name = $2, password_hash = $3, capacity = $4 WHERE id = $1', [
        existing[0].id,
        user.name,
        hashPassword(user.password),
        user.capacity,
      ]);
      userIds.set(user.email.toLowerCase(), existing[0].id);
    } else {
      const id = newId('u');
      await query(
        'INSERT INTO users (id, name, email, password_hash, capacity) VALUES ($1, $2, $3, $4, $5)',
        [id, user.name, user.email, hashPassword(user.password), user.capacity],
      );
      userIds.set(user.email.toLowerCase(), id);
    }
  }

  const workspaceId = newId('w');
  await query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, workspaceRaw.name]);
  for (const member of members) {
    const userId = userIds.get(member.email.toLowerCase());
    if (!userId) bad('workspace.members');
    await query('INSERT INTO members (workspace_id, user_id, role) VALUES ($1, $2, $3)', [
      workspaceId,
      userId,
      member.role,
    ]);
  }

  const firstOwner = members.find((member) => member.role === 'owner') ?? members[0];
  const creatorId = userIds.get(firstOwner.email.toLowerCase())!;

  const answers: SetupAnswer['projects'] = [];
  for (const project of projects) {
    const projectId = newId('p');
    await query('INSERT INTO projects (id, workspace_id, name) VALUES ($1, $2, $3)', [
      projectId,
      workspaceId,
      project.name,
    ]);
    for (const holiday of project.holidays) {
      await query('INSERT INTO holidays (project_id, date, name) VALUES ($1, $2, $3)', [
        projectId,
        holiday.date,
        holiday.name,
      ]);
    }

    const calendar = new Calendar(project.holidays.map((holiday) => holiday.date));
    const itemIds = new Map<string, string>();
    let topPosition = 0;
    const childPositions = new Map<string, number>();

    for (const item of project.items) {
      const id = newId('i');
      itemIds.set(item.key, id);
      const groupId = item.group ? itemIds.get(item.group) ?? null : null;
      let position: number;
      if (groupId) {
        position = childPositions.get(groupId) ?? 0;
        childPositions.set(groupId, position + 1);
      } else {
        position = topPosition;
        topPosition += 1;
      }
      const duration = item.kind === 'group' ? 0 : item.kind === 'milestone' ? 0 : item.duration ?? 1;
      const chosenStart = item.kind === 'group' ? null : calendar.nextWorkingIso(item.start ?? today());
      await query(
        `INSERT INTO items (id, project_id, kind, name, group_id, position, chosen_start, duration, percent, version, last_editor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10)`,
        [id, projectId, item.kind, item.name, groupId, position, chosenStart, duration, item.percent, creatorId],
      );
      for (const assignee of item.assignees) {
        const userId = userIds.get(assignee.email.toLowerCase());
        if (!userId) bad('projects');
        await query('INSERT INTO assignments (item_id, user_id, hours) VALUES ($1, $2, $3)', [
          id,
          userId,
          assignee.hours,
        ]);
      }
    }

    for (const link of project.links) {
      const from = itemIds.get(link.from);
      const to = itemIds.get(link.to);
      if (!from || !to) bad('projects');
      await query(
        'INSERT INTO links (id, project_id, from_item, to_item, type, lag) VALUES ($1, $2, $3, $4, $5, $6)',
        [newId('l'), projectId, from, to, link.type, link.lag],
      );
    }

    if (project.baseline) {
      const state = (await loadProjectState(projectId))!;
      await saveBaselineRows(projectId, project.baseline.name, scheduleOf(state));
    }

    answers.push({
      name: project.name,
      id: projectId,
      items: Object.fromEntries(itemIds),
    });
  }

  return {
    workspace: { id: workspaceId },
    users: users.map((user) => ({ email: user.email, id: userIds.get(user.email.toLowerCase())! })),
    projects: answers,
  };
}
