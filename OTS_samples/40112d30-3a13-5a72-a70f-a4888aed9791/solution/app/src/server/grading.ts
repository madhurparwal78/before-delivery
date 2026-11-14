import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Answers, FormDefinition } from '../shared/types.ts';
import { config } from './config.ts';
import { transaction } from './db.ts';
import { asDefinition, mergeAnswers, definitionProblems, resolve, validateStructure } from './engine/index.ts';
import { notFound, seedInvalid, validationFailed } from './errors.ts';
import { engineEnv, settle, loadForm } from './forms.ts';
import { bodyObject, route, sendJson, type Ctx } from './http.ts';
import { createSession, hashPassword, emailKey } from './auth.ts';
import { isoWithOffset, now, parseInstant, parseLocal, setClock } from './time.ts';
import { newSlug, referenceOf } from './ids.ts';
import { M68 } from '../shared/messages.ts';

// The published grading routes: the only grading-only behaviour, and only with GRADING_KEY (brief: Grading routes).

function requireGradingKey(ctx: Ctx): void {
  const given = ctx.req.headers['x-grading-key'];
  const expected = config.gradingKey;
  if (!expected || typeof given !== 'string') throw notFound();
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw notFound();
}

const invalid = seedInvalid;

interface SeedUser { key: string; name: string; email: string; password: string }
interface SeedResponse {
  key: string; status: 'partial' | 'submitted'; answers?: Answers; page?: string; edition?: number;
  email?: string; saved_at?: string; submitted_at?: string;
}
interface SeedForm {
  key: string; owner: string; editors?: string[]; editions?: FormDefinition[]; draft?: FormDefinition | null;
  settings?: { closes_at?: string | null; response_limit?: number | null; closed_message?: string | null; copy_to?: string | null };
  responses?: SeedResponse[];
}

function definitionOf(raw: unknown, what: string, strict: boolean): FormDefinition {
  const issue = validateStructure(raw);
  if (issue) throw invalid(`${what}: ${issue.message}`);
  const def = asDefinition(raw);
  const problem = strict ? definitionProblems(def, engineEnv())[0] : undefined;
  if (problem) throw invalid(`${what}: ${problem.message}`);
  return def;
}

const asList = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

async function seed(ctx: Ctx): Promise<void> {
  requireGradingKey(ctx);
  const body = bodyObject(ctx);
  const users = asList<SeedUser>(body['users']);
  const forms = asList<SeedForm>(body['forms']);
  const reply = await transaction(async (tx) => {
    const made: Record<string, { id: string; session: string }> = {};
    const ids = new Map<string, string>();
    for (const user of users) {
      if (typeof user.key !== 'string' || typeof user.email !== 'string' || typeof user.password !== 'string') throw invalid('A user needs a key, an email and a password.');
      const id = randomUUID();
      await tx.query('INSERT INTO users (id, name, email, email_key, password_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, user.name ?? user.key, user.email, emailKey(user.email), await hashPassword(user.password), now()]);
      ids.set(user.key, id);
      made[user.key] = { id, session: await createSession(id, tx) };
    }
    const formsOut: Record<string, unknown> = {};
    for (const form of forms) {
      const ownerId = ids.get(form.owner);
      if (!ownerId) throw invalid(`Form ${form.key} names an owner that is not in users: ${String(form.owner)}.`);
      const editions = asList<unknown>(form.editions).map((def, index) => definitionOf(def, `Edition ${index + 1} of ${form.key}`, true));
      const live = editions[editions.length - 1];
      const draft = form.draft ? definitionOf(form.draft, `The draft of ${form.key}`, false) : live;
      if (!draft) throw invalid(`Form ${form.key} needs a draft or an edition.`);
      const settings = form.settings ?? {};
      const closesAt = settings.closes_at ? parseLocal(settings.closes_at) : null;
      if (settings.closes_at && !closesAt) throw invalid(`Form ${form.key} has a closing time that is not a time.`);
      const id = randomUUID();
      const slug = newSlug();
      await tx.query(
        `INSERT INTO forms (id, slug, owner_id, title, draft, live_edition, state, closes_at, response_limit, closed_message, copy_to, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [id, slug, ownerId, draft.title, JSON.stringify(draft), editions.length || null, editions.length ? 'open' : 'draft', closesAt,
          settings.response_limit ?? null, settings.closed_message ?? null, settings.copy_to ?? null, now()],
      );
      await tx.query('INSERT INTO form_limits (form_id) VALUES ($1)', [id]);
      for (const editorKey of asList<string>(form.editors)) {
        const editorId = ids.get(editorKey);
        if (!editorId) throw invalid(`Form ${form.key} names an editor that is not in users: ${editorKey}.`);
        await tx.query('INSERT INTO form_editors (form_id, user_id) VALUES ($1, $2)', [id, editorId]);
      }
      for (const [index, def] of editions.entries()) {
        await tx.query('INSERT INTO editions (form_id, number, definition, published_at) VALUES ($1, $2, $3, $4)', [id, index + 1, JSON.stringify(def), now()]);
      }
      const responses: Record<string, unknown> = {};
      for (const response of asList<SeedResponse>(form.responses)) {
        const number = response.edition ?? editions.length;
        const def = editions[number - 1];
        if (!def) throw invalid(`Response ${response.key} of ${form.key} names an edition that does not exist.`);
        const given = response.answers ?? {};
        const merged = mergeAnswers(def.pages.flatMap((p) => p.questions), {}, given);
        if (merged.invalid !== null) throw invalid(`Response ${response.key} of ${form.key} has an answer that does not fit ${merged.invalid}.`);
        const rid = randomUUID();
        const token = randomBytes(24).toString('base64url');
        const submitted = response.status === 'submitted';
        const at = (submitted ? response.submitted_at : response.saved_at) ? parseLocal((submitted ? response.submitted_at : response.saved_at) ?? '') : now();
        if (!at) throw invalid(`Response ${response.key} of ${form.key} has a time that is not a time.`);
        const res = resolve(def, given, engineEnv(at));
        const kept: Answers = submitted ? Object.fromEntries(Object.entries(given).filter(([key]) => res.counting.includes(key))) : given;
        const page = response.page ?? res.shownPageKeys[0] ?? def.pages[0]?.key ?? '';
        await tx.query(
          `INSERT INTO responses (id, form_id, edition, status, answers, page, resume_token, email, saved_at, created_at, submitted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [rid, id, number, submitted ? 'submitted' : 'partial', JSON.stringify(kept), page, token,
            !submitted && response.email ? response.email : null, !submitted && response.email ? at : null, at, submitted ? at : null],
        );
        responses[response.key] = submitted ? { id: rid, reference: referenceOf(rid) } : { id: rid, resume_url: `${config.baseUrl}/r/${token}` };
      }
      const row = await loadForm(tx, id);
      if (row) await settle(tx, row);
      formsOut[form.key] = {
        id, slug, fill_url: `${config.baseUrl}/f/${slug}`, edit_url: `${config.baseUrl}/forms/${id}/edit`,
        summary_url: `${config.baseUrl}/forms/${id}/summary`, responses,
      };
    }
    return { users: made, forms: formsOut };
  });
  sendJson(ctx, 201, reply);
}

async function clock(ctx: Ctx): Promise<void> {
  requireGradingKey(ctx);
  const requested = bodyObject(ctx)['now'];
  if (requested === null) await setClock(null);
  else {
    const instant = typeof requested === 'string' ? parseInstant(requested) : null;
    if (!instant) throw validationFailed([{ key: 'now', message: M68 }]);
    await setClock(instant);
  }
  sendJson(ctx, 200, { now: isoWithOffset(now()) });
}

export function registerGradingRoutes(): void {
  route('POST', '/api/grading/seed', seed);
  route('POST', '/api/grading/clock', clock);
}
