// RFIs: questions linked both ways with an issue, passed between the asker and the addressee (ball in court).
import { randomUUID } from 'node:crypto';
import * as copy from '../shared/copy.ts';
import { ApiError, fieldError } from '../shared/errors.ts';
import { ballFor, isRfiState, MINIMUM_ROLE, moveRfiTo } from '../shared/rules.ts';
import type { Rfi } from '../shared/types.ts';
import { accessTo } from './access.ts';
import { normalizeUsername, requireUser } from './auth.ts';
import { objectBody, stringField } from './body.ts';
import { db, type Queryable } from './db.ts';
import { loadIssue, RFI_COLUMNS } from './issues.ts';
import { hub } from './live.ts';
import { folderRole } from './roles.ts';
import { route } from './router.ts';

/** One RFI; `not_found` for an unknown id. */
async function loadRfi(rfiId: string, q: Queryable = db): Promise<Rfi> {
  const rows = await q.query<Rfi>(`SELECT ${RFI_COLUMNS} FROM rfis WHERE id = $1`, [rfiId]);
  if (rows.length === 0) throw new ApiError('not_found', copy.NOT_FOUND);
  return rows[0];
}

/** A new RFI is a draft with the ball in court of its asker. */
export async function insertRfi(
  q: Queryable, issueId: string, rfi: Pick<Rfi, 'question' | 'asker' | 'addressee'>, state: Rfi['state'] = 'draft', answer: string | null = null,
): Promise<string> {
  const id = randomUUID();
  const ball = ballFor(state, rfi.asker, rfi.addressee);
  await q.query(
    'INSERT INTO rfis (id, issue_id, question, answer, state, asker, addressee, ball_in_court) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [id, issueId, rfi.question, answer, state, rfi.asker, rfi.addressee, ball],
  );
  return id;
}

route('POST', '/api/issues/:id/rfis', async (ctx) => {
  const { drawingId, folderId } = await accessTo(ctx, 'issue', ctx.params.id, MINIMUM_ROLE.askRfi);
  const body = objectBody(ctx.json());
  const question = stringField(body, 'question').trim();
  if (question === '') throw fieldError('question', copy.RFI_QUESTION);
  const asker = requireUser(ctx).username;
  const addressee = normalizeUsername(stringField(body, 'addressee'));
  if (addressee === asker || (await folderRole(addressee, folderId)) === null) throw fieldError('addressee', copy.RFI_ADDRESSEE);
  const rfi = await loadRfi(await insertRfi(db, ctx.params.id, { question, asker, addressee }));
  hub.broadcast(drawingId, { type: 'rfi', data: { rfi, issue: await loadIssue(ctx.params.id) } });
  return ctx.reply(201, rfi);
});

route('POST', '/api/rfis/:id/transitions', async (ctx) => {
  const { drawingId } = await accessTo(ctx, 'rfi', ctx.params.id);
  const body = objectBody(ctx.json());
  if (!isRfiState(body.to)) throw fieldError('to', copy.TRANSITION_TARGET);
  const to = body.to;
  const answer = typeof body.answer === 'string' ? body.answer : undefined;
  const actor = requireUser(ctx).username;
  // the RFI is locked for the read-check-write, so two requests that race each other see one state after the other
  const changed = await db.tx(async (q) => {
    await q.query('SELECT 1 FROM rfis WHERE id = $1 FOR UPDATE', [ctx.params.id]);
    const rfi = await loadRfi(ctx.params.id, q);
    const moved = moveRfiTo(rfi, to, answer, actor);
    await q.query('UPDATE rfis SET state = $2, answer = $3, ball_in_court = $4 WHERE id = $1', [rfi.id, moved.state, moved.answer, moved.ball_in_court]);
    return loadRfi(rfi.id, q);
  });
  hub.broadcast(drawingId, { type: 'rfi', data: { rfi: changed, issue: await loadIssue(changed.issue_id) } });
  return ctx.reply(200, changed);
});
