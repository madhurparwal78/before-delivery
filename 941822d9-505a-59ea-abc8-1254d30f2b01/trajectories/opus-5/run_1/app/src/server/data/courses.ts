import { one, query, type Queryable } from '../db/pool.js';
import { contactHoursHundredths, formatHours } from '../domain/contactHours.js';
import { formatMoney } from '../domain/money.js';
import type { CourseState, Role } from '../domain/courseLifecycle.js';
import type { AuthUser } from '../http/context.js';

export interface CourseRow {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly format: 'self_paced' | 'cohort';
  readonly state: CourseState;
  readonly list_price_cents: number;
  readonly version: number;
  readonly author_id: string;
  readonly author_display_name: string;
}

export interface ModuleRow {
  readonly id: string;
  readonly course_id: string;
  readonly position: number;
  readonly title: string;
  readonly minutes: number;
  readonly kind: 'lesson' | 'evaluation';
  readonly body: string | null;
  readonly question_prompt: string | null;
  readonly question_options: string[] | null;
  readonly answer_index: number | null;
}

const COURSE_SELECT = `
  SELECT c.id, c.title, c.summary, c.format, c.state, c.list_price_cents, c.version,
         c.author_id, a.display_name AS author_display_name
  FROM courses c JOIN users a ON a.id = c.author_id
`;

export async function getCourse(client: Queryable, id: string): Promise<CourseRow | null> {
  return one<CourseRow>(client, `${COURSE_SELECT} WHERE c.id = $1`, [id]);
}

export async function getCourseForUpdate(client: Queryable, id: string): Promise<CourseRow | null> {
  const locked = await one<{ id: string }>(client, 'SELECT id FROM courses WHERE id = $1 FOR UPDATE', [id]);
  if (locked === null) return null;
  return getCourse(client, id);
}

export async function listCoursesFor(client: Queryable, user: AuthUser): Promise<CourseRow[]> {
  if (user.role === 'planner') {
    return query<CourseRow>(client, `${COURSE_SELECT} ORDER BY c.created_at`);
  }
  if (user.role === 'author') {
    return query<CourseRow>(
      client,
      `${COURSE_SELECT} WHERE c.state IN ('published', 'withdrawn') OR c.author_id = $1 ORDER BY c.created_at`,
      [user.id],
    );
  }
  return query<CourseRow>(client, `${COURSE_SELECT} WHERE c.state = 'published' ORDER BY c.created_at`);
}

export async function getModules(client: Queryable, courseId: string): Promise<ModuleRow[]> {
  return query<ModuleRow>(
    client,
    `SELECT id, course_id, position, title, minutes, kind, body, question_prompt, question_options, answer_index
     FROM course_modules WHERE course_id = $1 ORDER BY position`,
    [courseId],
  );
}

export function totalMinutes(modules: readonly ModuleRow[]): number {
  return modules.reduce((sum, module) => sum + module.minutes, 0);
}

/** Draft and in-review courses are readable only by their author and the planner. */
export function canReadCourse(course: CourseRow, user: AuthUser): boolean {
  if (course.state === 'published' || course.state === 'withdrawn') return true;
  return user.role === 'planner' || course.author_id === user.id;
}

/** The author and the planner also see lesson bodies and the correct answer. */
export function seesCourseInternals(course: CourseRow, role: Role, userId: string): boolean {
  return role === 'planner' || (role === 'author' && course.author_id === userId);
}

export interface CourseJsonModule {
  readonly id: string;
  readonly position: number;
  readonly title: string;
  readonly minutes: number;
  readonly kind: 'lesson' | 'evaluation';
  readonly body?: string | null;
  readonly question?: { prompt: string; options: string[]; answer_index: number } | null;
}

export interface CourseJson {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly format: 'self_paced' | 'cohort';
  readonly state: CourseState;
  readonly list_price: string;
  readonly total_minutes: number;
  readonly contact_hours: string;
  readonly version: number;
  readonly author: { id: string; display_name: string };
  readonly modules?: readonly CourseJsonModule[];
  readonly cohorts?: readonly unknown[];
}

function moduleJson(module: ModuleRow, withInternals: boolean): CourseJsonModule {
  const base = {
    id: module.id,
    position: module.position,
    title: module.title,
    minutes: module.minutes,
    kind: module.kind,
  };
  if (!withInternals) return base;
  if (module.kind === 'evaluation') return { ...base, body: null, question: null };
  return {
    ...base,
    body: module.body,
    question:
      module.question_prompt === null || module.question_options === null || module.answer_index === null
        ? null
        : {
            prompt: module.question_prompt,
            options: module.question_options,
            answer_index: module.answer_index,
          },
  };
}

export function courseSummaryJson(course: CourseRow, modules: readonly ModuleRow[]): CourseJson {
  const minutes = totalMinutes(modules);
  return {
    id: course.id,
    title: course.title,
    summary: course.summary,
    format: course.format,
    state: course.state,
    list_price: formatMoney(course.list_price_cents),
    total_minutes: minutes,
    contact_hours: formatHours(contactHoursHundredths(minutes)),
    version: course.version,
    author: { id: course.author_id, display_name: course.author_display_name },
  };
}

export function courseJson(
  course: CourseRow,
  modules: readonly ModuleRow[],
  cohorts: readonly unknown[],
  user: AuthUser,
): CourseJson {
  const withInternals = seesCourseInternals(course, user.role, user.id);
  return {
    ...courseSummaryJson(course, modules),
    modules: modules.map((module) => moduleJson(module, withInternals)),
    cohorts,
  };
}
