// The dispatcher's weekly coverage: every seeded language with its uncovered minutes and assignments.
import { DateTime } from "luxon";
import { AGENCY_ZONE, toAgencyIso } from "../shared/time.js";
import { requireRole } from "./auth.js";
import { pool } from "./db.js";
import { ApiError, type Reply, type SignedInContext, route } from "./http.js";
import { endOf, loadAssignments } from "./records.js";
import { uncoveredMinutes } from "./rules.js";
import { seatInitials } from "./views.js";

async function coverage(ctx: SignedInContext): Promise<Reply> {
  requireRole(ctx, "dispatcher");
  const week = ctx.query.get("week") ?? "";
  const monday = /^\d{4}-\d{2}-\d{2}$/.test(week) ? DateTime.fromISO(week, { zone: AGENCY_ZONE }) : null;
  if (!monday?.isValid || monday.weekday !== 1) {
    throw new ApiError("validation", { week: "Give the week as the date of its Monday (YYYY-MM-DD)." });
  }
  const next = monday.plus({ weeks: 1 });
  const languages = await pool.query<{ code: string; name: string }>("SELECT code, name FROM languages ORDER BY position");
  const records = await loadAssignments("a.start_at >= $1 AND a.start_at < $2 AND a.status <> 'cancelled'", [
    monday.toJSDate(),
    next.toJSDate(),
  ]);
  return {
    status: 200,
    json: {
      week_start: monday.toISODate(),
      languages: languages.rows.map((language) => {
        const own = records.filter((r) => r.languageCode === language.code);
        return {
          code: language.code,
          name: language.name,
          uncovered_minutes: uncoveredMinutes(own),
          assignments: own.map((r) => ({
            number: r.number,
            status: r.status,
            org_code: r.orgCode,
            setting: r.setting,
            start_at: toAgencyIso(DateTime.fromJSDate(r.startAt)),
            end_at: toAgencyIso(DateTime.fromJSDate(endOf(r))),
            duration_minutes: r.durationMinutes,
            seats: r.seats.map((s) => ({ seat: s.seat, status: s.status, interpreter_initials: seatInitials(s) })),
          })),
        };
      }),
    },
  };
}

export function registerCoverageRoutes(): void {
  route("GET", "/api/coverage", coverage);
}
