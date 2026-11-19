import { Router } from 'express';
import { query, withTx } from './db';
import { AuthedRequest, readBody, BODY_MAX } from './apiutil';
import { requireAuthFor } from './auth';
import { projectTeam } from './access';
import { TaskRow } from './taskjson';
import { publish } from './live';
import { runAndRecord, TriggerEvent } from './rules';

export function approvalsRouter(): Router {
  const r = Router();
  r.use(requireAuthFor('/api/tasks/', '/api/approvals/'));

  r.post('/api/tasks/:id/approval', readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const task = (await query<TaskRow>(`SELECT * FROM tasks WHERE id = $1`, [id])).rows[0];
    if (!task) { res.status(404).json({ error: 'not_found' }); return; }
    const ctx = await projectTeam(task.project_id, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    const body = req.body as { approverId?: unknown };
    const approverId = typeof body.approverId === 'string' ? body.approverId : '';
    const member = await query<{ person_id: string }>(
      `SELECT tm.person_id FROM team_members tm WHERE tm.team_id = $1 AND tm.person_id = $2`, [ctx.teamId, approverId]);
    if (!member.rows[0]) { res.status(422).json({ errors: { approverId: 'Choose a member of this team' } }); return; }
    const latest = (await query<{ status: string }>(
      `SELECT status FROM approvals WHERE task_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, [id])).rows[0];
    if (latest && latest.status === 'requested') { res.status(409).json({ error: 'already_requested' }); return; }
    const ins = await query<{ id: string }>(
      `INSERT INTO approvals (task_id, approver_id, requester_id, status) VALUES ($1,$2,$3,'requested') RETURNING id`,
      [id, approverId, ar.personId ?? null]);
    const approverName = (await query<{ name: string }>(`SELECT name FROM people WHERE id = $1`, [approverId])).rows[0]?.name ?? '';
    await query(`INSERT INTO inbox_items (person_id, text, task_id, kind) VALUES ($1,$2,$3,'approval')`,
      [approverId, `Approval requested: ${task.name}`, id]);
    publish({ teamIds: [ctx.teamId], kind: 'approval', at: new Date().toISOString(), data: { taskId: id, projectId: task.project_id } });
    void ins;
    res.status(201).json({ status: 'requested', approverId });
  });

  r.post('/api/tasks/:id/decision', readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const id = String(req.params.id);
    const task = (await query<TaskRow>(`SELECT * FROM tasks WHERE id = $1`, [id])).rows[0];
    if (!task) { res.status(404).json({ error: 'not_found' }); return; }
    const ctx = await projectTeam(task.project_id, ar.teamIds, ar.personRole);
    if (!ctx) { res.status(404).json({ error: 'not_found' }); return; }
    const latest = (await query<{ id: string; approver_id: string; status: string; requester_id: string | null }>(
      `SELECT id, approver_id, status, requester_id FROM approvals WHERE task_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, [id])).rows[0];
    if (!latest) { res.status(404).json({ error: 'not_found' }); return; }
    if (latest.approver_id !== ar.personId) { res.status(403).json({ error: 'forbidden' }); return; }
    if (latest.status !== 'requested') { res.status(409).json({ error: 'already_decided' }); return; }
    const body = req.body as { decision?: unknown; comment?: unknown };
    const decision = typeof body.decision === 'string' ? body.decision : '';
    if (!['approve', 'request_changes', 'reject'].includes(decision)) {
      res.status(422).json({ errors: { decision: 'Choose a decision' } });
      return;
    }
    const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
    if ((decision === 'request_changes' || decision === 'reject') && !comment) {
      res.status(422).json({ errors: { comment: 'Add a comment for this decision' } });
      return;
    }
    if (comment.length > 500) { res.status(422).json({ errors: { comment: 'Comment must be 500 characters or fewer' } }); return; }
    const status = decision === 'approve' ? 'approved' : decision === 'request_changes' ? 'changes_requested' : 'rejected';
    await withTx(async (client) => {
      await client.query(`UPDATE approvals SET status = $1, comment = $2, decided_at = now() WHERE id = $3`, [status, comment || null, latest.id]);
      await client.query(`INSERT INTO task_history (task_id, text) VALUES ($1,$2)`,
        [id, `${ar.personName ?? 'Someone'} decided ${status === 'approved' ? 'Approved' : status === 'changes_requested' ? 'Changes requested' : 'Rejected'}`]);
      const approverName = (await client.query<{ name: string }>(`SELECT name FROM people WHERE id = $1`, [latest.approver_id])).rows[0]?.name ?? '';
      const text = decision === 'approve'
        ? `${approverName} approved ${task.name}`
        : decision === 'request_changes'
          ? `${approverName} requested changes on ${task.name}`
          : `${approverName} rejected ${task.name}`;
      if (latest.requester_id) {
        await client.query(`INSERT INTO inbox_items (person_id, text, task_id, kind) VALUES ($1,$2,$3,'decision')`,
          [latest.requester_id, text, id]);
      }
      const ev: TriggerEvent = {
        projectId: task.project_id, type: 'approval_decided', taskId: id,
        eventId: `decision:${latest.id}`,
      };
      await runAndRecord(client, ev, id);
    });
    publish({ teamIds: [ctx.teamId], kind: 'approval', at: new Date().toISOString(), data: { taskId: id, projectId: task.project_id } });
    res.json({ status });
  });

  return r;
}
