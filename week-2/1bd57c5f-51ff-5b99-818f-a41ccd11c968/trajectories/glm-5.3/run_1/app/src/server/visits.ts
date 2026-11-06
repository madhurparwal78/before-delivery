/** Site visits: recurrence expansion, per-occurrence checks, overlap and the
 *  code window. Every rule about visits and occurrence times lives here. */

import type { PoolClient } from "pg";
import type { Membership } from "./context.js";
import { Errors } from "./errors.js";
import { addDays, dayDiff, localDateOf, localToUtc, toLocalString, utcIso, weekdayOf, WEEKDAY_ORDER } from "./times.js";
import type { TradeKey } from "../shared/types.js";

export type Recurrence = {
  freq: "daily" | "weekly" | "every_n_days";
  weekdays?: string[];
  interval?: number;
  until?: string | null;
  count?: number | null;
} | null;

export type LocalTime = { date: string; hh: number; mm: number };

export type OccurrenceDraft = {
  date: string;
  startsAtUtc: Date;
  endsAtUtc: Date;
};

export function parseLocalDateTime(raw: unknown): LocalTime | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (m === null) return null;
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  if (hh > 23 || mm > 59) return null;
  if (m[6] !== undefined && Number(m[6]) > 59) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, hh, mm };
}

/** Expands a rule into its occurrence dates, judged by date arithmetic alone so
 *  an oversized rule is refused before anything is stored. */
export function recurrenceDates(start: LocalTime, recurrence: Recurrence): string[] | { error: "recurrence" } {
  if (recurrence === null) return [start.date];
  const freq = recurrence.freq;
  if (freq === "daily") {
    if (recurrence.weekdays !== undefined || recurrence.interval !== undefined) return { error: "recurrence" };
  } else if (freq === "weekly") {
    const weekdays = recurrence.weekdays;
    if (!Array.isArray(weekdays) || weekdays.length === 0) return { error: "recurrence" };
    if (new Set(weekdays).size !== weekdays.length) return { error: "recurrence" };
    for (const wd of weekdays) {
      if (typeof wd !== "string" || !WEEKDAY_ORDER.includes(wd as (typeof WEEKDAY_ORDER)[number])) return { error: "recurrence" };
    }
    if (!weekdays.includes(weekdayOf(start.date))) return { error: "recurrence" };
    if (recurrence.interval !== undefined) return { error: "recurrence" };
  } else if (freq === "every_n_days") {
    if (typeof recurrence.interval !== "number" || !Number.isInteger(recurrence.interval) || recurrence.interval < 2 || recurrence.interval > 30) {
      return { error: "recurrence" };
    }
    if (recurrence.weekdays !== undefined) return { error: "recurrence" };
  } else {
    return { error: "recurrence" };
  }
  const hasUntil = recurrence.until !== undefined && recurrence.until !== null;
  const hasCount = recurrence.count !== undefined && recurrence.count !== null;
  if (hasUntil === hasCount) return { error: "recurrence" };
  if (hasUntil && (typeof recurrence.until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(recurrence.until))) return { error: "recurrence" };
  if (hasCount && (typeof recurrence.count !== "number" || !Number.isInteger(recurrence.count) || recurrence.count < 1 || recurrence.count > 60)) {
    return { error: "recurrence" };
  }

  const dates: string[] = [];
  let cursor = start.date;
  const interval = freq === "every_n_days" ? (recurrence.interval as number) : 1;
  const weekdays = freq === "weekly" ? (recurrence.weekdays as string[]) : null;
  for (let guard = 0; guard < 400; guard++) {
    if (hasUntil && dayDiff(cursor, recurrence.until ?? cursor) > 0) break;
    const include =
      freq === "daily" ||
      (weekdays !== null && weekdays.includes(weekdayOf(cursor))) ||
      (freq === "every_n_days" && dayDiff(start.date, cursor) % interval === 0);
    if (include) dates.push(cursor);
    if (hasCount && dates.length >= (recurrence.count as number)) break;
    cursor = addDays(cursor, freq === "weekly" ? 1 : interval);
  }
  if (dates.length === 0) return { error: "recurrence" };
  if (dates.length > 60) return { error: "recurrence" };
  if (dayDiff(dates[0], dates[dates.length - 1]) > 180) return { error: "recurrence" };
  return dates;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Converts one occurrence with its date's own UTC offset. Null when the local
 *  time does not exist on that date. */
export function occurrenceUtc(date: string, t: LocalTime, tz: string): Date | null {
  const conv = localToUtc(date, t.hh, t.mm, 0, tz);
  return conv.exists ? conv.utc : null;
}

/** Per-occurrence checks in the published order; the first failure names its
 *  field. Working hours are 07:00 to 19:00 job-local, both ends allowed. */
export function occurrenceFieldErrors(start: LocalTime, end: LocalTime): { field: string; message: string } | null {
  const startTotal = Date.UTC(Number(start.date.slice(0, 4)), Number(start.date.slice(5, 7)) - 1, Number(start.date.slice(8, 10)), start.hh, start.mm);
  const endTotal = Date.UTC(Number(end.date.slice(0, 4)), Number(end.date.slice(5, 7)) - 1, Number(end.date.slice(8, 10)), end.hh, end.mm);
  if (endTotal <= startTotal) return { field: "ends_at", message: "End after the start." };
  if (dayDiff(start.date, end.date) > 0) return { field: "ends_at", message: "Visits end on the day they start." };
  if (start.hh * 60 + start.mm < 7 * 60) return { field: "starts_at", message: "Visits start at 07:00 or later." };
  if (end.hh * 60 + end.mm > 19 * 60) return { field: "ends_at", message: "Visits end by 19:00." };
  return null;
}

/** Overlap against every non-cancelled occurrence of the same member. Returns
 *  the earliest job-local start date among the new occurrences that clash. */
export async function overlapDate(
  client: PoolClient,
  jobId: string,
  memberId: string,
  occurrences: { startsAtUtc: Date; endsAtUtc: Date }[],
  excludeVisitId: string | null,
): Promise<string | null> {
  const existing = await client.query<{ starts_at_utc: Date; ends_at_utc: Date }>(
    `SELECT o.starts_at_utc, o.ends_at_utc
     FROM visit_occurrences o JOIN visits v ON v.id = o.visit_id
     WHERE v.job_id = $1 AND v.member_id = $2 AND o.status <> 'cancelled'
       AND ($3::text IS NULL OR v.id <> $3)`,
    [jobId, memberId, excludeVisitId],
  );
  for (const occ of occurrences) {
    for (const row of existing.rows) {
      if (occ.startsAtUtc < row.ends_at_utc && row.starts_at_utc < occ.endsAtUtc) {
        return localDateOf(occ.startsAtUtc, await jobTimeZone(client, jobId));
      }
    }
  }
  return null;
}

async function jobTimeZone(client: PoolClient, jobId: string): Promise<string> {
  const res = await client.query<{ time_zone: string }>(`SELECT time_zone FROM jobs WHERE id = $1`, [jobId]);
  return res.rows[0]?.time_zone ?? "UTC";
}

/** The code window: 30 minutes before an occurrence's UTC start until its UTC
 *  end, the start included and the end excluded, by the server's clock. */
export function codeWindowOpen(startsAtUtc: Date, endsAtUtc: Date, now: Date): boolean {
  return now.getTime() >= startsAtUtc.getTime() - 30 * 60 * 1000 && now.getTime() < endsAtUtc.getTime();
}

async function openWindows(client: PoolClient, jobId: string, memberId: string): Promise<Date[]> {
  const res = await client.query<{ ends_at_utc: Date }>(
    `SELECT o.ends_at_utc FROM visit_occurrences o JOIN visits v ON v.id = o.visit_id
     WHERE v.job_id = $1 AND v.member_id = $2 AND o.status <> 'cancelled'
       AND o.starts_at_utc - interval '30 minutes' <= now() AND o.ends_at_utc > now()`,
    [jobId, memberId],
  );
  return res.rows.map((r) => r.ends_at_utc);
}

/** The caller's open code windows on the job, for a trade. */
export async function openWindowsFor(client: PoolClient, jobId: string, membership: Membership): Promise<Date[]> {
  return openWindows(client, jobId, membership.id);
}

/** Whether the member may read the access card right now. */
export async function accessCodesAvailable(client: PoolClient, jobId: string, membership: Membership): Promise<boolean> {
  if (membership.role === "trade") return (await openWindows(client, jobId, membership.id)).length > 0;
  return membership.role === "owner" || membership.role === "lead";
}

/** The latest UTC end among the caller's open windows, for a trade's card. */
export async function visibleUntilFor(client: PoolClient, jobId: string, membership: Membership): Promise<Date | null> {
  if (membership.role !== "trade") return null;
  const windows = await openWindows(client, jobId, membership.id);
  if (windows.length === 0) return null;
  return windows.reduce((max, w) => (w > max ? w : max), windows[0]!);
}

/** The caller's current or next non-cancelled occurrence, job-local. */
export async function nextVisitFor(client: PoolClient, jobId: string, membership: Membership): Promise<{ starts_at: string; ends_at: string } | null> {
  if (membership.role !== "trade") return null;
  const tz = await jobTimeZone(client, jobId);
  const res = await client.query<{ starts_at_utc: Date; ends_at_utc: Date }>(
    `SELECT o.starts_at_utc, o.ends_at_utc FROM visit_occurrences o JOIN visits v ON v.id = o.visit_id
     WHERE v.job_id = $1 AND v.member_id = $2 AND o.status <> 'cancelled' AND o.ends_at_utc > now()
     ORDER BY o.starts_at_utc LIMIT 1`,
    [jobId, membership.id],
  );
  const row = res.rows[0];
  if (row === undefined) return null;
  return { starts_at: toLocalString(row.starts_at_utc, tz), ends_at: toLocalString(row.ends_at_utc, tz) };
}

export type VisitRow = {
  id: string;
  member_id: string;
  member_name: string;
  starts_at_local: string;
  ends_at_local: string;
  starts_at_utc: Date;
  ends_at_utc: Date;
  recurrence: Recurrence;
  occurrences: { date: string; starts_at_utc: Date; ends_at_utc: Date; status: string }[];
};

export function projectVisit(tz: string, v: VisitRow, now: Date): Record<string, unknown> {
  const occurrences = v.occurrences.map((o) => ({
    date: o.date,
    starts_at: toLocalString(o.starts_at_utc, tz),
    ends_at: toLocalString(o.ends_at_utc, tz),
    starts_at_utc: utcIso(o.starts_at_utc),
    ends_at_utc: utcIso(o.ends_at_utc),
    status: o.status,
    active: o.status !== "cancelled" && codeWindowOpen(o.starts_at_utc, o.ends_at_utc, now),
  }));
  return {
    id: v.id,
    member_id: v.member_id,
    member_name: v.member_name,
    starts_at: v.starts_at_local,
    ends_at: v.ends_at_local,
    starts_at_utc: utcIso(v.starts_at_utc),
    ends_at_utc: utcIso(v.ends_at_utc),
    recurrence: v.recurrence === null
      ? null
      : {
        freq: v.recurrence.freq,
        weekdays: v.recurrence.weekdays,
        interval: v.recurrence.interval,
        until: v.recurrence.until ?? undefined,
        count: v.recurrence.count ?? undefined,
      },
    occurrences,
    active: occurrences.some((o) => o.active),
  };
}

export async function loadVisits(client: PoolClient, jobId: string, memberFilter: string | null): Promise<VisitRow[]> {
  const res = await client.query(
    `SELECT v.id, v.member_id, p.name AS member_name, v.starts_at_local, v.ends_at_local,
            v.starts_at_utc, v.ends_at_utc, v.recurrence
     FROM visits v JOIN job_members m ON m.id = v.member_id JOIN people p ON p.id = m.person_id
     WHERE v.job_id = $1 AND ($2::text IS NULL OR v.member_id = $2)
     ORDER BY v.created_at, v.id`,
    [jobId, memberFilter],
  );
  const out: VisitRow[] = [];
  for (const row of res.rows as VisitRow[]) {
    const occ = await client.query<{ date: string; starts_at_utc: Date; ends_at_utc: Date; status: string }>(
      `SELECT date, starts_at_utc, ends_at_utc, status FROM visit_occurrences WHERE visit_id = $1 ORDER BY date`,
      [row.id],
    );
    out.push({ ...row, occurrences: occ.rows });
  }
  return out;
}

export async function visitById(client: PoolClient, jobId: string, visitId: string): Promise<VisitRow | null> {
  const res = await client.query(
    `SELECT v.id, v.member_id, p.name AS member_name, v.starts_at_local, v.ends_at_local,
            v.starts_at_utc, v.ends_at_utc, v.recurrence
     FROM visits v JOIN job_members m ON m.id = v.member_id JOIN people p ON p.id = m.person_id
     WHERE v.job_id = $1 AND v.id = $2`,
    [jobId, visitId],
  );
  const row = (res.rows as VisitRow[])[0];
  if (row === undefined) return null;
  const occ = await client.query<{ date: string; starts_at_utc: Date; ends_at_utc: Date; status: string }>(
    `SELECT date, starts_at_utc, ends_at_utc, status FROM visit_occurrences WHERE visit_id = $1 ORDER BY date`,
    [visitId],
  );
  return { ...row, occurrences: occ.rows };
}

/** Tomorrow's non-cancelled occurrences, expanded at the cut-off, in start order
 *  then trade order. */
export async function tomorrowOccurrences(
  client: PoolClient,
  jobId: string,
  tz: string,
  tomorrowDate: string,
): Promise<{ trade: TradeKey | null; starts: string; ends: string }[]> {
  const res = await client.query<{ starts_at_utc: Date; ends_at_utc: Date; trade: TradeKey | null }>(
    `SELECT o.starts_at_utc, o.ends_at_utc, m.trade
     FROM visit_occurrences o JOIN visits v ON v.id = o.visit_id
     JOIN job_members m ON m.id = v.member_id
     WHERE v.job_id = $1 AND o.status <> 'cancelled'
     ORDER BY o.starts_at_utc, m.trade`,
    [jobId],
  );
  const out: { trade: TradeKey | null; starts: string; ends: string }[] = [];
  for (const row of res.rows) {
    if (localDateOf(row.starts_at_utc, tz) === tomorrowDate) {
      out.push({ trade: row.trade, starts: toLocalString(row.starts_at_utc, tz), ends: toLocalString(row.ends_at_utc, tz) });
    }
  }
  return out;
}

export function recurrenceValidationError(): { field: string; message: string } {
  return { field: "recurrence", message: "Pick a repeat that gives 60 occurrences or fewer within 180 days." };
}

export function localDateTimeString(t: LocalTime): string {
  return `${t.date}T${pad(t.hh)}:${pad(t.mm)}`;
}

