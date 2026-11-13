// Issues: pinned to a version at a world point, moved through open, answered and closed.
import { randomUUID } from 'node:crypto';
import * as copy from '../shared/copy.ts';
import { ApiError, fieldError } from '../shared/errors.ts';
import { assertMayReopen, isIssueState, MINIMUM_ROLE, moveIssueTo } from '../shared/rules.ts';
import type { Issue, Rfi, RfiState } from '../shared/types.ts';
import { accessTo } from './access.ts';
import { requireUser } from './auth.ts';
import { type Body, objectBody, stringField } from './body.ts';
import { db, type Queryable } from './db.ts';
import { numberField } from './fields.ts';
import { hub } from './live.ts';
import { roleOnDrawing } from './roles.ts';
import { route } from './router.ts';

const SELECT_ISSUES = `SELECT i.id, i.version_id, s.drawing_id, i.title, i.x, i.y, i.state, i.creator,
    coalesce(array_agg(r.id ORDER BY r.seq) FILTER (WHERE r.id IS NOT NULL), '{}') AS rfi_ids
  FROM issues i JOIN versions v ON v.id = i.version_id JOIN sheets s ON s.id = v.sheet_id LEFT JOIN rfis r ON r.issue_id = i.id`;

/** Issues with their RFI ids, in creation order; `where` filters on the aliases `i` (issue), `v` (version) and `s` (sheet). */
async function selectIssues(q: Queryable, where: string, param: string): Promise<Issue[]> {
  return q.query<Issue>(`${SELECT_ISSUES} WHERE ${where} GROUP BY i.id, s.drawing_id ORDER BY i.seq`, [param]);
}

export const RFI_COLUMNS = 'id, issue_id, question, answer, state, asker, addressee, ball_in_court';

/** The RFIs of every issue of a drawing, in creation order. */
async function rfisOfDrawing(drawingId: string): Promise<Rfi[]> {
  return db.query<Rfi>(
    `SELECT ${RFI_COLUMNS} FROM rfis WHERE issue_id IN (
       SELECT i.id FROM issues i JOIN versions v ON v.id = i.version_id JOIN sheets s ON s.id = v.sheet_id WHERE s.drawing_id = $1)
      ORDER BY seq`,
    [drawingId],
  );
}

/** One issue; `not_found` for an unknown id. */
export async function loadIssue(issueId: string, q: Queryable = db): Promise<Issue> {
  const issues = await selectIssues(q, 'i.id = $1', issueId);
  if (issues.length === 0) throw new ApiError('not_found', copy.NOT_FOUND);
  return issues[0];
}

export interface IssueDraft { title: string; x: number; y: number }

export function issueDraft(body: Body): IssueDraft {
  const title = stringField(body, 'title').trim();
  if (title === '') throw fieldError('title', copy.ISSUE_TITLE);
  return { title, x: numberField(body, 'x'), y: numberField(body, 'y') };
}

export async function insertIssue(q: Queryable, versionId: string, draft: IssueDraft, creator: string, state: Issue['state'] = 'open'): Promise<string> {
  const id = randomUUID();
  await q.query(
    'INSERT INTO issues (id, version_id, title, x, y, state, creator) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, versionId, draft.title, draft.x, draft.y, state, creator],
  );
  return id;
}

route('POST', '/api/versions/:id/issues', async (ctx) => {
  const { drawingId } = await accessTo(ctx, 'version', ctx.params.id, MINIMUM_ROLE.raiseIssue);
  const id = await insertIssue(db, ctx.params.id, issueDraft(objectBody(ctx.json())), requireUser(ctx).username);
  const issue = await loadIssue(id);
  hub.broadcast(drawingId, { type: 'issue', data: { issue } });
  return ctx.reply(201, issue);
});

route('GET', '/api/drawings/:id/issues', async (ctx) => {
  await roleOnDrawing(ctx, ctx.params.id);
  return ctx.reply(200, { issues: await selectIssues(db, 's.drawing_id = $1', ctx.params.id), rfis: await rfisOfDrawing(ctx.params.id) });
});

route('POST', '/api/issues/:id/transitions', async (ctx) => {
  const { drawingId, role } = await accessTo(ctx, 'issue', ctx.params.id, MINIMUM_ROLE.raiseIssue);
  const to = objectBody(ctx.json()).to;
  if (!isIssueState(to)) throw fieldError('to', copy.TRANSITION_TARGET);
  const actor = { username: requireUser(ctx).username, manager: role === 'manage' };
  // the issue is locked for the read-check-write, so two requests that race each other see one state after the other
  const changed = await db.tx(async (q) => {
    await q.query('SELECT 1 FROM issues WHERE id = $1 FOR UPDATE', [ctx.params.id]);
    const issue = await loadIssue(ctx.params.id, q);
    assertMayReopen(to, issue.creator, actor);
    const rfis = await q.query<{ state: RfiState }>('SELECT state FROM rfis WHERE issue_id = $1', [issue.id]);
    await q.query('UPDATE issues SET state = $2 WHERE id = $1', [issue.id, moveIssueTo(issue.state, to, rfis.map((rfi) => rfi.state))]);
    return loadIssue(issue.id, q);
  });
  hub.broadcast(drawingId, { type: 'issue', data: { issue: changed } });
  return ctx.reply(200, changed);
});
