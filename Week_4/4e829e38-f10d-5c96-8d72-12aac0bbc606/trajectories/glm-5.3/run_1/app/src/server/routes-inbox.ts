import { Router } from 'express';
import { query } from './db';
import { AuthedRequest, readBody, BODY_MAX } from './apiutil';
import { requireAuthFor } from './auth';

export function inboxRouter(): Router {
  const r = Router();
  r.use(requireAuthFor('/api/inbox'));

  r.get('/api/inbox', async (req, res) => {
    const ar = req as AuthedRequest;
    const rows = await query<{ id: string; text: string; task_id: string | null; kind: string; read: boolean; created_at: string }>(
      `SELECT id, text, task_id, kind, read, created_at FROM inbox_items
        WHERE person_id = $1 AND archived = false ORDER BY created_at DESC, id DESC`, [ar.personId]);
    const unread = rows.rows.filter(x => !x.read).length;
    res.json({
      unread,
      items: rows.rows.map(x => ({ id: x.id, text: x.text, taskId: x.task_id, kind: x.kind, read: x.read, createdAt: x.created_at })),
    });
  });

  r.patch('/api/inbox/:id', readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const body = req.body as { read?: unknown; archived?: unknown };
    const cur = (await query<{ id: string }>(`SELECT id FROM inbox_items WHERE id = $1 AND person_id = $2`, [id, ar.personId])).rows[0];
    if (!cur) { res.status(404).json({ error: 'not_found' }); return; }
    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.read !== undefined) { params.push(Boolean(body.read)); sets.push(`read = $${params.length}`); }
    if (body.archived !== undefined) { params.push(Boolean(body.archived)); sets.push(`archived = $${params.length}`); }
    if (sets.length === 0) { res.status(422).json({ errors: { body: 'Send a JSON body' } }); return; }
    params.push(id);
    const updated = await query<{ id: string; text: string; task_id: string | null; kind: string; read: boolean; created_at: string }>(
      `UPDATE inbox_items SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, text, task_id, kind, read, created_at`, params);
    const x = updated.rows[0];
    res.json({ id: x.id, text: x.text, taskId: x.task_id, kind: x.kind, read: x.read, createdAt: x.created_at });
  });

  return r;
}
