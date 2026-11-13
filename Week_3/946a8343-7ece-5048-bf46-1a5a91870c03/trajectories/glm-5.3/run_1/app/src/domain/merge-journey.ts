import type { PoolClient } from 'pg';
import type { Ctx } from '../api/ctx.js';
import { closingKeywords, commitsBetween, commitMessagesOf } from './merge-service.js';

/** Close issues named by closing keywords when a request merges into the default branch. */
export async function closeIssuesForMerge(
  ctx: Ctx,
  c: PoolClient,
  project: { id: number; default_branch: string; path: string },
  mr: { iid: number; description: string; source: string; target: string },
  mergeCommit: string,
  actor: string,
): Promise<void> {
  if (mr.target !== project.default_branch) return;
  const iids = closingKeywords(mr.description);
  const commits = await commitsBetween(c, mr.source, mergeCommit);
  const messages = await commitMessagesOf(c, commits);
  for (const m of messages) {
    for (const n of closingKeywords(m)) iids.push(n);
  }
  const now = ctx.now();
  for (const iid of new Set(iids)) {
    const issue = (await c.query<{ id: number; state: string; confidential: boolean }>(`SELECT id, state, confidential FROM issues WHERE project_id = $1 AND iid = $2`, [project.id, iid])).rows[0];
    if (!issue || issue.state !== 'opened') continue;
    await c.query(`UPDATE issues SET state = 'closed', updated_at = $2 WHERE id = $1`, [issue.id, now]);
    await c.query(`INSERT INTO notes (project_id, author, body, system, pending, issue_id, issue_iid, created_at) VALUES ($1, $2, $3, true, false, $4, $5, $6)`,
      [project.id, actor, `Closed by !${mr.iid}.`, issue.id, iid, now]);
    await ctx.live(c, project.id, 'issue', { iid, state: 'closed', event: 'closed_by_merge' });
    const hooks = (await c.query<{ id: number }>(`SELECT id FROM webhooks WHERE project_id = $1 AND 'issue' = ANY(events)`, [project.id])).rows;
    for (const h of hooks) {
      if (issue.confidential) continue;
      await c.query(`INSERT INTO deliveries (webhook_id, event, payload, state, attempts, next_at, retry_step, created_at) VALUES ($1, 'issue', $2, 'pending', 0, $3, 0, $3)`,
        [h.id, JSON.stringify({ event: 'issue', action: 'close', project: { id: project.id }, issue: { iid, title: '', state: 'closed' } }), now]);
    }
  }
}

/** Retarget requests stacked on a merged request's source branch, oldest iid first, up to the limit. */
export async function retargetStacked(
  ctx: Ctx,
  c: PoolClient,
  project: { id: number; path: string },
  mr: { iid: number; source: string; target: string },
  limit: number,
): Promise<void> {
  const stacked = (await c.query<{ id: number; iid: number; target: string }>(`SELECT id, iid, target FROM merge_requests WHERE project_id = $1 AND state = 'opened' AND target = $2 ORDER BY iid`, [project.id, mr.source])).rows;
  const now = ctx.now();
  let count = 0;
  for (const s of stacked) {
    if (count >= limit) break;
    await c.query(`UPDATE merge_requests SET target = $2, updated_at = $3 WHERE id = $1`, [s.id, mr.target, now]);
    await c.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, 'system', $3, true, false, $4, $5)`,
      [project.id, `Retargeted from ${s.target} to ${mr.target} because !${mr.iid} merged.`, s.id, now]);
    count++;
  }
}
