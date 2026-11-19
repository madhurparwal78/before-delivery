import { randomUUID } from 'node:crypto';
import { isUuid, requireAction, requireActor, type Actor } from '../auth.js';
import { query, queryOne } from '../db/pool.js';
import { publish } from '../events.js';
import { ApiError, conflict, notFound } from '../http/errors.js';
import { json, type Router } from '../http/router.js';
import { FieldErrors } from '../http/validate.js';
import { correctionView, loadCorrection, loadSegmentView, recomputeWer, type CorrectionRow } from '../review.js';
import { fieldCopy } from '../../shared/copy.js';
import { checkText } from '../../shared/text.js';
import { requireVisibleSession } from './sessionroutes.js';

const invalidTransition = (): ApiError => conflict('invalid_transition', 'This correction was already decided.');

const requireVisibleCorrection = async (actor: Actor, correctionId: string): Promise<CorrectionRow> => {
  if (!isUuid(correctionId)) throw notFound();
  const correction = await loadCorrection(correctionId);
  if (correction === null) throw notFound();
  await requireVisibleSession(actor, correction.session_id);
  return correction;
};

export const registerReviewRoutes = (router: Router): void => {
  router.add('POST', '/api/sessions/:sessionId/segments/:segmentId/corrections', async (ctx) => {
    const actor = await requireActor(ctx);
    const session = await requireVisibleSession(actor, ctx.params.sessionId as string);
    requireAction(actor, 'write_corrections');
    const segmentId = ctx.params.segmentId as string;
    if (!isUuid(segmentId)) throw notFound();
    const segment = await queryOne<{ id: string }>('select id from segments where id = $1 and session_id = $2', [
      segmentId,
      session.id,
    ]);
    if (segment === null) throw notFound();
    const body = ctx.body;

    const existing = await queryOne<{ id: string }>(
      "select id from corrections where segment_id = $1 and state in ('draft','submitted','returned')",
      [segmentId],
    );
    if (existing !== null) throw conflict('correction_open', 'Another reviewer already has an open correction.');

    const fields = new FieldErrors();
    const text = checkText(body.text, 1, 500);
    if (!text.ok) fields.add('text', fieldCopy.correctionText);
    fields.raiseIfAny();

    const id = randomUUID();
    const created = await query<{ id: string }>(
      `insert into corrections (id, session_id, segment_id, author_id, state, text)
       values ($1, $2, $3, $4, 'draft', $5)
       on conflict (segment_id) where state in ('draft','submitted','returned') do nothing returning id`,
      [id, session.id, segmentId, actor.member.id, text.value],
    );
    if (created.length === 0) throw conflict('correction_open', 'Another reviewer already has an open correction.');
    const row = await loadCorrection(id);
    if (row === null) throw notFound();
    return json(201, { correction: correctionView(row) });
  }, 'json');

  router.add('PATCH', '/api/corrections/:correctionId', async (ctx) => {
    const actor = await requireActor(ctx);
    const correction = await requireVisibleCorrection(actor, ctx.params.correctionId as string);
    requireAction(actor, 'write_corrections');
    if (correction.author_id !== actor.member.id) throw new ApiError(403, 'not_author', 'Only the author can edit it.');
    if (correction.state !== 'draft') throw invalidTransition();
    const body = ctx.body;
    const fields = new FieldErrors();
    const text = checkText(body.text, 1, 500);
    if (!text.ok) fields.add('text', fieldCopy.correctionText);
    fields.raiseIfAny();
    await query("update corrections set text = $2 where id = $1 and state = 'draft'", [correction.id, text.value]);
    const row = await loadCorrection(correction.id);
    if (row === null) throw notFound();
    return json(200, { correction: correctionView(row) });
  }, 'json');

  router.add('POST', '/api/corrections/:correctionId/submit', async (ctx) => {
    const actor = await requireActor(ctx);
    const correction = await requireVisibleCorrection(actor, ctx.params.correctionId as string);
    requireAction(actor, 'write_corrections');
    if (correction.author_id !== actor.member.id)
      throw new ApiError(403, 'not_author', 'Only the author can submit it.');
    const moved = await query<{ id: string }>(
      "update corrections set state = 'submitted', submitted_at = now() where id = $1 and state = 'draft' returning id",
      [correction.id],
    );
    if (moved.length === 0) throw invalidTransition();
    const row = await loadCorrection(correction.id);
    if (row === null) throw notFound();
    return json(200, { correction: correctionView(row) });
  });

  router.add('POST', '/api/corrections/:correctionId/reopen', async (ctx) => {
    const actor = await requireActor(ctx);
    const correction = await requireVisibleCorrection(actor, ctx.params.correctionId as string);
    requireAction(actor, 'write_corrections');
    if (correction.author_id !== actor.member.id)
      throw new ApiError(403, 'not_author', 'Only the author can reopen it.');
    const moved = await query<{ id: string }>(
      "update corrections set state = 'draft', decided_at = null, decided_by = null, submitted_at = null, note = null where id = $1 and state = 'returned' returning id",
      [correction.id],
    );
    if (moved.length === 0) throw invalidTransition();
    const row = await loadCorrection(correction.id);
    if (row === null) throw notFound();
    return json(200, { correction: correctionView(row) });
  });

  /** Exactly one of two simultaneous decisions wins; the other changes nothing. */
  router.add('POST', '/api/corrections/:correctionId/approve', async (ctx) => {
    const actor = await requireActor(ctx);
    const correction = await requireVisibleCorrection(actor, ctx.params.correctionId as string);
    requireAction(actor, 'decide_corrections');
    if (correction.author_id === actor.member.id)
      throw new ApiError(403, 'own_correction', "You can't approve your own correction.");
    const moved = await query<{ id: string }>(
      "update corrections set state = 'approved', decided_at = now(), decided_by = $2 where id = $1 and state = 'submitted' returning id",
      [correction.id, actor.member.id],
    );
    if (moved.length === 0) throw invalidTransition();
    const wer = await recomputeWer(correction.session_id);
    const segment = await loadSegmentView(correction.segment_id);
    if (segment === null) throw notFound();
    publish(correction.session_id, { type: 'correction', segment, wer });
    const row = await loadCorrection(correction.id);
    if (row === null) throw notFound();
    return json(200, { correction: correctionView(row), segment, wer });
  });

  router.add('POST', '/api/corrections/:correctionId/return', async (ctx) => {
    const actor = await requireActor(ctx);
    const correction = await requireVisibleCorrection(actor, ctx.params.correctionId as string);
    requireAction(actor, 'decide_corrections');
    if (correction.author_id === actor.member.id)
      throw new ApiError(403, 'own_correction', "You can't return your own correction.");
    if (correction.state !== 'submitted') throw invalidTransition();
    const body = ctx.body;
    const fields = new FieldErrors();
    const note = checkText(body.note, 1, 500);
    if (!note.ok) fields.add('note', fieldCopy.returnNote);
    fields.raiseIfAny();
    const moved = await query<{ id: string }>(
      "update corrections set state = 'returned', decided_at = now(), decided_by = $2, note = $3 where id = $1 and state = 'submitted' returning id",
      [correction.id, actor.member.id, note.value],
    );
    if (moved.length === 0) throw invalidTransition();
    const row = await loadCorrection(correction.id);
    if (row === null) throw notFound();
    return json(200, { correction: correctionView(row) });
  }, 'json');
};
