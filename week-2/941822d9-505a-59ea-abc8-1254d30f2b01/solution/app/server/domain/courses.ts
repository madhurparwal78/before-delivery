import { randomUUID } from "node:crypto";
import { one, tx, type Db } from "../db.js";
import { conflict, fail, forbidden, notFound, Validation } from "../http/errors.js";
import { awardedQuarters, formatHours, formatMoney, parseMoney } from "./amounts.js";
import { COHORT_COLUMNS, cohortsJson, type CohortRow } from "./cohorts.js";
import type { SessionUser } from "./users.js";

export type CourseState = "draft" | "in_review" | "published" | "withdrawn";

export interface CourseRow {
  id: string;
  title: string;
  summary: string;
  format: "self_paced" | "cohort";
  state: CourseState;
  list_price_cents: number;
  version: number;
  author_id: string;
  author_name: string;
  total_minutes: number;
}

export interface ModuleRow {
  id: string;
  course_id: string;
  position: number;
  title: string;
  minutes: number;
  kind: "lesson" | "evaluation";
  body: string | null;
  prompt: string | null;
  options: string[] | null;
  answer_index: number | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ids are opaque UUIDs; anything else names no record. */
export const isId = (value: unknown): value is string => typeof value === "string" && UUID_RE.test(value);

const COURSE_SELECT = `
  SELECT c.id, c.title, c.summary, c.format, c.state, c.list_price_cents, c.version, c.author_id,
         u.display_name AS author_name,
         (SELECT coalesce(sum(m.minutes), 0) FROM course_modules m WHERE m.course_id = c.id) AS total_minutes
    FROM courses c JOIN users u ON u.id = c.author_id`;

const MODULE_COLUMNS = "id, course_id, position, title, minutes, kind, body, prompt, options, answer_index";

/** Published and withdrawn courses are readable by everyone; drafts and courses in review by their author and the planner. */
const canReadCourse = (viewer: SessionUser, course: Pick<CourseRow, "state" | "author_id">): boolean =>
  course.state === "published" || course.state === "withdrawn" || viewer.role === "planner" || course.author_id === viewer.id;

export async function readableCourse(t: Db, viewer: SessionUser, id: unknown, lock = false): Promise<CourseRow> {
  if (!isId(id)) throw notFound();
  const course = await one<CourseRow>(t, `${COURSE_SELECT} WHERE c.id = $1${lock ? " FOR UPDATE OF c" : ""}`, [id]);
  if (!course || !canReadCourse(viewer, course)) throw notFound();
  return course;
}

export const modulesOf = (t: Db, courseId: string): Promise<ModuleRow[]> =>
  t.q<ModuleRow>(`SELECT ${MODULE_COLUMNS} FROM course_modules WHERE course_id = $1 ORDER BY position`, [courseId]);

const summaryJson = (course: CourseRow): Record<string, unknown> => ({
  id: course.id,
  title: course.title,
  summary: course.summary,
  format: course.format,
  state: course.state,
  list_price: formatMoney(course.list_price_cents),
  total_minutes: course.total_minutes,
  contact_hours: formatHours(awardedQuarters(course.total_minutes)),
  version: course.version,
  author: { id: course.author_id, display_name: course.author_name },
});

/** The full Course object; its author and the planner also see lesson bodies and questions with answers. */
export async function courseJson(t: Db, course: CourseRow, viewer: SessionUser, at: Date): Promise<Record<string, unknown>> {
  const authoring = viewer.role === "planner" || viewer.id === course.author_id;
  const modules = (await modulesOf(t, course.id)).map((m) => {
    const base: Record<string, unknown> = { id: m.id, position: m.position, title: m.title, minutes: m.minutes, kind: m.kind };
    if (authoring && m.kind === "lesson") {
      base.body = m.body;
      base.question = { prompt: m.prompt, options: m.options, answer_index: m.answer_index };
    }
    return base;
  });
  const cohorts = await t.q<CohortRow>(`SELECT ${COHORT_COLUMNS} FROM cohorts WHERE course_id = $1 ORDER BY starts_on, created_at`, [course.id]);
  return { ...summaryJson(course), modules, cohorts: await cohortsJson(t, cohorts, viewer, at) };
}

export async function listCourses(t: Db, viewer: SessionUser): Promise<Record<string, unknown>[]> {
  const where =
    viewer.role === "planner" ? "TRUE" : viewer.role === "author" ? "(c.state = 'published' OR c.author_id = $1)" : "c.state = 'published'";
  const params = viewer.role === "author" ? [viewer.id] : [];
  const rows = await t.q<CourseRow>(`${COURSE_SELECT} WHERE ${where} ORDER BY c.created_at, c.title`, params);
  return rows.map(summaryJson);
}

interface ModuleInput {
  title: string;
  minutes: number;
  kind: "lesson" | "evaluation";
  body: string | null;
  prompt: string | null;
  options: string[] | null;
  answerIndex: number | null;
}

interface CourseFields {
  title?: string;
  summary?: string;
  format?: "self_paced" | "cohort";
  listPriceCents?: number;
  modules?: ModuleInput[];
}

const COURSE_FIELDS = ["title", "summary", "format", "list_price", "modules"] as const;

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function parseModules(value: unknown, v: Validation): ModuleInput[] | undefined {
  const structure = "Add at least one lesson and exactly one post-evaluation, placed last.";
  if (!Array.isArray(value) || value.length === 0 || !value.every(isObject)) {
    v.add("modules", structure);
    return undefined;
  }
  const kinds = value.map((m) => m.kind);
  const lessons = kinds.filter((k) => k === "lesson").length;
  const evaluations = kinds.filter((k) => k === "evaluation").length;
  if (lessons < 1 || evaluations !== 1 || kinds[kinds.length - 1] !== "evaluation" || lessons + evaluations !== kinds.length) {
    v.add("modules", structure);
    return undefined;
  }
  return value.map((m) => {
    const title = typeof m.title === "string" ? m.title.trim() : "";
    if (title.length < 1 || title.length > 120) v.add("module_title", "Give each module a title of 1 to 120 characters.");
    const minutes = m.minutes;
    if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 5 || minutes > 240) v.add("minutes", "Minutes must be a whole number from 5 to 240.");
    if (m.kind === "evaluation") {
      return { title, minutes: typeof minutes === "number" ? minutes : 0, kind: "evaluation", body: null, prompt: null, options: null, answerIndex: null };
    }
    const body = typeof m.body === "string" ? m.body.trim() : "";
    if (body.length < 1 || body.length > 20_000) v.add("body", "Give each lesson its lesson text.");
    const question = isObject(m.question) ? m.question : {};
    const prompt = typeof question.prompt === "string" ? question.prompt.trim() : "";
    const options = Array.isArray(question.options) ? question.options : [];
    const answer = question.answer_index;
    const validOptions = options.length >= 2 && options.length <= 5 && options.every((o) => typeof o === "string" && o.trim().length > 0);
    if (!prompt || !validOptions || typeof answer !== "number" || !Number.isInteger(answer) || answer < 0 || answer >= options.length) {
      v.add("question", "Give each lesson a question with 2 to 5 options and one correct option.");
    }
    return {
      title,
      minutes: typeof minutes === "number" ? minutes : 0,
      kind: "lesson",
      body,
      prompt,
      options: options.map((o) => String(o).trim()),
      answerIndex: typeof answer === "number" ? answer : 0,
    };
  });
}

/** Validates the course fields present in `body` (all of them when `required`). */
function parseCourseFields(body: Record<string, unknown>, v: Validation, required: boolean): CourseFields {
  const fields: CourseFields = {};
  const present = (name: string) => required || name in body;
  if (present("title")) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title.length < 1 || title.length > 120) v.add("title", "Enter a course title of 1 to 120 characters.");
    else fields.title = title;
  }
  if (present("summary")) {
    if (typeof body.summary !== "string" || body.summary.trim().length > 2000) v.add("summary", "Enter a summary of up to 2000 characters.");
    else fields.summary = body.summary.trim();
  }
  if (present("format")) {
    if (body.format !== "self_paced" && body.format !== "cohort") v.add("format", "Choose self-paced or live cohort.");
    else fields.format = body.format;
  }
  if (present("list_price")) {
    const cents = parseMoney(body.list_price);
    if (cents === null || cents > 500_000) v.add("list_price", "Enter a price from 0.00 to 5000.00 with two decimals.");
    else fields.listPriceCents = cents;
  }
  if (present("modules")) fields.modules = parseModules(body.modules, v);
  return fields;
}

async function writeModules(t: Db, courseId: string, modules: ModuleInput[]): Promise<void> {
  await t.q("DELETE FROM course_modules WHERE course_id = $1", [courseId]);
  for (const [index, m] of modules.entries()) {
    await t.q(
      `INSERT INTO course_modules (course_id, position, title, minutes, kind, body, prompt, options, answer_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [courseId, index + 1, m.title, m.minutes, m.kind, m.body, m.prompt, m.options ? JSON.stringify(m.options) : null, m.answerIndex],
    );
  }
}

export async function createCourse(author: SessionUser, body: Record<string, unknown>, at: Date): Promise<Record<string, unknown>> {
  if (author.role !== "author") throw forbidden();
  const v = new Validation(body, COURSE_FIELDS);
  const fields = parseCourseFields(body, v, true);
  v.done();
  return tx(async (t) => {
    const id = randomUUID();
    await t.q(
      `INSERT INTO courses (id, title, summary, format, state, list_price_cents, version, author_id, created_at)
       VALUES ($1, $2, $3, $4, 'draft', $5, 1, $6, $7)`,
      [id, fields.title, fields.summary, fields.format, fields.listPriceCents, author.id, at],
    );
    await writeModules(t, id, fields.modules ?? []);
    return courseJson(t, await readableCourse(t, author, id), author, at);
  });
}

/** `If-Match: "<version>"` — missing is 428, a stale version is 412 with the current version. */
function basedOnVersion(ifMatch: string | undefined, current: number): void {
  const match = /^(?:W\/)?"?(\d+)"?$/.exec((ifMatch ?? "").trim());
  if (!match) throw fail(428, "version_required");
  if (parseInt(match[1] ?? "", 10) !== current) throw fail(412, "stale_version", { current_version: current });
}

/** Who may edit a course in its current state. */
const editable = (viewer: SessionUser, course: CourseRow): boolean =>
  viewer.role === "planner" ? course.state === "draft" || course.state === "in_review" : course.state === "draft" && course.author_id === viewer.id;

export async function updateCourse(viewer: SessionUser, id: unknown, ifMatch: string | undefined, body: Record<string, unknown>, at: Date): Promise<Record<string, unknown>> {
  return tx(async (t) => {
    const course = await readableCourse(t, viewer, id, true);
    if (viewer.role !== "planner" && viewer.id !== course.author_id) throw forbidden();
    basedOnVersion(ifMatch, course.version);
    if (!editable(viewer, course)) throw conflict("course_not_editable");
    const v = new Validation(body, COURSE_FIELDS);
    const fields = parseCourseFields(body, v, false);
    v.done();
    await t.q(
      `UPDATE courses SET title = coalesce($2, title), summary = coalesce($3, summary), format = coalesce($4, format),
              list_price_cents = coalesce($5, list_price_cents), version = version + 1 WHERE id = $1`,
      [course.id, fields.title ?? null, fields.summary ?? null, fields.format ?? null, fields.listPriceCents ?? null],
    );
    if (fields.modules) await writeModules(t, course.id, fields.modules);
    return courseJson(t, await readableCourse(t, viewer, course.id), viewer, at);
  });
}

/** The legal lifecycle edges and the one role allowed to take each target state. */
const LEGAL_EDGES: Record<CourseState, readonly CourseState[]> = {
  draft: ["in_review"],
  in_review: ["published", "draft"],
  published: ["withdrawn"],
  withdrawn: [],
};

const mayRequest = (viewer: SessionUser, course: CourseRow, to: unknown): to is CourseState =>
  (viewer.role === "author" && course.author_id === viewer.id && to === "in_review") ||
  (viewer.role === "planner" && (to === "published" || to === "draft" || to === "withdrawn"));

export async function transitionCourse(viewer: SessionUser, id: unknown, ifMatch: string | undefined, body: Record<string, unknown>, at: Date): Promise<Record<string, unknown>> {
  return tx(async (t) => {
    const course = await readableCourse(t, viewer, id, true);
    const to = body.to;
    if (!mayRequest(viewer, course, to)) throw forbidden();
    basedOnVersion(ifMatch, course.version);
    if (!LEGAL_EDGES[course.state].includes(to)) throw conflict("invalid_transition", { from: course.state, to });
    const v = new Validation(body, ["to", "note"]);
    const note = typeof body.note === "string" && body.note.trim() !== "" ? body.note.trim() : null;
    if (body.note !== undefined && body.note !== null && typeof body.note !== "string") v.add("note", "Tell the author what to change.");
    if (to === "draft" && note === null) v.add("note", "Tell the author what to change.");
    v.done();
    await t.q("UPDATE courses SET state = $2, version = version + 1 WHERE id = $1", [course.id, to]);
    await t.q("INSERT INTO course_transitions (course_id, from_state, to_state, by_user, note, at) VALUES ($1, $2, $3, $4, $5, $6)", [
      course.id,
      course.state,
      to,
      viewer.id,
      note,
      at,
    ]);
    return courseJson(t, await readableCourse(t, viewer, course.id), viewer, at);
  });
}

export async function courseHistory(t: Db, viewer: SessionUser, id: unknown): Promise<Record<string, unknown>[]> {
  const course = await readableCourse(t, viewer, id);
  if (viewer.role !== "planner" && viewer.id !== course.author_id) throw forbidden();
  const rows = await t.q<{ from_state: string; to_state: string; by_id: string; by_name: string; note: string | null; at: Date }>(
    `SELECT h.from_state, h.to_state, u.id AS by_id, u.display_name AS by_name, h.note, h.at
       FROM course_transitions h JOIN users u ON u.id = h.by_user WHERE h.course_id = $1 ORDER BY h.at, h.id`,
    [course.id],
  );
  return rows.map((r) => ({ from: r.from_state, to: r.to_state, by: { id: r.by_id, display_name: r.by_name }, note: r.note, at: r.at.toISOString() }));
}
