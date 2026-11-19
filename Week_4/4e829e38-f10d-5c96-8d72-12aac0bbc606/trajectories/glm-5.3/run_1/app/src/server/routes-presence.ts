import { Router } from 'express';
import { query } from './db';
import { readBody, BODY_MAX, AuthedRequest } from './apiutil';
import { requireAuthFor } from './auth';
import { env } from './env';
import { now } from './clock';
import { publish } from './live';

/** Viewer presence: who has a task open, lapsing on the server clock. */
export function presenceRouter(): Router {
  const r = Router();
  r.use(requireAuthFor('/api/presence/'));

  r.post('/api/presence/:taskId', readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const taskId = String(req.params.taskId);
    const body = (req as AuthedRequest).body as { viewId?: unknown };
    const viewId = typeof body.viewId === 'string' ? body.viewId : '';
    if (!viewId) { res.status(422).json({ errors: { viewId: 'Send a JSON body' } }); return; }
    const nowDate = await now();
    const expires = new Date(nowDate.getTime() + env().limits.holdTimeoutMs);
    await query(
      `INSERT INTO presence (task_id, person_id, view_id, expires_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (task_id, view_id) DO UPDATE SET person_id = $2, expires_at = $4`,
      [taskId, ar.personId, viewId, expires]);
    const task = (await query<{ project_id: string }>(`SELECT project_id FROM tasks WHERE id = $1`, [taskId])).rows[0];
    if (task) {
      const team = (await query<{ team_id: string }>(`SELECT team_id FROM projects WHERE id = $1`, [task.project_id])).rows[0];
      if (team) publish({ teamIds: [team.team_id], kind: 'presence', at: new Date().toISOString(), data: { taskId } });
    }
    res.json({ ok: true, expiresAt: expires.toISOString() });
  });

  r.delete('/api/presence/:viewId', async (req, res) => {
    await query(`DELETE FROM presence WHERE view_id = $1`, [String(req.params.viewId)]);
    res.status(204).end();
  });

  return r;
}
