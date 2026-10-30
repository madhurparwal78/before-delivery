import { centsToMoney, formatHours, formatPercent } from "./money.ts";
import { providerCloseInstant, isoInstant } from "./time.ts";
import type { SessionUser } from "./session.ts";

export type Row = Record<string, unknown>;

export type Organisation = { id: string; name: string; kind: "provider" | "hospital" };

export const serialiseOrganisation = (row: { id: string; name: string; kind: string } | null): Organisation | null =>
  row ? { id: row.id, name: row.name, kind: row.kind === "provider" ? "provider" : "hospital" } : null;

export function serialiseUser(user: SessionUser, orgRow: { id: string; name: string; kind: string } | null): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    organisation: serialiseOrganisation(orgRow),
  };
  if (user.role === "learner") {
    base.licence_number = user.licence_number;
    base.date_of_birth = user.date_of_birth;
  }
  return base;
}

export type ModuleRow = {
  id: string;
  position: number;
  title: string;
  minutes: number;
  kind: "lesson" | "evaluation";
  body: string | null;
  question_prompt: string | null;
  question_options: unknown;
  answer_index: number | null;
};

export type CohortRow = {
  id: string;
  course_id: string;
  name: string;
  starts_on: string;
  close_date: string;
  seat_cap: number;
  seats_remaining: number;
  roster?: Array<{ enrolment_id: string; nurse_name: string; state: string }>;
  waitlist?: Array<{ position: number; nurse_name: string; joined_at: string }>;
};

export function serialiseCohort(row: CohortRow, forPlanner: boolean): Record<string, unknown> {
  const closesAt = providerCloseInstant(row.close_date);
  const out: Record<string, unknown> = {
    id: row.id,
    course_id: row.course_id,
    name: row.name,
    starts_on: row.starts_on,
    close_date: row.close_date,
    closes_at: isoInstant(closesAt),
    seat_cap: row.seat_cap,
    seats_remaining: row.seats_remaining,
    open: Date.now() < closesAt.getTime(),
  };
  if (forPlanner) {
    out.roster = row.roster ?? [];
    out.waitlist = row.waitlist ?? [];
  }
  return out;
}

export type CourseRow = {
  id: string;
  title: string;
  summary: string;
  format: "self_paced" | "cohort";
  state: "draft" | "in_review" | "published" | "withdrawn";
  list_price_cents: number;
  total_minutes: number;
  contact_hours_h: number;
  version: number;
  author_id: string;
  author_name: string;
};

export function serialiseCourseSummary(row: CourseRow): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    format: row.format,
    state: row.state,
    list_price: centsToMoney(row.list_price_cents),
    total_minutes: row.total_minutes,
    contact_hours: formatHours(row.contact_hours_h),
    version: row.version,
    author: { id: row.author_id, display_name: row.author_name },
  };
}

export function serialiseCourse(
  row: CourseRow,
  modules: ModuleRow[],
  cohorts: CohortRow[],
  includeAuthorBody: boolean,
  forPlanner: boolean,
): Record<string, unknown> {
  const moduleList = modules.map((m) => {
    const base: Record<string, unknown> = {
      id: m.id,
      position: m.position,
      title: m.title,
      minutes: m.minutes,
      kind: m.kind,
    };
    if (includeAuthorBody && m.kind === "lesson") {
      base.body = m.body ?? "";
      base.question = {
        prompt: m.question_prompt ?? "",
        options: m.question_options as string[],
        answer_index: m.answer_index ?? 0,
      };
    }
    return base;
  });
  const cohortList = cohorts.map((c) => serialiseCohort(c, forPlanner));
  return {
    ...serialiseCourseSummary(row),
    modules: moduleList,
    cohorts: cohortList,
  };
}

export type QuoteRow = {
  list_price_cents: number;
  employer_share_cents: number;
  learner_share_cents: number;
  coverage_percent_h: number;
  sponsor: string | null;
};

export function serialiseQuote(row: QuoteRow): Record<string, unknown> {
  return {
    list_price: centsToMoney(row.list_price_cents),
    employer_share: centsToMoney(row.employer_share_cents),
    learner_share: centsToMoney(row.learner_share_cents),
    coverage_percent: formatPercent(row.coverage_percent_h),
    sponsor: row.sponsor,
  };
}

export type EnrolmentRow = {
  id: string;
  course_id: string;
  course_title: string;
  cohort_id: string | null;
  state: "held" | "confirmed" | "completed" | "certified" | "refunded" | "withdrawn";
  funding: "card" | "co_pay" | "seat";
  assignment_id: string | null;
  list_price_cents: number;
  employer_share_cents: number;
  learner_share_cents: number;
  enrolled_at: Date;
  verified_minutes: number;
  total_minutes: number;
  certificate_id: string | null;
};

export type EnrolmentModule = { id: string; title: string; minutes: number; kind: "lesson" | "evaluation"; status: "verified" | "unverified" };

export function serialiseEnrolment(row: EnrolmentRow, modules: EnrolmentModule[]): Record<string, unknown> {
  const progress = row.total_minutes === 0 ? 0 : Math.floor((row.verified_minutes * 100) / row.total_minutes);
  return {
    id: row.id,
    course_id: row.course_id,
    course_title: row.course_title,
    cohort_id: row.cohort_id,
    state: row.state,
    funding: row.funding,
    assignment_id: row.assignment_id,
    list_price: centsToMoney(row.list_price_cents),
    employer_share: centsToMoney(row.employer_share_cents),
    learner_share: centsToMoney(row.learner_share_cents),
    enrolled_at: isoInstant(new Date(row.enrolled_at)),
    verified_minutes: row.verified_minutes,
    total_minutes: row.total_minutes,
    progress_percent: progress,
    certificate_id: row.certificate_id,
    modules,
  };
}

export type CertificateRow = {
  id: string;
  enrolment_id: string;
  serial: string;
  course_title: string;
  contact_hours_h: number;
  current_version: number;
  state: "sealing" | "sealed" | "revoked";
  reissue_pending: boolean;
  issued_on: string | null;
  verified_module_count: number;
  versions: Array<{ version: number; state: "sealing" | "sealed" | "reissued" | "revoked"; sealed_on: string | null; nurse_name: string }>;
};

export function serialiseCertificate(row: CertificateRow): Record<string, unknown> {
  const current = row.versions.find((v) => v.version === row.current_version);
  return {
    id: row.id,
    serial: row.serial,
    state: row.state,
    version: row.current_version,
    reissue_pending: row.reissue_pending,
    nurse_name: current?.nurse_name ?? "",
    course_title: row.course_title,
    contact_hours: formatHours(row.contact_hours_h),
    issued_on: row.issued_on,
    enrolment_id: row.enrolment_id,
    verified_module_count: row.verified_module_count,
    versions: row.versions.map((v) => ({
      version: v.version,
      state: v.state,
      sealed_on: v.sealed_on,
      nurse_name: v.nurse_name,
    })),
  };
}

export type PackRow = {
  id: string;
  course_id: string;
  course_title: string;
  seats: number;
  balance: number;
  price_cents: number;
  purchased_at: Date;
  expires_at: Date;
  state: "active" | "expired";
};

export function serialisePack(row: PackRow): Record<string, unknown> {
  return {
    id: row.id,
    course_id: row.course_id,
    course_title: row.course_title,
    seats_purchased: row.seats,
    balance: row.balance,
    price_total: centsToMoney(row.price_cents),
    purchased_at: isoInstant(new Date(row.purchased_at)),
    expires_at: isoInstant(new Date(row.expires_at)),
    state: row.state,
  };
}

export type CoverageRow = { coverage_percent_h: number; scheduled_percent_h: number | null; scheduled_on: string | null };

export function serialiseCoverage(row: CoverageRow): Record<string, unknown> {
  return {
    coverage_percent: formatPercent(row.coverage_percent_h),
    scheduled:
      row.scheduled_percent_h === null || row.scheduled_on === null
        ? null
        : { coverage_percent: formatPercent(row.scheduled_percent_h), effective_on: row.scheduled_on },
  };
}

