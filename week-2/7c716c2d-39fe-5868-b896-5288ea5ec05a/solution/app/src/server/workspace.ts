// The workspace record and the working-calendar settings.
import type { Viewer } from "./access.js";
import { dayUnder, loadCalendar, type CalendarSave, type Holiday, type WorkspaceCalendar } from "./calendar.js";
import { recordFinishedCycles } from "./cycles.js";
import { tx, type Db } from "./db.js";
import { invalid } from "./errors.js";
import { nextDigestAt } from "./digest.js";
import { route } from "./router.js";
import { seatSummary } from "./seats.js";
import { textWithin } from "../shared/text.js";
import { isRealDate, isZone } from "./time.js";

export async function zoneOf(db: Db, workspaceId: string): Promise<string> {
  const { rows } = await db.query<{ time_zone: string }>("SELECT time_zone FROM calendar_saves WHERE workspace_id = $1 ORDER BY seq DESC LIMIT 1", [workspaceId]);
  return (rows[0] as { time_zone: string }).time_zone;
}

function calendarFields(save: CalendarSave): Record<string, unknown> {
  return {
    time_zone: save.time_zone,
    working_weekdays: [...save.working_weekdays].sort((a, b) => a - b),
    holidays: [...save.holidays].sort((a, b) => a.date.localeCompare(b.date)),
    cycle_anchor: save.cycle_anchor,
  };
}

async function workspaceBody(db: Db, viewer: Viewer, cal: WorkspaceCalendar): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ id: string; name: string; slug: string }>("SELECT id, name, slug FROM workspaces WHERE id = $1", [viewer.workspaceId]);
  const ws = rows[0] as { id: string; name: string; slug: string };
  const today = cal.today();
  return {
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    ...calendarFields(cal.current),
    today,
    is_working_day: cal.day(today).counted,
    next_digest_at: cal.instant(await nextDigestAt(db, viewer.workspaceId, cal)),
    seats: null,
  };
}

/** The Workspace object for `viewer`; seat counts are added for the owner only. */
export async function workspaceFor(viewer: Viewer): Promise<Record<string, unknown>> {
  const body = await tx(async (db) => workspaceBody(db, viewer, await loadCalendar(db, viewer.workspaceId)));
  if (viewer.role === "owner") {
    const summary = await seatSummary(viewer.workspaceId);
    body.seats = { limit: summary.limit, active: summary.active, pending: summary.pending };
  }
  return body;
}

route("GET", "/api/workspace", { access: "workspace" }, async (ctx) => ({ status: 200, body: await workspaceFor(ctx.viewer) }));

function parseHolidays(value: unknown): Holiday[] | string {
  if (!Array.isArray(value)) return "Enter a date as YYYY-MM-DD.";
  const holidays: Holiday[] = [];
  for (const item of value as unknown[]) {
    const entry = (item ?? {}) as { date?: unknown; name?: unknown };
    if (!isRealDate(entry.date)) return "Enter a date as YYYY-MM-DD.";
    if (textWithin(entry.name, 61, Number.MAX_SAFE_INTEGER)) return "Holiday names can be up to 60 characters.";
    if (!textWithin(entry.name, 1, 60)) return "Give the holiday a name.";
    if (holidays.some((h) => h.date === entry.date)) return "That date is already a holiday.";
    holidays.push({ date: entry.date, name: entry.name });
  }
  return holidays;
}

route("PUT", "/api/workspace/calendar", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.owner();
  const body = ctx.body;
  const fields: Record<string, string> = {};
  const zone = body.time_zone;
  if (typeof zone !== "string" || !isZone(zone)) fields.time_zone = "Choose a time zone from the list.";
  const weekdays = body.working_weekdays;
  const validWeekdays =
    Array.isArray(weekdays) && weekdays.length > 0 && weekdays.every((d) => Number.isInteger(d) && d >= 1 && d <= 7) && new Set(weekdays).size === weekdays.length;
  if (!validWeekdays) fields.working_weekdays = "Pick at least one working day.";
  const holidays = parseHolidays(body.holidays);
  if (typeof holidays === "string") fields.holidays = holidays;
  const anchor = body.cycle_anchor;
  if (!isRealDate(anchor)) fields.cycle_anchor = "Enter a date as YYYY-MM-DD.";

  await tx(async (db) => {
    await db.query("SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE", [viewer.workspaceId]);
    const cal = await loadCalendar(db, viewer.workspaceId);
    await recordFinishedCycles(db, viewer.workspaceId, cal);
    if (isRealDate(anchor)) {
      const begun = cal.today() >= cal.current.cycle_anchor;
      if (begun && anchor !== cal.current.cycle_anchor) fields.cycle_anchor = "The first cycle start can't change after cycle 1 has begun.";
      else if (!begun && validWeekdays && typeof holidays !== "string" && !dayUnder({ working_weekdays: weekdays as number[], holidays }, anchor).counted) fields.cycle_anchor = "The first cycle must start on a working day.";
    }
    if (Object.keys(fields).length > 0) throw invalid(fields);
    await db.query(
      "INSERT INTO calendar_saves (workspace_id, effective_date, time_zone, working_weekdays, holidays, cycle_anchor) VALUES ($1, $2, $3, $4, $5, $6)",
      [viewer.workspaceId, cal.today(), zone, weekdays, JSON.stringify(holidays), anchor],
    );
  });
  return { status: 200, body: await workspaceFor(viewer) };
});
