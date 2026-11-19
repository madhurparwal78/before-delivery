import { Router, Request, Response } from 'express';
import { query, withTx } from './db';
import { AuthedRequest, readBody, BODY_MAX } from './apiutil';
import { requireAuth, requireAuthFor } from './auth';
import { projectTeam, TeamContext } from './access';
import { env } from './env';
import { toTaskJSON, projectFields, computeFormulas, TaskRow, FieldRow, dueStatus } from './taskjson';
import { isValidDate } from './taskjson';
import { now, todayYMD } from './clock';
import { addDays } from '../shared/dates';
import { nextRecurrenceDue, recurrenceRecursByClock, shiftByDays } from '../shared/worktime';
import { successorDue } from '../shared/rules';
import { publish } from './live';
import { runRulesForTrigger } from './rules';

export function projectsRouter(): Router {
  const r = Router();
  r.use(requireAuthFor('/api/teams/', '/api/projects/'));

  r.get('/api/teams/:teamId/projects', async (req, res) => {
    const ar = req as AuthedRequest;
    const teamId = String(req.params.teamId);
    if (!ar.teamIds?.includes(teamId)) { res.status(404).json({ error: 'not_found' }); return; }
    const today = await todayYMD();
    const rows = await query<{ id: string; name: string }>(
      `SELECT id, name FROM projects WHERE team_id = $1 ORDER BY created_at`, [teamId]);
    const out = [];
    for (const p of rows.rows) {
      const done = await query<{ c: string }>(
        `SELECT count(*)::text AS c FROM tasks WHERE project_id = $1 AND parent_id IS NULL AND completed`, [p.id]);
      const total = await query<{ c: string }>(
        `SELECT count(*)::text AS c FROM tasks WHERE project_id = $1 AND parent_id IS NULL`, [p.id]);
      const t = Number(total.rows[0]?.c ?? 0);
      const d = Number(done.rows[0]?.c ?? 0);
      out.push({ id: p.id, name: p.name, progress: t === 0 ? 0 : (d / t) * 100 });
    }
    void today;
    res.json({ projects: out });
  });

  r.post('/api/teams/:teamId/projects', readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const teamId = String(req.params.teamId);
    if (!ar.teamIds?.includes(teamId)) { res.status(404).json({ error: 'not_found' }); return; }
    if (ar.personRole?.[teamId] !== 'coordinator') { res.status(403).json({ error: 'forbidden' }); return; }
    const body = req.body as { name?: unknown; sections?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) { res.status(422).json({ errors: { name: 'Enter a project name' } }); return; }
    let sections: string[] = [];
    if (Array.isArray(body.sections)) {
      sections = body.sections.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map(s => s.trim());
    }
    if (sections.length === 0) { res.status(422).json({ errors: { sections: 'Add at least one section' } }); return; }
    const created = await withTx(async (client) => {
      const pr = await client.query<{ id: string }>(`INSERT INTO projects (team_id, name) VALUES ($1,$2) RETURNING id`, [teamId, name]);
      const pid = pr.rows[0].id;
      let i = 1;
      for (const s of sections) {
        await client.query(`INSERT INTO sections (project_id, name, position) VALUES ($1,$2,$3)`, [pid, s, i++]);
      }
      return pid;
    });
    const ctx = await projectTeam(created, ar.teamIds, ar.personRole);
    publish({ teamIds: [ctx!.teamId], kind: 'projects', at: new Date().toISOString() });
    res.status(201).json({ id: created, name, teamId, progress: 0 });
  });

  r.get('/api/projects/:id', async (req, res) => {
    const ar = req as AuthedRequest;
    const ctx = await projectTeam(String(req.params.id), ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    const pid = String(req.params.id);
    const p = await query<{ id: string; name: string; team_id: string }>(`SELECT * FROM projects WHERE id = $1`, [pid]);
    if (!p.rows[0]) { res.status(404).json({ error: 'not_found' }); return; }
    const members = await query<{ id: string; name: string; email: string }>(
      `SELECT pe.id, pe.name, pe.email FROM team_members tm JOIN people pe ON pe.id = tm.person_id WHERE tm.team_id = $1 ORDER BY pe.name`, [ctx.teamId]);
    const sections = await query<{ id: string; name: string; position: number }>(
      `SELECT id, name, position FROM sections WHERE project_id = $1 ORDER BY position`, [pid]);
    const fields = await projectFields(pid);
    const done = await query<{ c: string }>(`SELECT count(*)::text AS c FROM tasks WHERE project_id = $1 AND parent_id IS NULL AND completed`, [pid]);
    const total = await query<{ c: string }>(`SELECT count(*)::text AS c FROM tasks WHERE project_id = $1 AND parent_id IS NULL`, [pid]);
    const t = Number(total.rows[0]?.c ?? 0);
    const d = Number(done.rows[0]?.c ?? 0);
    res.json({
      id: p.rows[0].id,
      name: p.rows[0].name,
      teamId: p.rows[0].team_id,
      progress: t === 0 ? 0 : (d / t) * 100,
      members: members.rows,
      sections: sections.rows,
      fields: fields.map(f => ({ id: f.id, name: f.name, type: f.type, options: f.options, formula: f.formula })),
    });
  });

  r.get('/api/projects/:id/tasks', async (req, res) => {
    const ar = req as AuthedRequest;
    const ctx = await projectTeam(String(req.params.id), ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    const pid = String(req.params.id);
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const size = env().limits.pageSize;
    const totalR = await query<{ c: string }>(`SELECT count(*)::text AS c FROM tasks WHERE project_id = $1`, [pid]);
    const total = Number(totalR.rows[0]?.c ?? 0);
    const rows = await query<TaskRow>(
      `SELECT * FROM tasks WHERE project_id = $1 ORDER BY (SELECT position FROM sections s WHERE s.id = tasks.section_id), parent_id NULLS FIRST, position, created_at LIMIT $2 OFFSET $3`,
      [pid, size, (page - 1) * size]);
    const today = await todayYMD();
    const tasks = [];
    for (const row of rows.rows) tasks.push(await toTaskJSON(row, today));
    res.json({ tasks, page, pageSize: size, total });
  });

  return r;
}

export async function closePositions(client: import('pg').PoolClient, sectionId: string, parentId: string | null): Promise<void> {
  const rows = await client.query<{ id: string }>(
    `SELECT id FROM tasks WHERE section_id = $1 AND parent_id IS NOT DISTINCT FROM $2 ORDER BY position`, [sectionId, parentId]);
  let i = 1;
  for (const row of rows.rows) {
    await client.query(`UPDATE tasks SET position = $1 WHERE id = $2`, [i++, row.id]);
  }
}

export { withTx };
