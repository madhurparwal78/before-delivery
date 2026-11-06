import { randomUUID } from 'node:crypto';
import { db, type Queryable } from '../db.js';
import { ApiError, fail } from '../errors.js';
import { emitVisit, emitVisitDeleted, jobWrite } from '../events.js';
import {
  body,
  requireAccount,
  route,
  sendEmpty,
  sendJson,
  type Ctx,
  type Route,
} from '../http.js';
import { requireJob, requireOpenJob, requireRole, requireUuid } from '../jobctx.js';
import {
  dateTextOf,
  expandRecurrenceDates,
  readRecurrence,
  serialiseRecurrence,
  type Recurrence,
} from '../core/recurrence.js';
import {
  dayNumber,
  formatLocalDate,
  formatLocalDateTime,
  localToUtc,
  parseLocalDate,
  parseLocalDateTime,
  secondsOfDay,
  type LocalDateTime,
} from '../core/timezone.js';
import type { JobContext } from '../jobctx.js';
import type { JobRecord, MemberRecord } from '../model.js';
import {
  expandVisit,
  loadVisits,
  projectVisit,
  type Occurrence,
  type VisitRecord,
} from '../visits.js';

const DAY_START_SECONDS = 7 * 3600;
const DAY_END_SECONDS = 19 * 3600;

type Interval = { startsLocal: LocalDateTime; endsLocal: LocalDateTime };

/** The one per-occurrence check, in the published order. */
function checkOccurrence(
  job: JobRecord,
  interval: Interval,
  isFirst: boolean,
  now: Date,
): { field: 'starts_at' | 'ends_at'; message: string } | null {
  const startsUtc = localToUtc(job.timeZone, interval.startsLocal);
  const endsUtc = localToUtc(job.timeZone, interval.endsLocal);
  if (startsUtc === null) {
    return { field: 'starts_at', message: 'That local time does not exist on that date.' };
  }
  if (endsUtc === null) {
    return { field: 'ends_at', message: 'That local time does not exist on that date.' };
  }
  if (endsUtc.getTime() <= startsUtc.getTime()) {
    return { field: 'ends_at', message: 'The visit must end after it starts.' };
  }
  if (dayNumber(interval.endsLocal) > dayNumber(interval.startsLocal)) {
    return { field: 'ends_at', message: 'A visit ends on the day it starts.' };
  }
  if (secondsOfDay(interval.startsLocal) < DAY_START_SECONDS) {
    return { field: 'starts_at', message: 'Site visits start at 07:00 or later.' };
  }
  if (secondsOfDay(interval.endsLocal) > DAY_END_SECONDS) {
    return { field: 'ends_at', message: 'Site visits end by 19:00.' };
  }
  if (isFirst && endsUtc.getTime() <= now.getTime()) {
    return { field: 'ends_at', message: 'Schedule a visit that ends in the future.' };
  }
  return null;
}

function shift(time: LocalDateTime, date: { year: number; month: number; day: number }): LocalDateTime {
  return { ...date, hour: time.hour, minute: time.minute, second: time.second };
}

function intervalsFor(
  starts: LocalDateTime,
  ends: LocalDateTime,
  rule: Recurrence | null,
): { date: string; interval: Interval }[] {
  const expansion = expandRecurrenceDates(starts, rule);
  if ('problem' in expansion) return [];
  return expansion.days.map((day) => {
    const date = parseLocalDate(dateTextOf(day))!;
    return {
      date: dateTextOf(day),
      interval: { startsLocal: shift(starts, date), endsLocal: shift(ends, date) },
    };
  });
}

async function otherOccurrences(
  tx: Queryable,
  job: JobRecord,
  memberId: string,
  exclude: { visitId: string; date?: string } | null,
): Promise<Occurrence[]> {
  const visits = await loadVisits(tx, job.id);
  const out: Occurrence[] = [];
  for (const visit of visits) {
    if (visit.memberId !== memberId) continue;
    for (const occurrence of expandVisit(job, visit)) {
      if (occurrence.status === 'cancelled') continue;
      if (
        exclude !== null &&
        visit.id === exclude.visitId &&
        (exclude.date === undefined || occurrence.date === exclude.date)
      ) {
        continue;
      }
      out.push(occurrence);
    }
  }
  return out;
}

function firstClash(
  job: JobRecord,
  candidates: { date: string; interval: Interval }[],
  existing: Occurrence[],
): string | null {
  const clashes: string[] = [];
  for (const candidate of candidates) {
    const startsUtc = localToUtc(job.timeZone, candidate.interval.startsLocal);
    const endsUtc = localToUtc(job.timeZone, candidate.interval.endsLocal);
    if (startsUtc === null || endsUtc === null) continue;
    for (const other of existing) {
      if (
        startsUtc.getTime() < other.endsUtc.getTime() &&
        other.startsUtc.getTime() < endsUtc.getTime()
      ) {
        clashes.push(candidate.date);
        break;
      }
    }
  }
  clashes.sort();
  return clashes.length === 0 ? null : clashes[0];
}

async function sendVisit(
  ctx: Ctx,
  jobCtx: JobContext,
  visitId: string,
  status: number,
): Promise<void> {
  const visits = await loadVisits(db, jobCtx.job.id, visitId);
  const visit = visits[0];
  const member = jobCtx.members.find((candidate) => candidate.id === visit.memberId);
  sendJson(
    ctx.res,
    status,
    projectVisit(
      visit,
      expandVisit(jobCtx.job, visit),
      member?.name ?? '',
      jobCtx.job,
      new Date(),
    ),
  );
}

async function requireVisit(
  jobCtx: JobContext,
  visitId: string,
): Promise<{ visit: VisitRecord; member: MemberRecord }> {
  requireUuid(visitId);
  const visits = await loadVisits(db, jobCtx.job.id, visitId);
  if (visits.length === 0) fail('not_found');
  const member = jobCtx.members.find((candidate) => candidate.id === visits[0].memberId);
  if (member === undefined) fail('not_found');
  return { visit: visits[0], member };
}

export const visitRoutes: Route[] = [
  route('GET', '/api/jobs/:jobId/visits', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    if (jobCtx.viewer.role === 'homeowner') fail('forbidden');
    const visits = await loadVisits(db, jobCtx.job.id);
    const now = new Date();
    const mine =
      jobCtx.viewer.role === 'trade'
        ? visits.filter((visit) => visit.memberId === jobCtx.viewer.memberId)
        : visits;
    sendJson(ctx.res, 200, {
      visits: mine.map((visit) => {
        const member = jobCtx.members.find((candidate) => candidate.id === visit.memberId);
        return projectVisit(
          visit,
          expandVisit(jobCtx.job, visit),
          member?.name ?? '',
          jobCtx.job,
          now,
        );
      }),
    });
  }),

  route('POST', '/api/jobs/:jobId/visits', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner', 'lead']);
    requireOpenJob(jobCtx);
    const raw = body(ctx);
    const fields: Record<string, string> = {};

    const memberIdRaw = raw.member_id;
    if (typeof memberIdRaw !== 'string') fail('not_found');
    requireUuid(memberIdRaw);
    const member = jobCtx.members.find((candidate) => candidate.id === memberIdRaw);
    if (member === undefined) fail('not_found');
    if (member.role !== 'trade') fields.member_id = 'Site visits are for trade subcontractors.';

    const starts = parseLocalDateTime(raw.starts_at);
    const ends = parseLocalDateTime(raw.ends_at);
    if (starts === null) fields.starts_at = 'Give a job-local start as YYYY-MM-DDTHH:MM.';
    if (ends === null) fields.ends_at = 'Give a job-local end as YYYY-MM-DDTHH:MM.';

    let rule: Recurrence | null = null;
    let ruleValid = true;
    if (raw.recurrence !== undefined && raw.recurrence !== null) {
      ruleValid = false;
      if (starts !== null) {
        rule = readRecurrence(raw.recurrence, starts);
        if (rule === null) {
          fields.recurrence = 'Check the repeat rule, its end and its size.';
        } else if ('problem' in expandRecurrenceDates(starts, rule)) {
          rule = null;
          fields.recurrence = 'Keep a series to 60 occurrences within 180 days.';
        } else {
          ruleValid = true;
        }
      }
    }

    const now = new Date();
    let candidates: { date: string; interval: Interval }[] = [];
    if (starts !== null && ends !== null) {
      const startsUtc = localToUtc(jobCtx.job.timeZone, starts);
      const endsUtc = localToUtc(jobCtx.job.timeZone, ends);
      const readable = startsUtc !== null && endsUtc !== null;
      const ordered = readable && endsUtc!.getTime() > startsUtc!.getTime();
      candidates =
        ruleValid && ordered
          ? intervalsFor(starts, ends, rule)
          : readable
            ? [{ date: formatLocalDate(starts), interval: { startsLocal: starts, endsLocal: ends } }]
            : [];
    }

    const existing = await otherOccurrences(db, jobCtx.job, member.id, null);
    const clash = firstClash(jobCtx.job, candidates, existing);
    if (clash !== null) fail('visit_overlap', { occurrence_date: clash });

    for (let index = 0; index < candidates.length; index++) {
      const problem = checkOccurrence(jobCtx.job, candidates[index].interval, index === 0, now);
      if (problem !== null && fields[problem.field] === undefined) {
        fields[problem.field] = problem.message;
      }
    }
    if (candidates.length === 0 && starts !== null && ends !== null) {
      fields.ends_at = fields.ends_at ?? 'The visit must end after it starts.';
    }
    if (Object.keys(fields).length > 0) throw new ApiError('validation', { fields });

    const visitId = randomUUID();
    await jobWrite(jobCtx.job.id, async (tx) => {
      await tx.query(
        `insert into visits (id, job_id, member_id, starts_local, ends_local, recurrence, created_at)
         values ($1, $2, $3, $4, $5, $6, now())`,
        [
          visitId,
          jobCtx.job.id,
          member.id,
          formatLocalDateTime(starts!),
          formatLocalDateTime(ends!),
          rule === null ? null : JSON.stringify(serialiseRecurrence(rule)),
        ],
      );
      await emitVisit(tx, jobCtx.job.id, visitId, member.personId);
    });
    await sendVisit(ctx, jobCtx, visitId, 201);
  }),

  route('PUT', '/api/jobs/:jobId/visits/:visitId/occurrences/:date', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner', 'lead']);
    requireOpenJob(jobCtx);
    const { visit, member } = await requireVisit(jobCtx, ctx.params.visitId);
    const occurrences = expandVisit(jobCtx.job, visit);
    const target = occurrences.find((candidate) => candidate.date === ctx.params.date);
    if (target === undefined || target.status === 'cancelled') fail('not_found');
    const now = new Date();
    if (target.endsUtc.getTime() <= now.getTime()) fail('invalid_transition');

    const raw = body(ctx);
    const fields: Record<string, string> = {};
    const starts = parseLocalDateTime(raw.starts_at);
    const ends = parseLocalDateTime(raw.ends_at);
    if (starts === null) fields.starts_at = 'Give a job-local start as YYYY-MM-DDTHH:MM.';
    if (ends === null) fields.ends_at = 'Give a job-local end as YYYY-MM-DDTHH:MM.';

    if (starts !== null && ends !== null) {
      const existing = await otherOccurrences(db, jobCtx.job, member.id, {
        visitId: visit.id,
        date: target.date,
      });
      const clash = firstClash(
        jobCtx.job,
        [{ date: target.date, interval: { startsLocal: starts, endsLocal: ends } }],
        existing,
      );
      if (clash !== null) fail('visit_overlap', { occurrence_date: clash });
      const problem = checkOccurrence(
        jobCtx.job,
        { startsLocal: starts, endsLocal: ends },
        true,
        now,
      );
      if (problem !== null) fields[problem.field] = problem.message;
    }
    if (Object.keys(fields).length > 0) throw new ApiError('validation', { fields });

    await jobWrite(jobCtx.job.id, async (tx) => {
      await tx.query(
        `insert into visit_exceptions (visit_id, occurrence_date, status, starts_local, ends_local)
         values ($1, $2, 'moved', $3, $4)
         on conflict (visit_id, occurrence_date) do update
            set status = 'moved', starts_local = excluded.starts_local, ends_local = excluded.ends_local`,
        [visit.id, target.date, formatLocalDateTime(starts!), formatLocalDateTime(ends!)],
      );
      await emitVisit(tx, jobCtx.job.id, visit.id, member.personId);
    });
    await sendVisit(ctx, jobCtx, visit.id, 200);
  }),

  route('DELETE', '/api/jobs/:jobId/visits/:visitId/occurrences/:date', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner', 'lead']);
    requireOpenJob(jobCtx);
    const { visit, member } = await requireVisit(jobCtx, ctx.params.visitId);
    const target = expandVisit(jobCtx.job, visit).find(
      (candidate) => candidate.date === ctx.params.date,
    );
    if (target === undefined || target.status === 'cancelled') fail('not_found');
    if (target.endsUtc.getTime() <= Date.now()) fail('invalid_transition');

    await jobWrite(jobCtx.job.id, async (tx) => {
      await tx.query(
        `insert into visit_exceptions (visit_id, occurrence_date, status, starts_local, ends_local)
         values ($1, $2, 'cancelled', null, null)
         on conflict (visit_id, occurrence_date) do update
            set status = 'cancelled', starts_local = null, ends_local = null`,
        [visit.id, target.date],
      );
      await emitVisit(tx, jobCtx.job.id, visit.id, member.personId);
    });
    await sendVisit(ctx, jobCtx, visit.id, 200);
  }),

  route('DELETE', '/api/jobs/:jobId/visits/:visitId', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner', 'lead']);
    requireOpenJob(jobCtx);
    const { visit, member } = await requireVisit(jobCtx, ctx.params.visitId);
    await jobWrite(jobCtx.job.id, async (tx) => {
      await tx.query(`delete from visits where id = $1`, [visit.id]);
      await emitVisitDeleted(tx, jobCtx.job.id, visit.id, member.personId);
    });
    sendEmpty(ctx.res, 204);
  }),
];
