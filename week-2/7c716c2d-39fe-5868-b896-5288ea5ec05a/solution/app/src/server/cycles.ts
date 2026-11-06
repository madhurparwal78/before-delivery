// Cycles as the API reports them: which cycle an issue reports, the fixed records of finished
// cycles, and the per-viewer burndown.
import type { Viewer } from "./access.js";
import { loadCalendar, CYCLE_LENGTH, type Day, type WorkspaceCalendar } from "./calendar.js";
import { tx, type Db } from "./db.js";
import { ApiError } from "./errors.js";
import { route } from "./router.js";
import { visibleIssueRows, type IssueRow } from "./issues.js";
import { addDays } from "./time.js";

interface CycleRecord {
  starts_at: string;
  ends_at: string;
  first_working_date: string;
  last_working_date: string;
  days: Day[];
  midnights: number[];
  members: { id: string; closed_at: number | null }[];
}

/** The cycle an issue reports: where it was closed, else its plan rolled forward past finished cycles. */
export function reportedCycle(cal: WorkspaceCalendar, issue: Pick<IssueRow, "planned_cycle" | "closed_at">): number | null {
  if (issue.planned_cycle === null) return null;
  if (issue.closed_at !== null) return cal.cycleAt(issue.closed_at);
  const current = cal.currentNumber();
  return issue.planned_cycle < current ? current : issue.planned_cycle;
}

/** Writes the fixed record of every finished cycle that has none yet. */
export async function recordFinishedCycles(db: Db, workspaceId: string, cal: WorkspaceCalendar): Promise<void> {
  const current = cal.currentNumber();
  const { rows } = await db.query<{ number: number }>("SELECT number FROM cycle_records WHERE workspace_id = $1", [workspaceId]);
  const recorded = new Set(rows.map((r) => r.number));
  for (let number = 1; number < current; number++) {
    if (recorded.has(number)) continue;
    const span = cal.cycle(number);
    const { rows: members } = await db.query<{ id: string; closed_at: number | null }>(
      `SELECT id, CASE WHEN closed_at < $3 THEN closed_at END AS closed_at FROM issues
       WHERE workspace_id = $1 AND planned_cycle IS NOT NULL
         AND ((closed_at < $3 AND (closed_at >= $2 OR $4 = 1)) OR (planned_cycle <= $4 AND (closed_at IS NULL OR closed_at >= $3)))
       ORDER BY key`,
      [workspaceId, span.startsMs, span.endsMs, number],
    );
    const record: CycleRecord = {
      starts_at: span.starts_at,
      ends_at: span.ends_at,
      first_working_date: span.first_working_date,
      last_working_date: span.last_working_date,
      days: span.days,
      midnights: span.days.map((d) => cal.midnight(addDays(d.date, 1))),
      members,
    };
    await db.query("INSERT INTO cycle_records (workspace_id, number, record) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [workspaceId, number, JSON.stringify(record)]);
  }
}

async function finishedRecord(db: Db, workspaceId: string, number: number): Promise<CycleRecord> {
  const { rows } = await db.query<{ record: CycleRecord }>("SELECT record FROM cycle_records WHERE workspace_id = $1 AND number = $2", [workspaceId, number]);
  return (rows[0] as { record: CycleRecord }).record;
}

/** Member issues of cycle `number` visible to the viewer, in the Issues list order. */
export async function cycleIssues(db: Db, viewer: Viewer, cal: WorkspaceCalendar, number: number): Promise<IssueRow[]> {
  const visible = await visibleIssueRows(db, viewer);
  if (cal.isFinished(number)) {
    await recordFinishedCycles(db, viewer.workspaceId, cal);
    const members = new Set((await finishedRecord(db, viewer.workspaceId, number)).members.map((m) => m.id));
    return visible.filter((issue) => members.has(issue.id));
  }
  return visible.filter((issue) => reportedCycle(cal, issue) === number);
}

/** A finished cycle's keys keep the order of its record, whatever the issues' statuses are now. */
function keysInRecordOrder(record: CycleRecord, issues: IssueRow[]): string[] {
  const keys = new Map(issues.map((issue) => [issue.id, issue.key]));
  return record.members.flatMap((member) => keys.get(member.id) ?? []);
}

async function cycleBody(db: Db, viewer: Viewer, cal: WorkspaceCalendar, number: number): Promise<Record<string, unknown>> {
  const issues = await cycleIssues(db, viewer, cal, number);
  const finished = cal.isFinished(number);
  let shape: Omit<CycleRecord, "members">;
  let closedAt: (issue: IssueRow) => number | null;
  if (finished) {
    const record = await finishedRecord(db, viewer.workspaceId, number);
    shape = record;
    const closed = new Map(record.members.map((m) => [m.id, m.closed_at]));
    closedAt = (issue) => closed.get(issue.id) ?? null;
  } else {
    const span = cal.cycle(number);
    shape = { ...span, midnights: span.days.map((d) => cal.midnight(addDays(d.date, 1))) };
    closedAt = (issue) => issue.closed_at;
  }
  const today = cal.today();
  const burndown = shape.days
    .map((day, i) => ({ day, endOfDay: shape.midnights[i] as number }))
    .filter(({ day }) => day.counted && (finished || day.date <= today))
    .map(({ day, endOfDay }) => ({
      date: day.date,
      open: issues.filter((issue) => {
        const closed = closedAt(issue);
        return closed === null || closed >= endOfDay;
      }).length,
    }));
  return {
    number,
    starts_at: shape.starts_at,
    ends_at: shape.ends_at,
    first_working_date: shape.first_working_date,
    last_working_date: shape.last_working_date,
    calendar_days: shape.days.length,
    working_day_count: CYCLE_LENGTH,
    days: shape.days,
    burndown,
    issue_keys: finished ? keysInRecordOrder(await finishedRecord(db, viewer.workspaceId, number), issues) : issues.map((issue) => issue.key),
    is_current: number === cal.currentNumber(),
    is_finished: finished,
  };
}

route("GET", "/api/cycles/current", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return {
    status: 200,
    body: await tx(async (db) => {
      const cal = await loadCalendar(db, viewer.workspaceId);
      return cycleBody(db, viewer, cal, cal.currentNumber());
    }),
  };
});

route("GET", "/api/cycles/:number", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  const raw = ctx.params.number ?? "";
  if (!/^[1-9]\d{0,3}$/.test(raw) || Number(raw) > 1000) throw new ApiError("not_found");
  return {
    status: 200,
    body: await tx(async (db) => cycleBody(db, viewer, await loadCalendar(db, viewer.workspaceId), Number(raw))),
  };
});
