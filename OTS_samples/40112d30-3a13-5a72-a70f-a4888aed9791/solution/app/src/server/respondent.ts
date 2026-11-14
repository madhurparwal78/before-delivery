import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Answers, FormDefinition, RespondentState } from '../shared/types.ts';
import { M13, M14, M15, M16, M17, M18, M68, M75 } from '../shared/messages.ts';
import { pool, transaction, type Db } from './db.ts';
import {
  carryAnswers, checkAnswers, evaluate, mergeAnswers, nextShownPage, pageToOpen, previousShownPage,
  respondentStructure, resolve,
} from './engine/index.ts';
import {
  alreadySent, alreadySubmitted, answerInvalid, answersInvalid, draftMoved, linkExpired, notFound, validationFailed,
} from './errors.ts';
import {
  closedText, engineEnv, formClosedFailure, loadEdition, loadFormBySlug, loadForm, settle, submittedCount, type FormRow,
} from './forms.ts';
import { bodyObject, sendJson, type Ctx } from './http.ts';
import { publishFormEvent } from './hub.ts';
import { isUuid } from './ids.ts';
import { hitResumeEmailLimit } from './rate.ts';
import { config } from './config.ts';
import { dateTimeText, hoursAfter, isoWithOffset, now } from './time.ts';
import { enqueue, deliverNow } from './outbox.ts';
import { validEmail } from './auth.ts';
import { answerLines } from './mailtext.ts';

// The respondent's part-done response: private to one device or link (brief: Save and resume, Respondent rules).

export const DEVICE_COOKIE = 'nf_device';
const DEVICE_COOKIE_DAYS = 400;

interface ResponseRow {
  id: string;
  form_id: string;
  edition: number;
  status: 'partial' | 'submitted' | 'expired';
  answers: Answers;
  page: string;
  device_id: string | null;
  devices: string[];
  last_seq: number;
  last_seq_device: string | null;
  resume_token: string;
  email: string | null;
  saved_at: Date | null;
  created_at: Date;
  submitted_at: Date | null;
}

const RESPONSE_COLUMNS = 'id, form_id, edition, status, answers, page, device_id, devices, last_seq, last_seq_device, resume_token, email, saved_at, created_at, submitted_at';

function deviceOf(ctx: Ctx): string {
  const known = ctx.cookies[DEVICE_COOKIE];
  if (isUuid(known)) return known;
  const fresh = randomUUID();
  ctx.setCookies.push(`${DEVICE_COOKIE}=${fresh}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DEVICE_COOKIE_DAYS * 24 * 3600}`);
  return fresh;
}

export async function loadResponse(db: Db, id: string, lock = false): Promise<ResponseRow | null> {
  if (!isUuid(id)) return null;
  const { rows } = await db.query<ResponseRow>(`SELECT ${RESPONSE_COLUMNS} FROM responses WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  return rows[0] ?? null;
}

/** A part-done response works until the resume window after its last save (or creation), judged on the server clock. */
const expiresAt = (row: ResponseRow): Date => hoursAfter(row.saved_at ?? row.created_at, config.resumeTtlHours);

/** A part-done response that outlived its window becomes expired, and every request on it is refused as such. */
async function assertAlive(db: Db, row: ResponseRow): Promise<void> {
  if (row.status === 'submitted') return;
  if (row.status === 'partial' && now().getTime() <= expiresAt(row).getTime()) return;
  await db.query(`UPDATE responses SET status = 'expired' WHERE id = $1 AND status = 'partial'`, [row.id]);
  throw linkExpired();
}

interface Held { row: ResponseRow; form: FormRow; def: FormDefinition; device: string }

/** The 404 tier: the response must be this device's (or once was), and not expired. */
export async function holdResponse(db: Db, ctx: Ctx, id: string, lock = false): Promise<Held> {
  const row = await loadResponse(db, id, lock);
  const device = deviceOf(ctx);
  if (!row || !row.devices.includes(device)) throw notFound();
  await assertAlive(db, row);
  const form = await loadForm(db, row.form_id);
  if (!form) throw notFound();
  return { row, form, def: await loadEdition(db, row.form_id, row.edition), device };
}

/** The 409 tier, in the order the brief lists them. */
export async function assertWritable(db: Db, held: Held): Promise<FormRow> {
  if (held.row.status === 'submitted') throw alreadySubmitted();
  if (held.row.device_id !== held.device) throw draftMoved();
  const form = await settle(db, held.form);
  if (form.state === 'closed') throw await formClosedFailure(db, form);
  return form;
}

const shownPage = (def: FormDefinition, answers: Answers, wanted: string): string => {
  const res = resolve(def, answers, engineEnv());
  if (res.shownPageKeys.includes(wanted)) return wanted;
  const order = def.pages.map((p) => p.key);
  const before = res.shownPageKeys.filter((key) => order.indexOf(key) < order.indexOf(wanted));
  return before[before.length - 1] ?? res.shownPageKeys[0] ?? wanted;
};

function respondentState(row: ResponseRow, def: FormDefinition): RespondentState {
  const env = engineEnv();
  const seq = row.last_seq_device === row.device_id ? row.last_seq : 0;
  const page = shownPage(def, row.answers, row.page);
  return {
    id: row.id,
    edition: row.edition,
    page,
    answers: row.answers,
    evaluation: evaluate(def, row.answers, env, { audience: 'respondent', seq, currentPage: page }),
    structure: respondentStructure(def, env),
    title: def.title,
    today: env.today,
  };
}

async function openForm(db: Db, slug: string): Promise<FormRow> {
  const form = await loadFormBySlug(db, slug);
  if (!form || form.live_edition === null) throw notFound();
  return settle(db, form);
}

export async function publicForm(ctx: Ctx): Promise<void> {
  const form = await openForm(pool, ctx.params['slug'] ?? '');
  const def = await loadEdition(pool, form.id, form.live_edition ?? 0);
  const count = form.state === 'closed' ? await submittedCount(pool, form.id) : 0;
  sendJson(ctx, 200, {
    title: def.title,
    intro: def.intro,
    state: form.state,
    closed: closedText(form, count),
    today: engineEnv().today,
  });
}

export async function startResponse(ctx: Ctx): Promise<void> {
  const device = deviceOf(ctx);
  const result = await transaction(async (tx) => {
    const form = await openForm(tx, ctx.params['slug'] ?? '');
    if (form.state === 'closed') throw await formClosedFailure(tx, form);
    const existing = await tx.query<ResponseRow>(
      `SELECT ${RESPONSE_COLUMNS} FROM responses WHERE form_id = $1 AND device_id = $2 AND status = 'partial' ORDER BY created_at DESC LIMIT 1`,
      [form.id, device],
    );
    const held = existing.rows[0];
    if (held && now().getTime() <= expiresAt(held).getTime()) {
      return { status: 200, state: respondentState(held, await loadEdition(tx, form.id, held.edition)) };
    }
    const edition = form.live_edition ?? 1;
    const def = await loadEdition(tx, form.id, edition);
    const first = resolve(def, {}, engineEnv()).shownPageKeys[0] ?? def.pages[0]?.key ?? '';
    const row: ResponseRow = {
      id: randomUUID(), form_id: form.id, edition, status: 'partial', answers: {}, page: first, device_id: device,
      devices: [device], last_seq: 0, last_seq_device: null, resume_token: randomBytes(24).toString('base64url'), email: null, saved_at: null, created_at: now(), submitted_at: null,
    };
    await tx.query(
      `INSERT INTO responses (id, form_id, edition, status, answers, page, device_id, devices, resume_token, created_at)
       VALUES ($1, $2, $3, 'partial', '{}', $4, $5, $6, $7, $8)`,
      [row.id, form.id, edition, first, device, [device], row.resume_token, row.created_at],
    );
    return { status: 201, state: respondentState(row, def) };
  });
  sendJson(ctx, result.status, result.state);
}

export async function getResponse(ctx: Ctx): Promise<void> {
  const held = await holdResponse(pool, ctx, ctx.params['id'] ?? '');
  if (held.row.status !== 'partial' || held.row.device_id !== held.device) throw notFound();
  sendJson(ctx, 200, respondentState(held.row, held.def));
}

function readAnswerMap(ctx: Ctx): Record<string, unknown> {
  const body = bodyObject(ctx);
  const map = body['answers'];
  if (map === null || typeof map !== 'object' || Array.isArray(map)) throw validationFailed([{ key: 'answers', message: M68 }]);
  return map as Record<string, unknown>;
}

const MAX_SEQ = 2_147_483_647;

const seqOf = (ctx: Ctx): number => {
  const seq = bodyObject(ctx)['seq'];
  return typeof seq === 'number' && Number.isInteger(seq) && seq >= 0 && seq <= MAX_SEQ ? seq : 0;
};

export async function commitAnswers(ctx: Ctx): Promise<void> {
  const result = await transaction(async (tx) => {
    const held = await holdResponse(tx, ctx, ctx.params['id'] ?? '', true);
    await assertWritable(tx, held);
    const incoming = readAnswerMap(ctx);
    const seq = seqOf(ctx);
    const stale = held.row.last_seq_device === held.device && seq < held.row.last_seq;
    const merged = mergeAnswers(held.def.pages.flatMap((p) => p.questions), held.row.answers, incoming);
    if (merged.invalid !== null) throw answerInvalid(merged.invalid);
    const next = merged.answers;
    if (stale) {
      return evaluate(held.def, held.row.answers, engineEnv(), { audience: 'respondent', seq, currentPage: held.row.page });
    }
    const body = bodyObject(ctx);
    const wanted = typeof body['page'] === 'string' ? body['page'] : held.row.page;
    const page = shownPage(held.def, next, held.def.pages.some((p) => p.key === wanted) ? wanted : held.row.page);
    await tx.query('UPDATE responses SET answers = $2, page = $3, last_seq = $4, last_seq_device = $5 WHERE id = $1', [held.row.id, JSON.stringify(next), page, seq, held.device]);
    return evaluate(held.def, next, engineEnv(), { audience: 'respondent', seq, currentPage: page, prior: held.row.answers });
  });
  sendJson(ctx, 200, { evaluation: result });
}

function pageOf(ctx: Ctx, held: Held): string {
  const page = bodyObject(ctx)['page'];
  return typeof page === 'string' && held.def.pages.some((p) => p.key === page) ? page : held.row.page;
}

export async function nextPage(ctx: Ctx): Promise<void> {
  const reply = await transaction(async (tx) => {
    const held = await holdResponse(tx, ctx, ctx.params['id'] ?? '', true);
    await assertWritable(tx, held);
    const page = pageOf(ctx, held);
    const errors = checkAnswers(held.def, held.row.answers, engineEnv(), { kind: 'page', page });
    if (errors.length) throw answersInvalid(errors);
    const res = resolve(held.def, held.row.answers, engineEnv());
    const target = nextShownPage(res, page) ?? page;
    await tx.query('UPDATE responses SET page = $2 WHERE id = $1', [held.row.id, target]);
    return { page: target, evaluation: evaluate(held.def, held.row.answers, engineEnv(), { audience: 'respondent', seq: 0, currentPage: target }) };
  });
  sendJson(ctx, 200, reply);
}

export async function backPage(ctx: Ctx): Promise<void> {
  const reply = await transaction(async (tx) => {
    const held = await holdResponse(tx, ctx, ctx.params['id'] ?? '', true);
    await assertWritable(tx, held);
    const page = pageOf(ctx, held);
    const res = resolve(held.def, held.row.answers, engineEnv());
    const target = previousShownPage(res, page) ?? shownPage(held.def, held.row.answers, page);
    await tx.query('UPDATE responses SET page = $2 WHERE id = $1', [held.row.id, target]);
    return { page: target, evaluation: evaluate(held.def, held.row.answers, engineEnv(), { audience: 'respondent', seq: 0, currentPage: target }) };
  });
  sendJson(ctx, 200, reply);
}

export async function saveForLater(ctx: Ctx): Promise<void> {
  const reply = await (async () => {
    const early = await holdResponse(pool, ctx, ctx.params['id'] ?? '');
    await hitResumeEmailLimit(ctx.ip);
    const outcome = await transaction(async (tx) => {
      const held = await holdResponse(tx, ctx, early.row.id, true);
      await assertWritable(tx, held);
      const body = bodyObject(ctx);
      if (!validEmail(body['email'])) throw validationFailed([{ key: 'email', message: M75 }]);
      const email = body['email'].trim();
      const at = now();
      const expiry = hoursAfter(at, config.resumeTtlHours);
      const page = pageOf(ctx, held);
      await tx.query('UPDATE responses SET email = $2, saved_at = $3, page = $4 WHERE id = $1', [held.row.id, email, at, page]);
      const res = resolve(held.def, held.row.answers, engineEnv(at));
      const lines = answerLines(res);
      const link = `${config.baseUrl}/r/${held.row.resume_token}`;
      const mail = await enqueue(tx, email, `Continue your form: ${held.def.title}`,
        [`Continue your form: ${held.def.title}`, '', `Open this link to carry on: ${link}`, `It works until ${dateTimeText(expiry)}.`, '', 'Your answers so far:', ...lines].join('\n'));
      return { email, expiry, mail };
    });
    const [sent] = await deliverNow([outcome.mail]);
    return {
      email: outcome.email,
      expires_at: isoWithOffset(outcome.expiry),
      sent: sent === true,
      message: sent === true ? M13(outcome.email, dateTimeText(outcome.expiry)) : M14,
    };
  })();
  sendJson(ctx, 200, reply);
}

// ---- Resume (brief: Save and resume) ----

function droppedNotice(labels: string[]): string {
  if (labels.length === 0) return M18;
  return labels.length === 1 ? M16(labels[0] ?? '') : M17(labels.length, labels.join(', '));
}

async function resumeInTransaction(tx: PoolClient, token: string, device: string): Promise<RespondentState & { notice: string; saved_at: string | null }> {
  const found = await tx.query<ResponseRow>(`SELECT ${RESPONSE_COLUMNS} FROM responses WHERE resume_token = $1 FOR UPDATE`, [token]);
  const row = found.rows[0];
  if (!row) throw notFound();
  if (row.status === 'submitted') throw alreadySent();
  await assertAlive(tx, row);
  const formRow = await loadForm(tx, row.form_id);
  if (!formRow) throw notFound();
  const form = await settle(tx, formRow);
  if (form.state === 'closed') throw await formClosedFailure(tx, form);
  let def = await loadEdition(tx, row.form_id, row.edition);
  let notice = M15(row.saved_at ? dateTimeText(row.saved_at) : dateTimeText(row.created_at));
  let answers = row.answers;
  let edition = row.edition;
  let page = row.page;
  if (form.live_edition !== null && form.live_edition > row.edition) {
    const newer = await loadEdition(tx, row.form_id, form.live_edition);
    const carried = carryAnswers(def, newer, row.answers);
    notice = droppedNotice(carried.droppedLabels);
    answers = carried.answers;
    edition = form.live_edition;
    def = newer;
    page = pageToOpen(newer, answers, carried.dropped, row.page, engineEnv());
  }
  const devices = row.devices.includes(device) ? row.devices : [...row.devices, device];
  await tx.query('UPDATE responses SET device_id = $2, devices = $3, edition = $4, answers = $5, page = $6 WHERE id = $1',
    [row.id, device, devices, edition, JSON.stringify(answers), page]);
  const moved = { ...row, device_id: device, devices, edition, answers, page };
  if (row.device_id !== device) await publishFormEvent(row.form_id, { kind: 'moved', response: row.id });
  return { ...respondentState(moved, def), notice, saved_at: row.saved_at ? isoWithOffset(row.saved_at) : null };
}

export async function resume(ctx: Ctx): Promise<void> {
  const device = deviceOf(ctx);
  const state = await transaction((tx) => resumeInTransaction(tx, ctx.params['token'] ?? '', device));
  sendJson(ctx, 200, state);
}
