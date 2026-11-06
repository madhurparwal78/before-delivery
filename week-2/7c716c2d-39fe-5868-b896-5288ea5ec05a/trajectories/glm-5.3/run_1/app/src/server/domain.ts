import type { Client } from "./db.ts";
import type { Ctx, VisibleScope } from "./scope.ts";
import { visibleScope } from "./scope.ts";
import { calendarEffectiveOn, dayInfo, isCounted, nextCountedDay, nextCountedOnOrAfter, type CalendarState } from "./calendar.ts";
import { addDays, parseDate } from "./text.ts";
import { instantInZone, localMidnightInstant } from "./tz.ts";
import { nowMs } from "./clock.ts";
import { ApiError } from "./errors.ts";

export interface AttachmentJson {
  id: string;
  filename: string;
  size: number;
  content_type: string;
  parent: { type: "issue" | "message" | "doc"; id: string };
}

export interface IssueJson {
  key: string;
  project_id: string;
  title: string;
  description: string;
  status: string;
  assignee_id: string | null;
  parent_key: string | null;
  sub_issue_keys: string[];
  cycle_number: number | null;
  due_date: string | null;
  closed_at: string | null;
  attachments: AttachmentJson[];
}

export interface CycleJson {
  number: number;
  starts_at: string;
  ends_at: string;
  first_working_date: string;
  last_working_date: string;
  calendar_days: number;
  working_day_count: number;
  days: { date: string; counted: boolean; reason: string | null; clock_change: "forward" | "back" | null }[];
  burndown: { date: string; open: number }[];
  issue_keys: string[];
  is_current: boolean;
  is_finished: boolean;
}

const STATUS_ORDER = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"];

export function statusRank(status: string): number {
  const i = STATUS_ORDER.indexOf(status);
  return i < 0 ? 99 : i;
}

export const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  cancelled: "Cancelled",
};

/** The only legal status moves. */
export const STATUS_EDGES: Record<string, string[]> = {
  backlog: ["todo", "cancelled"],
  todo: ["backlog", "in_progress", "cancelled"],
  in_progress: ["todo", "in_review", "cancelled"],
  in_review: ["in_progress", "done", "cancelled"],
  done: ["in_progress"],
  cancelled: ["backlog"],
};

export interface IssueRow {
  id: string;
  project_id: string;
  project_key: string;
  number: number;
  title: string;
  description: string;
  status: string;
  assignee_id: string | null;
  parent_id: string | null;
  parent_number: number | null;
  cycle_number: number | null;
  due_date: string | null;
  closed_at: string | null;
}

function keyOf(row: { project_key: string; number: number }): string {
  return `${row.project_key}-${row.number}`;
}

export async function projectIssuesVisible(
  ctx: Ctx,
  scope: VisibleScope
): Promise<IssueRow[]> {
  const ids = [...scope.projectIds];
  if (ids.length === 0) return [];
  const res = await ctx.client.query<IssueRow>(
    `SELECT i.id, i.project_id, p.key AS project_key, i.number, i.title, i.description,
            i.status, i.assignee_id, i.parent_id, pi.number AS parent_number, i.cycle_number,
            i.due_date, i.closed_at
     FROM issues i JOIN projects p ON p.id = i.project_id
     LEFT JOIN issues pi ON pi.id = i.parent_id
     WHERE i.project_id = ANY($1::uuid[])`,
    [ids]
  );
  return res.rows;
}

async function attachmentsFor(ctx: Ctx, parentType: "issue" | "message" | "doc", parentIds: string[]): Promise<Map<string, AttachmentJson[]>> {
  const map = new Map<string, AttachmentJson[]>();
  if (parentIds.length === 0) return map;
  const res = await ctx.client.query<{ id: string; parent_id: string; filename: string; size: string; content_type: string }>(
    "SELECT id, parent_id, filename, size, content_type FROM attachments WHERE parent_type = $1 AND parent_id = ANY($2::text[]) ORDER BY created_at, id",
    [parentType, parentIds]
  );
  for (const row of res.rows) {
    const list = map.get(row.parent_id) ?? [];
    list.push({
      id: row.id,
      filename: row.filename,
      size: Number(row.size),
      content_type: row.content_type,
      parent: { type: parentType, id: row.parent_id },
    });
    map.set(row.parent_id, list);
  }
  return map;
}

export async function issueJson(ctx: Ctx, row: IssueRow): Promise<IssueJson> {
  const subs = await ctx.client.query<{ project_key: string; number: number }>(
    `SELECT p.key AS project_key, s.number FROM issues s JOIN projects p ON p.id = s.project_id
     WHERE s.parent_id = $1 ORDER BY s.number`,
    [row.id]
  );
  const atts = await attachmentsFor(ctx, "issue", [row.id]);
  return {
    key: keyOf(row),
    project_id: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    assignee_id: row.assignee_id,
    parent_key: row.parent_id && row.parent_number ? `${row.project_key}-${row.parent_number}` : null,
    sub_issue_keys: subs.rows.map((s) => `${s.project_key}-${s.number}`),
    cycle_number: row.cycle_number,
    due_date: row.due_date,
    closed_at: row.closed_at ? instantInZone(zoneOf(ctx), Date.parse(row.closed_at)) : null,
    attachments: atts.get(row.id) ?? [],
  };
}

export function zoneOf(ctx: Ctx): string {
  return ctx.zone;
}

// The cycle computation uses the calendar states; ctx carries them for the request.
export interface CycleCtx {
  states: CalendarState[];
}

export function issueKeyRowSort(a: IssueRow, b: IssueRow): number {
  return a.project_key < b.project_key ? -1 : a.project_key > b.project_key ? 1 : a.number - b.number;
}

/** The Issues list order: status group, then project key A-Z, then number ascending. */
export function issuesListOrder(rows: IssueRow[]): IssueRow[] {
  return [...rows].sort((a, b) => {
    const s = statusRank(a.status) - statusRank(b.status);
    if (s !== 0) return s;
    return issueKeyRowSort(a, b);
  });
}

export async function issueByKey(ctx: Ctx, key: string): Promise<IssueRow | null> {
  const m = /^(.+)-(\d+)$/.exec(key);
  if (!m) return null;
  const res = await ctx.client.query<IssueRow>(
    `SELECT i.id, i.project_id, p.key AS project_key, i.number, i.title, i.description,
            i.status, i.assignee_id, i.parent_id, pi.number AS parent_number, i.cycle_number,
            i.due_date, i.closed_at
     FROM issues i JOIN projects p ON p.id = i.project_id
     LEFT JOIN issues pi ON pi.id = i.parent_id
     WHERE p.key = $1 AND i.number = $2`,
    [m[1], Number(m[2])]
  );
  return res.rows[0] ?? null;
}

export async function issueByKeyVisible(ctx: Ctx, scope: VisibleScope, key: string): Promise<IssueRow | null> {
  const row = await issueByKey(ctx, key);
  if (!row) return null;
  if (!scope.projectIds.has(row.project_id)) return null;
  return row;
}

/** Effective cycle number, applying rollover and attribution. */
export function effectiveCycle(row: IssueRow, currentCycle: number, nowMs: number, cycleByNumber: Map<number, { startsAtMs: number; endsAtMs: number }>): number | null {
  if (row.cycle_number === null) return null;
  if (row.status === "done" || row.status === "cancelled") {
    if (!row.closed_at) return row.cycle_number;
    const closedMs = Date.parse(row.closed_at);
    // The cycle whose span contains the closed instant.
    for (const [num, span] of cycleByNumber) {
      if (closedMs >= span.startsAtMs && closedMs < span.endsAtMs) return num;
    }
    return row.cycle_number;
  }
  // Open issue in a finished cycle reports the current cycle.
  const span = cycleByNumber.get(row.cycle_number);
  if (span && nowMs >= span.endsAtMs) return currentCycle;
  return row.cycle_number;
}

export interface CycleComputation {
  number: number;
  countedDates: string[];
  nextFirst: string;
  startsAtMs: number;
  endsAtMs: number;
  days: { date: string; counted: boolean; reason: string | null; clock_change: "forward" | "back" | null }[];
}

/** Compute a cycle's span and day list from the calendar states. */
export function computeCycle(states: CalendarState[], number: number, anchor: string): CycleComputation {
  let first = nextCountedOnOrAfter(states[0], anchor);
  for (let n = 1; n < number; n++) {
    const span = singleCycleSpan(states, first);
    first = span.nextFirst;
  }
  const span = singleCycleSpan(states, first);
  const days: CycleComputation["days"] = [];
  let d = span.countedDates[0];
  while (d < span.nextFirst) {
    const cal = calendarEffectiveOn(states, d);
    const info = dayInfo(cal, d);
    days.push(info);
    d = addDays(d, 1);
  }
  const startsAtMs = localMidnightInstant(calendarEffectiveOn(states, span.countedDates[0]).time_zone, span.countedDates[0]);
  const endsAtMs = localMidnightInstant(calendarEffectiveOn(states, span.nextFirst).time_zone, span.nextFirst);
  return {
    number,
    countedDates: span.countedDates,
    nextFirst: span.nextFirst,
    startsAtMs,
    endsAtMs,
    days,
  };
}

function singleCycleSpan(states: CalendarState[], firstCounted: string): { countedDates: string[]; nextFirst: string } {
  const countedDates: string[] = [];
  let d = firstCounted;
  for (let i = 0; i < 10; i++) {
    const cal = calendarEffectiveOn(states, d);
    if (!isCounted(cal, d)) d = nextCountedDay(cal, d);
    countedDates.push(d);
    if (i < 9) d = addDays(d, 1);
  }
  const calAfter = calendarEffectiveOn(states, addDays(countedDates[9], 1));
  return { countedDates, nextFirst: nextCountedDay(calAfter, countedDates[9]) };
}

export function parseDateOrThrow(value: unknown, field: string): string {
  const parsed = parseDate(value);
  if (!parsed) {
    const message = "Enter a date as YYYY-MM-DD.";
    throw new ApiError("validation", message, { [field]: message });
  }
  return parsed;
}
