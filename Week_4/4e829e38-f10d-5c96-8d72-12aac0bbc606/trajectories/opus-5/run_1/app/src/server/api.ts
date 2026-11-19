import { config } from './config.js';
import { newId, query } from './db.js';
import { now as clockNow, toDateString } from './clock.js';
import {
  createPerson,
  createSession,
  dropSession,
  isCoordinator,
  SESSION_COOKIE,
  teamsOf,
  verificationCode,
  verifyPassword,
} from './auth.js';
import {
  ApiError,
  conflict,
  forbidden,
  invalid,
  jsonBody,
  notFound,
  requireAuth,
  sendJson,
  sendNoContent,
  type Ctx,
  type Router,
} from './http.js';
import {
  dateOnly,
  DUE_STATUS_LABEL,
  getFields,
  getSections,
  getStoredValues,
  getTaskRow,
  numberOrNull,
  orderTasks,
  serializeTask,
  type FieldRow,
  type TaskRow,
} from './model.js';
import { compileFormula, FormulaError } from './formula.js';
import { publish } from './events.js';
import {
  addHistory,
  closeUp,
  createTaskRow,
  makeRoomAt,
  nextPosition,
  publishRollups,
  publishTask,
  setStoredValue,
  teamOfProject,
  type TriggerEvent,
} from './taskops.js';
import { runChain } from './rules.js';
import { createSuccessor } from './recurrence.js';
import { projectProgress } from './goals.js';
import { EMAIL_MESSAGE, looksLikeEmail, requireText, text } from './validate.js';
import { sendMailQuietly } from './mail.js';

export interface ProjectRow {
  id: string;
  team_id: string;
  name: string;
}

export async function loadProject(ctx: Ctx, id: string): Promise<ProjectRow> {
  const rows = await query<ProjectRow>(`SELECT id, team_id, name FROM projects WHERE id = $1`, [id]);
  if (rows.length === 0 || !ctx.teams.includes(rows[0].team_id)) throw notFound();
  return rows[0];
}

export async function loadTask(ctx: Ctx, id: string): Promise<{ task: TaskRow; project: ProjectRow }> {
  const task = await getTaskRow(id);
  if (!task) throw notFound();
  const project = await loadProject(ctx, task.project_id);
  return { task, project };
}

export function requireTeam(ctx: Ctx, teamId: string): void {
  if (!ctx.teams.includes(teamId)) throw notFound();
}

async function teamExists(teamId: string): Promise<boolean> {
  const rows = await query(`SELECT 1 FROM teams WHERE id = $1`, [teamId]);
  return rows.length > 0;
}

export async function loadTeam(ctx: Ctx, teamId: string): Promise<string> {
  if (!(await teamExists(teamId))) throw notFound();
  requireTeam(ctx, teamId);
  return teamId;
}

const NESTING_MESSAGE = 'Tasks nest one level only';

/**
 * The one place list nesting is decided. Checked before anything is written so a
 * refusal changes nothing.
 */
async function validateParentChange(task: TaskRow, parentId: string | null): Promise<void> {
  const nestingError = invalid({ parentId: NESTING_MESSAGE });
  if (parentId === null) {
    if (task.parent_id === null) throw nestingError;
    if (!(await getTaskRow(task.parent_id))) throw nestingError;
    return;
  }
  if (task.parent_id !== null) throw nestingError;
  const own = await query(`SELECT 1 FROM tasks WHERE parent_id = $1`, [task.id]);
  if (own.length > 0) throw nestingError;
  const parent = await getTaskRow(parentId);
  if (
    !parent ||
    parent.parent_id !== null ||
    parent.section_id !== task.section_id ||
    parent.position >= task.position
  ) {
    throw nestingError;
  }
}

async function applyParentChange(task: TaskRow, parentId: string | null): Promise<void> {
  const nestingError = invalid({ parentId: NESTING_MESSAGE });
  if (parentId === null) {
    const parent = await getTaskRow(task.parent_id as string);
    if (!parent) throw nestingError;
    await closeUp(task.section_id, task.parent_id);
    await makeRoomAt(parent.section_id, null, parent.position + 1, task.id);
    await query(`UPDATE tasks SET parent_id = NULL, section_id = $1, position = $2 WHERE id = $3`, [
      parent.section_id,
      parent.position + 1,
      task.id,
    ]);
    await closeUp(parent.section_id, null);
    return;
  }
  const position = await nextPosition(task.section_id, parentId);
  const formerSection = task.section_id;
  await query(`UPDATE tasks SET parent_id = $1, position = $2 WHERE id = $3`, [
    parentId,
    position,
    task.id,
  ]);
  await closeUp(formerSection, null);
  await closeUp(formerSection, parentId);
}

async function moveWithin(
  task: TaskRow,
  sectionId: string,
  position: number | null,
): Promise<void> {
  const parentId = task.parent_id;
  const movedSection = sectionId !== task.section_id;
  if (movedSection) {
    await query(`UPDATE tasks SET section_id = $1 WHERE id = $2 OR parent_id = $2`, [
      sectionId,
      task.id,
    ]);
    await closeUp(task.section_id, parentId);
  }
  const target = position ?? (await nextPosition(sectionId, parentId));
  await query(`UPDATE tasks SET position = $1 WHERE id = $2`, [0, task.id]);
  await closeUp(sectionId, parentId);
  await makeRoomAt(sectionId, parentId, target, task.id);
  await query(`UPDATE tasks SET position = $1 WHERE id = $2`, [target, task.id]);
  await closeUp(sectionId, parentId);
}

async function heldByOther(taskId: string, fields: string[], personId: string, at: Date) {
  if (fields.length === 0) return null;
  const rows = await query<{ field: string; name: string }>(
    `SELECT h.field, p.name FROM holds h JOIN people p ON p.id = h.person_id
     WHERE h.task_id = $1 AND h.field = ANY($2) AND h.person_id <> $3 AND h.expires_at > $4`,
    [taskId, fields, personId, at.toISOString()],
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function approvalOf(taskId: string) {
  const rows = await query<{ status: string; approver_id: string; requester_id: string | null }>(
    `SELECT status, approver_id, requester_id FROM approvals WHERE task_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [taskId],
  );
  return rows.length > 0
    ? { status: rows[0].status, approverId: rows[0].approver_id, requesterId: rows[0].requester_id }
    : { status: 'none', approverId: null, requesterId: null };
}

export function registerCoreRoutes(router: Router): void {
  router.add('GET', '/api/config', async (ctx) => {
    sendJson(ctx.res, 200, {
      moveMs: config.moveMs,
      progressMs: config.progressMs,
      toastMs: config.toastMs,
      holdTimeoutMs: config.holdTimeoutMs,
    });
  });

  router.add('POST', '/api/signup', async (ctx) => {
    const body = jsonBody(ctx);
    const name = text(body, 'name').trim();
    if (name === '') throw invalid({ name: 'Enter your name' });
    const email = text(body, 'email').trim().toLowerCase();
    if (!looksLikeEmail(email)) throw invalid({ email: EMAIL_MESSAGE });
    const password = text(body, 'password');
    if (password.length < 8) throw invalid({ password: 'Use at least 8 characters' });
    const existing = await query(`SELECT 1 FROM people WHERE email = $1`, [email]);
    if (existing.length > 0) throw invalid({ email: 'That email already has an account' });
    const code = verificationCode();
    const person = await createPerson({ name, email, password, verified: false, code });
    await sendMailQuietly({
      to: email,
      subject: 'Your Everyweek verification code',
      body: `Your Everyweek verification code is ${code}.\n\nEnter it on the account page to verify your email.`,
    });
    sendJson(ctx.res, 201, { id: person.id, email, verified: false });
  });

  router.add('POST', '/api/verify', async (ctx) => {
    const body = jsonBody(ctx);
    const email = text(body, 'email').trim().toLowerCase();
    const rows = await query<{ id: string; verify_code: string | null }>(
      `SELECT id, verify_code FROM people WHERE email = $1`,
      [email],
    );
    if (rows.length === 0) throw notFound();
    const code = text(body, 'code').trim();
    if (code === '' || rows[0].verify_code !== code) {
      throw invalid({ code: 'That code is not right' });
    }
    await query(`UPDATE people SET verified = true, verify_code = NULL WHERE id = $1`, [rows[0].id]);
    sendJson(ctx.res, 200, { verified: true });
  });

  router.add('POST', '/api/signin', async (ctx) => {
    const body = jsonBody(ctx);
    const email = text(body, 'email').trim().toLowerCase();
    const rows = await query<{ id: string; name: string; email: string; password_hash: string }>(
      `SELECT id, name, email, password_hash FROM people WHERE email = $1`,
      [email],
    );
    if (rows.length === 0 || !verifyPassword(text(body, 'password'), rows[0].password_hash)) {
      throw new ApiError(401, { error: 'invalid_credentials' });
    }
    const token = await createSession(rows[0].id);
    ctx.setCookie(
      `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
    );
    sendJson(ctx.res, 200, { id: rows[0].id, name: rows[0].name, email: rows[0].email });
  });

  router.add('POST', '/api/signout', async (ctx) => {
    const cookies = ctx.req.headers.cookie ?? '';
    const match = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(cookies);
    if (match) await dropSession(match[1]);
    ctx.setCookie(`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    sendNoContent(ctx.res);
  });

  router.add('GET', '/api/me', async (ctx) => {
    if (!ctx.person) {
      sendJson(ctx.res, 200, { id: null, name: null, email: null, verified: false, teams: [] });
      return;
    }
    sendJson(ctx.res, 200, {
      id: ctx.person.id,
      name: ctx.person.name,
      email: ctx.person.email,
      verified: ctx.person.verified,
      teams: await teamsOf(ctx.person.id),
    });
  });

  router.add('POST', '/api/teams/join', async (ctx) => {
    const person = requireAuth(ctx);
    const body = jsonBody(ctx);
    const code = text(body, 'code').trim();
    const rows = await query<{ id: string; name: string }>(
      `SELECT id, name FROM teams WHERE join_code = $1`,
      [code],
    );
    if (rows.length === 0) throw notFound();
    if (!person.verified) throw forbidden('not_verified');
    await query(
      `INSERT INTO memberships (team_id, person_id, role) VALUES ($1, $2, 'member')
       ON CONFLICT (team_id, person_id) DO NOTHING`,
      [rows[0].id, person.id],
    );
    sendJson(ctx.res, 200, { teamId: rows[0].id, name: rows[0].name });
  });

  router.add('GET', '/api/teams/:teamId/projects', async (ctx) => {
    requireAuth(ctx);
    const teamId = await loadTeam(ctx, ctx.params.teamId);
    const rows = await query<{ id: string; name: string }>(
      `SELECT id, name FROM projects WHERE team_id = $1 ORDER BY created_at, name`,
      [teamId],
    );
    const projects = [];
    for (const row of rows) {
      projects.push({ id: row.id, name: row.name, progress: await projectProgress(row.id) });
    }
    sendJson(ctx.res, 200, { projects });
  });

  router.add('POST', '/api/teams/:teamId/projects', async (ctx) => {
    const person = requireAuth(ctx);
    const teamId = await loadTeam(ctx, ctx.params.teamId);
    const body = jsonBody(ctx);
    if (!(await isCoordinator(person.id, teamId))) throw forbidden();
    const name = requireText(body, 'name', 'Enter a project name');
    const raw = body.sections;
    const sectionNames = (Array.isArray(raw) ? raw.map((s) => String(s).trim()) : []).filter(
      (s) => s !== '',
    );
    if (sectionNames.length === 0) throw invalid({ sections: 'Add at least one section' });
    const id = newId();
    const at = await clockNow();
    await query(
      `INSERT INTO projects (id, team_id, name, created_at) VALUES ($1,$2,$3,$4)`,
      [id, teamId, name, at.toISOString()],
    );
    for (let i = 0; i < sectionNames.length; i += 1) {
      await query(`INSERT INTO sections (id, project_id, name, position) VALUES ($1,$2,$3,$4)`, [
        newId(),
        id,
        sectionNames[i],
        i + 1,
      ]);
    }
    await publish({ type: 'project_added', teamId, project: { id, name, progress: 0 } });
    sendJson(ctx.res, 201, { id, name, teamId, progress: 0 });
  });

  router.add('GET', '/api/projects/:id', async (ctx) => {
    requireAuth(ctx);
    const project = await loadProject(ctx, ctx.params.id);
    const members = await query<{ id: string; name: string; email: string }>(
      `SELECT p.id, p.name, p.email FROM people p JOIN memberships m ON m.person_id = p.id
       WHERE m.team_id = $1 ORDER BY p.name`,
      [project.team_id],
    );
    const sections = (await getSections(project.id)).map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
    }));
    const fields = (await getFields(project.id)).map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      options: f.options,
      formula: f.formula,
    }));
    const dependencies = await query<{ from_task: string; to_task: string }>(
      `SELECT d.from_task, d.to_task FROM dependencies d
       JOIN tasks t ON t.id = d.from_task WHERE t.project_id = $1`,
      [project.id],
    );
    sendJson(ctx.res, 200, {
      id: project.id,
      name: project.name,
      teamId: project.team_id,
      progress: await projectProgress(project.id),
      members,
      sections,
      fields,
      dependencies: dependencies.map((d) => ({ from: d.from_task, to: d.to_task })),
    });
  });

  router.add('GET', '/api/projects/:id/tasks', async (ctx) => {
    requireAuth(ctx);
    const project = await loadProject(ctx, ctx.params.id);
    const serverDate = toDateString(await clockNow());
    const sections = await getSections(project.id);
    const fields = await getFields(project.id);
    const rows = await query<TaskRow>(`SELECT * FROM tasks WHERE project_id = $1`, [project.id]);
    const ordered = orderTasks(rows, sections);
    const page = Math.max(1, Number(ctx.url.searchParams.get('page') ?? '1') || 1);
    const slice = ordered.slice((page - 1) * config.pageSize, page * config.pageSize);
    const stored = await getStoredValues(
      slice.map((t) => t.id),
      fields,
    );
    sendJson(ctx.res, 200, {
      tasks: slice.map((t) => serializeTask(t, fields, stored.get(t.id) ?? new Map(), serverDate)),
      page,
      pageSize: config.pageSize,
      total: ordered.length,
    });
  });

  router.add('POST', '/api/projects/:id/tasks', async (ctx) => {
    const person = requireAuth(ctx);
    const project = await loadProject(ctx, ctx.params.id);
    const body = jsonBody(ctx);
    const at = await clockNow();
    const sections = await getSections(project.id);
    const fields = await getFields(project.id);
    const name = requireText(body, 'name', 'Enter a task name');
    let sectionId = sections[0].id;
    if ('section' in body && body.section !== null && body.section !== '') {
      const match = sections.find((s) => s.id === String(body.section));
      if (!match) throw invalid({ section: 'Choose a section of this project' });
      sectionId = match.id;
    }
    const effort = readEffort(body);
    const start = readDate(body, 'start');
    const due = readDate(body, 'due');
    if (start && due && due < start) {
      throw invalid({ due: "Due date can't be before the start date" });
    }
    let parentId: string | null = null;
    if ('parentId' in body && body.parentId !== null && body.parentId !== '') {
      const parent = await getTaskRow(String(body.parentId));
      if (!parent || parent.project_id !== project.id || parent.parent_id !== null) {
        throw invalid({ parentId: 'Tasks nest one level only' });
      }
      parentId = parent.id;
      sectionId = parent.section_id;
    }
    const assigneeId = await readAssignee(body, project.team_id);
    const created = await createTaskRow({
      projectId: project.id,
      sectionId,
      parentId,
      name,
      position: 'position' in body && body.position !== null ? Number(body.position) : null,
      assigneeId,
      start,
      due,
      effort,
      recurrence: 'recurrence' in body && body.recurrence ? String(body.recurrence) : null,
      createdAt: at,
    });
    await writeValues(created.id, fields, body.values);
    await addHistory(created.id, `${person.name} changed Name`, at);
    await publishTask(created.id, toDateString(at));
    await publishRollups(project.team_id);
    await runChain(
      project.id,
      [{ taskId: created.id, kind: 'task_added', key: `added:${created.id}` }],
      at,
    );
    const fresh = (await getTaskRow(created.id)) as TaskRow;
    const stored = await getStoredValues([fresh.id], fields);
    sendJson(
      ctx.res,
      201,
      serializeTask(fresh, fields, stored.get(fresh.id) ?? new Map(), toDateString(at)),
    );
  });

  router.add('GET', '/api/tasks/:id', async (ctx) => {
    requireAuth(ctx);
    const { task, project } = await loadTask(ctx, ctx.params.id);
    const at = await clockNow();
    const fields = await getFields(project.id);
    const stored = await getStoredValues([task.id], fields);
    const attachments = await query<{ id: string; name: string; size: number }>(
      `SELECT id, name, size FROM attachments WHERE task_id = $1 ORDER BY created_at`,
      [task.id],
    );
    const blocks = await query<{ to_task: string }>(
      `SELECT to_task FROM dependencies WHERE from_task = $1`,
      [task.id],
    );
    const blockedBy = await query<{ from_task: string }>(
      `SELECT from_task FROM dependencies WHERE to_task = $1`,
      [task.id],
    );
    const history = await query<{ text: string; created_at: string }>(
      `SELECT text, created_at FROM task_history WHERE task_id = $1 ORDER BY created_at, id`,
      [task.id],
    );
    const viewing = await query<{ id: string; name: string }>(
      `SELECT p.id, p.name FROM presence pr JOIN people p ON p.id = pr.person_id
       WHERE pr.task_id = $1 AND pr.expires_at > $2 ORDER BY p.name`,
      [task.id, at.toISOString()],
    );
    const holds = await query<{ field: string; person_id: string; name: string }>(
      `SELECT h.field, h.person_id, p.name FROM holds h JOIN people p ON p.id = h.person_id
       WHERE h.task_id = $1 AND h.expires_at > $2`,
      [task.id, at.toISOString()],
    );
    sendJson(ctx.res, 200, {
      ...serializeTask(task, fields, stored.get(task.id) ?? new Map(), toDateString(at)),
      attachments,
      approval: await approvalOf(task.id),
      blocks: blocks.map((b) => b.to_task),
      blockedBy: blockedBy.map((b) => b.from_task),
      history: history.map((h) => ({ text: h.text, createdAt: new Date(h.created_at).toISOString() })),
      viewing,
      holds: holds.map((h) => ({ field: h.field, personId: h.person_id, name: h.name })),
    });
  });

  router.add('PATCH', '/api/tasks/:id', async (ctx) => {
    const person = requireAuth(ctx);
    const { task, project } = await loadTask(ctx, ctx.params.id);
    const body = jsonBody(ctx);
    const at = await clockNow();
    const serverDate = toDateString(at);

    const lockedFields = ['name', 'description'].filter((f) => f in body);
    const held = await heldByOther(task.id, lockedFields, person.id, at);
    if (held) throw conflict({ error: 'held_by_other', holder: held.name });
    if ('version' in body && Number(body.version) !== task.version) {
      throw conflict({ error: 'stale_task', latest: task.version });
    }

    const sections = await getSections(project.id);
    const fields = await getFields(project.id);
    const events: TriggerEvent[] = [];
    const changes: string[] = [];

    let nextName = task.name;
    if ('name' in body) {
      nextName = requireText(body, 'name', 'Enter a task name');
    }
    let nextSection = task.section_id;
    if ('section' in body) {
      const match = sections.find((s) => s.id === String(body.section));
      if (!match) throw invalid({ section: 'Choose a section of this project' });
      nextSection = match.id;
    }
    const effort = 'effort' in body ? readEffort(body) : undefined;
    const start = 'start' in body ? readDate(body, 'start') : undefined;
    const due = 'due' in body ? readDate(body, 'due') : undefined;
    const effectiveStart = start === undefined ? dateOnly(task.start_date) : start;
    const effectiveDue = due === undefined ? dateOnly(task.due_date) : due;
    if (effectiveStart && effectiveDue && effectiveDue < effectiveStart) {
      throw invalid({ due: "Due date can't be before the start date" });
    }
    const assigneeId =
      'assigneeId' in body ? await readAssignee(body, project.team_id) : undefined;
    if ('values' in body) validateValues(fields, body.values);
    const nextParent =
      'parentId' in body
        ? body.parentId === null || body.parentId === ''
          ? null
          : String(body.parentId)
        : undefined;
    if (nextParent !== undefined) await validateParentChange(task, nextParent);

    const version = task.version + 1;
    await query(`UPDATE tasks SET version = $1 WHERE id = $2`, [version, task.id]);

    if ('name' in body && nextName !== task.name) {
      await query(`UPDATE tasks SET name = $1 WHERE id = $2`, [nextName, task.id]);
      changes.push('Name');
    }
    if ('description' in body) {
      const description = text(body, 'description');
      if (description !== task.description) {
        await query(`UPDATE tasks SET description = $1 WHERE id = $2`, [description, task.id]);
        changes.push('Description');
      }
    }
    if (nextParent !== undefined) {
      await applyParentChange(task, nextParent);
      changes.push('Parent');
    } else if ('section' in body || 'position' in body) {
      const position = 'position' in body && body.position !== null ? Number(body.position) : null;
      if (nextSection !== task.section_id || position !== null) {
        await moveWithin(task, nextSection, position);
        if (nextSection !== task.section_id) {
          changes.push('Section');
          events.push({
            taskId: task.id,
            kind: 'moved_to_section',
            section: nextSection,
            key: `t${task.id}:v${version}:section:${nextSection}`,
          });
        } else {
          changes.push('Position');
        }
      }
    }
    if (assigneeId !== undefined && assigneeId !== task.assignee_id) {
      await query(`UPDATE tasks SET assignee_id = $1 WHERE id = $2`, [assigneeId, task.id]);
      changes.push('Assignee');
      events.push({
        taskId: task.id,
        kind: 'field_changed',
        field: 'assignee',
        value: assigneeId,
        key: `t${task.id}:v${version}:assignee:${assigneeId}`,
      });
    }
    if (start !== undefined && start !== dateOnly(task.start_date)) {
      await query(`UPDATE tasks SET start_date = $1 WHERE id = $2`, [start, task.id]);
      changes.push('Start');
      events.push({
        taskId: task.id,
        kind: 'field_changed',
        field: 'start',
        value: start,
        key: `t${task.id}:v${version}:start:${start}`,
      });
    }
    if (due !== undefined && due !== dateOnly(task.due_date)) {
      await query(`UPDATE tasks SET due_date = $1 WHERE id = $2`, [due, task.id]);
      changes.push('Due');
      events.push({
        taskId: task.id,
        kind: 'field_changed',
        field: 'due',
        value: due,
        key: `t${task.id}:v${version}:due:${due}`,
      });
    }
    if (effort !== undefined && effort !== numberOrNull(task.effort)) {
      await query(`UPDATE tasks SET effort = $1 WHERE id = $2`, [effort, task.id]);
      changes.push('Effort');
      events.push({
        taskId: task.id,
        kind: 'field_changed',
        field: 'effort',
        value: effort,
        key: `t${task.id}:v${version}:effort:${effort}`,
      });
    }
    if ('recurrence' in body) {
      const recurrence = body.recurrence === null || body.recurrence === '' ? null : String(body.recurrence);
      await query(`UPDATE tasks SET recurrence = $1 WHERE id = $2`, [recurrence, task.id]);
      changes.push('Repeat');
    }
    if ('values' in body && body.values && typeof body.values === 'object') {
      const stored = await getStoredValues([task.id], fields);
      const current = stored.get(task.id) ?? new Map();
      for (const [key, value] of Object.entries(body.values as Record<string, unknown>)) {
        const field = fields.find((f) => f.name === key);
        if (!field || field.type === 'formula') continue;
        const before = current.get(field.name) ?? null;
        await setStoredValue(task.id, field.id, value === '' ? null : value);
        if (JSON.stringify(before ?? null) !== JSON.stringify(value === '' ? null : value)) {
          changes.push(field.name);
          events.push({
            taskId: task.id,
            kind: 'field_changed',
            field: field.id,
            value,
            key: `t${task.id}:v${version}:${field.id}:${JSON.stringify(value)}`,
          });
        }
      }
    }

    let successorDue: string | null = null;
    if ('completed' in body) {
      const completed = Boolean(body.completed);
      if (completed !== task.completed) {
        await query(`UPDATE tasks SET completed = $1, completed_on = $2 WHERE id = $3`, [
          completed,
          completed ? serverDate : null,
          task.id,
        ]);
        changes.push('Completed');
        if (completed) {
          const fresh = (await getTaskRow(task.id)) as TaskRow;
          const successor = await createSuccessor(fresh, at, 'completed');
          if (successor) successorDue = successor.due;
        }
      }
    }

    for (const change of changes) {
      await addHistory(task.id, `${person.name} changed ${change}`, at);
    }
    await publishTask(task.id, serverDate);
    if (changes.some((change) => ['Section', 'Position', 'Parent'].includes(change))) {
      const touched = [...new Set([task.section_id, nextSection])];
      const siblings = await query<{ id: string }>(
        `SELECT id FROM tasks WHERE section_id = ANY($1) AND id <> $2`,
        [touched, task.id],
      );
      for (const sibling of siblings) await publishTask(sibling.id, serverDate);
    }
    await publishRollups(project.team_id);
    if (events.length > 0) await runChain(project.id, events, at);

    const fresh = (await getTaskRow(task.id)) as TaskRow;
    const stored = await getStoredValues([fresh.id], fields);
    sendJson(ctx.res, 200, {
      ...serializeTask(fresh, fields, stored.get(fresh.id) ?? new Map(), serverDate),
      successorDue,
    });
  });

  router.add('DELETE', '/api/tasks/:id', async (ctx) => {
    requireAuth(ctx);
    const { task, project } = await loadTask(ctx, ctx.params.id);
    await query(`DELETE FROM tasks WHERE id = $1 OR parent_id = $1`, [task.id]);
    await closeUp(task.section_id, task.parent_id);
    await publish({
      type: 'task_deleted',
      teamId: project.team_id,
      projectId: project.id,
      taskId: task.id,
    });
    await publishRollups(project.team_id);
    sendNoContent(ctx.res);
  });

  router.add('POST', '/api/projects/:id/sections', async (ctx) => {
    requireAuth(ctx);
    const project = await loadProject(ctx, ctx.params.id);
    const body = jsonBody(ctx);
    const name = requireText(body, 'name', 'Enter a section name');
    const sections = await getSections(project.id);
    if (sections.some((s) => s.name === name)) {
      throw invalid({ name: 'A section with that name already exists' });
    }
    const id = newId();
    const position = sections.length + 1;
    await query(`INSERT INTO sections (id, project_id, name, position) VALUES ($1,$2,$3,$4)`, [
      id,
      project.id,
      name,
      position,
    ]);
    await publish({
      type: 'section_added',
      teamId: project.team_id,
      projectId: project.id,
      section: { id, name, position },
    });
    sendJson(ctx.res, 201, { id, name, position });
  });

  router.add('DELETE', '/api/sections/:id', async (ctx) => {
    requireAuth(ctx);
    const rows = await query<{ id: string; project_id: string }>(
      `SELECT id, project_id FROM sections WHERE id = $1`,
      [ctx.params.id],
    );
    if (rows.length === 0) throw notFound();
    const project = await loadProject(ctx, rows[0].project_id);
    const sections = await getSections(project.id);
    if (sections.length <= 1) {
      throw invalid({ section: 'A project needs at least one section' });
    }
    await query(`DELETE FROM sections WHERE id = $1`, [rows[0].id]);
    const left = await getSections(project.id);
    for (let i = 0; i < left.length; i += 1) {
      await query(`UPDATE sections SET position = $1 WHERE id = $2`, [i + 1, left[i].id]);
    }
    await publish({
      type: 'section_deleted',
      teamId: project.team_id,
      projectId: project.id,
      sectionId: rows[0].id,
    });
    await publishRollups(project.team_id);
    sendNoContent(ctx.res);
  });

  router.add('POST', '/api/projects/:id/fields', async (ctx) => {
    requireAuth(ctx);
    const project = await loadProject(ctx, ctx.params.id);
    const body = jsonBody(ctx);
    const name = requireText(body, 'name', 'Enter a field name');
    const fields = await getFields(project.id);
    if (fields.some((f) => f.name === name)) {
      throw invalid({ name: 'A field with that name already exists' });
    }
    const type = text(body, 'type');
    const allowed = ['text', 'number', 'date', 'single_select', 'multi_select', 'formula'];
    if (!allowed.includes(type)) throw invalid({ type: 'Choose a field type' });
    const options = Array.isArray(body.options)
      ? body.options.map((o) => String(o).trim()).filter((o) => o !== '')
      : typeof body.options === 'string'
        ? body.options
            .split(',')
            .map((o) => o.trim())
            .filter((o) => o !== '')
        : [];
    let formula: string | null = null;
    if (type === 'formula') {
      formula = text(body, 'formula');
      try {
        compileFormula(formula, fields, name);
      } catch (err) {
        if (err instanceof FormulaError) throw invalid({ formula: err.message });
        throw err;
      }
    }
    const id = newId();
    await query(
      `INSERT INTO fields (id, project_id, name, type, options, formula, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, project.id, name, type, JSON.stringify(options), formula, fields.length + 1],
    );
    const field = { id, name, type, options, formula };
    await publish({
      type: 'field_upserted',
      teamId: project.team_id,
      projectId: project.id,
      field,
    });
    sendJson(ctx.res, 201, field);
  });

  router.add('PATCH', '/api/fields/:id', async (ctx) => {
    requireAuth(ctx);
    const rows = await query<FieldRow>(`SELECT * FROM fields WHERE id = $1`, [ctx.params.id]);
    if (rows.length === 0) throw notFound();
    const field = rows[0];
    const project = await loadProject(ctx, field.project_id);
    const body = jsonBody(ctx);
    const fields = await getFields(project.id);
    let name = field.name;
    if ('name' in body) {
      name = requireText(body, 'name', 'Enter a field name');
      if (fields.some((f) => f.name === name && f.id !== field.id)) {
        throw invalid({ name: 'A field with that name already exists' });
      }
    }
    let formula = field.formula;
    if ('formula' in body) {
      const source = text(body, 'formula');
      try {
        compileFormula(source, fields, name);
      } catch (err) {
        if (err instanceof FormulaError) throw invalid({ formula: err.message });
        throw err;
      }
      formula = source;
    }
    await query(`UPDATE fields SET name = $1, formula = $2 WHERE id = $3`, [
      name,
      formula,
      field.id,
    ]);
    const updated = { id: field.id, name, type: field.type, options: field.options, formula };
    await publish({
      type: 'field_upserted',
      teamId: project.team_id,
      projectId: project.id,
      field: updated,
      recompute: true,
    });
    sendJson(ctx.res, 200, updated);
  });

  router.add('DELETE', '/api/fields/:id', async (ctx) => {
    requireAuth(ctx);
    const rows = await query<FieldRow>(`SELECT * FROM fields WHERE id = $1`, [ctx.params.id]);
    if (rows.length === 0) throw notFound();
    const project = await loadProject(ctx, rows[0].project_id);
    await query(`DELETE FROM fields WHERE id = $1`, [rows[0].id]);
    await publish({
      type: 'field_deleted',
      teamId: project.team_id,
      projectId: project.id,
      fieldId: rows[0].id,
    });
    sendNoContent(ctx.res);
  });

  router.add('POST', '/api/tasks/:id/dependencies', async (ctx) => {
    requireAuth(ctx);
    const { task, project } = await loadTask(ctx, ctx.params.id);
    const body = jsonBody(ctx);
    const target = text(body, 'blocks');
    const loopMessage = { blocks: "A task can't block itself or create a loop" };
    if (target === task.id) throw invalid(loopMessage);
    const other = await getTaskRow(target);
    if (!other || other.project_id !== project.id) throw invalid(loopMessage);
    if (await reaches(target, task.id)) throw invalid(loopMessage);
    await query(
      `INSERT INTO dependencies (from_task, to_task) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [task.id, target],
    );
    await publish({
      type: 'dependency_added',
      teamId: project.team_id,
      projectId: project.id,
      from: task.id,
      to: target,
    });
    sendJson(ctx.res, 201, { from: task.id, to: target });
  });

  router.add('POST', '/api/tasks/:id/hold', async (ctx) => {
    const person = requireAuth(ctx);
    const { task, project } = await loadTask(ctx, ctx.params.id);
    const body = jsonBody(ctx);
    const at = await clockNow();
    const field = text(body, 'field');
    const existing = await heldByOther(task.id, [field], person.id, at);
    if (existing) throw conflict({ error: 'held_by_other', holder: existing.name });
    if (field !== 'name' && field !== 'description') {
      throw invalid({ field: 'Choose name or description' });
    }
    const expiresAt = new Date(at.getTime() + config.holdTimeoutMs);
    await query(
      `INSERT INTO holds (task_id, field, person_id, expires_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (task_id, field) DO UPDATE SET person_id = EXCLUDED.person_id, expires_at = EXCLUDED.expires_at`,
      [task.id, field, person.id, expiresAt.toISOString()],
    );
    await publish({
      type: 'hold_changed',
      teamId: project.team_id,
      taskId: task.id,
      field,
      holder: { id: person.id, name: person.name },
    });
    sendJson(ctx.res, 200, {
      field,
      holder: { id: person.id, name: person.name },
      expiresAt: expiresAt.toISOString(),
    });
  });

  router.add('DELETE', '/api/tasks/:id/hold', async (ctx) => {
    const person = requireAuth(ctx);
    const { task, project } = await loadTask(ctx, ctx.params.id);
    const body = jsonBody(ctx);
    const field = text(body, 'field');
    await query(`DELETE FROM holds WHERE task_id = $1 AND field = $2 AND person_id = $3`, [
      task.id,
      field,
      person.id,
    ]);
    await publish({
      type: 'hold_changed',
      teamId: project.team_id,
      taskId: task.id,
      field,
      holder: null,
    });
    sendNoContent(ctx.res);
  });

  router.add('POST', '/api/tasks/:id/presence', async (ctx) => {
    const person = requireAuth(ctx);
    const { task, project } = await loadTask(ctx, ctx.params.id);
    const body = jsonBody(ctx);
    const at = await clockNow();
    if (body.leaving === true) {
      await query(`DELETE FROM presence WHERE task_id = $1 AND person_id = $2`, [
        task.id,
        person.id,
      ]);
    } else {
      await query(
        `INSERT INTO presence (task_id, person_id, expires_at) VALUES ($1,$2,$3)
         ON CONFLICT (task_id, person_id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
        [task.id, person.id, new Date(at.getTime() + config.holdTimeoutMs).toISOString()],
      );
    }
    const viewing = await query<{ id: string; name: string }>(
      `SELECT p.id, p.name FROM presence pr JOIN people p ON p.id = pr.person_id
       WHERE pr.task_id = $1 AND pr.expires_at > $2 ORDER BY p.name`,
      [task.id, at.toISOString()],
    );
    await publish({ type: 'presence_changed', teamId: project.team_id, taskId: task.id, viewing });
    sendJson(ctx.res, 200, { viewing });
  });

  router.add('GET', '/api/my-work', async (ctx) => {
    const person = requireAuth(ctx);
    const at = await clockNow();
    const serverDate = toDateString(at);
    const rows = await query<TaskRow & { project_name: string }>(
      `SELECT t.*, pr.name AS project_name FROM tasks t
       JOIN projects pr ON pr.id = t.project_id
       JOIN memberships m ON m.team_id = pr.team_id
       WHERE m.person_id = $1 AND t.assignee_id = $1 AND t.completed = false
       ORDER BY t.due_date NULLS LAST, t.name`,
      [person.id],
    );
    const groups: Record<string, { label: string; tasks: unknown[] }> = {};
    for (const key of ['overdue', 'today', 'later', 'none']) {
      groups[key] = { label: DUE_STATUS_LABEL[key as keyof typeof DUE_STATUS_LABEL], tasks: [] };
    }
    for (const row of rows) {
      const status = row.completed || !row.due_date
        ? 'none'
        : dateOnly(row.due_date)! < serverDate
          ? 'overdue'
          : dateOnly(row.due_date) === serverDate
            ? 'today'
            : 'later';
      groups[status].tasks.push({
        id: row.id,
        name: row.name,
        projectId: row.project_id,
        projectName: row.project_name,
        due: dateOnly(row.due_date),
        dueStatus: status,
      });
    }
    sendJson(ctx.res, 200, {
      serverDate,
      groups: Object.entries(groups)
        .filter(([, g]) => g.tasks.length > 0)
        .map(([key, g]) => ({ key, label: g.label, tasks: g.tasks })),
    });
  });
}

async function reaches(from: string, target: string): Promise<boolean> {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const rows = await query<{ to_task: string }>(
      `SELECT to_task FROM dependencies WHERE from_task = $1`,
      [current],
    );
    for (const row of rows) stack.push(row.to_task);
  }
  return false;
}

function readEffort(body: Record<string, unknown>): number | null {
  const raw = body.effort;
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw invalid({ effort: 'Effort must be 0 or more hours' });
  }
  return value;
}

function readDate(body: Record<string, unknown>, key: 'start' | 'due'): string | null {
  const raw = body[key];
  if (raw === null || raw === undefined || raw === '') return null;
  const value = String(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalid({ [key]: 'Enter a date like 2026-03-02' });
  }
  return value;
}

async function readAssignee(
  body: Record<string, unknown>,
  teamId: string,
): Promise<string | null> {
  const raw = body.assigneeId;
  if (raw === null || raw === undefined || raw === '') return null;
  const rows = await query(`SELECT 1 FROM memberships WHERE team_id = $1 AND person_id = $2`, [
    teamId,
    String(raw),
  ]);
  if (rows.length === 0) throw invalid({ assigneeId: 'Choose a member of this team' });
  return String(raw);
}

function validateValues(fields: FieldRow[], raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const field = fields.find((f) => f.name === key);
    if (!field) continue;
    if (field.type === 'single_select' && value !== null && value !== '') {
      if (!field.options.includes(String(value))) {
        throw invalid({ values: `Choose an option of ${field.name}` });
      }
    }
    if (field.type === 'multi_select' && Array.isArray(value)) {
      for (const option of value) {
        if (!field.options.includes(String(option))) {
          throw invalid({ values: `Choose an option of ${field.name}` });
        }
      }
    }
  }
}

async function writeValues(taskId: string, fields: FieldRow[], raw: unknown): Promise<void> {
  if (!raw || typeof raw !== 'object') return;
  validateValues(fields, raw);
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const field = fields.find((f) => f.name === key);
    if (!field || field.type === 'formula') continue;
    await setStoredValue(taskId, field.id, value === '' ? null : value);
  }
}
