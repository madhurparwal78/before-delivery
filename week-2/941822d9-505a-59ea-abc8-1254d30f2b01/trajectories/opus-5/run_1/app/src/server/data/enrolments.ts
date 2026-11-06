import { one, query, type Queryable } from '../db/pool.js';
import { progressPercent } from '../domain/contactHours.js';
import type { Funding } from '../domain/coverage.js';
import type { EnrolmentState } from '../domain/enrolment.js';
import { formatMoney } from '../domain/money.js';
import { instantToIso } from '../domain/providerTime.js';
import type { AuthUser } from '../http/context.js';

export interface EnrolmentRow {
  readonly id: string;
  readonly user_id: string;
  readonly course_id: string;
  readonly cohort_id: string | null;
  readonly state: EnrolmentState;
  readonly funding: Funding;
  readonly sponsor_organisation_id: string | null;
  readonly list_price_cents: number;
  readonly employer_share_cents: number;
  readonly learner_share_cents: number;
  readonly enrolled_at: Date;
  readonly course_title: string;
}

const ENROLMENT_SELECT = `
  SELECT e.id, e.user_id, e.course_id, e.cohort_id, e.state, e.funding, e.sponsor_organisation_id,
         e.list_price_cents, e.employer_share_cents, e.learner_share_cents, e.enrolled_at,
         c.title AS course_title
  FROM enrolments e JOIN courses c ON c.id = e.course_id
`;

export async function getEnrolment(client: Queryable, id: string): Promise<EnrolmentRow | null> {
  return one<EnrolmentRow>(client, `${ENROLMENT_SELECT} WHERE e.id = $1`, [id]);
}

export async function listEnrolmentsOf(client: Queryable, userId: string): Promise<EnrolmentRow[]> {
  return query<EnrolmentRow>(client, `${ENROLMENT_SELECT} WHERE e.user_id = $1 ORDER BY e.enrolled_at DESC`, [userId]);
}

/**
 * A learner reads only their own enrolments; a coordinator only those their hospital
 * funded; the planner reads every one. Every other id answers as not found.
 */
export function canReadEnrolment(enrolment: EnrolmentRow, user: AuthUser): boolean {
  if (user.role === 'planner') return true;
  if (user.role === 'learner') return enrolment.user_id === user.id;
  if (user.role === 'coordinator') {
    return (
      user.organisationId !== null &&
      enrolment.sponsor_organisation_id === user.organisationId &&
      (enrolment.funding === 'seat' || enrolment.funding === 'co_pay')
    );
  }
  return false;
}

export interface EnrolmentModuleJson {
  readonly id: string;
  readonly title: string;
  readonly minutes: number;
  readonly kind: 'lesson' | 'evaluation';
  readonly status: 'verified' | 'unverified';
}

export interface EnrolmentJson {
  readonly id: string;
  readonly course_id: string;
  readonly course_title: string;
  readonly cohort_id: string | null;
  readonly state: EnrolmentState;
  readonly funding: Funding;
  readonly assignment_id: string | null;
  readonly list_price: string;
  readonly employer_share: string;
  readonly learner_share: string;
  readonly enrolled_at: string;
  readonly verified_minutes: number;
  readonly total_minutes: number;
  readonly progress_percent: number;
  readonly certificate_id: string | null;
  readonly modules: readonly EnrolmentModuleJson[];
}

interface ModuleStatusRow {
  readonly id: string;
  readonly title: string;
  readonly minutes: number;
  readonly kind: 'lesson' | 'evaluation';
  readonly verified: boolean;
}

export async function moduleStatuses(
  client: Queryable,
  enrolment: EnrolmentRow,
): Promise<ModuleStatusRow[]> {
  return query<ModuleStatusRow>(
    client,
    `SELECT m.id, m.title, m.minutes, m.kind,
            (v.id IS NOT NULL) AS verified
     FROM course_modules m
     LEFT JOIN module_verifications v ON v.module_id = m.id AND v.enrolment_id = $1
     WHERE m.course_id = $2
     ORDER BY m.position`,
    [enrolment.id, enrolment.course_id],
  );
}

export async function verifiedMinutes(client: Queryable, enrolment: EnrolmentRow): Promise<number> {
  const modules = await moduleStatuses(client, enrolment);
  return modules.filter((module) => module.verified).reduce((sum, module) => sum + module.minutes, 0);
}

export async function enrolmentJson(client: Queryable, enrolment: EnrolmentRow): Promise<EnrolmentJson> {
  const modules = await moduleStatuses(client, enrolment);
  const verified = modules.filter((module) => module.verified).reduce((sum, module) => sum + module.minutes, 0);
  const total = modules.reduce((sum, module) => sum + module.minutes, 0);
  const assignment = await one<{ id: string }>(
    client,
    `SELECT id FROM seat_assignments WHERE enrolment_id = $1 ORDER BY created_at LIMIT 1`,
    [enrolment.id],
  );
  const certificate = await one<{ id: string }>(
    client,
    'SELECT id FROM certificates WHERE enrolment_id = $1',
    [enrolment.id],
  );
  return {
    id: enrolment.id,
    course_id: enrolment.course_id,
    course_title: enrolment.course_title,
    cohort_id: enrolment.cohort_id,
    state: enrolment.state,
    funding: enrolment.funding,
    assignment_id: enrolment.funding === 'seat' ? assignment?.id ?? null : null,
    list_price: formatMoney(enrolment.list_price_cents),
    employer_share: formatMoney(enrolment.employer_share_cents),
    learner_share: formatMoney(enrolment.learner_share_cents),
    enrolled_at: instantToIso(enrolment.enrolled_at),
    verified_minutes: verified,
    total_minutes: total,
    progress_percent: progressPercent(verified, total),
    certificate_id: certificate?.id ?? null,
    modules: modules.map((module) => ({
      id: module.id,
      title: module.title,
      minutes: module.minutes,
      kind: module.kind,
      status: module.verified ? 'verified' : 'unverified',
    })),
  };
}
