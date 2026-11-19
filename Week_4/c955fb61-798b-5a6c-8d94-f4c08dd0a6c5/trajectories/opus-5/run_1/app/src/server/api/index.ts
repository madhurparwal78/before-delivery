import type { IncomingMessage, ServerResponse } from 'node:http';
import { query } from '../db.js';
import { config, today } from '../config.js';
import {
  ApiError,
  errors,
  isStateChanging,
  parseCookies,
  parseJsonBody,
  readBody,
  sameOrigin,
  sendEmpty,
  sendJson,
  sendText,
} from '../http.js';
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  findUserByEmail,
  hashPassword,
  newId,
  roleInWorkspace,
  setSessionCookie,
  userForRequest,
  verifyPassword,
  workspacesOf,
  SESSION_COOKIE,
} from '../auth.js';
import {
  loadProjectState,
  projectAccess,
  scheduleOf,
  toProject,
  type ItemRow,
  type ProjectAccess,
} from '../repo.js';
import {
  beginEdit,
  bumpVersion,
  childrenOfGroup,
  completeEdit,
  setPositions,
  topLevelUnits,
  withProjectLock,
  writeTopOrder,
  rowsAnswer,
  type Actor,
} from './engine.js';
import { gradingSetup } from './setup.js';
import { saveBaselineRows } from './baseline.js';
import { readWorkload } from './workload.js';
import { parsePredecessors } from '../domain/predecessors.js';
import { bindingPredecessor } from '../domain/schedule.js';
import { findLoopPath } from '../domain/loops.js';
import { renderCsv } from '../exports/csv.js';
import { renderPdf } from '../exports/pdf.js';
import { getObject, putObject, StorageUnavailable } from '../storage.js';
import { broadcastToProject, presenceOf } from '../live.js';
import { isDate, isHours, isInteger, isKind, isLinkType, isName, isEmail, isPercent, slug } from './validate.js';
import { dayOfWeek, fromIso, isMonday } from '../../shared/dates.js';
import { loopMessage } from '../../shared/copy.js';
import type { ExportFormat, Item, Project, SessionUser } from '../../shared/types.js';

interface Resolved {
  access: ProjectAccess;
  actor: Actor;
}

function requireEditor(access: ProjectAccess): void {
  if (access.role === 'viewer') throw errors.readOnly();
}

async function resolveProject(user: SessionUser, projectId: string): Promise<Resolved> {
  const access = await projectAccess(user.id, projectId);
  if (!access) throw errors.notFound();
  return { access, actor: { id: user.id, name: user.name } };
}

async function resolveItem(
  user: SessionUser,
  itemId: string,
): Promise<Resolved & { item: ItemRow }> {
  const rows = await query<ItemRow>('SELECT * FROM items WHERE id = $1', [itemId]);
  const item = rows[0];
  if (!item) throw errors.notFound();
  const resolved = await resolveProject(user, item.project_id);
  return { ...resolved, item };
}

function itemOf(project: Project, itemId: string): Item {
  return project.items.find((entry) => entry.id === itemId)!;
}

async function editorName(itemId: string): Promise<string> {
  const rows = await query<{ name: string }>(
    'SELECT users.name FROM items JOIN users ON users.id = items.last_editor WHERE items.id = $1',
    [itemId],
  );
  return rows[0]?.name ?? '';
}

async function requireVersion(itemId: string, body: Record<string, unknown>, project: Project): Promise<void> {
  if (!isInteger(body.baseVersion)) throw errors.invalidField('baseVersion');
  const current = itemOf(project, itemId);
  if (current.version !== body.baseVersion) {
    throw new ApiError(409, {
      error: 'version_conflict',
      item: current,
      by: await editorName(itemId),
    });
  }
}

/* ------------------------------------------------------------------ items */

async function createItem(user: SessionUser, projectId: string, body: Record<string, unknown>): Promise<unknown> {
  const { access, actor } = await resolveProject(user, projectId);
  requireEditor(access);
  return withProjectLock(projectId, async () => {
    const { state, schedule, before } = await beginEdit(projectId);
    if (!isName(body.name, 120)) throw errors.invalidField('name');
    if (!isKind(body.kind)) throw errors.invalidField('kind');
    const kind = body.kind;
    if (body.start !== undefined && body.start !== null && !isDate(body.start)) {
      throw errors.invalidField('start');
    }
    let duration = kind === 'milestone' ? 0 : 1;
    if (kind !== 'group' && body.duration !== undefined && body.duration !== null) {
      if (!isInteger(body.duration)) throw errors.invalidField('duration');
      if (kind === 'task' && (body.duration < 1 || body.duration > 999)) throw errors.invalidField('duration');
      if (kind === 'milestone' && body.duration !== 0) throw errors.invalidField('duration');
      duration = body.duration;
    }
    const groupValue = body.group === undefined ? null : body.group;
    let groupId: string | null = null;
    if (groupValue !== null) {
      if (typeof groupValue !== 'string' || kind === 'group') throw errors.invalidField('group');
      const target = state.rows.find((row) => row.id === groupValue && row.kind === 'group');
      if (!target) throw errors.invalidField('group');
      groupId = target.id;
    }

    const id = newId('i');
    const chosenStart =
      kind === 'group'
        ? null
        : schedule.calendar.nextWorkingIso(isDate(body.start) ? body.start : today());
    const position = groupId
      ? childrenOfGroup(state.rows, groupId).length
      : topLevelUnits(state.rows).length;
    await query(
      `INSERT INTO items (id, project_id, kind, name, group_id, position, chosen_start, duration, percent, version, last_editor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 1, $9)`,
      [id, projectId, kind, String(body.name).trim(), groupId, position, chosenStart, duration, actor.id],
    );

    const end = await completeEdit(projectId, before, {
      actor,
      verb: 'added',
      editedItemId: id,
      itemId: id,
      itemName: String(body.name).trim(),
    });
    return { status: 201, body: { item: itemOf(end.project, id), moved: end.moved, finish: end.finish } };
  });
}

async function patchItem(user: SessionUser, itemId: string, body: Record<string, unknown>): Promise<unknown> {
  const { access, actor, item } = await resolveItem(user, itemId);
  requireEditor(access);
  return withProjectLock(item.project_id, async () => {
    const { state, schedule, before } = await beginEdit(item.project_id);
    const project = toProject(state, schedule);
    await requireVersion(itemId, body, project);
    const current = itemOf(project, itemId);

    if (body.name !== undefined && !isName(body.name, 120)) throw errors.invalidField('name');
    if (current.kind === 'group') {
      for (const field of ['start', 'duration', 'percent', 'group'] as const) {
        if (body[field] !== undefined) throw errors.invalidField(field);
      }
    }
    if (body.start !== undefined && !isDate(body.start)) throw errors.invalidField('start');
    if (body.duration !== undefined && (!isInteger(body.duration) || body.duration < 0 || body.duration > 999)) {
      throw errors.invalidField('duration');
    }
    const resultingKind =
      current.kind === 'group'
        ? 'group'
        : body.duration === undefined
          ? current.kind
          : body.duration === 0
            ? 'milestone'
            : 'task';
    if (body.percent !== undefined) {
      if (!isPercent(body.percent)) throw errors.invalidField('percent');
      if (current.kind === 'milestone' && resultingKind === 'milestone' && body.percent !== 0 && body.percent !== 100) {
        throw errors.invalidField('percent');
      }
    }
    let groupId = current.group;
    if (body.group !== undefined) {
      if (body.group === null) {
        groupId = null;
      } else {
        const target = state.rows.find((row) => row.id === body.group && row.kind === 'group');
        if (!target) throw errors.invalidField('group');
        groupId = target.id;
      }
    }
    if (resultingKind === 'milestone' && current.assignees.length > 0) {
      throw new ApiError(422, { error: 'has_assignees' });
    }

    const name = body.name === undefined ? current.name : String(body.name).trim();
    const duration = resultingKind === 'group' ? item.duration : body.duration === undefined ? current.duration : (body.duration as number);
    let percent = resultingKind === 'group' ? 0 : body.percent === undefined ? current.percent : (body.percent as number);
    if (resultingKind === 'milestone') percent = percent === 100 ? 100 : 0;
    const chosenStart =
      resultingKind === 'group'
        ? null
        : schedule.calendar.nextWorkingIso(isDate(body.start) ? body.start : current.chosenStart!);

    await query(
      `UPDATE items SET name = $2, kind = $3, duration = $4, percent = $5, chosen_start = $6,
              group_id = $7, version = version + 1, last_editor = $8
         WHERE id = $1`,
      [itemId, name, resultingKind, duration, percent, chosenStart, groupId, actor.id],
    );

    if (body.group !== undefined && groupId !== current.group) {
      if (groupId === null) {
        const units = topLevelUnits(state.rows);
        const groupIndex = units.findIndex((unit) => unit.id === current.group);
        const order = units.map((unit) => unit.id);
        order.splice(groupIndex + 1, 0, itemId);
        await writeTopOrder(order);
      } else {
        await setPositions([{ id: itemId, position: childrenOfGroup(state.rows, groupId).length }]);
      }
    }

    const end = await completeEdit(item.project_id, before, {
      actor,
      verb: 'changed',
      editedItemId: itemId,
      itemId,
      itemName: name,
    });
    const saved = itemOf(end.project, itemId);
    const bound =
      saved.chosenStart && saved.start && fromIso(saved.chosenStart) < fromIso(saved.start)
        ? bindingPredecessor(end.schedule, itemId, end.state.links)
        : null;
    return {
      status: 200,
      body: {
        item: saved,
        moved: end.moved,
        finish: end.finish,
        constraint: bound ? { predecessor: bound.name } : null,
      },
    };
  });
}

async function deleteItem(user: SessionUser, itemId: string): Promise<unknown> {
  const { access, actor, item } = await resolveItem(user, itemId);
  requireEditor(access);
  return withProjectLock(item.project_id, async () => {
    const { state, before } = await beginEdit(item.project_id);
    const name = item.name;

    if (item.kind === 'group') {
      const units = topLevelUnits(state.rows);
      const children = childrenOfGroup(state.rows, itemId);
      const order: string[] = [];
      for (const unit of units) {
        if (unit.id === itemId) order.push(...children.map((child) => child.id));
        else order.push(unit.id);
      }
      await query('UPDATE items SET group_id = NULL WHERE group_id = $1', [itemId]);
      await writeTopOrder(order);
    }
    await query('DELETE FROM items WHERE id = $1', [itemId]);

    const end = await completeEdit(item.project_id, before, {
      actor,
      verb: 'deleted',
      editedItemId: null,
      itemId,
      itemName: name,
    });
    return { status: 200, body: { moved: end.moved, finish: end.finish } };
  });
}

async function reorderItem(user: SessionUser, itemId: string, body: Record<string, unknown>): Promise<unknown> {
  const { access, actor, item } = await resolveItem(user, itemId);
  requireEditor(access);
  return withProjectLock(item.project_id, async () => {
    const { state, before } = await beginEdit(item.project_id);
    if (body.direction !== 'up' && body.direction !== 'down') throw errors.invalidField('direction');
    if (item.kind === 'group') throw new ApiError(422, { error: 'not_reorderable' });

    const siblings = item.group_id
      ? childrenOfGroup(state.rows, item.group_id)
      : topLevelUnits(state.rows);
    const index = siblings.findIndex((sibling) => sibling.id === itemId);
    const target = index + (body.direction === 'up' ? -1 : 1);
    if (target < 0 || target >= siblings.length) {
      return { status: 200, body: { changed: false, rows: rowsAnswer(state) } };
    }
    await setPositions([
      { id: siblings[index].id, position: siblings[target].position },
      { id: siblings[target].id, position: siblings[index].position },
    ]);

    const end = await completeEdit(item.project_id, before, {
      actor,
      verb: 'changed',
      editedItemId: itemId,
      itemId,
      itemName: item.name,
    });
    return { status: 200, body: { changed: true, rows: rowsAnswer(end.state) } };
  });
}

async function setPredecessors(user: SessionUser, itemId: string, body: Record<string, unknown>): Promise<unknown> {
  const { access, actor, item } = await resolveItem(user, itemId);
  requireEditor(access);
  return withProjectLock(item.project_id, async () => {
    const { state, schedule, before } = await beginEdit(item.project_id);
    const project = toProject(state, schedule);
    await requireVersion(itemId, body, project);
    const text = typeof body.text === 'string' ? body.text : '';

    const parsed = parsePredecessors(
      text,
      schedule.items.map((entry) => ({ id: entry.id, row: entry.row, name: entry.name, kind: entry.kind })),
      itemId,
      state.links,
    );
    if (!parsed.ok) {
      throw new ApiError(422, { error: 'invalid_predecessors', message: parsed.message });
    }

    const byRow = new Map(schedule.items.map((entry) => [entry.row, entry.id]));
    await query('DELETE FROM links WHERE to_item = $1', [itemId]);
    for (const entry of parsed.entries) {
      await query(
        'INSERT INTO links (id, project_id, from_item, to_item, type, lag) VALUES ($1, $2, $3, $4, $5, $6)',
        [newId('l'), item.project_id, byRow.get(entry.row)!, itemId, entry.type, entry.lag],
      );
    }
    await bumpVersion(itemId, actor);

    const end = await completeEdit(item.project_id, before, {
      actor,
      verb: 'changed',
      editedItemId: itemId,
      itemId,
      itemName: item.name,
    });
    return { status: 200, body: { item: itemOf(end.project, itemId), moved: end.moved, finish: end.finish } };
  });
}

/* ------------------------------------------------------------------ links */

async function createLink(user: SessionUser, projectId: string, body: Record<string, unknown>): Promise<unknown> {
  const { access, actor } = await resolveProject(user, projectId);
  requireEditor(access);
  return withProjectLock(projectId, async () => {
    const { state, schedule, before } = await beginEdit(projectId);
    if (!isLinkType(body.type)) throw new ApiError(422, { error: 'invalid_link', field: 'type' });
    if (!isInteger(body.lag) || body.lag < -30 || body.lag > 30) {
      throw new ApiError(422, { error: 'invalid_link', field: 'lag' });
    }
    const from = schedule.byId.get(String(body.from));
    if (!from) throw new ApiError(422, { error: 'invalid_link', field: 'from' });
    const to = schedule.byId.get(String(body.to));
    if (!to) throw new ApiError(422, { error: 'invalid_link', field: 'to' });
    if (from.id === to.id) throw new ApiError(422, { error: 'self_link' });
    if (from.kind === 'group' || to.kind === 'group') throw new ApiError(422, { error: 'group_link' });
    if (state.links.some((link) => link.from === from.id && link.to === to.id)) {
      throw new ApiError(409, { error: 'duplicate_link' });
    }
    const rowOf = new Map(schedule.items.map((entry) => [entry.id, entry.row]));
    const loop = findLoopPath(from.id, to.id, state.links, rowOf);
    if (loop) {
      throw new ApiError(422, {
        error: 'loop',
        path: loop,
        message: loopMessage(loop.map((id) => schedule.byId.get(id)!.name)),
      });
    }

    const id = newId('l');
    await query(
      'INSERT INTO links (id, project_id, from_item, to_item, type, lag) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, projectId, from.id, to.id, body.type, body.lag],
    );
    await bumpVersion(to.id, actor);

    const end = await completeEdit(projectId, before, {
      actor,
      verb: 'changed',
      editedItemId: from.id,
      itemId: from.id,
      itemName: from.name,
      alsoMoved: to.id,
    });
    return {
      status: 201,
      body: {
        link: { id, from: from.id, to: to.id, type: body.type, lag: body.lag },
        moved: end.moved,
        finish: end.finish,
      },
    };
  });
}

async function deleteLink(user: SessionUser, linkId: string): Promise<unknown> {
  const rows = await query<{ id: string; project_id: string; from_item: string; to_item: string }>(
    'SELECT id, project_id, from_item, to_item FROM links WHERE id = $1',
    [linkId],
  );
  const link = rows[0];
  if (!link) throw errors.notFound();
  const { access, actor } = await resolveProject(user, link.project_id);
  requireEditor(access);
  return withProjectLock(link.project_id, async () => {
    const { schedule, before } = await beginEdit(link.project_id);
    const from = schedule.byId.get(link.from_item)!;
    await query('DELETE FROM links WHERE id = $1', [linkId]);
    await bumpVersion(link.to_item, actor);
    const end = await completeEdit(link.project_id, before, {
      actor,
      verb: 'changed',
      editedItemId: link.from_item,
      itemId: link.from_item,
      itemName: from.name,
      alsoMoved: link.to_item,
    });
    return { status: 200, body: { moved: end.moved, finish: end.finish } };
  });
}

/* --------------------------------------------------------------- holidays */

async function addHoliday(user: SessionUser, projectId: string, body: Record<string, unknown>): Promise<unknown> {
  const { access, actor } = await resolveProject(user, projectId);
  requireEditor(access);
  return withProjectLock(projectId, async () => {
    const { state, before } = await beginEdit(projectId);
    if (!isDate(body.date)) throw errors.invalidField('date');
    if (!isName(body.name, 60)) throw errors.invalidField('name');
    const weekday = dayOfWeek(fromIso(body.date));
    if (weekday === 0 || weekday === 6) throw new ApiError(422, { error: 'weekend' });
    if (state.holidays.some((holiday) => holiday.date === body.date)) {
      throw new ApiError(409, { error: 'duplicate_holiday' });
    }
    await query('INSERT INTO holidays (project_id, date, name) VALUES ($1, $2, $3)', [
      projectId,
      body.date,
      String(body.name).trim(),
    ]);
    const end = await completeEdit(projectId, before, {
      actor,
      verb: 'holidays',
      editedItemId: null,
      itemId: null,
      itemName: null,
    });
    return {
      status: 201,
      body: {
        holiday: { date: body.date, name: String(body.name).trim() },
        moved: end.moved,
        finish: end.finish,
      },
    };
  });
}

async function removeHoliday(user: SessionUser, projectId: string, date: string): Promise<unknown> {
  const { access, actor } = await resolveProject(user, projectId);
  requireEditor(access);
  return withProjectLock(projectId, async () => {
    const { state, before } = await beginEdit(projectId);
    if (!state.holidays.some((holiday) => holiday.date === date)) throw errors.notFound();
    await query('DELETE FROM holidays WHERE project_id = $1 AND date = $2', [projectId, date]);
    const end = await completeEdit(projectId, before, {
      actor,
      verb: 'holidays',
      editedItemId: null,
      itemId: null,
      itemName: null,
    });
    return { status: 200, body: { moved: end.moved, finish: end.finish } };
  });
}

/* --------------------------------------------------------------- baseline */

async function saveBaseline(user: SessionUser, projectId: string, body: Record<string, unknown>): Promise<unknown> {
  const { access, actor } = await resolveProject(user, projectId);
  requireEditor(access);
  return withProjectLock(projectId, async () => {
    const { state, schedule, before } = await beginEdit(projectId);
    if (!isName(body.name, 60)) throw errors.invalidField('name');
    if (state.baseline && body.replace !== true) {
      throw new ApiError(409, { error: 'baseline_exists', name: state.baseline.name });
    }
    await saveBaselineRows(projectId, String(body.name).trim(), schedule);
    const end = await completeEdit(projectId, before, {
      actor,
      verb: 'baseline',
      editedItemId: null,
      itemId: null,
      itemName: null,
    });
    return { status: 201, body: { baseline: end.project.baseline } };
  });
}

/* ------------------------------------------------------------ assignments */

async function addAssignee(user: SessionUser, itemId: string, body: Record<string, unknown>): Promise<unknown> {
  const { access, actor, item } = await resolveItem(user, itemId);
  requireEditor(access);
  return withProjectLock(item.project_id, async () => {
    const { before } = await beginEdit(item.project_id);
    if (item.kind !== 'task') throw new ApiError(422, { error: 'not_a_task' });
    const userId = typeof body.userId === 'string' ? body.userId : '';
    const role = await roleInWorkspace(userId, access.project.workspace_id);
    if (role !== 'owner' && role !== 'editor') throw errors.invalidField('userId');
    if (!isHours(body.hours)) throw errors.invalidField('hours');
    const existing = await query('SELECT 1 FROM assignments WHERE item_id = $1 AND user_id = $2', [
      itemId,
      userId,
    ]);
    if (existing.length > 0) throw new ApiError(409, { error: 'already_assigned' });

    await query('INSERT INTO assignments (item_id, user_id, hours) VALUES ($1, $2, $3)', [
      itemId,
      userId,
      body.hours,
    ]);
    await bumpVersion(itemId, actor);
    if (userId !== actor.id) {
      await query(
        `INSERT INTO notices (id, item_id, user_id, assigner_name, send_after)
         VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)`,
        [newId('n'), itemId, userId, actor.name, String(config.assignNoticeDelaySeconds)],
      );
    }
    const end = await completeEdit(item.project_id, before, {
      actor,
      verb: 'changed',
      editedItemId: itemId,
      itemId,
      itemName: item.name,
    });
    return { status: 201, body: { item: itemOf(end.project, itemId) } };
  });
}

async function removeAssignee(user: SessionUser, itemId: string, userId: string): Promise<unknown> {
  const { access, actor, item } = await resolveItem(user, itemId);
  requireEditor(access);
  return withProjectLock(item.project_id, async () => {
    const { before } = await beginEdit(item.project_id);
    const existing = await query('SELECT 1 FROM assignments WHERE item_id = $1 AND user_id = $2', [
      itemId,
      userId,
    ]);
    if (existing.length === 0) throw errors.notFound();
    await query('DELETE FROM assignments WHERE item_id = $1 AND user_id = $2', [itemId, userId]);
    await query("DELETE FROM notices WHERE item_id = $1 AND user_id = $2 AND state = 'queued'", [
      itemId,
      userId,
    ]);
    await bumpVersion(itemId, actor);
    const end = await completeEdit(item.project_id, before, {
      actor,
      verb: 'changed',
      editedItemId: itemId,
      itemId,
      itemName: item.name,
    });
    return { status: 200, body: { item: itemOf(end.project, itemId) } };
  });
}

/* --------------------------------------------------------------- comments */

async function listComments(user: SessionUser, itemId: string): Promise<unknown> {
  await resolveItem(user, itemId);
  const rows = await query<{
    id: string;
    author_id: string;
    author_name: string;
    body: string;
    created_at: Date;
  }>(
    `SELECT comments.id, comments.author_id, users.name AS author_name, comments.body, comments.created_at
       FROM comments JOIN users ON users.id = comments.author_id
      WHERE comments.item_id = $1
      ORDER BY comments.created_at, comments.sequence`,
    [itemId],
  );
  return {
    status: 200,
    body: {
      comments: rows.map((row) => ({
        id: row.id,
        author: { userId: row.author_id, name: row.author_name },
        text: row.body,
        createdAt: new Date(row.created_at).toISOString(),
      })),
    },
  };
}

async function postComment(user: SessionUser, itemId: string, body: Record<string, unknown>): Promise<unknown> {
  const { access, actor, item } = await resolveItem(user, itemId);
  requireEditor(access);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < 1 || text.length > 1000) throw errors.invalidField('text');
  const id = newId('c');
  const rows = await query<{ created_at: Date }>(
    'INSERT INTO comments (id, item_id, author_id, body) VALUES ($1, $2, $3, $4) RETURNING created_at',
    [id, itemId, actor.id, text],
  );
  const comment = {
    id,
    author: { userId: actor.id, name: actor.name },
    text,
    createdAt: new Date(rows[0].created_at).toISOString(),
  };
  broadcastToProject(item.project_id, {
    type: 'comment',
    itemId,
    comment,
    actorId: actor.id,
    itemName: item.name,
  });
  return { status: 201, body: { comment } };
}

/* ---------------------------------------------------------------- exports */

async function createExport(user: SessionUser, projectId: string, body: Record<string, unknown>): Promise<unknown> {
  const { access } = await resolveProject(user, projectId);
  if (body.format !== 'csv' && body.format !== 'pdf') throw errors.invalidField('format');
  const format = body.format as ExportFormat;
  const state = (await loadProjectState(projectId))!;
  const schedule = scheduleOf(state);
  const filename = `${slug(access.project.name)}-${today()}.${format}`;
  const id = newId('x');
  const key = `exports/${projectId}/${id}/${filename}`;
  const payload = format === 'csv' ? renderCsv(state, schedule) : renderPdf(state.name, schedule);
  const contentType = format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf';

  try {
    await putObject(key, payload, contentType);
  } catch (error) {
    if (error instanceof StorageUnavailable) {
      throw new ApiError(503, { error: 'storage_unavailable' });
    }
    throw error;
  }

  await query(
    "INSERT INTO exports (id, project_id, format, filename, object_key, state) VALUES ($1, $2, $3, $4, $5, 'stored')",
    [id, projectId, format, filename, key],
  );
  broadcastToProject(projectId, { type: 'exports', exports: await exportList(projectId) });
  return { status: 201, body: { id, format, filename, downloadUrl: `/api/exports/${id}/download` } };
}

async function exportList(projectId: string): Promise<
  { id: string; format: ExportFormat; filename: string; downloadUrl: string; createdAt: string }[]
> {
  const rows = await query<{ id: string; format: ExportFormat; filename: string; created_at: Date }>(
    "SELECT id, format, filename, created_at FROM exports WHERE project_id = $1 AND state = 'stored' ORDER BY created_at DESC, id DESC",
    [projectId],
  );
  return rows.map((row) => ({
    id: row.id,
    format: row.format,
    filename: row.filename,
    downloadUrl: `/api/exports/${row.id}/download`,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

async function downloadExport(user: SessionUser, res: ServerResponse, exportId: string): Promise<void> {
  const rows = await query<{ project_id: string; format: ExportFormat; filename: string; object_key: string }>(
    'SELECT project_id, format, filename, object_key FROM exports WHERE id = $1',
    [exportId],
  );
  const record = rows[0];
  if (!record) throw errors.notFound();
  await resolveProject(user, record.project_id);
  let body: Buffer;
  try {
    body = await getObject(record.object_key);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new ApiError(503, { error: 'storage_unavailable' });
    throw error;
  }
  sendText(res, 200, body, {
    'content-type': record.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf',
    'content-disposition': `attachment; filename="${record.filename}"`,
    'cache-control': 'no-store',
  });
}

/* ----------------------------------------------------------------- router */

interface RouteAnswer {
  status: number;
  body: unknown;
}

async function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: Record<string, unknown>,
): Promise<RouteAnswer | null> {
  const method = req.method ?? 'GET';
  const segments = url.pathname.split('/').filter((part) => part !== '');
  const at = (index: number): string => segments[index] ?? '';

  if (method === 'GET' && url.pathname === '/api/health') {
    return { status: 200, body: { status: 'ok' } };
  }
  if (method === 'GET' && url.pathname === '/api/config') {
    return {
      status: 200,
      body: {
        today: today(),
        timeZone: config.timeZone,
        assignNoticeDelaySeconds: config.assignNoticeDelaySeconds,
        presenceTimeoutSeconds: config.presenceTimeoutSeconds,
        knockOnMs: config.knockOnMs,
        knockOnStaggerMs: config.knockOnStaggerMs,
        finishMotionMs: config.finishMotionMs,
      },
    };
  }
  if (method === 'POST' && url.pathname === '/api/grading/setup') {
    const key = req.headers['x-grading-key'];
    if (!config.gradingKey || key !== config.gradingKey) throw errors.notFound();
    return { status: 201, body: await gradingSetup(body) };
  }

  if (isStateChanging(method) && !sameOrigin(req)) throw errors.badOrigin();

  if (method === 'POST' && url.pathname === '/api/signup') {
    if (!isName(body.name, 80)) throw errors.invalidField('name');
    if (!isEmail(body.email)) throw errors.invalidField('email');
    if (typeof body.password !== 'string' || body.password.length < 10) {
      throw errors.invalidField('password');
    }
    if (await findUserByEmail(body.email)) throw new ApiError(409, { error: 'email_taken' });
    const id = newId('u');
    const name = String(body.name).trim();
    await query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)', [
      id,
      name,
      body.email,
      hashPassword(body.password),
    ]);
    const workspaceId = newId('w');
    await query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, `${name}'s plans`]);
    await query("INSERT INTO members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')", [
      workspaceId,
      id,
    ]);
    setSessionCookie(res, await createSession(id));
    return { status: 201, body: { user: { id, name, email: body.email } } };
  }

  if (method === 'POST' && url.pathname === '/api/session') {
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const found = await findUserByEmail(email);
    if (!found || !verifyPassword(password, found.password_hash)) {
      throw new ApiError(401, { error: 'invalid_credentials' });
    }
    setSessionCookie(res, await createSession(found.id));
    return { status: 200, body: { user: { id: found.id, name: found.name, email: found.email } } };
  }

  const user = await userForRequest(req);
  if (!user) throw errors.unauthenticated();

  if (method === 'DELETE' && url.pathname === '/api/session') {
    const sessionId = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
    if (sessionId) await deleteSession(sessionId);
    clearSessionCookie(res);
    return { status: 204, body: null };
  }

  if (method === 'GET' && url.pathname === '/api/me') {
    return { status: 200, body: { user, workspaces: await workspacesOf(user.id) } };
  }

  if (url.pathname === '/api/projects' && method === 'GET') {
    const rows = await query<{ id: string; name: string; workspace_id: string; workspace_name: string }>(
      `SELECT projects.id, projects.name, projects.workspace_id, workspaces.name AS workspace_name
         FROM projects
         JOIN workspaces ON workspaces.id = projects.workspace_id
         JOIN members ON members.workspace_id = projects.workspace_id AND members.user_id = $1
        ORDER BY projects.name`,
      [user.id],
    );
    const projects = [];
    for (const row of rows) {
      const state = (await loadProjectState(row.id))!;
      projects.push({
        id: row.id,
        name: row.name,
        workspace: { id: row.workspace_id, name: row.workspace_name },
        finish: scheduleOf(state).finish,
      });
    }
    return { status: 200, body: { projects } };
  }

  if (url.pathname === '/api/projects' && method === 'POST') {
    const workspaceId = typeof body.workspace === 'string' ? body.workspace : '';
    const role = await roleInWorkspace(user.id, workspaceId);
    if (!role) throw errors.notFound();
    if (role === 'viewer') throw errors.readOnly();
    if (!isName(body.name, 80)) throw errors.invalidField('name');
    const id = newId('p');
    await query('INSERT INTO projects (id, workspace_id, name) VALUES ($1, $2, $3)', [
      id,
      workspaceId,
      String(body.name).trim(),
    ]);
    const state = (await loadProjectState(id))!;
    return { status: 201, body: { project: toProject(state, scheduleOf(state)) } };
  }

  if (at(1) === 'projects' && segments.length >= 3) {
    const projectId = at(2);
    const tail = at(3);
    if (segments.length === 3 && method === 'GET') {
      const { access } = await resolveProject(user, projectId);
      const state = (await loadProjectState(access.project.id))!;
      return { status: 200, body: toProject(state, scheduleOf(state)) };
    }
    if (tail === 'items' && method === 'POST') return (await createItem(user, projectId, body)) as RouteAnswer;
    if (tail === 'links' && method === 'POST') return (await createLink(user, projectId, body)) as RouteAnswer;
    if (tail === 'holidays' && method === 'POST') return (await addHoliday(user, projectId, body)) as RouteAnswer;
    if (tail === 'holidays' && segments.length === 5 && method === 'DELETE') {
      return (await removeHoliday(user, projectId, at(4))) as RouteAnswer;
    }
    if (tail === 'baseline' && method === 'POST') return (await saveBaseline(user, projectId, body)) as RouteAnswer;
    if (tail === 'presence' && method === 'GET') {
      await resolveProject(user, projectId);
      return { status: 200, body: { people: presenceOf(projectId) } };
    }
    if (tail === 'exports' && method === 'POST') return (await createExport(user, projectId, body)) as RouteAnswer;
    if (tail === 'exports' && method === 'GET') {
      await resolveProject(user, projectId);
      return { status: 200, body: { exports: await exportList(projectId) } };
    }
  }

  if (at(1) === 'items' && segments.length >= 3) {
    const itemId = at(2);
    const tail = at(3);
    if (segments.length === 3 && method === 'PATCH') return (await patchItem(user, itemId, body)) as RouteAnswer;
    if (segments.length === 3 && method === 'DELETE') return (await deleteItem(user, itemId)) as RouteAnswer;
    if (tail === 'reorder' && method === 'POST') return (await reorderItem(user, itemId, body)) as RouteAnswer;
    if (tail === 'predecessors' && method === 'PUT') {
      return (await setPredecessors(user, itemId, body)) as RouteAnswer;
    }
    if (tail === 'assignees' && segments.length === 4 && method === 'POST') {
      return (await addAssignee(user, itemId, body)) as RouteAnswer;
    }
    if (tail === 'assignees' && segments.length === 5 && method === 'DELETE') {
      return (await removeAssignee(user, itemId, at(4))) as RouteAnswer;
    }
    if (tail === 'comments' && method === 'GET') return (await listComments(user, itemId)) as RouteAnswer;
    if (tail === 'comments' && method === 'POST') return (await postComment(user, itemId, body)) as RouteAnswer;
  }

  if (at(1) === 'links' && segments.length === 3 && method === 'DELETE') {
    return (await deleteLink(user, at(2))) as RouteAnswer;
  }

  if (at(1) === 'workspaces' && at(3) === 'workload' && method === 'GET') {
    const workspaceId = at(2);
    const role = await roleInWorkspace(user.id, workspaceId);
    if (!role) throw errors.notFound();
    const from = url.searchParams.get('from');
    if (!from || !isDate(from) || !isMonday(from)) throw errors.invalidField('from');
    return { status: 200, body: await readWorkload(workspaceId, from) };
  }

  if (at(1) === 'exports' && at(3) === 'download' && method === 'GET') {
    await downloadExport(user, res, at(2));
    return null;
  }

  throw errors.notFound();
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  try {
    const raw = await readBody(req);
    const method = req.method ?? 'GET';
    const body =
      method === 'POST' || method === 'PATCH' || method === 'PUT' ? parseJsonBody(raw) : {};
    const answer = await dispatch(req, res, url, body);
    if (!answer) return;
    if (answer.status === 204) sendEmpty(res, 204);
    else sendJson(res, answer.status, answer.body);
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(res, error.status, error.body);
      return;
    }
    process.stderr.write(`api error: ${String((error as Error).stack ?? error)}\n`);
    sendJson(res, 500, { error: 'server_error' });
  }
}
