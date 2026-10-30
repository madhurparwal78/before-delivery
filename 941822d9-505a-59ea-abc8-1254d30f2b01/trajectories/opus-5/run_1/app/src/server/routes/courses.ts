import type { PoolClient } from 'pg';
import { pool, query, withTransaction } from '../db/pool.js';
import { cohortsJson } from '../data/cohorts.js';
import {
  canReadCourse,
  courseJson,
  courseSummaryJson,
  getCourse,
  getCourseForUpdate,
  getModules,
  listCoursesFor,
  type CourseRow,
} from '../data/courses.js';
import {
  findEdge,
  isCourseState,
  mayEditCourse,
  mayRequestTransition,
  type CourseState,
} from '../domain/courseLifecycle.js';
import { parseMoney } from '../domain/money.js';
import { instantToIso } from '../domain/providerTime.js';
import {
  conflict,
  forbidden,
  notFound,
  staleVersion,
  Validator,
  versionRequired,
} from '../http/errors.js';
import { param, requireUser, type Reply, type RequestContext } from '../http/context.js';
import type { Route } from '../http/router.js';
import { newId } from '../util/ids.js';

const TITLE_MESSAGE = 'Enter a course title of 1 to 120 characters.';
const PRICE_MESSAGE = 'Enter a price from 0.00 to 5000.00 with two decimals.';
const MINUTES_MESSAGE = 'Minutes must be a whole number from 5 to 240.';
const MODULES_MESSAGE = 'Add at least one lesson and exactly one post-evaluation, placed last.';
const QUESTION_MESSAGE = 'Give each lesson a question with 2 to 5 options and one correct option.';
const FORMAT_MESSAGE = 'Choose a self-paced or live cohort format.';
const SUMMARY_MESSAGE = 'Enter a summary of 1 to 600 characters.';
const RETURN_NOTE_MESSAGE = 'Tell the author what to change.';

const MAX_PRICE_CENTS = 500000;

interface ModuleDraft {
  readonly title: string;
  readonly minutes: number;
  readonly kind: 'lesson' | 'evaluation';
  readonly body: string | null;
  readonly prompt: string | null;
  readonly options: string[] | null;
  readonly answerIndex: number | null;
}

interface CourseDraft {
  readonly title?: string;
  readonly summary?: string;
  readonly format?: 'self_paced' | 'cohort';
  readonly listPriceCents?: number;
  readonly modules?: readonly ModuleDraft[];
}

function readModules(raw: unknown, validator: Validator): readonly ModuleDraft[] | undefined {
  if (!Array.isArray(raw)) {
    validator.add('modules', MODULES_MESSAGE);
    return undefined;
  }
  const drafts: ModuleDraft[] = [];
  let minutesBad = false;
  let questionBad = false;
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      validator.add('modules', MODULES_MESSAGE);
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    const title = typeof record['title'] === 'string' ? record['title'].trim() : '';
    const minutes = record['minutes'];
    const kind = record['kind'];
    if (title.length === 0 || title.length > 120) validator.add('modules', MODULES_MESSAGE);
    if (!Number.isInteger(minutes) || typeof minutes !== 'number' || minutes < 5 || minutes > 240) {
      minutesBad = true;
    }
    if (kind !== 'lesson' && kind !== 'evaluation') {
      validator.add('modules', MODULES_MESSAGE);
      return undefined;
    }
    if (kind === 'evaluation') {
      drafts.push({
        title,
        minutes: typeof minutes === 'number' ? minutes : 0,
        kind,
        body: null,
        prompt: null,
        options: null,
        answerIndex: null,
      });
      continue;
    }
    const question = record['question'];
    const questionRecord =
      typeof question === 'object' && question !== null ? (question as Record<string, unknown>) : null;
    const prompt = typeof questionRecord?.['prompt'] === 'string' ? questionRecord['prompt'].trim() : '';
    const optionsRaw = questionRecord?.['options'];
    const options = Array.isArray(optionsRaw)
      ? optionsRaw.filter((option): option is string => typeof option === 'string' && option.trim() !== '')
      : [];
    const answerIndex = questionRecord?.['answer_index'];
    const answerOk =
      typeof answerIndex === 'number' &&
      Number.isInteger(answerIndex) &&
      answerIndex >= 0 &&
      answerIndex < options.length;
    if (prompt === '' || options.length < 2 || options.length > 5 || !answerOk) questionBad = true;
    drafts.push({
      title,
      minutes: typeof minutes === 'number' ? minutes : 0,
      kind,
      body: typeof record['body'] === 'string' ? record['body'] : '',
      prompt,
      options,
      answerIndex: answerOk && typeof answerIndex === 'number' ? answerIndex : null,
    });
  }
  if (minutesBad) validator.add('minutes', MINUTES_MESSAGE);
  if (questionBad) validator.add('question', QUESTION_MESSAGE);

  const evaluations = drafts.filter((draft) => draft.kind === 'evaluation');
  const lessons = drafts.filter((draft) => draft.kind === 'lesson');
  const lastIsEvaluation = drafts.length > 0 && drafts[drafts.length - 1]?.kind === 'evaluation';
  if (lessons.length < 1 || evaluations.length !== 1 || !lastIsEvaluation) {
    validator.add('modules', MODULES_MESSAGE);
  }
  return drafts;
}

function readDraft(ctx: RequestContext, validator: Validator, partial: boolean): CourseDraft {
  const body = ctx.body ?? {};
  const draft: {
    title?: string;
    summary?: string;
    format?: 'self_paced' | 'cohort';
    listPriceCents?: number;
    modules?: readonly ModuleDraft[];
  } = {};

  if (!partial || Object.hasOwn(body, 'title')) {
    const title = typeof body['title'] === 'string' ? body['title'].trim() : '';
    if (title.length === 0 || title.length > 120) validator.add('title', TITLE_MESSAGE);
    draft.title = title;
  }
  if (!partial || Object.hasOwn(body, 'summary')) {
    const summary = typeof body['summary'] === 'string' ? body['summary'].trim() : '';
    if (summary.length === 0 || summary.length > 600) validator.add('summary', SUMMARY_MESSAGE);
    draft.summary = summary;
  }
  if (!partial || Object.hasOwn(body, 'format')) {
    const format = body['format'];
    if (format !== 'self_paced' && format !== 'cohort') validator.add('format', FORMAT_MESSAGE);
    else draft.format = format;
  }
  if (!partial || Object.hasOwn(body, 'list_price')) {
    const cents = parseMoney(body['list_price']);
    if (cents === null || cents > MAX_PRICE_CENTS) validator.add('list_price', PRICE_MESSAGE);
    else draft.listPriceCents = cents;
  }
  if (!partial || Object.hasOwn(body, 'modules')) {
    const modules = readModules(body['modules'], validator);
    if (modules !== undefined) draft.modules = modules;
  }
  return draft;
}

async function writeModules(
  client: PoolClient,
  courseId: string,
  modules: readonly ModuleDraft[],
): Promise<void> {
  await client.query('DELETE FROM course_modules WHERE course_id = $1', [courseId]);
  for (const [index, module] of modules.entries()) {
    await client.query(
      `INSERT INTO course_modules
         (id, course_id, position, title, minutes, kind, body, question_prompt, question_options, answer_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        newId(),
        courseId,
        index,
        module.title,
        module.minutes,
        module.kind,
        module.body,
        module.prompt,
        module.options === null ? null : JSON.stringify(module.options),
        module.answerIndex,
      ],
    );
  }
}

function readIfMatch(ctx: RequestContext): number {
  const header = ctx.request.headers['if-match'];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || value.trim() === '') throw versionRequired();
  const parsed = Number.parseInt(value.replaceAll('"', '').trim(), 10);
  return Number.isInteger(parsed) ? parsed : -1;
}

async function courseWithCohorts(
  client: PoolClient,
  course: CourseRow,
  ctx: RequestContext,
): Promise<unknown> {
  const user = requireUser(ctx);
  const modules = await getModules(client, course.id);
  const cohorts = await cohortsJson(client, course.id, user.role === 'planner', ctx.at);
  return courseJson(course, modules, cohorts, user);
}

async function listCourses(ctx: RequestContext): Promise<Reply> {
  const user = requireUser(ctx);
  const courses = await listCoursesFor(pool, user);
  const summaries = [];
  for (const course of courses) {
    summaries.push(courseSummaryJson(course, await getModules(pool, course.id)));
  }
  return { status: 200, json: { courses: summaries } };
}

async function readCourse(ctx: RequestContext): Promise<Reply> {
  const user = requireUser(ctx);
  const course = await getCourse(pool, param(ctx, 'id'));
  if (course === null || !canReadCourse(course, user)) throw notFound();
  const modules = await getModules(pool, course.id);
  const cohorts = await cohortsJson(pool, course.id, user.role === 'planner', ctx.at);
  return { status: 200, json: { course: courseJson(course, modules, cohorts, user) } };
}

async function createCourse(ctx: RequestContext): Promise<Reply> {
  const user = requireUser(ctx);
  const validator = new Validator(ctx.body, ['title', 'summary', 'format', 'list_price', 'modules']);
  const draft = readDraft(ctx, validator, false);
  validator.throwIfInvalid();
  const { title, summary, format, listPriceCents, modules } = draft;
  if (
    title === undefined ||
    summary === undefined ||
    format === undefined ||
    listPriceCents === undefined ||
    modules === undefined
  ) {
    throw new Error('A validated course draft is complete');
  }

  const json = await withTransaction(async (client) => {
    const courseId = newId();
    await client.query(
      `INSERT INTO courses (id, title, summary, format, state, list_price_cents, version, author_id)
       VALUES ($1, $2, $3, $4, 'draft', $5, 1, $6)`,
      [courseId, title, summary, format, listPriceCents, user.id],
    );
    await writeModules(client, courseId, modules);
    const created = await getCourse(client, courseId);
    if (created === null) throw new Error('The new course was not written');
    return courseWithCohorts(client, created, ctx);
  });
  return { status: 201, json: { course: json } };
}

async function patchCourse(ctx: RequestContext): Promise<Reply> {
  const user = requireUser(ctx);
  const existing = await getCourse(pool, param(ctx, 'id'));
  if (existing === null || !canReadCourse(existing, user)) throw notFound();
  if (user.role !== 'planner' && !(user.role === 'author' && existing.author_id === user.id)) {
    throw forbidden();
  }
  const expectedVersion = readIfMatch(ctx);

  const json = await withTransaction(async (client) => {
    const course = await getCourseForUpdate(client, existing.id);
    if (course === null) throw notFound();
    if (course.version !== expectedVersion) throw staleVersion(course.version);
    if (!mayEditCourse(course.state, user.role, course.author_id === user.id)) {
      throw conflict('course_not_editable');
    }
    const validator = new Validator(ctx.body, ['title', 'summary', 'format', 'list_price', 'modules']);
    const draft = readDraft(ctx, validator, true);
    validator.throwIfInvalid();

    await client.query(
      `UPDATE courses SET
         title = coalesce($2, title),
         summary = coalesce($3, summary),
         format = coalesce($4, format),
         list_price_cents = coalesce($5, list_price_cents),
         version = version + 1
       WHERE id = $1`,
      [
        course.id,
        draft.title ?? null,
        draft.summary ?? null,
        draft.format ?? null,
        draft.listPriceCents ?? null,
      ],
    );
    if (draft.modules !== undefined) await writeModules(client, course.id, draft.modules);
    const updated = await getCourse(client, course.id);
    if (updated === null) throw new Error('The course vanished mid-save');
    return courseWithCohorts(client, updated, ctx);
  });
  return { status: 200, json: { course: json } };
}

async function transitionCourse(ctx: RequestContext): Promise<Reply> {
  const user = requireUser(ctx);
  const existing = await getCourse(pool, param(ctx, 'id'));
  if (existing === null || !canReadCourse(existing, user)) throw notFound();

  const to = ctx.body?.['to'];
  if (!isCourseState(to) || !mayRequestTransition(user.role, to)) throw forbidden();
  if (user.role === 'author' && existing.author_id !== user.id) throw forbidden();
  const expectedVersion = readIfMatch(ctx);

  const json = await withTransaction(async (client) => {
    const course = await getCourseForUpdate(client, existing.id);
    if (course === null) throw notFound();
    if (course.version !== expectedVersion) throw staleVersion(course.version);
    const edge = findEdge(course.state, to, user.role);
    if (edge === null) {
      throw conflict('invalid_transition', { from: course.state, to });
    }
    const validator = new Validator(ctx.body, ['to', 'note']);
    const noteRaw = ctx.body?.['note'];
    const note = typeof noteRaw === 'string' ? noteRaw.trim() : null;
    if (edge.requiresNote && (note === null || note === '')) {
      validator.add('note', RETURN_NOTE_MESSAGE);
    }
    validator.throwIfInvalid();

    await client.query('UPDATE courses SET state = $2, version = version + 1 WHERE id = $1', [course.id, to]);
    await client.query(
      `INSERT INTO course_history (id, course_id, from_state, to_state, by_user_id, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [newId(), course.id, course.state, to, user.id, note],
    );
    const updated = await getCourse(client, course.id);
    if (updated === null) throw new Error('The course vanished mid-transition');
    return courseWithCohorts(client, updated, ctx);
  });
  return { status: 200, json: { course: json } };
}

async function courseHistory(ctx: RequestContext): Promise<Reply> {
  const user = requireUser(ctx);
  const course = await getCourse(pool, param(ctx, 'id'));
  if (course === null || !canReadCourse(course, user)) throw notFound();
  if (user.role !== 'planner' && course.author_id !== user.id) throw notFound();

  const rows = await query<{
    from_state: CourseState;
    to_state: CourseState;
    by_id: string;
    by_display_name: string;
    note: string | null;
    at: Date;
  }>(
    pool,
    `SELECT h.from_state, h.to_state, u.id AS by_id, u.display_name AS by_display_name, h.note, h.at
     FROM course_history h JOIN users u ON u.id = h.by_user_id
     WHERE h.course_id = $1 ORDER BY h.seq`,
    [course.id],
  );
  return {
    status: 200,
    json: {
      history: rows.map((row) => ({
        from: row.from_state,
        to: row.to_state,
        by: { id: row.by_id, display_name: row.by_display_name },
        note: row.note,
        at: instantToIso(row.at),
      })),
    },
  };
}

export const courseRoutes: readonly Route[] = [
  { method: 'GET', path: '/api/courses', auth: 'required', handler: listCourses },
  { method: 'POST', path: '/api/courses', auth: 'required', roles: ['author'], handler: createCourse },
  { method: 'GET', path: '/api/courses/:id', auth: 'required', handler: readCourse },
  { method: 'PATCH', path: '/api/courses/:id', auth: 'required', handler: patchCourse },
  { method: 'POST', path: '/api/courses/:id/transitions', auth: 'required', handler: transitionCourse },
  { method: 'GET', path: '/api/courses/:id/history', auth: 'required', handler: courseHistory },
];
