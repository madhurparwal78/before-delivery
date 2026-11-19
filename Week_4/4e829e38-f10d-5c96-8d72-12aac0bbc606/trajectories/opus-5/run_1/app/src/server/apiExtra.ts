import { config } from './config.js';
import { newId, query } from './db.js';
import { now as clockNow, toDateString } from './clock.js';
import {
  ApiError,
  conflict,
  forbidden,
  invalid,
  jsonBody,
  notFound,
  parseMultipart,
  requireAuth,
  sendJson,
  storageUnavailable,
  type Router,
} from './http.js';
import { getFields, getSections, orderTasks, type TaskRow } from './model.js';
import { publish, subscribe } from './events.js';
import { approvalOf, loadProject, loadTask, loadTeam } from './api.js';
import { publishInbox, runChain } from './rules.js';
import { createTaskRow, publishRollups, publishTask, setStoredValue } from './taskops.js';
import { teamGoals, displayPercent } from './goals.js';
import { teamWorkload } from './workload.js';
import { getObject, putObject, headObject, StorageUnavailable } from './s3.js';
import { requireText, text, looksLikeEmail, EMAIL_MESSAGE } from './validate.js';
import { isCoordinator, teamsOf } from './auth.js';

const APPROVAL_STATUS: Record<string, string> = {
  approve: 'approved',
  request_changes: 'changes_requested',
  reject: 'rejected',
};

const DECISION_ANNOUNCEMENT: Record<string, string> = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
  rejected: 'Rejected',
};

const DECISION_ITEM: Record<string, string> = {
  approved: 'approved',
  changes_requested: 'requested changes on',
  rejected: 'rejected',
};

export function registerExtraRoutes(router: Router): void {
  router.add('GET', '/api/projects/:id/rules', async (ctx) => {
    requireAuth(ctx);
    const project = await loadProject(ctx, ctx.params.id);
    const rules = await query(
      `SELECT id, name, position, trigger, condition, action FROM rules
       WHERE project_id = $1 ORDER BY position, created_at`,
      [project.id],
    );
    sendJson(ctx.res, 200, { rules });
  });

  router.add('POST', '/api/projects/:id/rules', async (ctx) => {
    const person = requireAuth(ctx);
    const project = await loadProject(ctx, ctx.params.id);
    const body = jsonBody(ctx);
    if (!(await isCoordinator(person.id, project.team_id))) throw forbidden();
    const name = requireText(body, 'name', 'Enter a rule name');
    const trigger = body.trigger;
    if (!trigger || typeof trigger !== 'object' || !('type' in trigger)) {
      throw invalid({ trigger: 'Choose when the rule runs' });
    }
    const action = body.action;
    if (!action || typeof action !== 'object' || !('type' in action)) {
      throw invalid({ action: 'Choose what happens' });
    }
    const rows = await query<{ max: number | null }>(
      `SELECT MAX(position) AS max FROM rules WHERE project_id = $1`,
      [project.id],
    );
    const id = newId();
    const position = (rows[0].max ?? 0) + 1;
    const at = await clockNow();
    await query(
      `INSERT INTO rules (id, project_id, name, position, trigger, condition, action, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        project.id,
        name,
        position,
        JSON.stringify(trigger),
        body.condition ? JSON.stringify(body.condition) : null,
        JSON.stringify(action),
        at.toISOString(),
      ],
    );
    const rule = { id, name, position, trigger, condition: body.condition ?? null, action };
    await publish({ type: 'rule_added', teamId: project.team_id, projectId: project.id, rule });
    sendJson(ctx.res, 201, rule);
  });

  router.add('GET', '/api/tasks/:id/rule-runs', async (ctx) => {
    requireAuth(ctx);
    const { task } = await loadTask(ctx, ctx.params.id);
    const runs = await query<{
      id: string;
      depth: number;
      summary: string;
      detail: string;
      created_at: string;
    }>(
      `SELECT id, depth, summary, detail, created_at FROM rule_runs
       WHERE task_id = $1 ORDER BY seq`,
      [task.id],
    );
    sendJson(ctx.res, 200, {
      runs: runs.map((r) => ({
        id: r.id,
        depth: r.depth,
        summary: r.summary,
        detail: r.detail,
        createdAt: new Date(r.created_at).toISOString(),
      })),
    });
  });

  router.add('GET', '/api/teams/:teamId/goals', async (ctx) => {
    requireAuth(ctx);
    const teamId = await loadTeam(ctx, ctx.params.teamId);
    sendJson(ctx.res, 200, { goals: await teamGoals(teamId) });
  });

  router.add('POST', '/api/teams/:teamId/goals', async (ctx) => {
    const person = requireAuth(ctx);
    const teamId = await loadTeam(ctx, ctx.params.teamId);
    const body = jsonBody(ctx);
    const name = requireText(body, 'name', 'Enter a goal name');
    const weight = readWeight(body);
    const manual = readManual(body);
    let parentId: string | null = null;
    if (body.parentId !== null && body.parentId !== undefined && body.parentId !== '') {
      const rows = await query(`SELECT 1 FROM goals WHERE id = $1 AND team_id = $2`, [
        String(body.parentId),
        teamId,
      ]);
      if (rows.length === 0) throw invalid({ parentId: 'Choose a goal of this team' });
      parentId = String(body.parentId);
    }
    const id = newId();
    const at = await clockNow();
    await query(
      `INSERT INTO goals (id, team_id, name, parent_id, weight, manual_value, owner_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, teamId, name, parentId, weight ?? 1, manual ?? 0, person.id, at.toISOString()],
    );
    await publish({ type: 'goals_changed', teamId });
    sendJson(ctx.res, 201, {
      id,
      name,
      parentId,
      weight: weight ?? 1,
      manualValue: manual ?? 0,
      ownerId: person.id,
      progress: manual ?? 0,
      percent: displayPercent(manual ?? 0),
      projects: [],
    });
  });

  router.add('PATCH', '/api/goals/:id', async (ctx) => {
    const person = requireAuth(ctx);
    const rows = await query<{ id: string; team_id: string; owner_id: string | null }>(
      `SELECT id, team_id, owner_id FROM goals WHERE id = $1`,
      [ctx.params.id],
    );
    if (rows.length === 0) throw notFound();
    const goal = rows[0];
    await loadTeam(ctx, goal.team_id);
    const body = jsonBody(ctx);
    if (goal.owner_id !== person.id && !(await isCoordinator(person.id, goal.team_id))) {
      throw forbidden();
    }
    const updates: string[] = [];
    const params: unknown[] = [];
    if ('name' in body) {
      params.push(requireText(body, 'name', 'Enter a goal name'));
      updates.push(`name = $${params.length}`);
    }
    if ('weight' in body) {
      params.push(readWeight(body));
      updates.push(`weight = $${params.length}`);
    }
    if ('manualValue' in body) {
      params.push(readManual(body));
      updates.push(`manual_value = $${params.length}`);
    }
    if (updates.length > 0) {
      params.push(goal.id);
      await query(`UPDATE goals SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
    }
    await publish({ type: 'goals_changed', teamId: goal.team_id });
    const all = await teamGoals(goal.team_id);
    sendJson(ctx.res, 200, all.find((g) => g.id === goal.id));
  });

  router.add('POST', '/api/goals/:id/projects', async (ctx) => {
    const person = requireAuth(ctx);
    const rows = await query<{ id: string; team_id: string; owner_id: string | null }>(
      `SELECT id, team_id, owner_id FROM goals WHERE id = $1`,
      [ctx.params.id],
    );
    if (rows.length === 0) throw notFound();
    const goal = rows[0];
    await loadTeam(ctx, goal.team_id);
    const body = jsonBody(ctx);
    if (goal.owner_id !== person.id && !(await isCoordinator(person.id, goal.team_id))) {
      throw forbidden();
    }
    const project = await loadProject(ctx, text(body, 'projectId'));
    const weight = readWeight(body) ?? 1;
    await query(
      `INSERT INTO goal_projects (goal_id, project_id, weight) VALUES ($1,$2,$3)
       ON CONFLICT (goal_id, project_id) DO UPDATE SET weight = EXCLUDED.weight`,
      [goal.id, project.id, weight],
    );
    await publish({ type: 'goals_changed', teamId: goal.team_id });
    sendJson(ctx.res, 201, { goalId: goal.id, projectId: project.id, weight });
  });

  router.add('GET', '/api/teams/:teamId/workload', async (ctx) => {
    requireAuth(ctx);
    const teamId = await loadTeam(ctx, ctx.params.teamId);
    const at = await clockNow();
    const from = ctx.url.searchParams.get('from') ?? toDateString(at);
    sendJson(ctx.res, 200, await teamWorkload(teamId, from));
  });

  router.add('PUT', '/api/teams/:teamId/capacities', async (ctx) => {
    const person = requireAuth(ctx);
    const teamId = await loadTeam(ctx, ctx.params.teamId);
    const body = jsonBody(ctx);
    if (!(await isCoordinator(person.id, teamId))) throw forbidden();
    const weekday = text(body, 'weekday');
    if (!['mon', 'tue', 'wed', 'thu', 'fri'].includes(weekday)) {
      throw invalid({ weekday: 'Choose a weekday from mon to fri' });
    }
    const hours = Number(body.hours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
      throw invalid({ hours: 'Hours must be from 0 to 24' });
    }
    await query(
      `INSERT INTO capacities (team_id, person_id, weekday, hours) VALUES ($1,$2,$3,$4)
       ON CONFLICT (team_id, person_id, weekday) DO UPDATE SET hours = EXCLUDED.hours`,
      [teamId, text(body, 'personId'), weekday, hours],
    );
    await publish({ type: 'workload_changed', teamId });
    sendJson(ctx.res, 200, { personId: text(body, 'personId'), weekday, hours });
  });

  router.add('POST', '/api/projects/:id/forms', async (ctx) => {
    const person = requireAuth(ctx);
    const project = await loadProject(ctx, ctx.params.id);
    const body = jsonBody(ctx);
    if (!(await isCoordinator(person.id, project.team_id))) throw forbidden();
    const slug = text(body, 'slug').trim();
    if (!/^[a-z0-9-]+$/.test(slug)) {
      throw invalid({ slug: 'Use lowercase letters, digits and hyphens' });
    }
    const taken = await query(`SELECT 1 FROM forms WHERE slug = $1`, [slug]);
    if (taken.length > 0) throw invalid({ slug: 'That form address is taken' });
    const sections = await getSections(project.id);
    const section = sections.find((s) => s.id === text(body, 'section'));
    if (!section) throw invalid({ section: 'Choose a section of this project' });
    const title = requireText(body, 'title', 'Enter a form title');
    const id = newId();
    await query(
      `INSERT INTO forms (id, project_id, section_id, slug, title) VALUES ($1,$2,$3,$4,$5)`,
      [id, project.id, section.id, slug, title],
    );
    await ensureRequestedByField(project.id);
    sendJson(ctx.res, 201, { id, slug, title, section: section.id });
  });

  router.add('GET', '/api/forms/:slug', async (ctx) => {
    const rows = await query<{ title: string; project_id: string }>(
      `SELECT title, project_id FROM forms WHERE slug = $1`,
      [ctx.params.slug],
    );
    if (rows.length === 0) throw notFound();
    const fields = await getFields(rows[0].project_id);
    const category = fields.find((f) => f.name === 'Category');
    sendJson(ctx.res, 200, { title: rows[0].title, categories: category ? category.options : [] });
  });

  router.add('POST', '/api/forms/:slug/submissions', async (ctx) => {
    const rows = await query<{ id: string; project_id: string; section_id: string }>(
      `SELECT id, project_id, section_id FROM forms WHERE slug = $1`,
      [ctx.params.slug],
    );
    if (rows.length === 0) throw notFound();
    const form = rows[0];
    const body = jsonBody(ctx);
    const at = await clockNow();
    const serverDate = toDateString(at);

    const title = text(body, 'title').trim();
    if (title === '') throw invalid({ title: 'Enter a request title' });
    if (title.length > 120) {
      throw invalid({ title: 'Request title must be 120 characters or fewer' });
    }
    const neededBy = text(body, 'neededBy').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(neededBy) || neededBy < serverDate) {
      throw invalid({ neededBy: 'Enter a date today or later' });
    }
    const email = text(body, 'email').trim();
    if (!looksLikeEmail(email)) throw invalid({ email: EMAIL_MESSAGE });
    const fields = await getFields(form.project_id);
    const categoryField = fields.find((f) => f.name === 'Category');
    const category = text(body, 'category').trim();
    if (category !== '' && (!categoryField || !categoryField.options.includes(category))) {
      throw invalid({ category: 'Choose a category from the list' });
    }

    const project = await query<{ team_id: string }>(`SELECT team_id FROM projects WHERE id = $1`, [
      form.project_id,
    ]);
    const teamId = project[0].team_id;
    const counter = await query<{ reference_counter: number }>(
      `UPDATE teams SET reference_counter = reference_counter + 1 WHERE id = $1
       RETURNING reference_counter`,
      [teamId],
    );
    const reference = `REQ-${String(counter[0].reference_counter).padStart(4, '0')}`;

    
    const created = await createTaskRow({
      projectId: form.project_id,
      sectionId: form.section_id,
      parentId: null,
      name: title,
      description: text(body, 'details'),
      due: neededBy,
      createdAt: at,
    });
    const requestedBy = await ensureRequestedByField(form.project_id);
    
    await setStoredValue(created.id, requestedBy, email);
    if (category !== '' && categoryField) {
      await setStoredValue(created.id, categoryField.id, category);
    }
    await publishTask(created.id, serverDate);
    await publishRollups(teamId);
    await runChain(
      form.project_id,
      [{ taskId: created.id, kind: 'task_added', key: `added:${created.id}` }],
      at,
    );
    sendJson(ctx.res, 201, { reference, taskId: created.id });
  });

  router.add('GET', '/api/inbox', async (ctx) => {
    const person = requireAuth(ctx);
    const items = await query<{
      id: string;
      text: string;
      task_id: string | null;
      kind: string;
      read: boolean;
      created_at: string;
    }>(
      `SELECT id, text, task_id, kind, read, created_at FROM inbox_items
       WHERE person_id = $1 AND archived = false ORDER BY created_at DESC, id DESC`,
      [person.id],
    );
    sendJson(ctx.res, 200, {
      unread: items.filter((i) => !i.read).length,
      items: items.map((i) => ({
        id: i.id,
        text: i.text,
        taskId: i.task_id,
        kind: i.kind,
        read: i.read,
        createdAt: new Date(i.created_at).toISOString(),
      })),
    });
  });

  router.add('PATCH', '/api/inbox/:id', async (ctx) => {
    const person = requireAuth(ctx);
    const rows = await query<{ id: string; person_id: string }>(
      `SELECT id, person_id FROM inbox_items WHERE id = $1`,
      [ctx.params.id],
    );
    if (rows.length === 0 || rows[0].person_id !== person.id) throw notFound();
    const body = jsonBody(ctx);
    if (body.archived === true) {
      await query(`UPDATE inbox_items SET archived = true WHERE id = $1`, [rows[0].id]);
    } else if ('read' in body) {
      await query(`UPDATE inbox_items SET read = $1 WHERE id = $2`, [
        Boolean(body.read),
        rows[0].id,
      ]);
    }
    const updated = await query<{
      id: string;
      text: string;
      task_id: string | null;
      kind: string;
      read: boolean;
      archived: boolean;
    }>(`SELECT id, text, task_id, kind, read, archived FROM inbox_items WHERE id = $1`, [
      rows[0].id,
    ]);
    const unread = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM inbox_items WHERE person_id = $1 AND read = false AND archived = false`,
      [person.id],
    );
    await publish({
      type: 'inbox_updated',
      teamId: null,
      personId: person.id,
      unread: Number(unread[0].count),
    });
    sendJson(ctx.res, 200, {
      id: updated[0].id,
      text: updated[0].text,
      taskId: updated[0].task_id,
      kind: updated[0].kind,
      read: updated[0].read,
      archived: updated[0].archived,
      unread: Number(unread[0].count),
    });
  });

  router.add('POST', '/api/tasks/:id/approval', async (ctx) => {
    const person = requireAuth(ctx);
    const { task, project } = await loadTask(ctx, ctx.params.id);
    const body = jsonBody(ctx);
    const latest = await approvalOf(task.id);
    if (latest.status === 'requested') throw conflict({ error: 'already_requested' });
    const approverId = text(body, 'approverId');
    const member = await query(
      `SELECT 1 FROM memberships WHERE team_id = $1 AND person_id = $2`,
      [project.team_id, approverId],
    );
    if (member.length === 0) throw invalid({ approverId: 'Choose a member of this team' });
    const at = await clockNow();
    const id = newId();
    await query(
      `INSERT INTO approvals (id, task_id, approver_id, requester_id, status, created_at)
       VALUES ($1,$2,$3,$4,'requested',$5)`,
      [id, task.id, approverId, person.id, at.toISOString()],
    );
    const itemId = newId();
    const itemText = `Approval requested: ${task.name}`;
    await query(
      `INSERT INTO inbox_items (id, person_id, team_id, text, task_id, kind, created_at)
       VALUES ($1,$2,$3,$4,$5,'approval',$6)`,
      [itemId, approverId, project.team_id, itemText, task.id, at.toISOString()],
    );
    await publishInbox(approverId, project.team_id, itemId, itemText, task.id, 'approval', at);
    await publish({
      type: 'approval_changed',
      teamId: project.team_id,
      projectId: project.id,
      taskId: task.id,
      approval: { status: 'requested', approverId },
    });
    sendJson(ctx.res, 201, { status: 'requested', approverId });
  });

  router.add('POST', '/api/tasks/:id/decision', async (ctx) => {
    const person = requireAuth(ctx);
    const { task, project } = await loadTask(ctx, ctx.params.id);
    const body = jsonBody(ctx);
    const rows = await query<{
      id: string;
      approver_id: string;
      requester_id: string | null;
      status: string;
    }>(
      `SELECT id, approver_id, requester_id, status FROM approvals WHERE task_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [task.id],
    );
    if (rows.length === 0) throw notFound();
    const approval = rows[0];
    if (approval.approver_id !== person.id) throw forbidden();
    if (approval.status !== 'requested') throw conflict({ error: 'already_decided' });
    const decision = text(body, 'decision');
    if (!(decision in APPROVAL_STATUS)) throw invalid({ decision: 'Choose a decision' });
    const comment = text(body, 'comment');
    if (decision !== 'approve' && comment.trim() === '') {
      throw invalid({ comment: 'Add a comment for this decision' });
    }
    if (comment.length > 500) {
      throw invalid({ comment: 'Comment must be 500 characters or fewer' });
    }
    const status = APPROVAL_STATUS[decision];
    const at = await clockNow();
    await query(
      `UPDATE approvals SET status = $1, comment = $2, decided_at = $3 WHERE id = $4`,
      [status, comment, at.toISOString(), approval.id],
    );
    if (approval.requester_id) {
      const itemId = newId();
      const itemText = `${person.name} ${DECISION_ITEM[status]} ${task.name}`;
      await query(
        `INSERT INTO inbox_items (id, person_id, team_id, text, task_id, kind, created_at)
         VALUES ($1,$2,$3,$4,$5,'decision',$6)`,
        [itemId, approval.requester_id, project.team_id, itemText, task.id, at.toISOString()],
      );
      await publishInbox(
        approval.requester_id,
        project.team_id,
        itemId,
        itemText,
        task.id,
        'decision',
        at,
      );
    }
    await publish({
      type: 'approval_changed',
      teamId: project.team_id,
      projectId: project.id,
      taskId: task.id,
      approval: { status, approverId: approval.approver_id },
      announcement: `Decision saved: ${DECISION_ANNOUNCEMENT[status]}`,
    });
    await runChain(
      project.id,
      [
        {
          taskId: task.id,
          kind: 'approval_decided',
          value: status,
          key: `decision:${approval.id}`,
        },
      ],
      at,
    );
    sendJson(ctx.res, 200, { status });
  });

  router.add('POST', '/api/tasks/:id/attachments', async (ctx) => {
    requireAuth(ctx);
    const { task, project } = await loadTask(ctx, ctx.params.id);
    const parts = parseMultipart(ctx.raw, String(ctx.req.headers['content-type'] ?? ''));
    const file = parts.find((p) => p.field === 'file' && p.filename !== '');
    if (ctx.rawTruncated || (file && file.data.length > config.uploadMaxBytes)) {
      throw new ApiError(413, { error: 'file_too_large' });
    }
    if (!file) throw invalid({ file: 'Choose a file to attach' });
    const id = newId();
    const key = `attachments/${task.id}/${id}/${file.filename}`;
    try {
      await putObject(key, file.data, file.contentType);
      await headObject(key);
    } catch (err) {
      if (err instanceof StorageUnavailable) throw storageUnavailable();
      throw err;
    }
    const at = await clockNow();
    await query(
      `INSERT INTO attachments (id, task_id, name, size, content_type, object_key, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, task.id, file.filename, file.data.length, file.contentType, key, at.toISOString()],
    );
    await publish({
      type: 'attachment_added',
      teamId: project.team_id,
      taskId: task.id,
      attachment: { id, name: file.filename, size: file.data.length },
    });
    sendJson(ctx.res, 201, {
      id,
      name: file.filename,
      size: file.data.length,
      contentType: file.contentType,
    });
  });

  router.add('GET', '/api/attachments/:id', async (ctx) => {
    requireAuth(ctx);
    const rows = await query<{ task_id: string; name: string; content_type: string; object_key: string }>(
      `SELECT task_id, name, content_type, object_key FROM attachments WHERE id = $1`,
      [ctx.params.id],
    );
    if (rows.length === 0) throw notFound();
    await loadTask(ctx, rows[0].task_id);
    let bytes: Buffer;
    try {
      bytes = await getObject(rows[0].object_key);
    } catch (err) {
      if (err instanceof StorageUnavailable) throw storageUnavailable();
      throw err;
    }
    ctx.res.writeHead(200, {
      'content-type': rows[0].content_type,
      'content-length': String(bytes.length),
      'content-disposition': `attachment; filename="${rows[0].name}"`,
    });
    ctx.res.end(bytes);
  });

  router.add('POST', '/api/projects/:id/files', async (ctx) => {
    requireAuth(ctx);
    const project = await loadProject(ctx, ctx.params.id);
    const body = jsonBody(ctx);
    const format = text(body, 'format');
    if (format !== 'csv' && format !== 'json') throw invalid({ format: 'Choose csv or json' });
    const id = newId();
    const at = await clockNow();
    await query(
      `INSERT INTO project_files (id, project_id, format, status, created_at)
       VALUES ($1,$2,$3,'preparing',$4)`,
      [id, project.id, format, at.toISOString()],
    );
    sendJson(ctx.res, 202, { id, status: 'preparing' });
    setImmediate(() => void prepareFile(id, project.id, project.team_id, format));
  });

  router.add('GET', '/api/files/:id', async (ctx) => {
    requireAuth(ctx);
    const rows = await query<{
      id: string;
      project_id: string;
      format: string;
      status: string;
      error: string | null;
    }>(`SELECT id, project_id, format, status, error FROM project_files WHERE id = $1`, [
      ctx.params.id,
    ]);
    if (rows.length === 0) throw notFound();
    await loadProject(ctx, rows[0].project_id);
    sendJson(ctx.res, 200, fileJson(rows[0]));
  });

  router.add('GET', '/api/files/:id/download', async (ctx) => {
    requireAuth(ctx);
    const rows = await query<{
      id: string;
      project_id: string;
      format: string;
      status: string;
      object_key: string | null;
    }>(
      `SELECT id, project_id, format, status, object_key FROM project_files WHERE id = $1`,
      [ctx.params.id],
    );
    if (rows.length === 0) throw notFound();
    await loadProject(ctx, rows[0].project_id);
    if (rows[0].status !== 'ready' || !rows[0].object_key) throw notFound();
    let bytes: Buffer;
    try {
      bytes = await getObject(rows[0].object_key);
    } catch (err) {
      if (err instanceof StorageUnavailable) throw storageUnavailable();
      throw err;
    }
    ctx.res.writeHead(200, {
      'content-type': rows[0].format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json',
      'content-length': String(bytes.length),
      'content-disposition': `attachment; filename="project.${rows[0].format}"`,
    });
    ctx.res.end(bytes);
  });

  router.add('GET', '/api/events', async (ctx) => {
    const person = requireAuth(ctx);
    const teams = (await teamsOf(person.id)).map((t) => t.id);
    ctx.res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    ctx.res.write(`event: ready\ndata: {}\n\n`);
    const stop = subscribe({
      teams: new Set(teams),
      personId: person.id,
      write: (event) => {
        ctx.res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
    });
    ctx.req.on('close', () => {
      stop();
      ctx.res.end();
    });
    await new Promise<void>(() => {
      /* held open until the client disconnects */
    });
  });

}

function fileJson(row: {
  id: string;
  format: string;
  status: string;
  error: string | null;
}): Record<string, unknown> {
  const out: Record<string, unknown> = { id: row.id, status: row.status, format: row.format };
  if (row.status === 'ready') out.url = `/api/files/${row.id}/download`;
  if (row.status === 'failed') out.error = row.error;
  return out;
}

export async function ensureRequestedByField(projectId: string): Promise<string> {
  const fields = await getFields(projectId);
  const existing = fields.find((f) => f.name === 'Requested by');
  if (existing) return existing.id;
  const id = newId();
  await query(
    `INSERT INTO fields (id, project_id, name, type, options, formula, position)
     VALUES ($1,$2,'Requested by','text','[]'::jsonb,NULL,$3)`,
    [id, projectId, fields.length + 1],
  );
  return id;
}

function readWeight(body: Record<string, unknown>): number | null {
  if (!('weight' in body) || body.weight === null || body.weight === '') return null;
  const value = Number(body.weight);
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw invalid({ weight: 'Weight must be a whole number from 1 to 10' });
  }
  return value;
}

function readManual(body: Record<string, unknown>): number | null {
  if (!('manualValue' in body) || body.manualValue === null || body.manualValue === '') return null;
  const value = Number(body.manualValue);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw invalid({ manualValue: 'Manual value must be from 0 to 100' });
  }
  return value;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function projectFileBody(
  projectId: string,
  format: 'csv' | 'json',
): Promise<{ body: Buffer; contentType: string }> {
  const sections = await getSections(projectId);
  const rows = await query<TaskRow & { assignee_email: string | null }>(
    `SELECT t.*, p.email AS assignee_email FROM tasks t
     LEFT JOIN people p ON p.id = t.assignee_id WHERE t.project_id = $1`,
    [projectId],
  );
  const ordered = orderTasks(rows, sections) as (TaskRow & { assignee_email: string | null })[];
  const sectionName = new Map(sections.map((s) => [s.id, s.name]));
  if (format === 'csv') {
    const lines = ['id,name,section,assignee_email,start,due,effort_hours,completed,parent_id'];
    for (const task of ordered) {
      lines.push(
        [
          task.id,
          csvCell(task.name),
          csvCell(sectionName.get(task.section_id) ?? ''),
          task.assignee_email ?? '',
          task.start_date ? String(task.start_date).slice(0, 10) : '',
          task.due_date ? String(task.due_date).slice(0, 10) : '',
          task.effort === null ? '' : String(Number(task.effort)),
          task.completed ? 'true' : 'false',
          task.parent_id ?? '',
        ].join(','),
      );
    }
    return { body: Buffer.from(`${lines.join('\n')}\n`, 'utf8'), contentType: 'text/csv' };
  }
  const project = await query<{ id: string; name: string }>(
    `SELECT id, name FROM projects WHERE id = $1`,
    [projectId],
  );
  const payload = {
    schema: 'everyweek.project/1',
    project: { id: project[0].id, name: project[0].name },
    sections: sections.map((s) => ({ id: s.id, name: s.name, position: s.position })),
    tasks: ordered.map((task) => ({
      id: task.id,
      name: task.name,
      section: task.section_id,
      assignee_email: task.assignee_email ?? null,
      start: task.start_date ? String(task.start_date).slice(0, 10) : null,
      due: task.due_date ? String(task.due_date).slice(0, 10) : null,
      effort_hours: task.effort === null ? null : Number(task.effort),
      completed: task.completed,
      parent_id: task.parent_id,
    })),
  };
  return {
    body: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
    contentType: 'application/json',
  };
}

async function prepareFile(
  fileId: string,
  projectId: string,
  teamId: string,
  format: 'csv' | 'json',
): Promise<void> {
  const key = `exports/${projectId}/${fileId}.${format}`;
  try {
    const { body, contentType } = await projectFileBody(projectId, format);
    await putObject(key, body, contentType);
    const confirmed = await headObject(key);
    if (!confirmed) throw new StorageUnavailable();
    await query(`UPDATE project_files SET status = 'ready', object_key = $1 WHERE id = $2`, [
      key,
      fileId,
    ]);
    await publish({
      type: 'file_status',
      teamId,
      file: { id: fileId, status: 'ready', format, url: `/api/files/${fileId}/download` },
    });
  } catch {
    await query(
      `UPDATE project_files SET status = 'failed', error = 'storage_unavailable' WHERE id = $1`,
      [fileId],
    );
    await publish({
      type: 'file_status',
      teamId,
      file: { id: fileId, status: 'failed', format, error: 'storage_unavailable' },
    });
  }
}
