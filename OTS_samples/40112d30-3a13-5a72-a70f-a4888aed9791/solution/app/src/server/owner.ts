import { randomBytes, randomUUID } from 'node:crypto';
import type { FormDefinition, ResponseView, ResponseItem } from '../shared/types.ts';
import { M50, M68, M75, M78 } from '../shared/messages.ts';
import { config } from './config.ts';
import { pool, transaction } from './db.ts';
import { evaluate, mergeAnswers } from './engine/index.ts';
import {
  answerInvalid, exportFailed, notFound, validationFailed,
} from './errors.ts';
import {
  engineEnv, formDetail, loadEdition, requireAccess, settle, submittedCount,
} from './forms.ts';
import { bodyObject, route, send, sendJson, type Ctx } from './http.ts';
import { requireUser, validEmail, type User } from './auth.ts';
import { applyChanges } from './changes.ts';
import { close, publish, reopen, saveSettings } from './lifecycle.ts';
import { deleteObject, getObject, putObject } from './s3.ts';
import { summarize } from './summary.ts';
import { loadSubmitted, submittedAtText } from './submitted.ts';
import { toCsv } from './csv.ts';
import { deliverNow, enqueue } from './outbox.ts';
import { hoursAfter, isoWithOffset, minutesFromNow, now } from './time.ts';
import { newSlug, uuidOr } from './ids.ts';
import { afterSubmit } from './submit.ts';

// The owner's and co-editor's routes (brief: API). Each handler runs the precedence in order:
// 401 (requireUser), 404 (requireAccess), 409, 422, 503.


const formId = (ctx: Ctx): string => ctx.params['id'] ?? '';
const MAX_EDITION = 2_147_483_647;

async function listForms(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const { rows } = await pool.query<{ id: string }>(
    `SELECT f.id FROM forms f WHERE f.owner_id = $1 OR EXISTS (SELECT 1 FROM form_editors e WHERE e.form_id = f.id AND e.user_id = $1)
     ORDER BY f.created_at DESC`, [user.id],
  );
  const forms = [];
  for (const { id } of rows) {
    const { form, role } = await requireAccess(pool, user.id, id);
    const settled = await settle(pool, form);
    forms.push({ id, title: settled.title, role, state: settled.state, edition: settled.live_edition, responses: await submittedCount(pool, id) });
  }
  sendJson(ctx, 200, { forms });
}

async function createForm(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const title = typeof bodyObject(ctx)['title'] === 'string' ? (bodyObject(ctx)['title'] as string).trim() : '';
  if (!title) throw validationFailed([{ key: 'title', message: M78 }]);
  const id = randomUUID();
  const slug = newSlug();
  const draft: FormDefinition = { title, intro: '', pages: [{ key: 'page_1', title: 'Page 1', questions: [] }], checks: [] };
  await transaction(async (tx) => {
    await tx.query('INSERT INTO forms (id, slug, owner_id, title, draft, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [id, slug, user.id, title, JSON.stringify(draft), now()]);
    await tx.query('INSERT INTO form_limits (form_id) VALUES ($1)', [id]);
  });
  sendJson(ctx, 201, { id, slug, title });
}

async function getForm(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const access = await requireAccess(pool, user.id, formId(ctx), { builder: true });
  sendJson(ctx, 200, await formDetail({ ...access, form: await settle(pool, access.form) }));
}

async function postChanges(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  await requireAccess(pool, user.id, formId(ctx), { builder: true });
  const changes = bodyObject(ctx)['changes'];
  if (!Array.isArray(changes)) throw validationFailed([{ key: 'changes', message: M68 }]);
  sendJson(ctx, 200, await applyChanges({ id: user.id, name: user.name }, formId(ctx), changes));
}

async function trial(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const { form } = await requireAccess(pool, user.id, formId(ctx), { builder: true });
  const body = bodyObject(ctx);
  const given = body['answers'];
  if (given === null || typeof given !== 'object' || Array.isArray(given)) throw validationFailed([{ key: 'answers', message: M68 }]);
  const merged = mergeAnswers(form.draft.pages.flatMap((p) => p.questions), {}, given as Record<string, unknown>);
  if (merged.invalid !== null) throw answerInvalid(merged.invalid);
  const answers = merged.answers;
  const seq = typeof body['seq'] === 'number' ? body['seq'] : 0;
  sendJson(ctx, 200, evaluate(form.draft, answers, engineEnv(), { audience: 'owner', seq }));
}

async function editions(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  await requireAccess(pool, user.id, formId(ctx));
  const { rows } = await pool.query<{ number: number; published_at: Date }>('SELECT number, published_at FROM editions WHERE form_id = $1 ORDER BY number', [formId(ctx)]);
  sendJson(ctx, 200, { editions: rows.map((r) => ({ number: r.number, published_at: isoWithOffset(r.published_at) })) });
}

async function edition(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  await requireAccess(pool, user.id, formId(ctx));
  const number = Number(ctx.params['number']);
  const { rows } = await pool.query<{ number: number; published_at: Date; definition: FormDefinition }>(
    'SELECT number, published_at, definition FROM editions WHERE form_id = $1 AND number = $2', [formId(ctx), Number.isSafeInteger(number) && number <= MAX_EDITION ? number : -1],
  );
  const row = rows[0];
  if (!row) throw notFound();
  sendJson(ctx, 200, { number: row.number, published_at: isoWithOffset(row.published_at), definition: row.definition });
}

async function listResponses(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  await requireAccess(pool, user.id, formId(ctx));
  const rows = (await loadSubmitted(pool, formId(ctx))).reverse();
  sendJson(ctx, 200, { responses: rows.map((r) => ({ id: r.id, reference: r.reference, submitted_at: submittedAtText(r), edition: r.edition })) });
}

async function viewResponse(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  await requireAccess(pool, user.id, formId(ctx));
  const [row] = await loadSubmitted(pool, formId(ctx), uuidOr(ctx.params['rid']));
  if (!row) throw notFound();
  const items: ResponseItem[] = row.res.questions
    .filter((q) => q.state === 'lit' && (q.type === 'calculated' || q.value !== null))
    .map((q) => ({
      key: q.key, label: q.label, text: q.text,
      value: q.calc ? q.calc.value : q.value,
      ...(q.note ? { note: q.note } : {}),
    }));
  const files = await pool.query<{ id: string; question_key: string; name: string; size: number; type: string }>(
    'SELECT id, question_key, name, size, type FROM files WHERE response_id = $1 ORDER BY question_key', [row.id],
  );
  const view: ResponseView = {
    id: row.id, reference: row.reference, edition: row.edition, submitted_at: submittedAtText(row), items,
    files: files.rows.map((f) => ({ key: f.question_key, name: f.name, size: f.size, type: f.type, url: `/api/forms/${formId(ctx)}/files/${f.id}` })),
  };
  sendJson(ctx, 200, view);
}

async function deleteResponse(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  await requireAccess(pool, user.id, formId(ctx), { ownerOnly: true });
  const rid = ctx.params['rid'] ?? '';
  const keys = await transaction(async (tx) => {
    const { rows } = await tx.query<{ object_key: string }>(
      `SELECT f.object_key FROM files f JOIN responses r ON r.id = f.response_id WHERE r.id = $1 AND r.form_id = $2 AND r.status = 'submitted'`,
      [uuidOr(rid), formId(ctx)],
    );
    const removed = await tx.query(`DELETE FROM responses WHERE id = $1 AND form_id = $2 AND status = 'submitted'`, [uuidOr(rid), formId(ctx)]);
    if (!removed.rowCount) throw notFound();
    return rows.map((r) => r.object_key);
  });
  await Promise.all(keys.map((key) => deleteObject(key).catch(() => undefined)));
  await afterSubmit(formId(ctx));
  ctx.res.writeHead(204, { 'Cache-Control': 'no-store' });
  ctx.res.end();
}

async function downloadFile(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  await requireAccess(pool, user.id, formId(ctx));
  const id = ctx.params['file'] ?? '';
  const { rows } = await pool.query<{ name: string; type: string; object_key: string }>(
    `SELECT f.name, f.type, f.object_key FROM files f JOIN responses r ON r.id = f.response_id
     WHERE f.id = $1 AND f.form_id = $2 AND r.status = 'submitted'`, [uuidOr(id), formId(ctx)],
  );
  const file = rows[0];
  if (!file) throw notFound();
  const stored = await getObject(file.object_key).catch(() => { throw exportFailed(); });
  send(ctx, 200, { 'Content-Type': file.type, 'Content-Disposition': `attachment; filename="${file.name}"; filename*=UTF-8''${encodeURIComponent(file.name)}` }, stored.body);
}

async function summary(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  await requireAccess(pool, user.id, formId(ctx));
  sendJson(ctx, 200, await summarize(formId(ctx)));
}

async function createExport(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const { form } = await requireAccess(pool, user.id, formId(ctx));
  const rows = await loadSubmitted(pool, form.id);
  const newest = form.live_edition === null ? [] : (await loadEdition(pool, form.id, form.live_edition)).pages.flatMap((p) => p.questions);
  const id = randomUUID();
  try {
    await putObject(`exports/${form.id}/${id}.csv`, Buffer.from(toCsv(rows, newest), 'utf8'), 'text/csv; charset=utf-8');
  } catch {
    throw exportFailed();
  }
  await pool.query('INSERT INTO exports (id, form_id, responses, created_at) VALUES ($1, $2, $3, $4)', [id, form.id, rows.length, now()]);
  sendJson(ctx, 201, { id, responses: rows.length, url: `/api/forms/${form.id}/exports/${id}` });
}

async function downloadExport(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const { form } = await requireAccess(pool, user.id, formId(ctx));
  const id = ctx.params['export'] ?? '';
  const { rows } = await pool.query<{ created_at: Date }>('SELECT created_at FROM exports WHERE id = $1 AND form_id = $2', [uuidOr(id), form.id]);
  const made = rows[0];
  if (!made || made.created_at.getTime() < minutesFromNow(-config.exportLinkTtlMinutes).getTime()) throw notFound();
  const stored = await getObject(`exports/${form.id}/${id}.csv`).catch(() => { throw exportFailed(); });
  send(ctx, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${form.slug}-responses.csv"` }, stored.body);
}

async function invite(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const { form } = await requireAccess(pool, user.id, formId(ctx), { ownerOnly: true });
  const email = bodyObject(ctx)['email'];
  if (!validEmail(email)) throw validationFailed([{ key: 'email', message: M75 }]);
  const token = randomBytes(24).toString('base64url');
  const address = email.trim();
  const mail = await transaction(async (tx) => {
    await tx.query('INSERT INTO invitations (token, form_id, email, inviter_id, expires_at) VALUES ($1, $2, $3, $4, $5)',
      [token, form.id, address, user.id, hoursAfter(now(), config.inviteTtlHours)]);
    return enqueue(tx, address, `Join ${form.draft.title} on Nightform`,
      [`${user.name} invited you to edit ${form.draft.title} on Nightform.`, '', `Open this link to join: ${config.baseUrl}/invite/${token}`].join('\n'));
  });
  void deliverNow([mail]);
  sendJson(ctx, 202, { message: M50(address) });
}

interface InvitationRow { form_id: string; title: string; expires_at: Date; used_at: Date | null; owner_id: string }

async function openInvitation(token: string): Promise<InvitationRow> {
  const { rows } = await pool.query<InvitationRow>(
    `SELECT i.form_id, f.title, i.expires_at, i.used_at, f.owner_id FROM invitations i JOIN forms f ON f.id = i.form_id WHERE i.token = $1`, [token],
  );
  const row = rows[0];
  if (!row || row.used_at || now().getTime() > row.expires_at.getTime()) throw notFound();
  return row;
}

async function invitationTitle(ctx: Ctx): Promise<void> {
  const row = await openInvitation(ctx.params['token'] ?? '');
  sendJson(ctx, 200, { form_title: row.title });
}

async function acceptInvitation(ctx: Ctx): Promise<void> {
  const user: User = await requireUser(ctx);
  const row = await openInvitation(ctx.params['token'] ?? '');
  await transaction(async (tx) => {
    const used = await tx.query('UPDATE invitations SET used_at = $2 WHERE token = $1 AND used_at IS NULL', [ctx.params['token'], now()]);
    if (!used.rowCount) throw notFound();
    if (row.owner_id !== user.id) {
      await tx.query('INSERT INTO form_editors (form_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [row.form_id, user.id]);
    }
  });
  sendJson(ctx, 200, { form_id: row.form_id });
}

export function registerOwnerRoutes(): void {
  route('GET', '/api/forms', listForms);
  route('POST', '/api/forms', createForm);
  route('GET', '/api/forms/:id', getForm);
  route('POST', '/api/forms/:id/changes', postChanges);
  route('POST', '/api/forms/:id/trial', trial);
  route('POST', '/api/forms/:id/publish', async (ctx) => sendJson(ctx, 200, await publish((await requireUser(ctx)).id, formId(ctx))));
  route('PUT', '/api/forms/:id/settings', async (ctx) => sendJson(ctx, 200, await saveSettings((await requireUser(ctx)).id, formId(ctx), () => bodyObject(ctx))));
  route('POST', '/api/forms/:id/close', async (ctx) => sendJson(ctx, 200, await close((await requireUser(ctx)).id, formId(ctx))));
  route('POST', '/api/forms/:id/reopen', async (ctx) => sendJson(ctx, 200, await reopen((await requireUser(ctx)).id, formId(ctx))));
  route('POST', '/api/forms/:id/invitations', invite);
  route('GET', '/api/invitations/:token', invitationTitle);
  route('POST', '/api/invitations/:token/accept', acceptInvitation);
  route('GET', '/api/forms/:id/editions', editions);
  route('GET', '/api/forms/:id/editions/:number', edition);
  route('GET', '/api/forms/:id/responses', listResponses);
  route('GET', '/api/forms/:id/responses/:rid', viewResponse);
  route('DELETE', '/api/forms/:id/responses/:rid', deleteResponse);
  route('GET', '/api/forms/:id/files/:file', downloadFile);
  route('GET', '/api/forms/:id/summary', summary);
  route('POST', '/api/forms/:id/exports', createExport);
  route('GET', '/api/forms/:id/exports/:export', downloadExport);
}
