import type { ClosedReason, FormState, Settings, ServerFrame } from '../shared/types.ts';
import { M79, M80, M81 } from '../shared/messages.ts';
import type { PoolClient } from 'pg';
import { pool, transaction } from './db.ts';
import { definitionProblems } from './engine/index.ts';
import { formDraft, formOpen, formulaProblems, validationFailed } from './errors.ts';
import {
  closedText, engineEnv, limitReached, loadEdition, requireAccess, settingsOf, settle, settledForm, submittedCount, timeReached, type FormRow,
} from './forms.ts';
import { deliverFormEvent, formIdsWithPeers, publishFormEvent } from './hub.ts';
import { now, parseLocal } from './time.ts';

// The form state machine in one place: publish, close, reopen, settings, and the settling of time and limit
// (brief: Closing rules, Form state machine).

async function publishDraft(tx: PoolClient, form: FormRow): Promise<number> {
  const problems = definitionProblems(form.draft, engineEnv());
  if (problems.length) {
    throw formulaProblems(problems.map(({ key, message }) => ({ key, message })));
  }
  const { rows } = await tx.query<{ next: number }>('SELECT coalesce(max(number), 0) + 1 AS next FROM editions WHERE form_id = $1', [form.id]);
  const number = rows[0]?.next ?? 1;
  await tx.query('INSERT INTO editions (form_id, number, definition, published_at) VALUES ($1, $2, $3, $4)', [form.id, number, JSON.stringify(form.draft), now()]);
  await tx.query('UPDATE forms SET live_edition = $2 WHERE id = $1', [form.id, number]);
  return number;
}

export async function frameFor(formId: string): Promise<ServerFrame | null> {
  const form = await settledForm(pool, formId);
  if (!form) return null;
  const count = form.state === 'closed' ? await submittedCount(pool, formId) : 0;
  return { type: 'form_state', state: form.state, closed_reason: form.closed_reason, closed: closedText(form, count) };
}

async function pushFormState(formId: string): Promise<void> {
  const frame = await frameFor(formId);
  if (frame) await publishFormEvent(formId, { kind: 'frame', frame });
}

export async function publish(userId: string, formId: string): Promise<{ edition: number }> {
  const edition = await transaction(async (tx) => {
    const { form } = await requireAccess(tx, userId, formId, { ownerOnly: true }, true);
    const number = await publishDraft(tx, form);
    if (form.state === 'draft') await tx.query(`UPDATE forms SET state = 'open' WHERE id = $1`, [form.id]);
    await settle(tx, { ...form, state: form.state === 'draft' ? 'open' : form.state });
    return number;
  });
  await pushFormState(formId);
  return { edition };
}

export async function close(userId: string, formId: string): Promise<{ state: FormState; closed_reason: ClosedReason }> {
  const result = await transaction(async (tx) => {
    const access = await requireAccess(tx, userId, formId, { ownerOnly: true }, true);
    const form = await settle(tx, access.form);
    if (form.state === 'draft') throw formDraft();
    if (form.state === 'open') await tx.query(`UPDATE forms SET state = 'closed', closed_reason = 'hand' WHERE id = $1`, [formId]);
    return { state: 'closed' as const, closed_reason: form.state === 'open' ? 'hand' as const : form.closed_reason };
  });
  await pushFormState(formId);
  return result;
}

export async function reopen(userId: string, formId: string): Promise<{ state: 'open'; edition: number }> {
  const edition = await transaction(async (tx) => {
    const access = await requireAccess(tx, userId, formId, { ownerOnly: true }, true);
    const form = await settle(tx, access.form);
    if (form.state === 'draft') throw formDraft();
    if (form.state === 'open') throw formOpen();
    const number = await publishDraft(tx, form);
    const clearTime = timeReached(form);
    const clearLimit = limitReached(form, await submittedCount(tx, formId));
    await tx.query(
      `UPDATE forms SET state = 'open', closed_reason = NULL,
         closes_at = CASE WHEN $2 THEN NULL ELSE closes_at END,
         response_limit = CASE WHEN $3 THEN NULL ELSE response_limit END
       WHERE id = $1`,
      [formId, clearTime, clearLimit],
    );
    return number;
  });
  await pushFormState(formId);
  return { state: 'open', edition };
}

const MAX_LIMIT = 2_147_483_647;

function positiveWhole(value: unknown): number | null {
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_LIMIT ? n : null;
}

export async function saveSettings(userId: string, formId: string, readBody: () => Record<string, unknown>): Promise<{ settings: Settings; state: FormState; closed_reason: ClosedReason }> {
  const result = await transaction(async (tx) => {
    const { form } = await requireAccess(tx, userId, formId, { ownerOnly: true }, true);
    const body = readBody();
    const items = [];
    let closesAt: Date | null = null;
    if (body['closes_at'] !== null && body['closes_at'] !== undefined && body['closes_at'] !== '') {
      closesAt = typeof body['closes_at'] === 'string' ? parseLocal(body['closes_at']) : null;
      if (!closesAt) items.push({ key: 'closes_at', message: M79 });
    }
    const limitGiven = body['response_limit'] !== null && body['response_limit'] !== undefined && body['response_limit'] !== '';
    const limit = limitGiven ? positiveWhole(body['response_limit']) : null;
    if (limitGiven && limit === null) items.push({ key: 'response_limit', message: M80 });
    const message = typeof body['closed_message'] === 'string' && body['closed_message'].trim() ? body['closed_message'] : null;
    const copyTo = typeof body['copy_to'] === 'string' && body['copy_to'] !== '' ? body['copy_to'] : null;
    if (copyTo !== null && !(await isEmailQuestion(tx, form, copyTo))) items.push({ key: 'copy_to', message: M81 });
    if (items.length) throw validationFailed(items);
    await tx.query('UPDATE forms SET closes_at = $2, response_limit = $3, closed_message = $4, copy_to = $5 WHERE id = $1', [formId, closesAt, limit, message, copyTo]);
    const saved = await settle(tx, { ...form, closes_at: closesAt, response_limit: limit, closed_message: message, copy_to: copyTo });
    return { settings: settingsOf(saved), state: saved.state, closed_reason: saved.closed_reason };
  });
  await pushFormState(formId);
  return result;
}

async function isEmailQuestion(tx: PoolClient, form: FormRow, key: string): Promise<boolean> {
  const definitions = [form.draft];
  if (form.live_edition !== null) definitions.push(await loadEdition(tx, form.id, form.live_edition));
  return definitions.some((def) => def.pages.some((page) => page.questions.some(
    (q) => q.key === key && (q.type === 'short_text' || q.type === 'long_text') && q.pattern === 'email',
  )));
}

// ---- Pushing the form state of every form that has open sockets, so time and the grading clock are followed ----

const TICK_MS = 600;
const pushed = new Map<string, string>();

export function followFormStates(): void {
  setInterval(() => {
    const open = new Set(formIdsWithPeers());
    for (const id of [...pushed.keys()]) if (!open.has(id)) pushed.delete(id);
    for (const id of open) {
      void frameFor(id).then((frame) => {
        if (!frame) return;
        const signature = JSON.stringify(frame);
        const known = pushed.get(id);
        pushed.set(id, signature);
        if (known !== signature) deliverFormEvent(id, { kind: 'frame', frame });
      }).catch(() => undefined);
    }
  }, TICK_MS).unref();
}
