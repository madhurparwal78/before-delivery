import { err, notFound, validationError } from "./errors.ts";
import { query, withSerializable } from "./db.ts";
import { serialiseCourse, serialiseCourseSummary, type CohortRow, type ModuleRow } from "./dto.ts";
import { centsToMoney, contactHoursHundredths, parseMoney } from "./money.ts";
import { assertCourseReadable } from "./access.ts";
import type { Ctx } from "./route.ts";
import { uuidOr404 } from "./validation.ts";
import { pathParam } from "./route.ts";
import { seatsRemaining } from "./cohorts.ts";

export type CourseRecord = {
  id: string;
  title: string;
  summary: string;
  format: "self_paced" | "cohort";
  state: "draft" | "in_review" | "published" | "withdrawn";
  list_price_cents: number;
  version: number;
  author_id: string;
  author_name: string;
  total_minutes: number;
};

const COURSE_SELECT = `
  SELECT c.id, c.title, c.summary, c.format, c.state, c.list_price_cents, c.version,
         c.author_id, u.display_name AS author_name,
         COALESCE((SELECT sum(m.minutes) FROM modules m WHERE m.course_id = c.id), 0)::int AS total_minutes
    FROM courses c JOIN users u ON u.id = c.author_id`;

export async function findCourse(id: string): Promise<CourseRecord | null> {
  const { rows } = await query<CourseRecord>(`${COURSE_SELECT} WHERE c.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function courseModules(courseId: string): Promise<ModuleRow[]> {
  const { rows } = await query<ModuleRow>(
    `SELECT id, position, title, minutes, kind, body, question_prompt, question_options, answer_index
       FROM modules WHERE course_id = $1 ORDER BY position`,
    [courseId],
  );
  return rows;
}

export async function courseCohorts(courseId: string, forPlanner: boolean): Promise<CohortRow[]> {
  const { rows } = await query<{ id: string; course_id: string; name: string; starts_on: string; close_date: string; seat_cap: number; active: string }>(
    `SELECT co.id, co.course_id, co.name, to_char(co.starts_on,'YYYY-MM-DD') AS starts_on,
            to_char(co.close_date,'YYYY-MM-DD') AS close_date, co.seat_cap,
            (SELECT count(*) FROM enrolments e
              WHERE e.cohort_id = co.id AND e.state IN ('held','confirmed','completed','certified'))::text AS active
       FROM cohorts co WHERE co.course_id = $1 ORDER BY co.starts_on, co.name`,
    [courseId],
  );
  const list: CohortRow[] = rows.map((r) => ({ ...r, seats_remaining: seatsRemaining(r.seat_cap, Number(r.active)) }));
  if (!forPlanner) return list;
  const { rows: detail } = await query<{
    id: string;
    roster: Array<{ enrolment_id: string; nurse_name: string; state: string }>;
    waitlist: Array<{ position: number; nurse_name: string; joined_at: string }>;
  }>(
    `SELECT co.id,
            COALESCE((SELECT json_agg(json_build_object('enrolment_id', e.id, 'nurse_name', u.display_name, 'state', e.state)
                              ORDER BY u.display_name)
                        FROM enrolments e JOIN users u ON u.id = e.nurse_id
                       WHERE e.cohort_id = co.id AND e.state IN ('held','confirmed','completed','certified')), '[]') AS roster,
            COALESCE((SELECT json_agg(json_build_object('position', w.rn, 'nurse_name', u.display_name, 'joined_at', w.joined_at)
                              ORDER BY w.rn)
                        FROM (SELECT w2.*, row_number() OVER (ORDER BY w2.seq) AS rn
                                FROM waitlist_entries w2 WHERE w2.cohort_id = co.id) w
                        JOIN users u ON u.id = w.nurse_id), '[]') AS waitlist
       FROM cohorts co WHERE co.course_id = $1`,
    [courseId],
  );
  return list.map((c) => {
    const d = detail.find((row) => row.id === c.id);
    return { ...c, roster: d?.roster ?? [], waitlist: d?.waitlist ?? [] };
  });
}

const courseDto = (course: CourseRecord, modules: ModuleRow[], cohorts: CohortRow[], includeAuthorBody: boolean, forPlanner: boolean): Record<string, unknown> =>
  serialiseCourse(
    { ...course, contact_hours_h: contactHoursHundredths(course.total_minutes) },
    modules,
    cohorts,
    includeAuthorBody,
    forPlanner,
  );

const courseSummaryDto = (course: CourseRecord): Record<string, unknown> =>
  serialiseCourseSummary({ ...course, contact_hours_h: contactHoursHundredths(course.total_minutes) });

export async function getCourse(ctx: Ctx): Promise<void> {
  const course = await findCourse(uuidOr404(pathParam(ctx, "id")));
  if (!course) throw notFound();
  assertCourseReadable(ctx.user, course);
  const forPlanner = ctx.user.role === "planner";
  const includeAuthorBody = forPlanner || (ctx.user.role === "author" && course.author_id === ctx.user.id);
  const modules = await courseModules(course.id);
  const cohorts = course.format === "cohort" ? await courseCohorts(course.id, forPlanner) : [];
  ctx.res.json({ course: courseDto(course, modules, cohorts, includeAuthorBody, forPlanner) });
}

export async function listCourses(ctx: Ctx): Promise<void> {
  const { rows } = await query<CourseRecord>(`${COURSE_SELECT} ORDER BY c.created_at, c.title`);
  const visible = rows.filter((c) => {
    if (ctx.user.role === "planner") return true;
    if (c.state === "published") return true;
    if (ctx.user.role === "author") return c.author_id === ctx.user.id;
    return false;
  });
  ctx.res.json({ courses: visible.map(courseSummaryDto) });
}

const COURSE_BODY_FIELDS = ["title", "summary", "format", "list_price", "modules"];

type ModuleInput = {
  title: string;
  minutes: number;
  kind: "lesson" | "evaluation";
  body: string;
  question: { prompt: string; options: string[]; answer_index: number };
};

const MODULES_MESSAGE = "Add at least one lesson and exactly one post-evaluation, placed last.";
const QUESTION_MESSAGE = "Give each lesson a question with 2 to 5 options and one correct option.";
const MINUTES_MESSAGE = "Minutes must be a whole number from 5 to 240.";
const PRICE_MESSAGE = "Enter a price from 0.00 to 5000.00 with two decimals.";
const TITLE_MESSAGE = "Enter a course title of 1 to 120 characters.";

type ParsedCourseInput = { modules: ModuleInput[]; priceCents: number; format: "self_paced" | "cohort"; summary: string; title: string };

function parseCourseInput(body: Record<string, unknown>): { errors: Record<string, string>; value: ParsedCourseInput | null } {
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (!COURSE_BODY_FIELDS.includes(key)) errors[key] = "This field is not accepted.";
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length === 0 || title.length > 120) errors.title = TITLE_MESSAGE;
  const summary = typeof body.summary === "string" ? body.summary : "";
  const format = body.format === "self_paced" || body.format === "cohort" ? body.format : null;
  if (!format) errors.format = "Choose a course format.";
  const priceCents = parseMoney(body.list_price);
  if (priceCents === null || priceCents > 500000) errors.list_price = PRICE_MESSAGE;

  const modules: ModuleInput[] = [];
  let structureBad = false;
  let minutesBad = false;
  let questionBad = false;

  const rawModules = body.modules;
  if (Array.isArray(rawModules)) {
    for (const raw of rawModules) {
      if (typeof raw !== "object" || raw === null) {
        structureBad = true;
        continue;
      }
      const m = raw as Record<string, unknown>;
      const kind = m.kind === "lesson" || m.kind === "evaluation" ? (m.kind as "lesson" | "evaluation") : null;
      if (kind === null) {
        structureBad = true;
        continue;
      }
      const minutes = typeof m.minutes === "number" && Number.isInteger(m.minutes) ? m.minutes : -1;
      if (minutes < 5 || minutes > 240) minutesBad = true;
      const mTitle = typeof m.title === "string" ? m.title.trim() : "";
      if (mTitle.length === 0) structureBad = true;
      const mBody = typeof m.body === "string" ? m.body : "";
      if (kind === "evaluation") {
        modules.push({ title: mTitle, minutes: Math.max(minutes, 5), kind, body: mBody, question: { prompt: "", options: [], answer_index: -1 } });
        continue;
      }
      const q = m.question as Record<string, unknown> | null | undefined;
      if (typeof q !== "object" || q === null) {
        questionBad = true;
        modules.push({ title: mTitle, minutes: Math.max(minutes, 5), kind, body: mBody, question: { prompt: "", options: [], answer_index: -1 } });
        continue;
      }
      const prompt = typeof q.prompt === "string" ? q.prompt : "";
      const options = Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === "string") : [];
      const answerRaw = q.answer_index;
      const answerIndex = typeof answerRaw === "number" && Number.isInteger(answerRaw) ? answerRaw : -1;
      if (prompt.length === 0 || options.length < 2 || options.length > 5 || answerIndex < 0 || answerIndex >= options.length) {
        questionBad = true;
      }
      modules.push({
        title: mTitle,
        minutes: Math.max(minutes, 5),
        kind,
        body: mBody,
        question: { prompt, options, answer_index: answerIndex },
      });
    }
    const last = modules[modules.length - 1];
    if (modules.length < 2 || !last || last.kind !== "evaluation" || modules.slice(0, -1).some((m) => m.kind !== "lesson")) {
      structureBad = true;
    }
  } else {
    structureBad = true;
  }

  if (structureBad) errors.modules = MODULES_MESSAGE;
  else if (minutesBad) errors.modules = MINUTES_MESSAGE;
  if (questionBad) errors.question = QUESTION_MESSAGE;

  if (Object.keys(errors).length > 0) return { errors, value: null };
  return { errors, value: { modules, priceCents: priceCents ?? 0, format: format ?? "self_paced", summary, title } };
}

const MODULE_INSERT = `
  INSERT INTO modules (id, course_id, position, title, minutes, kind, body, question_prompt, question_options, answer_index)
  VALUES (gen_random_uuid(), $1, $2, $3, $4, $5,
          CASE WHEN $5 = 'lesson' THEN $6 END, CASE WHEN $5 = 'lesson' THEN $7 END,
          CASE WHEN $5 = 'lesson' THEN $8::jsonb END, CASE WHEN $5 = 'lesson' THEN $9 END)`;

export async function createCourse(ctx: Ctx): Promise<void> {
  if (ctx.user.role !== "author") throw notFound();
  const parsed = parseCourseInput((ctx.body ?? {}) as Record<string, unknown>);
  if (parsed.value === null) throw validationError(parsed.errors);
  const input = parsed.value;

  const courseId = await withSerializable(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO courses (id, title, summary, format, state, list_price_cents, author_id, version)
       VALUES (gen_random_uuid(), $1, $2, $3, 'draft', $4, $5, 1) RETURNING id`,
      [input.title, input.summary, input.format, input.priceCents, ctx.user.id],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("course insert failed");
    let position = 1;
    for (const m of input.modules) {
      await client.query(MODULE_INSERT, [id, position++, m.title, m.minutes, m.kind, m.body, m.question.prompt, JSON.stringify(m.question.options), m.question.answer_index]);
    }
    return id;
  });

  const created = await findCourse(courseId);
  if (!created) throw notFound();
  ctx.res.status(201).json({ course: courseDto(created, await courseModules(created.id), [], true, true) });
}

const editableBy = (course: CourseRecord, user: Ctx["user"]): boolean =>
  user.role === "planner" ? course.state === "draft" || course.state === "in_review" : course.state === "draft";

export async function patchCourse(ctx: Ctx): Promise<void> {
  const course = await findCourse(uuidOr404(pathParam(ctx, "id")));
  if (!course) throw notFound();
  assertCourseReadable(ctx.user, course);
  if (ctx.user.role !== "planner" && course.author_id !== ctx.user.id) throw err(403, "forbidden");

  const version = readIfMatch(ctx);
  if (version === null) throw err(428, "version_required");
  const current = await query<{ version: number }>(`SELECT version FROM courses WHERE id = $1`, [course.id]);
  const currentVersion = current.rows[0]?.version;
  if (currentVersion === undefined) throw notFound();
  if (currentVersion !== version) throw err(412, "stale_version", { current_version: currentVersion });
  if (!editableBy(course, ctx.user)) throw err(409, "course_not_editable");

  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = {
    title: body.title !== undefined ? body.title : course.title,
    summary: body.summary !== undefined ? body.summary : course.summary,
    format: body.format !== undefined ? body.format : course.format,
    list_price: body.list_price !== undefined ? body.list_price : centsToMoney(course.list_price_cents),
    modules:
      body.modules !== undefined
        ? body.modules
        : (await courseModules(course.id)).map((m) =>
            m.kind === "lesson"
              ? {
                  title: m.title,
                  minutes: m.minutes,
                  kind: m.kind,
                  body: m.body ?? "",
                  question: { prompt: m.question_prompt ?? "", options: (m.question_options as string[]) ?? [], answer_index: m.answer_index ?? 0 },
                }
              : { title: m.title, minutes: m.minutes, kind: m.kind, body: m.body ?? "", question: { prompt: "", options: [], answer_index: -1 } },
          ),
  };
  const parsed = parseCourseInput(merged);
  if (parsed.value === null) throw validationError(parsed.errors);
  const input = parsed.value;

  await withSerializable(async (client) => {
    await client.query(
      `UPDATE courses SET title = $2, summary = $3, format = $4, list_price_cents = $5, version = version + 1, updated_at = now() WHERE id = $1`,
      [course.id, input.title, input.summary, input.format, input.priceCents],
    );
    await client.query(`DELETE FROM modules WHERE course_id = $1`, [course.id]);
    let position = 1;
    for (const m of input.modules) {
      await client.query(MODULE_INSERT, [course.id, position++, m.title, m.minutes, m.kind, m.body, m.question.prompt, JSON.stringify(m.question.options), m.question.answer_index]);
    }
  });

  const updated = await findCourse(course.id);
  if (!updated) throw notFound();
  const forPlanner = ctx.user.role === "planner";
  const cohorts = updated.format === "cohort" ? await courseCohorts(updated.id, forPlanner) : [];
  ctx.res.json({ course: courseDto(updated, await courseModules(updated.id), cohorts, true, forPlanner) });
}

export function readIfMatch(ctx: Ctx): number | null {
  const header = ctx.req.headers["if-match"];
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined) return null;
  const match = /^"?(\d+)"?$/.exec(raw.trim());
  return match ? Number(match[1]) : null;
}

const LEGAL_EDGES: Record<"author" | "planner", Partial<Record<CourseRecord["state"], string[]>>> = {
  author: { draft: ["in_review"] },
  planner: { in_review: ["published", "draft"], published: ["withdrawn"] },
};

const STATE_VALUES = ["draft", "in_review", "published", "withdrawn"];

export async function transitionCourse(ctx: Ctx): Promise<void> {
  const course = await findCourse(uuidOr404(pathParam(ctx, "id")));
  if (!course) throw notFound();
  assertCourseReadable(ctx.user, course);

  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const to = body.to;
  if (typeof to !== "string" || !STATE_VALUES.includes(to)) throw err(403, "forbidden");

  const actorRole = ctx.user.role;
  if (actorRole === "author") {
    if (course.author_id !== ctx.user.id || to !== "in_review") throw err(403, "forbidden");
  } else if (actorRole === "planner") {
    if (!["published", "draft", "withdrawn"].includes(to)) throw err(403, "forbidden");
  } else {
    throw err(403, "forbidden");
  }

  const version = readIfMatch(ctx);
  if (version === null) throw err(428, "version_required");
  const current = await query<{ version: number }>(`SELECT version FROM courses WHERE id = $1`, [course.id]);
  const currentVersion = current.rows[0]?.version;
  if (currentVersion === undefined) throw notFound();
  if (currentVersion !== version) throw err(412, "stale_version", { current_version: currentVersion });

  const legal = LEGAL_EDGES[actorRole][course.state] ?? [];
  if (!legal.includes(to)) throw err(409, "invalid_transition", { from: course.state, to });

  const rawNote = body.note;
  const note = typeof rawNote === "string" ? rawNote : null;
  if (actorRole === "planner" && to === "draft" && (note === null || note.trim().length === 0)) {
    throw validationError({ note: "Tell the author what to change." });
  }

  await withSerializable(async (client) => {
    await client.query(`UPDATE courses SET state = $2, version = version + 1, updated_at = now() WHERE id = $1`, [course.id, to]);
    await client.query(
      `INSERT INTO course_history (id, course_id, from_state, to_state, by_user_id, note, at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())`,
      [course.id, course.state, to, ctx.user.id, note],
    );
  });

  const updated = await findCourse(course.id);
  if (!updated) throw notFound();
  const forPlanner = ctx.user.role === "planner";
  const cohorts = updated.format === "cohort" ? await courseCohorts(updated.id, forPlanner) : [];
  ctx.res.json({ course: courseDto(updated, await courseModules(updated.id), cohorts, true, forPlanner) });
}

export async function courseHistory(ctx: Ctx): Promise<void> {
  const course = await findCourse(uuidOr404(pathParam(ctx, "id")));
  if (!course) throw notFound();
  assertCourseReadable(ctx.user, course);
  if (!(ctx.user.role === "planner" || (ctx.user.role === "author" && course.author_id === ctx.user.id))) throw notFound();
  const { rows } = await query<{ from_state: string; to_state: string; by_id: string; display_name: string; note: string | null; at: Date }>(
    `SELECT ch.from_state, ch.to_state, ch.by_user_id AS by_id, u.display_name, ch.note, ch.at
       FROM course_history ch JOIN users u ON u.id = ch.by_user_id
      WHERE ch.course_id = $1 ORDER BY ch.at, ch.id`,
    [course.id],
  );
  ctx.res.json({
    history: rows.map((r) => ({ from: r.from_state, to: r.to_state, by: { id: r.by_id, display_name: r.display_name }, note: r.note, at: r.at.toISOString() })),
  });
}
