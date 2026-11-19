import { Router, Request, Response } from 'express';
import { query, withTx } from './db';
import { AuthedRequest, readBody, BODY_MAX } from './apiutil';
import { requireAuthFor } from './auth';
import { projectTeam } from './access';
import { env } from './env';
import { toTaskJSON, projectFields, TaskRow, FieldRow, isValidDate, dueStatus } from './taskjson';
import { now, todayYMD, txNow, txToday } from './clock';
import { publish } from './live';
import { runAndRecord, TriggerEvent, addHistory, RunOutcome } from './rules';
import { FieldValue } from '../shared/types';
import { validateFormula } from '../shared/formula';

export function tasksRouter(): Router {
  const r = Router();
  r.use(requireAuthFor('/api/tasks/', '/api/projects/', '/api/sections/', '/api/fields/', '/api/attachments/', '/api/files/', '/api/rules/'));

  r.post('/api/projects/:id/tasks', readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const ctx = await projectTeam(String(req.params.id), ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    const pid = String(req.params.id);
    const body = req.body as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) { res.status(422).json({ errors: { name: 'Enter a task name' } }); return; }
    const secs = await query<{ id: string }>(`SELECT id FROM sections WHERE project_id = $1 ORDER BY position`, [pid]);
    let sectionId: string | null = null;
    if (body.section !== undefined && body.section !== null) {
      sectionId = secs.rows.find(s => s.id === body.section)?.id ?? null;
    } else {
      sectionId = secs.rows[0]?.id ?? null;
    }
    if (!sectionId) { res.status(422).json({ errors: { section: 'Choose a section of this project' } }); return; }
    const effort = body.effort === undefined || body.effort === null || body.effort === '' ? null : Number(body.effort);
    if (effort !== null && (Number.isNaN(effort) || effort < 0)) { res.status(422).json({ errors: { effort: 'Effort must be 0 or more hours' } }); return; }
    const start = body.start === undefined || body.start === null || body.start === '' ? null : String(body.start);
    const due = body.due === undefined || body.due === null || body.due === '' ? null : String(body.due);
    if (start && !isValidDate(start)) { res.status(422).json({ errors: { start: 'Enter a date like 2026-03-02' } }); return; }
    if (due && !isValidDate(due)) { res.status(422).json({ errors: { due: 'Enter a date like 2026-03-02' } }); return; }
    if (start && due && due < start) { res.status(422).json({ errors: { due: 'Due date can\'t be before the start date' } }); return; }
    let parentId: string | null = null;
    if (body.parentId !== undefined && body.parentId !== null && body.parentId !== '') {
      const pr = await query<TaskRow>(`SELECT * FROM tasks WHERE id = $1 AND project_id = $2`, [String(body.parentId), pid]);
      if (!pr.rows[0]) { res.status(422).json({ errors: { parentId: 'Tasks nest one level only' } }); return; }
      if (pr.rows[0].parent_id) { res.status(422).json({ errors: { parentId: 'Tasks nest one level only' } }); return; }
      parentId = pr.rows[0].id;
    }
    const fields = await projectFields(pid);
    const values = body.values && typeof body.values === 'object' && !Array.isArray(body.values)
      ? body.values as Record<string, unknown> : {};
    for (const key of Object.keys(values)) {
      if (!fields.find(f => f.name === key)) { res.status(422).json({ errors: { values: `Unknown field ${key}` } }); return; }
    }

    const eventId = `create:${await nextSeq()}`;
    const created = await withTx(async (client) => {
      let position: number;
      if (body.position !== undefined && body.position !== null) {
        position = Number(body.position);
      } else {
        const cnt = await client.query<{ c: string }>(
          `SELECT count(*)::text AS c FROM tasks WHERE section_id = $1 AND parent_id IS NOT DISTINCT FROM $2`,
          [sectionId, parentId]);
        position = Number(cnt.rows[0]?.c ?? 0) + 1;
      }
      const assigneeId = body.assigneeId ? String(body.assigneeId) : null;
      const ins = await client.query<TaskRow>(
        `INSERT INTO tasks (project_id, name, section_id, position, parent_id, assignee_id, start_date, due_date, effort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [pid, name, sectionId, position, parentId, assigneeId, start, due, effort]);
      const row = ins.rows[0];
      for (const f of fields) {
        if (f.type === 'formula') continue;
        const v = values[f.name];
        if (v !== undefined) {
          await client.query(`INSERT INTO field_values (task_id, field_id, value) VALUES ($1,$2,$3)`,
            [row.id, f.id, JSON.stringify(coerceValue(f, v))]);
        }
      }
      await addHistory(client, row.id, `${ar.personName ?? 'Someone'} created the task`);
      return row;
    });
    await withTx(async (client) => {
      const ev: TriggerEvent = { projectId: pid, type: 'task_added', taskId: created.id, eventId };
      await runAndRecord(client, ev, created.id);
    });
    const row = (await query<TaskRow>(`SELECT * FROM tasks WHERE id = $1`, [created.id])).rows[0];
    const json = await toTaskJSON(row);
    publishProject(ctx.teamId, 'task', { task: json, kind: 'task_added' });
    res.status(201).json(json);
  });

  r.get('/api/tasks/:id', async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const row = (await query<TaskRow>(`SELECT * FROM tasks WHERE id = $1`, [id])).rows[0];
    if (!row) { res.status(404).json({ error: 'not_found' }); return; }
    const ctx = await projectTeam(row.project_id, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    const json = await toTaskJSON(row);
    const attachments = await query<{ id: string; name: string; size: number }>(
      `SELECT id, name, size FROM attachments WHERE task_id = $1 ORDER BY created_at`, [id]);
    const approval = await latestApproval(id);
    const blocks = await query<{ waiter_id: string }>(`SELECT waiter_id FROM dependencies WHERE blocker_id = $1`, [id]);
    const blockedBy = await query<{ blocker_id: string }>(`SELECT blocker_id FROM dependencies WHERE waiter_id = $1`, [id]);
    const history = await query<{ text: string; created_at: string }>(
      `SELECT text, created_at FROM task_history WHERE task_id = $1 ORDER BY created_at, id`, [id]);
    const viewers = await query<{ id: string; name: string }>(
      `SELECT p.id, p.name FROM presence pr JOIN people p ON p.id = pr.person_id WHERE pr.task_id = $1 AND pr.expires_at > $2`,
      [id, new Date()]);
    res.json({
      ...json,
      attachments: attachments.rows,
      approval,
      blocks: blocks.rows.map(b => b.waiter_id),
      blockedBy: blockedBy.rows.map(b => b.blocker_id),
      history: history.rows.map(h => ({ text: h.text, createdAt: h.created_at })),
      viewing: viewers.rows,
    });
  });

  r.patch('/api/tasks/:id', readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const before = (await query<TaskRow>(`SELECT * FROM tasks WHERE id = $1`, [id])).rows[0];
    if (!before) { res.status(404).json({ error: 'not_found' }); return; }
    const ctx = await projectTeam(before.project_id, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    const body = req.body as Record<string, unknown>;
    const version = Number(body.version ?? before.version);
    if (version !== before.version) {
      res.status(409).json({ error: 'stale_task', latest: before.version });
      return;
    }
    const holdField = body.name !== undefined ? 'name' : body.description !== undefined ? 'description' : null;
    if (holdField) {
      const hold = await query<{ holder_id: string; name: string; expires_at: Date }>(
        `SELECT h.holder_id, p.name, h.expires_at FROM holds h JOIN people p ON p.id = h.holder_id
          WHERE h.task_id = $1 AND h.field = $2`, [id, holdField]);
      const h = hold.rows[0];
      const nowDate = await now();
      if (h && h.holder_id !== ar.personId && h.expires_at > nowDate) {
        res.status(409).json({ error: 'held_by_other', holder: h.name });
        return;
      }
    }
    const events: TriggerEvent[] = [];
    const outcome = await withTx(async (client): Promise<{ ok: boolean; code?: number; body?: Record<string, unknown> }> => {
      const cur = (await client.query<TaskRow>(`SELECT * FROM tasks WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!cur) return { ok: false, code: 404, body: { error: 'not_found' } };
      if (cur.version !== version) return { ok: false, code: 409, body: { error: 'stale_task', latest: cur.version } };
      const today = await txToday(client);
      const updates: string[] = [`version = version + 1`, `updated_at = now()`];
      const params: unknown[] = [];
      const set = (col: string, val: unknown): void => { params.push(val); updates.push(`${col} = $${params.length}`); };

      let person = ar.personName ?? 'Someone';
      const personId = ar.personId ?? '';

      if (body.name !== undefined) {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) return { ok: false, code: 422, body: { errors: { name: 'Enter a task name' } } };
        set('name', name);
        await addHistory(client, id, `${person} changed Name`);
      }
      if (body.description !== undefined) {
        set('description', typeof body.description === 'string' ? body.description : '');
        await addHistory(client, id, `${person} changed Description`);
      }
      if (body.assigneeId !== undefined) {
        const v = body.assigneeId === null || body.assigneeId === '' ? null : String(body.assigneeId);
        if (cur.assignee_id !== v) {
          set('assignee_id', v);
          await addHistory(client, id, `${person} changed Assignee`);
          events.push({ projectId: cur.project_id, type: 'field_changed', taskId: id, field: 'assignee', value: v ?? '', eventId: `ev:${await nextSeq()}` });
        }
      }
      if (body.start !== undefined) {
        const v = body.start === null || body.start === '' ? null : String(body.start);
        if (v && !isValidDate(v)) return { ok: false, code: 422, body: { errors: { start: 'Enter a date like 2026-03-02' } } };
        if (cur.start_date !== v) {
          set('start_date', v);
          await addHistory(client, id, `${person} changed Start`);
        }
      }
      if (body.due !== undefined) {
        const v = body.due === null || body.due === '' ? null : String(body.due);
        if (v && !isValidDate(v)) return { ok: false, code: 422, body: { errors: { due: 'Enter a date like 2026-03-02' } } };
        const newStart = body.start !== undefined ? (body.start === null || body.start === '' ? null : String(body.start)) : cur.start_date;
        if (v && newStart && v < newStart) return { ok: false, code: 422, body: { errors: { due: 'Due date can\'t be before the start date' } } };
        if (cur.due_date !== v) {
          set('due_date', v);
          await addHistory(client, id, `${person} changed Due`);
        }
      }
      if (body.effort !== undefined) {
        const v = body.effort === null || body.effort === '' ? null : Number(body.effort);
        if (v !== null && (Number.isNaN(v) || v < 0)) return { ok: false, code: 422, body: { errors: { effort: 'Effort must be 0 or more hours' } } };
        set('effort', v);
        await addHistory(client, id, `${person} changed Effort`);
      }
      if (body.section !== undefined) {
        const v = String(body.section);
        const sec = await client.query<{ id: string; name: string }>(`SELECT id, name FROM sections WHERE id = $1 AND project_id = $2`, [v, cur.project_id]);
        if (!sec.rows[0]) return { ok: false, code: 422, body: { errors: { section: 'Choose a section of this project' } } };
        if (cur.section_id !== v) {
          let position: number;
          if (body.position !== undefined && body.position !== null) {
            position = Number(body.position);
          } else {
            const cnt = await client.query<{ c: string }>(`SELECT count(*)::text AS c FROM tasks WHERE section_id = $1 AND parent_id IS NULL`, [v]);
            position = Number(cnt.rows[0]?.c ?? 0) + 1;
          }
          set('section_id', v);
          params.push(position); updates.push(`position = $${params.length}`);
          if (cur.parent_id === null) {
            await addHistory(client, id, `${person} moved to ${sec.rows[0].name}`);
            events.push({ projectId: cur.project_id, type: 'moved_to_section', taskId: id, section: v, eventId: `ev:${await nextSeq()}` });
          }
        }
      }
      if (body.position !== undefined && body.section === undefined) {
        const v = Number(body.position);
        if (Number.isFinite(v)) { params.push(v); updates.push(`position = $${params.length}`); }
      }
      if (body.completed !== undefined) {
        const v = Boolean(body.completed);
        if (cur.completed !== v) {
          set('completed', v);
          if (v) { params.push(new Date()); updates.push(`completed_at = $${params.length}`); }
          else { updates.push(`completed_at = NULL`); }
          await addHistory(client, id, `${person} changed Completed`);
        }
      }
      if (body.parentId !== undefined) {
        const v = body.parentId === null || body.parentId === '' ? null : String(body.parentId);
        if (v !== null) {
          if (v === id) return { ok: false, code: 422, body: { errors: { parentId: 'Tasks nest one level only' } } };
          const parent = (await client.query<TaskRow>(`SELECT * FROM tasks WHERE id = $1 AND project_id = $2`, [v, cur.project_id])).rows[0];
          if (!parent) return { ok: false, code: 422, body: { errors: { parentId: 'Tasks nest one level only' } } };
          if (parent.parent_id) return { ok: false, code: 422, body: { errors: { parentId: 'Tasks nest one level only' } } };
          const kids = await client.query<{ c: string }>(`SELECT count(*)::text AS c FROM tasks WHERE parent_id = $1`, [id]);
          if (Number(kids.rows[0]?.c ?? 0) > 0) return { ok: false, code: 422, body: { errors: { parentId: 'Tasks nest one level only' } } };
        } else if (cur.parent_id === null) {
          return { ok: false, code: 422, body: { errors: { parentId: 'Tasks nest one level only' } } };
        }
        set('parent_id', v);
        if (v === null) {
          const pos = await client.query<{ c: string }>(`SELECT count(*)::text AS c FROM tasks WHERE parent_id = $1`, [cur.parent_id]);
          void pos;
        }
      }
      if (body.values !== undefined && typeof body.values === 'object' && !Array.isArray(body.values)) {
        const vals = body.values as Record<string, unknown>;
        const fields = await projectFields(cur.project_id);
        for (const [key, raw] of Object.entries(vals)) {
          const f = fields.find(x => x.name === key);
          if (!f) return { ok: false, code: 422, body: { errors: { values: `Unknown field ${key}` } } };
          if (f.type === 'formula') continue;
          const before2 = (await client.query<{ value: FieldValue }>(`SELECT value FROM field_values WHERE task_id = $1 AND field_id = $2`, [id, f.id])).rows[0];
          const beforeVal = before2?.value ?? null;
          const v = coerceValue(f, raw);
          const changed = JSON.stringify(beforeVal) !== JSON.stringify(v);
          await client.query(
            `INSERT INTO field_values (task_id, field_id, value) VALUES ($1,$2,$3)
             ON CONFLICT (task_id, field_id) DO UPDATE SET value = $3`,
            [id, f.id, JSON.stringify(v)]);
          if (changed) {
            await addHistory(client, id, `${person} changed ${f.name}`);
            events.push({ projectId: cur.project_id, type: 'field_changed', taskId: id, field: f.id, value: valueText(v), eventId: `ev:${await nextSeq()}` });
          }
        }
      }
      void personId;
      if (updates.length === 1) {
        return { ok: false, code: 422, body: { errors: {} } };
      }
      await client.query(`UPDATE tasks SET ${updates.join(', ')} WHERE id = $${params.length + 1}`, [...params, id]);
      return { ok: true };
    });
    if (!outcome.ok && outcome.code) {
      res.status(outcome.code).json(outcome.body ?? {});
      return;
    }
    for (const ev of events) {
      await withTx(async (client) => { await runAndRecord(client, ev, id); });
    }
    const after = (await query<TaskRow>(`SELECT * FROM tasks WHERE id = $1`, [id])).rows[0];
    const json = await toTaskJSON(after);
    publishProject(ctx.teamId, 'task', { task: json, kind: 'task' });
    res.json(json);
  });

  r.delete('/api/tasks/:id', async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const before = (await query<TaskRow>(`SELECT * FROM tasks WHERE id = $1`, [id])).rows[0];
    if (!before) { res.status(404).json({ error: 'not_found' }); return; }
    const ctx = await projectTeam(before.project_id, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    await query(`DELETE FROM tasks WHERE id = $1`, [id]);
    publishProject(ctx.teamId, 'task_deleted', { taskId: id, projectId: before.project_id });
    res.status(204).end();
  });

  r.post('/api/tasks/:id/dependencies', readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const body = req.body as { blocks?: unknown };
    const blockerId = typeof body.blocks === 'string' ? body.blocks : '';
    const waiter = (await query<TaskRow>(`SELECT * FROM tasks WHERE id = $1`, [id])).rows[0];
    const blocker = (await query<TaskRow>(`SELECT * FROM tasks WHERE id = $1`, [blockerId])).rows[0];
    if (!waiter || !blocker || waiter.project_id !== blocker.project_id) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const ctx = await projectTeam(waiter.project_id, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    if (blockerId === id) { res.status(422).json({ errors: { blocks: 'A task can\'t block itself or create a loop' } }); return; }
    const loop = await wouldLoop(blockerId, id);
    if (loop) { res.status(422).json({ errors: { blocks: 'A task can\'t block itself or create a loop' } }); return; }
    await query(`INSERT INTO dependencies (blocker_id, waiter_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [blockerId, id]);
    publishProject(ctx.teamId, 'dependency', { from: blockerId, to: id, projectId: waiter.project_id });
    res.status(201).json({ from: blockerId, to: id });
  });

  r.post('/api/tasks/:id/hold', readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const body = req.body as { field?: unknown };
    const field = body.field === 'name' || body.field === 'description' ? body.field : null;
    if (!field) { res.status(422).json({ errors: { field: 'Choose name or description' } }); return; }
    const task = (await query<TaskRow>(`SELECT * FROM tasks WHERE id = $1`, [id])).rows[0];
    if (!task) { res.status(404).json({ error: 'not_found' }); return; }
    const ctx = await projectTeam(task.project_id, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    const nowDate = await now();
    const existing = (await query<{ holder_id: string; name: string; expires_at: Date }>(
      `SELECT h.holder_id, p.name, h.expires_at FROM holds h JOIN people p ON p.id = h.holder_id WHERE h.task_id = $1 AND h.field = $2`, [id, field])).rows[0];
    if (existing && existing.holder_id !== ar.personId && existing.expires_at > nowDate) {
      res.status(409).json({ error: 'held_by_other', holder: existing.name });
      return;
    }
    const expires = new Date(nowDate.getTime() + env().limits.holdTimeoutMs);
    await query(
      `INSERT INTO holds (task_id, field, holder_id, expires_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (task_id, field) DO UPDATE SET holder_id = $3, expires_at = $4`, [id, field, ar.personId, expires]);
    res.json({ field, holder: { id: ar.personId ?? '', name: ar.personName ?? '' }, expiresAt: expires.toISOString() });
  });

  r.delete('/api/tasks/:id/hold', readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const body = req.body as { field?: unknown };
    const field = body.field === 'name' || body.field === 'description' ? body.field : null;
    if (!field) { res.status(422).json({ errors: { field: 'Choose name or description' } }); return; }
    const task = (await query<TaskRow>(`SELECT * FROM tasks WHERE id = $1`, [id])).rows[0];
    if (!task) { res.status(404).json({ error: 'not_found' }); return; }
    const ctx = await projectTeam(task.project_id, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    await query(`DELETE FROM holds WHERE task_id = $1 AND field = $2 AND holder_id = $3`, [id, field, ar.personId]);
    res.status(204).end();
  });

  r.get('/api/tasks/:id/rule-runs', async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const task = (await query<TaskRow>(`SELECT * FROM tasks WHERE id = $1`, [id])).rows[0];
    if (!task) { res.status(404).json({ error: 'not_found' }); return; }
    const ctx = await projectTeam(task.project_id, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    const runs = await query<{ id: string; depth: number; summary: string; detail: string; created_at: string }>(
      `SELECT id, depth, summary, detail, created_at FROM rule_runs WHERE task_id = $1 ORDER BY run_no`, [id]);
    res.json({ runs: runs.rows.map(x => ({ id: x.id, depth: x.depth, summary: x.summary, detail: x.detail, createdAt: x.created_at })) });
  });

  r.post('/api/projects/:id/sections', readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const ctx = await projectTeam(String(req.params.id), ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    const pid = String(req.params.id);
    const body = req.body as { name?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) { res.status(422).json({ errors: { name: 'Enter a section name' } }); return; }
    const existing = await query<{ id: string }>(`SELECT id FROM sections WHERE project_id = $1 AND name = $2`, [pid, name]);
    if (existing.rows[0]) { res.status(422).json({ errors: { name: 'A section with that name already exists' } }); return; }
    const cnt = await query<{ c: string }>(`SELECT count(*)::text AS c FROM sections WHERE project_id = $1`, [pid]);
    const ins = await query<{ id: string; name: string; position: number }>(
      `INSERT INTO sections (project_id, name, position) VALUES ($1,$2,$3) RETURNING id, name, position`, [pid, name, Number(cnt.rows[0]?.c ?? 0) + 1]);
    publishProject(ctx.teamId, 'sections', { projectId: pid });
    res.status(201).json(ins.rows[0]);
  });

  r.delete('/api/sections/:id', async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const sec = (await query<{ id: string; project_id: string }>(`SELECT * FROM sections WHERE id = $1`, [id])).rows[0];
    if (!sec) { res.status(404).json({ error: 'not_found' }); return; }
    const ctx = await projectTeam(sec.project_id, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    const cnt = await query<{ c: string }>(`SELECT count(*)::text AS c FROM sections WHERE project_id = $1`, [sec.project_id]);
    if (Number(cnt.rows[0]?.c ?? 0) <= 1) {
      res.status(422).json({ errors: { section: 'A project needs at least one section' } });
      return;
    }
    await withTx(async (client) => {
      await client.query(`DELETE FROM tasks WHERE section_id = $1`, [id]);
      await client.query(`DELETE FROM sections WHERE id = $1`, [id]);
    });
    publishProject(ctx.teamId, 'sections', { projectId: sec.project_id, deletedSectionId: id });
    res.status(204).end();
  });

  r.post('/api/projects/:id/fields', readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const ctx = await projectTeam(String(req.params.id), ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    const pid = String(req.params.id);
    const body = req.body as { name?: unknown; type?: unknown; options?: unknown; formula?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const type = typeof body.type === 'string' ? body.type : '';
    if (!name) { res.status(422).json({ errors: { name: 'Enter a field name' } }); return; }
    if (!['text', 'number', 'date', 'single_select', 'multi_select', 'formula'].includes(type)) {
      res.status(422).json({ errors: { type: 'Choose a field type' } });
      return;
    }
    const existing = await query<{ id: string }>(`SELECT id FROM fields WHERE project_id = $1 AND name = $2`, [pid, name]);
    if (existing.rows[0]) { res.status(422).json({ errors: { name: 'A field with that name already exists' } }); return; }
    let formula: string | null = null;
    if (type === 'formula') {
      const src = typeof body.formula === 'string' ? body.formula : '';
      const fields = await projectFields(pid);
      const err = validateFormula(src, env().limits.formulaMaxChars, null, n => {
        if (['Start', 'Due', 'Effort'].includes(n)) {
          return { id: `builtin:${n}`, name: n, type: 'builtin', formula: null };
        }
        const f = fields.find(x => x.name === n);
        return f ? { id: f.id, name: f.name, type: f.type, formula: f.formula } : undefined;
      });
      if (err) { res.status(422).json({ errors: { formula: err } }); return; }
      formula = src;
    }
    let options: string[] | null = null;
    if (type === 'single_select' || type === 'multi_select') {
      options = Array.isArray(body.options) ? body.options.filter((o): o is string => typeof o === 'string') : [];
    }
    const pos = await query<{ c: string }>(`SELECT count(*)::text AS c FROM fields WHERE project_id = $1`, [pid]);
    const ins = await query<{ id: string }>(
      `INSERT INTO fields (project_id, name, type, options, formula, position) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [pid, name, type, options ? JSON.stringify(options) : null, formula, Number(pos.rows[0]?.c ?? 0)]);
    publishProject(ctx.teamId, 'fields', { projectId: pid });
    const f = (await query<FieldRow>(`SELECT * FROM fields WHERE id = $1`, [ins.rows[0].id])).rows[0];
    res.status(201).json({ id: f.id, name: f.name, type: f.type, options: f.options, formula: f.formula });
  });

  r.patch('/api/fields/:id', readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const field = (await query<FieldRow>(`SELECT * FROM fields WHERE id = $1`, [id])).rows[0];
    if (!field) { res.status(404).json({ error: 'not_found' }); return; }
    const ctx = await projectTeam(field.project_id, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    const body = req.body as { name?: unknown; formula?: unknown };
    let newName = field.name;
    if (body.name !== undefined) {
      const n = typeof body.name === 'string' ? body.name.trim() : '';
      if (!n) { res.status(422).json({ errors: { name: 'Enter a field name' } }); return; }
      const dup = await query<{ id: string }>(`SELECT id FROM fields WHERE project_id = $1 AND name = $2 AND id <> $3`, [field.project_id, n, id]);
      if (dup.rows[0]) { res.status(422).json({ errors: { name: 'A field with that name already exists' } }); return; }
      newName = n;
    }
    let newFormula = field.formula;
    if (body.formula !== undefined) {
      const src = typeof body.formula === 'string' ? body.formula : '';
      const fields = await projectFields(field.project_id);
      const err = validateFormula(src, env().limits.formulaMaxChars, id, n => {
        if (['Start', 'Due', 'Effort'].includes(n)) {
          return { id: `builtin:${n}`, name: n, type: 'builtin', formula: null };
        }
        const f = fields.find(x => x.name === n);
        return f ? { id: f.id, name: f.name, type: f.type, formula: f.formula } : undefined;
      });
      if (err) { res.status(422).json({ errors: { formula: err } }); return; }
      newFormula = src;
    }
    await query(`UPDATE fields SET name = $1, formula = $2 WHERE id = $3`, [newName, newFormula, id]);
    publishProject(ctx.teamId, 'fields', { projectId: field.project_id });
    const f = (await query<FieldRow>(`SELECT * FROM fields WHERE id = $1`, [id])).rows[0];
    res.json({ id: f.id, name: f.name, type: f.type, options: f.options, formula: f.formula });
  });

  r.delete('/api/fields/:id', async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const field = (await query<FieldRow>(`SELECT * FROM fields WHERE id = $1`, [id])).rows[0];
    if (!field) { res.status(404).json({ error: 'not_found' }); return; }
    const ctx = await projectTeam(field.project_id, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    await query(`DELETE FROM fields WHERE id = $1`, [id]);
    publishProject(ctx.teamId, 'fields', { projectId: field.project_id, deletedFieldId: id });
    res.status(204).end();
  });

  return r;
}

function coerceValue(f: FieldRow, v: unknown): FieldValue {
  if (v === null || v === undefined || v === '') {
    return f.type === 'multi_select' ? [] : null;
  }
  switch (f.type) {
    case 'number': return typeof v === 'number' ? v : Number(v);
    case 'date': return String(v);
    case 'multi_select': return Array.isArray(v) ? v.map(String) : [String(v)];
    default: return typeof v === 'string' ? v : String(v);
  }
}

function valueText(v: FieldValue): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

async function wouldLoop(blockerId: string, waiterId: string): Promise<boolean> {
  const rows = await query<{ blocker_id: string; waiter_id: string }>(`SELECT blocker_id, waiter_id FROM dependencies`);
  const map = new Map<string, string[]>();
  for (const r of rows.rows) {
    const arr = map.get(r.waiter_id) ?? [];
    arr.push(r.blocker_id);
    map.set(r.waiter_id, arr);
  }
  const seen = new Set<string>();
  const stack = [blockerId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === waiterId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const b of map.get(cur) ?? []) stack.push(b);
  }
  return false;
}

let seqCounter = 0;
async function nextSeq(): Promise<string> {
  seqCounter++;
  return `${Date.now()}-${seqCounter}-${Math.floor(Math.random() * 1e6)}`;
}

export async function latestApproval(taskId: string): Promise<{ status: string; approverId: string | null }> {
  const r = await query<{ status: string; approver_id: string }>(
    `SELECT status, approver_id FROM approvals WHERE task_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, [taskId]);
  if (!r.rows[0]) return { status: 'none', approverId: null };
  return { status: r.rows[0].status, approverId: r.rows[0].approver_id };
}

export function publishProject(teamId: string, kind: string, data: unknown): void {
  publish({ teamIds: [teamId], kind, at: new Date().toISOString(), data });
}
