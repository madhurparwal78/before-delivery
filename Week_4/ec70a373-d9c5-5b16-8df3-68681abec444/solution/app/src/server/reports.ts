// The monthly utilisation report and its CSV export, from the same query.
import { pool, rows } from "./db.ts";
import { json, type AuthedCtx, type Reply } from "./router.ts";
import { Fields, validMonth } from "./validate.ts";
import { memberFor } from "./scope.ts";
import { quartersText } from "../shared/format.ts";
import { quartersToHours } from "../shared/rules.ts";
import type { Report, ReportRow } from "../shared/api.ts";

interface SiteFigures {
  site_id: string;
  site_name: string;
  scheduled: number;
  used: number;
  forfeited: number;
  overage_cents: number;
}

/**
 * Per site, for bookings whose site-local start date is in the month: scheduled = confirmed or checked-in
 * hours; used = usage and late check-out movements; forfeited = forfeit movements (never pack expiry);
 * overage = stored overage totals.
 */
async function figures(tenantId: string, month: string, memberId: string | null): Promise<SiteFigures[]> {
  return rows<SiteFigures>(
    pool,
    `WITH month_bookings AS (
       SELECT b.* FROM bookings b
        WHERE b.tenant_id = $1 AND to_char(b.date, 'YYYY-MM') = $2 AND ($3::uuid IS NULL OR b.member_id = $3)
     )
     SELECT s.id AS site_id, s.name AS site_name,
       COALESCE((SELECT SUM(quarters) FROM month_bookings mb WHERE mb.site_id = s.id AND mb.status IN ('confirmed', 'checked_in')), 0) AS scheduled,
       COALESCE((SELECT SUM(m.quarters) FROM movements m JOIN month_bookings mb ON mb.id = m.booking_id
                  WHERE mb.site_id = s.id AND m.kind IN ('usage', 'late_checkout')), 0) AS used,
       COALESCE((SELECT SUM(m.quarters) FROM movements m JOIN month_bookings mb ON mb.id = m.booking_id
                  WHERE mb.site_id = s.id AND m.kind = 'forfeit'), 0) AS forfeited,
       COALESCE((SELECT SUM(overage_total_cents) FROM month_bookings mb WHERE mb.site_id = s.id), 0) AS overage_cents
     FROM sites s WHERE s.tenant_id = $1 ORDER BY s.name`,
    [tenantId, month, memberId],
  );
}

interface Figures {
  month: string;
  member: Report["member"];
  sites: SiteFigures[];
  totals: Omit<SiteFigures, "site_id" | "site_name">;
}

async function report(ctx: AuthedCtx): Promise<Figures> {
  const user = ctx.user;
  const memberParam = ctx.query.get("member_id");
  const member = memberParam === null ? null : await memberFor(pool, user, memberParam);
  const fields = new Fields({ month: ctx.query.get("month") }, ["month"]);
  const month = validMonth(ctx.query.get("month")) ?? fields.fail("month", "Enter a month as YYYY-MM.");
  if (month === undefined) return fields.reject();
  fields.raise();
  const sites = await figures(user.tenantId, month, member?.id ?? null);
  const sum = (pick: (s: SiteFigures) => number): number => sites.reduce((total, s) => total + pick(s), 0);
  return {
    month,
    member: member ? { id: member.id, business_name: member.business_name } : null,
    sites,
    totals: {
      scheduled: sum((s) => s.scheduled),
      used: sum((s) => s.used),
      forfeited: sum((s) => s.forfeited),
      overage_cents: sum((s) => s.overage_cents),
    },
  };
}

function hoursRow(f: Omit<SiteFigures, "site_id" | "site_name">): Omit<ReportRow, "site_id" | "site_name"> {
  return {
    scheduled_hours: quartersToHours(f.scheduled),
    used_hours: quartersToHours(f.used),
    forfeited_hours: quartersToHours(f.forfeited),
    overage_cents: f.overage_cents,
  };
}

// GET /api/reports/utilisation
export async function utilisation(ctx: AuthedCtx): Promise<Reply> {
  const r = await report(ctx);
  const body: Report = {
    month: r.month,
    member: r.member,
    sites: r.sites.map((s) => ({ site_id: s.site_id, site_name: s.site_name, ...hoursRow(s) })),
    totals: hoursRow(r.totals),
  };
  return json(200, body);
}

/** A CSV field, quoted only when it holds a comma, quote or line break. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// GET /api/reports/utilisation.csv
export async function utilisationCsv(ctx: AuthedCtx): Promise<Reply> {
  const r = await report(ctx);
  const line = (name: string, row: Omit<SiteFigures, "site_id" | "site_name">): string =>
    [csvField(name), r.month, quartersText(row.scheduled), quartersText(row.used), quartersText(row.forfeited), String(row.overage_cents)].join(",");
  const csv = [
    "site_name,month,scheduled_hours,used_hours,forfeited_hours,overage_cents",
    ...r.sites.map((s) => line(s.site_name, s)),
    line("TOTAL", r.totals),
  ].join("\n");
  return {
    kind: "bytes",
    status: 200,
    data: `${csv}\n`,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="utilisation-${r.month}.csv"`,
      "Cache-Control": "no-store",
    },
  };
}
