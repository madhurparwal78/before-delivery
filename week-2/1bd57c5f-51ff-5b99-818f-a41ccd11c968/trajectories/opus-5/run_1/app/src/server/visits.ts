import type { OccurrenceStatus } from '../shared/domain.js';
import {
  dateTextOf,
  expandRecurrenceDates,
  type Recurrence,
} from './core/recurrence.js';
import {
  dayNumber,
  formatLocalDateTime,
  type LocalDateTime,
  localToUtc,
  parseLocalDate,
  parseLocalDateTime,
} from './core/timezone.js';
import type { Queryable } from './db.js';
import type { JobRecord } from './model.js';

export const CODE_WINDOW_LEAD_MS = 30 * 60 * 1000;

export type VisitRecord = {
  id: string;
  jobId: string;
  memberId: string;
  startsLocal: string;
  endsLocal: string;
  recurrence: Recurrence | null;
  exceptions: Map<string, { status: 'moved' | 'cancelled'; startsLocal: string | null; endsLocal: string | null }>;
};

export type OccurrenceView = {
  date: string;
  starts_at: string;
  ends_at: string;
  starts_at_utc: string;
  ends_at_utc: string;
  status: OccurrenceStatus;
  active: boolean;
};

export type VisitView = {
  id: string;
  member_id: string;
  member_name: string;
  starts_at: string;
  ends_at: string;
  starts_at_utc: string;
  ends_at_utc: string;
  recurrence: Recurrence | null;
  occurrences: OccurrenceView[];
  active: boolean;
};

export type Occurrence = {
  visitId: string;
  memberId: string;
  date: string;
  startsLocal: LocalDateTime;
  endsLocal: LocalDateTime;
  startsUtc: Date;
  endsUtc: Date;
  status: OccurrenceStatus;
};

export async function loadVisits(
  tx: Queryable,
  jobId: string,
  visitId?: string,
): Promise<VisitRecord[]> {
  const filter = visitId === undefined ? '' : 'and id = $2';
  const values: unknown[] = visitId === undefined ? [jobId] : [jobId, visitId];
  const { rows } = await tx.query(
    `select id, job_id, member_id, starts_local, ends_local, recurrence, created_at
       from visits where job_id = $1 ${filter} order by starts_local, created_at`,
    values,
  );
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id as string);
  const exceptions = await tx.query(
    `select visit_id, occurrence_date, status, starts_local, ends_local
       from visit_exceptions where visit_id = any($1::uuid[])`,
    [ids],
  );
  const byVisit = new Map<string, VisitRecord['exceptions']>();
  for (const id of ids) byVisit.set(id, new Map());
  for (const row of exceptions.rows) {
    byVisit.get(row.visit_id as string)!.set(row.occurrence_date as string, {
      status: row.status as 'moved' | 'cancelled',
      startsLocal: (row.starts_local as string | null) ?? null,
      endsLocal: (row.ends_local as string | null) ?? null,
    });
  }
  return rows.map((row) => ({
    id: row.id as string,
    jobId: row.job_id as string,
    memberId: row.member_id as string,
    startsLocal: row.starts_local as string,
    endsLocal: row.ends_local as string,
    recurrence: (row.recurrence as Recurrence | null) ?? null,
    exceptions: byVisit.get(row.id as string)!,
  }));
}

function shiftToDate(time: LocalDateTime, date: { year: number; month: number; day: number }): LocalDateTime {
  return { ...date, hour: time.hour, minute: time.minute, second: time.second };
}

/** Every occurrence of a series, with each date's own UTC offset. */
export function expandVisit(job: JobRecord, visit: VisitRecord): Occurrence[] {
  const start = parseLocalDateTime(visit.startsLocal)!;
  const end = parseLocalDateTime(visit.endsLocal)!;
  const expansion = expandRecurrenceDates(start, visit.recurrence);
  if ('problem' in expansion) return [];
  const out: Occurrence[] = [];
  for (const day of expansion.days) {
    const date = dateTextOf(day);
    const exception = visit.exceptions.get(date);
    let startsLocal = shiftToDate(start, parseLocalDate(date)!);
    let endsLocal = shiftToDate(end, parseLocalDate(date)!);
    let status: OccurrenceStatus = 'scheduled';
    if (exception?.status === 'cancelled') {
      status = 'cancelled';
    } else if (exception?.status === 'moved') {
      status = 'moved';
      startsLocal = parseLocalDateTime(exception.startsLocal!)!;
      endsLocal = parseLocalDateTime(exception.endsLocal!)!;
    }
    const startsUtc = localToUtc(job.timeZone, startsLocal);
    const endsUtc = localToUtc(job.timeZone, endsLocal);
    if (startsUtc === null || endsUtc === null) continue;
    out.push({
      visitId: visit.id,
      memberId: visit.memberId,
      date,
      startsLocal,
      endsLocal,
      startsUtc,
      endsUtc,
      status,
    });
  }
  return out;
}

export function windowOpen(occurrence: Occurrence, now: Date): boolean {
  if (occurrence.status === 'cancelled') return false;
  return (
    now.getTime() >= occurrence.startsUtc.getTime() - CODE_WINDOW_LEAD_MS &&
    now.getTime() < occurrence.endsUtc.getTime()
  );
}

export function projectVisit(
  visit: VisitRecord,
  occurrences: Occurrence[],
  memberName: string,
  job: JobRecord,
  now: Date,
): VisitView {
  const firstStart = localToUtc(job.timeZone, parseLocalDateTime(visit.startsLocal)!);
  const firstEnd = localToUtc(job.timeZone, parseLocalDateTime(visit.endsLocal)!);
  const views: OccurrenceView[] = occurrences.map((occurrence) => ({
    date: occurrence.date,
    starts_at: formatLocalDateTime(occurrence.startsLocal),
    ends_at: formatLocalDateTime(occurrence.endsLocal),
    starts_at_utc: occurrence.startsUtc.toISOString(),
    ends_at_utc: occurrence.endsUtc.toISOString(),
    status: occurrence.status,
    active: windowOpen(occurrence, now),
  }));
  return {
    id: visit.id,
    member_id: visit.memberId,
    member_name: memberName,
    starts_at: formatLocalDateTime(parseLocalDateTime(visit.startsLocal)!),
    ends_at: formatLocalDateTime(parseLocalDateTime(visit.endsLocal)!),
    starts_at_utc: (firstStart ?? new Date(0)).toISOString(),
    ends_at_utc: (firstEnd ?? new Date(0)).toISOString(),
    recurrence: visit.recurrence,
    occurrences: views,
    active: views.some((view) => view.active),
  };
}

export async function allOccurrences(
  tx: Queryable,
  job: JobRecord,
): Promise<{ visit: VisitRecord; occurrences: Occurrence[] }[]> {
  const visits = await loadVisits(tx, job.id);
  return visits.map((visit) => ({ visit, occurrences: expandVisit(job, visit) }));
}

export function occurrencesOfMember(
  all: { visit: VisitRecord; occurrences: Occurrence[] }[],
  memberId: string,
): Occurrence[] {
  return all
    .filter((entry) => entry.visit.memberId === memberId)
    .flatMap((entry) => entry.occurrences);
}

/** For a trade, the latest UTC end among their open code windows. */
export function codeWindow(
  occurrences: Occurrence[],
  now: Date,
): { open: boolean; visibleUntil: Date | null } {
  let latest: Date | null = null;
  for (const occurrence of occurrences) {
    if (!windowOpen(occurrence, now)) continue;
    if (latest === null || occurrence.endsUtc.getTime() > latest.getTime()) {
      latest = occurrence.endsUtc;
    }
  }
  return { open: latest !== null, visibleUntil: latest };
}

export function currentOrNextOccurrence(occurrences: Occurrence[], now: Date): Occurrence | null {
  const candidates = occurrences
    .filter((occurrence) => occurrence.status !== 'cancelled')
    .filter((occurrence) => occurrence.endsUtc.getTime() > now.getTime())
    .sort((a, b) => a.startsUtc.getTime() - b.startsUtc.getTime());
  return candidates.length === 0 ? null : candidates[0];
}

export function occurrenceDayNumber(occurrence: Occurrence): number {
  return dayNumber(occurrence.startsLocal);
}
