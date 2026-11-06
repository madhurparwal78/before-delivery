import type { LocalVisitTimes, Recurrence, Trade, Visit } from "../shared/domain";
import { rows, type Db } from "./db";
import { fail } from "./errors";
import {
  addDays,
  checkRecurrence,
  codeWindowOpen,
  daysBetween,
  expandOccurrences,
  formatUtc,
  intervalsOverlap,
  localToUtc,
  parseLocal,
  type Occurrence,
} from "./schedule";

// Site visit series as stored, expanded into occurrences in the job's time zone. The code
// window, a trade's next visit, the visits table and the daily summary all read the
// occurrences from here.

interface VisitException {
  date: string;
  status: "moved" | "cancelled";
  starts_local: string | null;
  ends_local: string | null;
}

interface SeriesRow {
  id: string;
  member_id: string;
  member_name: string;
  member_trade: Trade | null;
  starts_local: string;
  ends_local: string;
  recurrence: Recurrence | null;
  dates: string[];
  exceptions: VisitException[];
}

/** Visit series on a job in start order, optionally only one member's. */
export function loadSeries(db: Db, jobId: string, memberId: string | null = null): Promise<SeriesRow[]> {
  return rows<SeriesRow>(
    db,
    `SELECT v.id, v.member_id, p.name AS member_name, m.trade AS member_trade, v.starts_local, v.ends_local, v.recurrence, v.dates,
            COALESCE((SELECT json_agg(json_build_object('date', e.date, 'status', e.status, 'starts_local', e.starts_local,
                                                       'ends_local', e.ends_local))
                      FROM visit_exceptions e WHERE e.visit_id = v.id), '[]'::json) AS exceptions
     FROM visit_series v
     JOIN job_members m ON m.id = v.member_id
     JOIN people p ON p.id = m.person_id
     WHERE v.job_id = $1 AND ($2::uuid IS NULL OR v.member_id = $2)
     ORDER BY v.starts_local, v.position`,
    [jobId, memberId],
  );
}

export function occurrencesOf(series: SeriesRow, zone: string): Occurrence[] {
  return expandOccurrences(
    {
      startsLocal: series.starts_local,
      endsLocal: series.ends_local,
      dates: series.dates,
    },
    series.exceptions.map((exception) => ({
      date: exception.date,
      status: exception.status,
      startsLocal: exception.starts_local,
      endsLocal: exception.ends_local,
    })),
    zone,
  );
}

/** A non-cancelled occurrence with real instants: the ones that count for overlap, codes and summaries. */
interface LiveOccurrence extends Occurrence {
  startsUtc: Date;
  endsUtc: Date;
}

export function liveOccurrences(series: readonly SeriesRow[], zone: string): (LiveOccurrence & { series: SeriesRow })[] {
  return series.flatMap((one) =>
    occurrencesOf(one, zone)
      .filter((occurrence): occurrence is LiveOccurrence =>
        occurrence.status !== "cancelled" && occurrence.startsUtc !== null && occurrence.endsUtc !== null)
      .map((occurrence) => ({ ...occurrence, series: one })),
  );
}

/** The latest end among a trade's open code windows, or null when none is open. */
export function codesVisibleUntil(series: readonly SeriesRow[], zone: string, now: Date): Date | null {
  const open = liveOccurrences(series, zone).filter((occurrence) => codeWindowOpen(occurrence, now));
  if (open.length === 0) return null;
  return new Date(Math.max(...open.map((occurrence) => occurrence.endsUtc.getTime())));
}

/** The caller's current or next non-cancelled occurrence, in job-local time. */
export function nextVisit(series: readonly SeriesRow[], zone: string, now: Date): LocalVisitTimes | null {
  const upcoming = liveOccurrences(series, zone)
    .filter((occurrence) => occurrence.endsUtc.getTime() > now.getTime())
    .sort((a, b) => a.startsUtc.getTime() - b.startsUtc.getTime())[0];
  return upcoming ? { starts_at: upcoming.startsLocal, ends_at: upcoming.endsLocal } : null;
}

function utcText(value: Date | null): string {
  return value === null ? "" : formatUtc(value);
}

export function projectVisit(series: SeriesRow, zone: string, now: Date): Visit {
  const occurrences = occurrencesOf(series, zone).map((occurrence) => ({
    date: occurrence.date,
    starts_at: occurrence.startsLocal,
    ends_at: occurrence.endsLocal,
    starts_at_utc: utcText(occurrence.startsUtc),
    ends_at_utc: utcText(occurrence.endsUtc),
    status: occurrence.status,
    active:
      occurrence.status !== "cancelled" &&
      occurrence.startsUtc !== null &&
      occurrence.endsUtc !== null &&
      codeWindowOpen({ startsUtc: occurrence.startsUtc, endsUtc: occurrence.endsUtc }, now),
  }));
  const [first] = expandOccurrences({ startsLocal: series.starts_local, endsLocal: series.ends_local, dates: [series.dates[0]!] }, [], zone);
  return {
    id: series.id,
    member_id: series.member_id,
    member_name: series.member_name,
    starts_at: series.starts_local,
    ends_at: series.ends_local,
    starts_at_utc: utcText(first?.startsUtc ?? null),
    ends_at_utc: utcText(first?.endsUtc ?? null),
    recurrence: series.recurrence,
    occurrences,
    active: occurrences.some((occurrence) => occurrence.active),
  };
}

// ---------- Booking checks ----------

const FIRST_START = "07:00:00";
const LAST_END = "19:00:00";

interface Candidate {
  date: string;
  start: Date;
  end: Date;
}

interface OccurrencePlan {
  startsLocal: string;
  endsLocal: string;
  rule: Recurrence | null;
  dates: string[];
  /** The occurrences the overlap check judges: every one when the times and rule read, else only the first. */
  candidates: Candidate[];
  errors: Record<string, string>;
}

/**
 * Reads a booking's times and rule in the job's time zone and runs the per-occurrence checks:
 * readable times ending after they start, one job-local date, 07:00 to 19:00, a time that
 * exists on each date, and a first occurrence that ends in the future. Every failing field
 * is reported, each with the first failing check's message.
 */
export function planOccurrences(zone: string, rawStarts: unknown, rawEnds: unknown, rawRule: unknown, now = new Date()): OccurrencePlan {
  const starts = parseLocal(rawStarts);
  const ends = parseLocal(rawEnds);
  const errors: Record<string, string> = {};
  const report = (field: string, message: string) => {
    errors[field] ??= message;
  };
  if (!starts) report("starts_at", "Enter the start as a date and time.");
  if (!ends) report("ends_at", "Enter the end as a date and time.");
  const startsLocal = starts ? `${starts.date}T${starts.time}` : "";
  const endsLocal = ends ? `${ends.date}T${ends.time}` : "";
  const readable = starts !== null && ends !== null && endsLocal > startsLocal;
  if (starts && ends && !readable) report("ends_at", "The visit must end after it starts.");
  const rule = starts ? checkRecurrence(rawRule, starts.date) : null;
  if (rule && !rule.ok) report("recurrence", rule.message);
  const dates = rule?.ok ? rule.dates : starts ? [starts.date] : [];
  const candidates: Candidate[] = [];
  if (readable) {
    const spanDays = daysBetween(starts.date, ends.date);
    if (spanDays > 0) report("ends_at", "A visit starts and ends on the same day.");
    if (starts.time < FIRST_START) report("starts_at", "Visits start at 07:00 or later.");
    if (ends.time > LAST_END) report("ends_at", "Visits end by 19:00.");
    for (const date of rule?.ok ? dates : [starts.date]) {
      const start = localToUtc(date, starts.time, zone);
      const end = localToUtc(addDays(date, spanDays), ends.time, zone);
      if (!start) report("starts_at", `That start time doesn't exist on ${date}; the clocks change then.`);
      if (!end) report("ends_at", `That end time doesn't exist on ${date}; the clocks change then.`);
      if (start && end) candidates.push({ date, start, end });
    }
    const first = candidates[0];
    if (first && first.date === starts.date && first.end.getTime() <= now.getTime()) report("ends_at", "The visit must end in the future.");
  }
  return { startsLocal, endsLocal, rule: rule?.ok ? rule.rule : null, dates, candidates, errors };
}

/** Refuses a booking whose occurrences overlap the person's other non-cancelled occurrences on the job. */
export async function refuseOverlap(
  db: Db,
  jobId: string,
  zone: string,
  memberId: string,
  candidates: readonly Candidate[],
  except: { visitId: string; date: string } | null,
): Promise<void> {
  const existing = liveOccurrences(await loadSeries(db, jobId, memberId), zone).filter(
    (occurrence) => !(except && occurrence.series.id === except.visitId && occurrence.date === except.date),
  );
  const clash = candidates.find((candidate) =>
    existing.some((occurrence) => intervalsOverlap(candidate, { start: occurrence.startsUtc, end: occurrence.endsUtc })),
  );
  if (clash) fail("visit_overlap", { occurrence_date: clash.date });
}
