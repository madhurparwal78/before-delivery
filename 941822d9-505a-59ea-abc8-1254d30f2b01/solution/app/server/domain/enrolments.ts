import { one, type Db } from "../db.js";
import { notFound } from "../http/errors.js";
import { formatMoney, quotient } from "./amounts.js";
import { isId } from "./courses.js";
import { hospitalOf, type SessionUser } from "./users.js";

export type EnrolmentState = "held" | "confirmed" | "completed" | "certified" | "refunded" | "withdrawn";

export interface EnrolmentRow {
  id: string;
  learner_id: string;
  course_id: string;
  course_title: string;
  course_state: string;
  cohort_id: string | null;
  state: EnrolmentState;
  funding: "card" | "co_pay" | "seat";
  funding_hospital_id: string | null;
  assignment_id: string | null;
  list_price_cents: number;
  employer_share_cents: number;
  learner_share_cents: number;
  enrolled_at: Date;
  total_minutes: number;
  verified_minutes: number;
  certificate_id: string | null;
}

export const ENROLMENT_SELECT = `
  SELECT e.id, e.learner_id, e.course_id, c.title AS course_title, c.state AS course_state, e.cohort_id, e.state, e.funding,
         e.funding_hospital_id, e.assignment_id, e.list_price_cents, e.employer_share_cents, e.learner_share_cents, e.enrolled_at,
         (SELECT coalesce(sum(m.minutes), 0) FROM course_modules m WHERE m.course_id = e.course_id) AS total_minutes,
         (SELECT coalesce(sum(m.minutes), 0) FROM module_verifications v JOIN course_modules m ON m.id = v.module_id
           WHERE v.enrolment_id = e.id) AS verified_minutes,
         (SELECT x.id FROM certificates x WHERE x.enrolment_id = e.id) AS certificate_id
    FROM enrolments e JOIN courses c ON c.id = e.course_id`;

/** Enrolments a learner holds open in a course: not refunded and not withdrawn. */
export const OPEN_ENROLMENT = "e.state NOT IN ('refunded', 'withdrawn')";

/** Hospital funding in SQL: enrolments the hospital funded by seat or co-pay; `param` is the hospital id placeholder. */
export const fundedBySql = (param: string): string => `e.funding IN ('seat', 'co_pay') AND e.funding_hospital_id = ${param}`;

/** A coordinator reads an enrolment only when their own hospital funded it (seat or co-pay). */
const fundedBy = (viewer: SessionUser, e: Pick<EnrolmentRow, "funding" | "funding_hospital_id">): boolean =>
  viewer.role === "coordinator" && (e.funding === "seat" || e.funding === "co_pay") && e.funding_hospital_id === hospitalOf(viewer)?.id;

/** Its learner, the planner and the funding hospital's coordinator may read an enrolment and its certificate. */
export const canReadEnrolment = (viewer: SessionUser, e: Pick<EnrolmentRow, "learner_id" | "funding" | "funding_hospital_id">): boolean =>
  e.learner_id === viewer.id || viewer.role === "planner" || fundedBy(viewer, e);

export async function enrolmentRow(t: Db, id: string, lock = false): Promise<EnrolmentRow | undefined> {
  return one<EnrolmentRow>(t, `${ENROLMENT_SELECT} WHERE e.id = $1${lock ? " FOR UPDATE OF e" : ""}`, [id]);
}

export async function readableEnrolment(t: Db, viewer: SessionUser, id: unknown, lock = false): Promise<EnrolmentRow> {
  if (!isId(id)) throw notFound();
  const row = await enrolmentRow(t, id, lock);
  if (!row || !canReadEnrolment(viewer, row)) throw notFound();
  return row;
}

/** Progress: verified minutes × 100 / total minutes, rounded down to a whole number. */
const progressPercent = (e: Pick<EnrolmentRow, "verified_minutes" | "total_minutes">): number =>
  e.total_minutes === 0 ? 0 : quotient(e.verified_minutes * 100, e.total_minutes);

export async function enrolmentsJson(t: Db, rows: readonly EnrolmentRow[]): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];
  const modules = await t.q<{ enrolment_id: string; id: string; title: string; minutes: number; kind: string; verified: boolean }>(
    `SELECT e.id AS enrolment_id, m.id, m.title, m.minutes, m.kind, (v.module_id IS NOT NULL) AS verified
       FROM enrolments e JOIN course_modules m ON m.course_id = e.course_id
       LEFT JOIN module_verifications v ON v.enrolment_id = e.id AND v.module_id = m.id
      WHERE e.id = ANY($1::uuid[]) ORDER BY m.position`,
    [rows.map((r) => r.id)],
  );
  return rows.map((e) => ({
    id: e.id,
    course_id: e.course_id,
    course_title: e.course_title,
    cohort_id: e.cohort_id,
    state: e.state,
    funding: e.funding,
    assignment_id: e.assignment_id,
    list_price: formatMoney(e.list_price_cents),
    employer_share: formatMoney(e.employer_share_cents),
    learner_share: formatMoney(e.learner_share_cents),
    enrolled_at: e.enrolled_at.toISOString(),
    verified_minutes: e.verified_minutes,
    total_minutes: e.total_minutes,
    progress_percent: progressPercent(e),
    certificate_id: e.certificate_id,
    modules: modules
      .filter((m) => m.enrolment_id === e.id)
      .map((m) => ({ id: m.id, title: m.title, minutes: m.minutes, kind: m.kind, status: m.verified ? "verified" : "unverified" })),
  }));
}

export async function enrolmentJson(t: Db, id: string): Promise<Record<string, unknown>> {
  const row = await enrolmentRow(t, id);
  const [json] = row ? await enrolmentsJson(t, [row]) : [];
  if (!json) throw notFound();
  return json;
}
