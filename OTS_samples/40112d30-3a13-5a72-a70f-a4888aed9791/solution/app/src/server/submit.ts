import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Answers } from '../shared/types.ts';
import { M28 } from '../shared/messages.ts';
import { transaction } from './db.ts';
import { checkAnswers, resolve } from './engine/index.ts';
import { answersInvalid, idempotencyConflict, idempotencyKeyRequired, notFound } from './errors.ts';
import { engineEnv, loadForm, settle } from './forms.ts';
import { bodyObject, sendJson, type Ctx } from './http.ts';
import { assertWritable, holdResponse } from './respondent.ts';
import { hitSubmitLimit } from './rate.ts';
import { answerLines } from './mailtext.ts';
import { referenceOf } from './ids.ts';
import { deliverNow, enqueue } from './outbox.ts';
import { isoWithOffset, now } from './time.ts';
import { validEmail } from './auth.ts';
import { publishSummary, publishFormEvent } from './hub.ts';
import { summarize } from './summary.ts';
import { frameFor } from './lifecycle.ts';
import { discardFiles } from './uploads.ts';

// Submit: one response and one email copy per idempotency key, settled one at a time against the form's limit row
// (brief: Submit, The limit).

interface SubmitReply { id: string; reference: string; submitted_at: string; edition: number; copy: 'sent' | 'queued' | 'none'; replayed: boolean }

const bodyHash = (body: Record<string, unknown>): string => createHash('sha256').update(JSON.stringify(body)).digest('hex');

async function recordedReply(tx: PoolClient, key: string, responseId: string, hash: string): Promise<SubmitReply | null> {
  const { rows } = await tx.query<{ response_id: string; body_hash: string; result: SubmitReply }>(
    'SELECT response_id, body_hash, result FROM idempotency WHERE key = $1', [key],
  );
  const found = rows[0];
  if (!found) return null;
  if (found.response_id !== responseId || found.body_hash !== hash) throw idempotencyConflict();
  return { ...found.result, replayed: true };
}

export async function submit(ctx: Ctx): Promise<void> {
  const header = ctx.req.headers['idempotency-key'];
  const key = typeof header === 'string' && header.trim() ? header.trim() : null;
  let mail: number | null = null;
  let discarded: string[] = [];
  let formId = '';
  const reply = await transaction(async (tx) => {
    const held = await holdResponse(tx, ctx, ctx.params['id'] ?? '', true);
    formId = held.form.id;
    await hitSubmitLimit(ctx.ip);
    const hash = bodyHash(bodyObject(ctx));
    if (key) {
      const again = await recordedReply(tx, key, held.row.id, hash);
      if (again) return again;
    }
    await tx.query('SELECT form_id FROM form_limits WHERE form_id = $1 FOR UPDATE', [held.form.id]);
    const locked = await loadForm(tx, held.form.id);
    if (!locked) throw notFound();
    const fresh = { ...held, form: await settle(tx, locked) };
    await assertWritable(tx, fresh);
    if (!key) throw idempotencyKeyRequired();
    const env = engineEnv();
    const errors = checkAnswers(held.def, held.row.answers, env, { kind: 'all' });
    if (errors.length) throw answersInvalid(errors);

    const submittedAt = now();
    const res = resolve(held.def, held.row.answers, engineEnv(submittedAt));
    const kept: Answers = Object.fromEntries(Object.entries(held.row.answers).filter(([k]) => res.counting.includes(k)));
    discarded = Object.keys(held.row.answers).filter((k) => !(k in kept) && held.def.pages.some((p) => p.questions.some((q) => q.key === k && q.type === 'file')));
    const reference = referenceOf(held.row.id);
    const to = copyAddress(held.form.copy_to, kept);
    if (to) {
      mail = await enqueue(tx, to, `Your copy: ${held.def.title}`, [M28(reference), ...answerLines(res)].join('\n'));
    }
    await tx.query(`UPDATE responses SET status = 'submitted', answers = $2, submitted_at = $3, page = $4 WHERE id = $1`,
      [held.row.id, JSON.stringify(kept), submittedAt, held.row.page]);
    await settle(tx, fresh.form);
    const result: SubmitReply = {
      id: held.row.id, reference, submitted_at: isoWithOffset(submittedAt), edition: held.row.edition,
      copy: to ? 'queued' : 'none', replayed: false,
    };
    await tx.query('INSERT INTO idempotency (key, response_id, body_hash, result) VALUES ($1, $2, $3, $4)',
      [key, held.row.id, hash, JSON.stringify(result)]);
    return result;
  });
  if (reply.replayed) return sendJson(ctx, 200, reply);
  if (mail !== null) {
    const [sent] = await deliverNow([mail]);
    reply.copy = sent ? 'sent' : 'queued';
  }
  await discardFiles(ctx.params['id'] ?? '', discarded);
  await afterSubmit(formId);
  sendJson(ctx, 200, reply);
}

function copyAddress(copyTo: string | null, answers: Answers): string | null {
  const value = copyTo ? answers[copyTo] : undefined;
  return typeof value === 'string' && validEmail(value) ? value.trim() : null;
}

/** Everything that watches the form learns of the new response: the summary and the form state. */
export async function afterSubmit(formId: string): Promise<void> {
  await publishSummary(formId, await summarize(formId));
  const frame = await frameFor(formId);
  if (frame) await publishFormEvent(formId, { kind: 'frame', frame });
}
