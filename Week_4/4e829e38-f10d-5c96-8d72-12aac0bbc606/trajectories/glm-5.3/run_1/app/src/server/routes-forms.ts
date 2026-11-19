import { Router, Request, Response, NextFunction } from 'express';
import { query, withTx } from './db';
import { readBody, BODY_MAX, AuthedRequest } from './apiutil';
import { requireAuth } from './auth';
import { projectTeam } from './access';
import { todayYMD, now } from './clock';
import { isValidDate } from './taskjson';
import { publish } from './live';
import { ymdCompare } from '../shared/dates';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function formsRouter(): Router {
  const r = Router();

  r.get('/api/forms/:slug', async (req, res) => {
    const slug = String(req.params.slug);
    const form = (await query<{ title: string; project_id: string; section_id: string }>(
      `SELECT title, project_id, section_id FROM forms WHERE slug = $1`, [slug])).rows[0];
    if (!form) { res.status(404).json({ error: 'not_found' }); return; }
    const cat = await query<{ options: string[] }>(
      `SELECT options FROM fields WHERE project_id = $1 AND name = 'Category'`, [form.project_id]);
    const options = Array.isArray(cat.rows[0]?.options) ? cat.rows[0].options : [];
    res.json({ title: form.title, categories: options });
  });

  r.post('/api/forms/:slug/submissions', readBody(BODY_MAX), async (req, res) => {
    const slug = String(req.params.slug);
    const form = (await query<{ id: string; title: string; project_id: string; section_id: string }>(
      `SELECT id, title, project_id, section_id FROM forms WHERE slug = $1`, [slug])).rows[0];
    if (!form) { res.status(404).json({ error: 'not_found' }); return; }
    const body = req.body as { title?: unknown; details?: unknown; neededBy?: unknown; email?: unknown; category?: unknown };
    const errors: Record<string, string> = {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) errors.title = 'Enter a request title';
    else if (title.length > 120) errors.title = 'Request title must be 120 characters or fewer';
    const neededBy = typeof body.neededBy === 'string' ? body.neededBy : '';
    const today = await todayYMD();
    if (!neededBy || !isValidDate(neededBy)) errors.neededBy = 'Enter a date today or later';
    else if (ymdCompare(neededBy, today) < 0) errors.neededBy = 'Enter a date today or later';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!email || !EMAIL_RE.test(email)) errors.email = 'Enter an email address like name@example.com';
    let category: string | null = null;
    if (body.category !== undefined && body.category !== null && body.category !== '') {
      const cat = await query<{ options: string[] }>(`SELECT options FROM fields WHERE project_id = $1 AND name = 'Category'`, [form.project_id]);
      const options = Array.isArray(cat.rows[0]?.options) ? cat.rows[0].options : [];
      category = String(body.category);
      if (!options.includes(category)) errors.category = 'Choose a category from the list';
    }
    if (Object.keys(errors).length > 0) { res.status(422).json({ errors }); return; }
    const details = typeof body.details === 'string' ? body.details : '';
    const teamRow = (await query<{ team_id: string }>(`SELECT team_id FROM projects WHERE id = $1`, [form.project_id])).rows[0];
    const created = await withTx(async (client) => {
      const ref = await client.query<{ next_number: number }>(
        `UPDATE reference_counters SET next_number = next_number + 1 WHERE team_id = $1 RETURNING next_number`, [teamRow.team_id]);
      const num = ref.rows[0].next_number - 1;
      const reference = `REQ-${String(num).padStart(4, '0')}`;
      const cnt = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM tasks WHERE section_id = $1 AND parent_id IS NULL`, [form.section_id]);
      const ins = await client.query<{ id: string }>(
        `INSERT INTO tasks (project_id, name, description, section_id, position, due_date)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [form.project_id, title, details, form.section_id, Number(cnt.rows[0]?.c ?? 0) + 1, neededBy]);
      const taskId = ins.rows[0].id;
      const fields = await client.query<{ id: string; name: string }>(`SELECT id, name FROM fields WHERE project_id = $1`, [form.project_id]);
      const setVal = async (name: string, value: unknown): Promise<void> => {
        const f = fields.rows.find(x => x.name === name);
        if (!f) return;
        await client.query(
          `INSERT INTO field_values (task_id, field_id, value) VALUES ($1,$2,$3)
           ON CONFLICT (task_id, field_id) DO UPDATE SET value = $3`, [taskId, f.id, JSON.stringify(value)]);
      };
      await setVal('Category', category);
      await setVal('Requested by', email);
      await client.query(`INSERT INTO task_history (task_id, text) VALUES ($1,$2)`, [taskId, `Request ${reference} received`]);
      return { reference, taskId };
    });
    const teamId = teamRow.team_id;
    publish({ teamIds: [teamId], kind: 'task', at: new Date().toISOString(), data: { formSubmission: true, taskId: created.taskId, reference: created.reference } });
    res.status(201).json({ reference: created.reference, taskId: created.taskId });
  });

  r.post('/api/projects/:id/forms', requireAuth(), readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const pid = String(req.params.id);
    const ctx = await projectTeam(pid, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    if (!ctx.isCoordinator) { res.status(403).json({ error: 'forbidden' }); return; }
    const body = req.body as { slug?: unknown; section?: unknown; title?: unknown };
    const slug = typeof body.slug === 'string' ? body.slug : '';
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!/^[a-z0-9-]+$/.test(slug)) { res.status(422).json({ errors: { slug: 'Use lowercase letters, digits and hyphens' } }); return; }
    if (!title) { res.status(422).json({ errors: { title: 'Enter a form title' } }); return; }
    const section = typeof body.section === 'string' ? body.section : '';
    const sec = (await query<{ id: string }>(`SELECT id FROM sections WHERE id = $1 AND project_id = $2`, [section, pid])).rows[0];
    if (!sec) { res.status(422).json({ errors: { section: 'Choose a section of this project' } }); return; }
    const existing = (await query<{ id: string }>(`SELECT id FROM forms WHERE slug = $1`, [slug])).rows[0];
    if (existing) { res.status(422).json({ errors: { slug: 'That form address is taken' } }); return; }
    await query(`INSERT INTO forms (slug, project_id, section_id, title) VALUES ($1,$2,$3,$4)`, [slug, pid, section, title]);
    const catField = (await query<{ id: string }>(`SELECT id FROM fields WHERE project_id = $1 AND name = 'Category'`, [pid])).rows[0];
    if (!catField) {
      const cnt = await query<{ c: string }>(`SELECT count(*)::text AS c FROM fields WHERE project_id = $1`, [pid]);
      await query(`INSERT INTO fields (project_id, name, type, options, position) VALUES ($1,'Category','single_select',$2,$3)`,
        [pid, JSON.stringify(['Dry goods', 'Fresh', 'Equipment']), Number(cnt.rows[0]?.c ?? 0)]);
    }
    const reqField = (await query<{ id: string }>(`SELECT id FROM fields WHERE project_id = $1 AND name = 'Requested by'`, [pid])).rows[0];
    if (!reqField) {
      const cnt = await query<{ c: string }>(`SELECT count(*)::text AS c FROM fields WHERE project_id = $1`, [pid]);
      await query(`INSERT INTO fields (project_id, name, type, options, position) VALUES ($1,'Requested by','text',NULL,$2)`,
        [pid, Number(cnt.rows[0]?.c ?? 0)]);
    }
    publish({ teamIds: [ctx.teamId], kind: 'fields', at: new Date().toISOString(), data: { projectId: pid } });
    res.status(201).json({ slug, section, title });
  });

  return r;
}
