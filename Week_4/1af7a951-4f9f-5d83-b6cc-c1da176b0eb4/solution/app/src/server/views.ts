import type { Category, Cohort, DreamSign, Enrollment, EnrollmentStatus, Entry, Memo, ReceiptStatus, Technique } from "../shared/api.js";
import { cohortPhase, type PhaseAndWeek } from "./domain/cohorts.js";
import { localMoment, nightNumber, wakeAlarm } from "./domain/time.js";

// Rows as Postgres returns them, and the API objects built from them.

export interface CohortRow {
  id: string;
  coach_id: string;
  name: string;
  coach_name: string;
  coach_tz: string;
  starts_on: string;
  price_cents: number;
  seats: number;
  published: boolean;
  closed: boolean;
  active_seats: number;
}

export const COHORT_SELECT = `
  SELECT c.id, c.coach_id, c.name, co.name AS coach_name, co.time_zone AS coach_tz, c.starts_on, c.price_cents,
         c.seats, c.published, c.closed,
         (SELECT count(*)::int FROM enrollments e WHERE e.cohort_id = c.id AND e.status = 'active') AS active_seats
    FROM cohorts c JOIN coaches co ON co.id = c.coach_id`;

export function phaseOf(cohort: { published: boolean; closed: boolean; starts_on: string; coach_tz: string }, now: Date): PhaseAndWeek {
  return cohortPhase(
    { published: cohort.published, closed: cohort.closed, startsOn: cohort.starts_on },
    localMoment(now, cohort.coach_tz).date,
  );
}

export function toCohort(row: CohortRow, now: Date): Cohort {
  const { phase, week } = phaseOf(row, now);
  return {
    id: row.id,
    name: row.name,
    coach_name: row.coach_name,
    starts_on: row.starts_on,
    phase,
    week,
    price_cents: row.price_cents,
    seats: row.seats,
    seats_left: seatsLeft(row),
  };
}

/** Seats left: the cohort's seats minus its active enrolments, the one count every surface and the pay check use. */
export function seatsLeft(row: CohortRow): number {
  return row.seats - row.active_seats;
}

export interface EnrollmentRow {
  id: string;
  cohort_id: string;
  cohort_name: string;
  name: string;
  email: string;
  status: EnrollmentStatus;
  price_cents: number;
  home_tz: string;
  bedtime: string;
  first_night: string | null;
  receipt_status: ReceiptStatus;
  killbill_payment_id: string | null;
}

export const ENROLLMENT_SELECT = `
  SELECT e.id, e.cohort_id, c.name AS cohort_name, e.name, e.email, e.status, c.price_cents, e.home_tz, e.bedtime,
         e.first_night, e.receipt_status, e.killbill_payment_id
    FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id`;

export function toEnrollment(row: EnrollmentRow): Enrollment {
  return {
    id: row.id,
    cohort_id: row.cohort_id,
    cohort_name: row.cohort_name,
    name: row.name,
    email: row.email,
    status: row.status,
    price_cents: row.price_cents,
    home_tz: row.home_tz,
    bedtime: row.bedtime,
    wake_alarm: wakeAlarm(row.bedtime),
    first_night: row.first_night,
    receipt_status: row.receipt_status,
  };
}

interface EntryFields {
  id: string;
  enrollment_id: string;
  night_key: string;
  title: string;
  text: string;
  dreams_recalled: number;
  lucid: boolean;
  wbtb: boolean;
  technique: Technique;
  technique_minutes: number;
  late_recall: boolean;
  shared: boolean;
  created_at: Date;
}

/** The num_nonnulls CHECK stores the four memo columns together or not at all. */
type MemoColumns =
  | { memo_content_type: null; memo_size_bytes: null; memo_duration_ms: null; memo_sha256: null }
  | { memo_content_type: string; memo_size_bytes: number; memo_duration_ms: number; memo_sha256: string };

export type EntryRow = EntryFields & MemoColumns;

export interface SignRow {
  id: string;
  entry_id: string;
  start_offset: number;
  end_offset: number;
  phrase: string;
  category: Category;
  night_key: string;
  enrollment_id: string;
}

export const SIGN_SELECT = `
  SELECT s.id, s.entry_id, s.start_offset, s.end_offset, s.phrase, s.category, n.night_key, n.enrollment_id
    FROM dream_signs s JOIN entries n ON n.id = s.entry_id`;

export function toSign(row: SignRow): DreamSign {
  return {
    id: row.id,
    entry_id: row.entry_id,
    start: row.start_offset,
    end: row.end_offset,
    phrase: row.phrase,
    category: row.category,
    night_key: row.night_key,
  };
}

/** Instants leave the API as UTC with a Z suffix and no fractional seconds. */
function toInstant(instant: Date): string {
  return instant.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function memoOf(row: EntryRow): Memo | null {
  if (row.memo_content_type === null) return null;
  return { content_type: row.memo_content_type, size_bytes: row.memo_size_bytes, duration_ms: row.memo_duration_ms };
}

export function toEntry(row: EntryRow, firstNight: string, signs: readonly SignRow[]): Entry {
  return {
    id: row.id,
    night_key: row.night_key,
    night_number: nightNumber(row.night_key, firstNight),
    title: row.title,
    text: row.text,
    dreams_recalled: row.dreams_recalled,
    lucid: row.lucid,
    wbtb: row.wbtb,
    technique: row.technique,
    technique_minutes: row.technique_minutes,
    late_recall: row.late_recall,
    shared: row.shared,
    created_at: toInstant(row.created_at),
    memo: memoOf(row),
    signs: signs.filter((sign) => sign.entry_id === row.id).sort((a, b) => a.start_offset - b.start_offset).map(toSign),
  };
}

