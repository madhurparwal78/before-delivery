import type {
  ClosedReason, ClosedText, FormDefinition, FormDetail, FormState, Settings,
} from '../shared/types.ts';
import { M22, M23, M24, M25 } from '../shared/messages.ts';
import { config } from './config.ts';
import type { Db } from './db.ts';
import { pool } from './db.ts';
import { definitionProblems, type EngineEnv } from './engine/index.ts';
import { formClosed, notFound, type Failure } from './errors.ts';
import { isUuid } from './ids.ts';
import { dateTimeText, isoWithOffset, localDate, localDateTime, now } from './time.ts';

// Forms, their state machine and the one place that settles it (brief: Closing rules, Form state machine).

export interface FormRow {
  id: string;
  slug: string;
  owner_id: string;
  title: string;
  draft: FormDefinition;
  rev: number;
  live_edition: number | null;
  state: FormState;
  closed_reason: ClosedReason;
  closes_at: Date | null;
  response_limit: number | null;
  closed_message: string | null;
  copy_to: string | null;
}

type Role = 'owner' | 'editor';
interface Access { form: FormRow; role: Role }

const FORM_COLUMNS = `f.id, f.slug, f.owner_id, f.title, f.draft, f.rev, f.live_edition, f.state, f.closed_reason,
  f.closes_at, f.response_limit, f.closed_message, f.copy_to`;

export function engineEnv(at: Date = now()): EngineEnv {
  return {
    today: localDate(at),
    shuffleSeed: config.shuffleSeed,
    formulaMaxChars: config.formulaMaxChars,
    formulaMaxDepth: config.formulaMaxDepth,
  };
}

export async function loadForm(db: Db, id: string, lock = false): Promise<FormRow | null> {
  if (!isUuid(id)) return null;
  const { rows } = await db.query<FormRow>(`SELECT ${FORM_COLUMNS} FROM forms f WHERE f.id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  return rows[0] ?? null;
}

export async function loadFormBySlug(db: Db, slug: string): Promise<FormRow | null> {
  const { rows } = await db.query<FormRow>(`SELECT ${FORM_COLUMNS} FROM forms f WHERE f.slug = $1`, [slug]);
  return rows[0] ?? null;
}

/** The form with the person's role, or null when it is not theirs to see (a closed form's builder is the owner's). */
export async function accessFor(db: Db, userId: string, formId: string, lock = false): Promise<Access | null> {
  const form = await loadForm(db, formId, lock);
  if (!form) return null;
  if (form.owner_id === userId) return { form, role: 'owner' };
  const { rowCount } = await db.query('SELECT 1 FROM form_editors WHERE form_id = $1 AND user_id = $2', [formId, userId]);
  return rowCount ? { form, role: 'editor' } : null;
}

/** Owner routes: 404 for what the person may not open. `ownerOnly` adds the co-editor refusal; `builder` the closed-form one. */
export async function requireAccess(db: Db, userId: string, formId: string, rule: { ownerOnly?: boolean; builder?: boolean } = {}, lock = false): Promise<Access> {
  const access = await accessFor(db, userId, formId, lock);
  if (!access) throw notFound();
  if (access.role === 'editor' && (rule.ownerOnly || (rule.builder && access.form.state === 'closed'))) throw notFound();
  return access;
}

export async function submittedCount(db: Db, formId: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM responses WHERE form_id = $1 AND status = 'submitted'`, [formId]);
  return Number(rows[0]?.n ?? 0);
}

export const timeReached = (form: FormRow): boolean => form.closes_at !== null && now().getTime() >= form.closes_at.getTime();
export const limitReached = (form: FormRow, count: number): boolean => form.response_limit !== null && count >= form.response_limit;

/** Open forms close when the clock reaches closes_at or the submitted count reaches the limit; closed forms stay closed. */
export async function settle(db: Db, form: FormRow): Promise<FormRow> {
  if (form.state !== 'open') return form;
  const reason: ClosedReason = timeReached(form) ? 'time' : limitReached(form, await submittedCount(db, form.id)) ? 'limit' : null;
  if (!reason) return form;
  await db.query(`UPDATE forms SET state = 'closed', closed_reason = $2 WHERE id = $1 AND state = 'open'`, [form.id, reason]);
  return { ...form, state: 'closed', closed_reason: reason };
}

export async function settledForm(db: Db, id: string): Promise<FormRow | null> {
  const form = await loadForm(db, id);
  return form ? settle(db, form) : null;
}

export function closedText(form: FormRow, count: number): ClosedText | null {
  if (form.state !== 'closed') return null;
  const byReason = form.closed_reason === 'time' && form.closes_at
    ? M23(dateTimeText(form.closes_at), config.timeZone)
    : form.closed_reason === 'limit' ? M24(form.response_limit ?? count) : M25;
  return { heading: M22, text: form.closed_message ?? byReason };
}

/** 409 FORM_CLOSED carrying the closed text, for a submit, commit, save or resume on a form that is not taking responses. */
export async function formClosedFailure(db: Db, form: FormRow): Promise<Failure> {
  return formClosed(closedText(form, await submittedCount(db, form.id))?.text ?? '');
}

export const settingsOf = (form: FormRow): Settings => ({
  closes_at: form.closes_at ? localDateTime(form.closes_at) : null,
  response_limit: form.response_limit,
  closed_message: form.closed_message,
  copy_to: form.copy_to,
});

const editionCache = new Map<string, FormDefinition>();
const CACHE_LIMIT = 500;

/** Editions never change once published, so they are cached for good. */
export async function loadEdition(db: Db, formId: string, number: number): Promise<FormDefinition> {
  const key = `${formId}:${number}`;
  const cached = editionCache.get(key);
  if (cached) return cached;
  const { rows } = await db.query<{ definition: FormDefinition }>('SELECT definition FROM editions WHERE form_id = $1 AND number = $2', [formId, number]);
  const row = rows[0];
  if (!row) throw notFound();
  if (editionCache.size >= CACHE_LIMIT) editionCache.clear();
  editionCache.set(key, row.definition);
  return row.definition;
}

export async function formDetail(access: Access): Promise<FormDetail> {
  const { form, role } = access;
  const count = await submittedCount(pool, form.id);
  return {
    id: form.id,
    slug: form.slug,
    title: form.title,
    role,
    state: form.state,
    closed_reason: form.closed_reason,
    edition: form.live_edition,
    rev: form.rev,
    draft: form.draft,
    problems: definitionProblems(form.draft, engineEnv()).map(({ key, message }) => ({ key, message })),
    settings: settingsOf(form),
    responses: count,
    server_now: isoWithOffset(now()),
  };
}
