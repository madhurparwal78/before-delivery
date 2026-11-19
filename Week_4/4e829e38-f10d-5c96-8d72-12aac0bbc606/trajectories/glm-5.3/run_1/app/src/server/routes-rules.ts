import { Router } from 'express';
import { query, withTx } from './db';
import { AuthedRequest, readBody, BODY_MAX } from './apiutil';
import { requireAuthFor } from './auth';
import { projectTeam } from './access';
import { env } from './env';
import { TaskRow } from './taskjson';
import { publish } from './live';
import { runAndRecord, TriggerEvent } from './rules';
import { addHistory } from './rules';

export function rulesRouter(): Router {
  const r = Router();
  r.use(requireAuthFor('/api/projects/', '/api/rules/'));

  r.get('/api/projects/:id/rules', async (req, res) => {
    const ar = req as AuthedRequest;
    const ctx = await projectTeam(String(req.params.id), ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    const rows = await query(
      `SELECT id, name, trigger, condition, action, position FROM rules WHERE project_id = $1 ORDER BY position, created_at`, [String(req.params.id)]);
    res.json({ rules: rows.rows });
  });

  r.post('/api/projects/:id/rules', readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const pid = String(req.params.id);
    const ctx = await projectTeam(pid, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    if (!ctx.isCoordinator) { res.status(403).json({ error: 'forbidden' }); return; }
    const body = req.body as { name?: unknown; trigger?: unknown; condition?: unknown; action?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) { res.status(422).json({ errors: { name: 'Enter a rule name' } }); return; }
    const trig = body.trigger as { type?: string; field?: string; value?: string; section?: string } | undefined;
    if (!trig || typeof trig.type !== 'string') { res.status(422).json({ errors: { trigger: 'Choose when the rule runs' } }); return; }
    const validTriggers = ['task_added', 'field_changed', 'moved_to_section', 'due_date_arrives', 'approval_decided'];
    if (!validTriggers.includes(trig.type)) { res.status(422).json({ errors: { trigger: 'Choose when the rule runs' } }); return; }
    if (trig.type === 'field_changed' && !trig.field) { res.status(422).json({ errors: { trigger: 'Choose when the rule runs' } }); return; }
    if (trig.type === 'moved_to_section' && !trig.section) { res.status(422).json({ errors: { trigger: 'Choose when the rule runs' } }); return; }
    const action = body.action as { type?: string; target?: string; value?: string } | undefined;
    if (!action || typeof action.type !== 'string') { res.status(422).json({ errors: { action: 'Choose what happens' } }); return; }
    const validActions = ['set_field', 'move_to_section', 'assign_to', 'add_subtask', 'send_to_inbox'];
    if (!validActions.includes(action.type)) { res.status(422).json({ errors: { action: 'Choose what happens' } }); return; }
    if ((action.type === 'set_field' || action.type === 'move_to_section' || action.type === 'assign_to') && !action.target) {
      res.status(422).json({ errors: { action: 'Choose what happens' } });
      return;
    }
    if (action.type === 'add_subtask' && !action.value) { res.status(422).json({ errors: { action: 'Choose what happens' } }); return; }
    const cond = body.condition as { field?: string; op?: string; value?: string } | undefined;
    if (cond !== undefined && cond !== null) {
      if (!cond.field || !cond.op) { res.status(422).json({ errors: { action: 'Choose what happens' } }); return; }
    }
    const cnt = await query<{ c: string }>(`SELECT count(*)::text AS c FROM rules WHERE project_id = $1`, [pid]);
    const pos = Number(cnt.rows[0]?.c ?? 0) + 1;
    const ins = await query(
      `INSERT INTO rules (project_id, name, trigger, condition, action, position) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, trigger, condition, action, position`,
      [pid, name, JSON.stringify(trig), cond ? JSON.stringify(cond) : null, JSON.stringify(action), pos]);
    publish({ teamIds: [ctx.teamId], kind: 'rules', at: new Date().toISOString(), data: { projectId: pid } });
    res.status(201).json(ins.rows[0]);
  });

  r.delete('/api/rules/:id', async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const rule = (await query<{ project_id: string }>(`SELECT project_id FROM rules WHERE id = $1`, [id])).rows[0];
    if (!rule) { res.status(404).json({ error: 'not_found' }); return; }
    const ctx = await projectTeam(rule.project_id, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    if (!ctx.isCoordinator) { res.status(403).json({ error: 'forbidden' }); return; }
    await query(`DELETE FROM rules WHERE id = $1`, [id]);
    publish({ teamIds: [ctx.teamId], kind: 'rules', at: new Date().toISOString(), data: { projectId: rule.project_id } });
    res.status(204).end();
  });

  return r;
}

export { runAndRecord, TriggerEvent, addHistory, withTx };
