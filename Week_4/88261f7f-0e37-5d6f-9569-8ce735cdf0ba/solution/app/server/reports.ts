import type { CloseResult, Report, ReportFigures } from "../shared/api";
import { addDays, daysBetween, isIsoDate, nightsBetween, type IsoDate } from "../shared/dates";
import { database, inserted, rows, type Queryable, type Row } from "./db";
import { fail, ok, type Reply } from "./http";
import { figuresFor } from "./rules/figures";

const MAX_REPORT_NIGHTS = 366;

interface NightCounts extends Row { night: IsoDate; sold: number; revenue: number }

/** Rooms available, rooms sold and room revenue for each night: the one function every figure comes from. */
export async function nightFigures(from: Queryable, hotelId: string, dates: readonly IsoDate[]): Promise<{ date: IsoDate; figures: ReportFigures }[]> {
  if (dates.length === 0) return [];
  const counts = await rows<NightCounts>(
    from,
    `SELECT n.night, count(*)::int AS sold, COALESCE(sum(n.room_cents), 0)::int AS revenue
     FROM stay_nights n JOIN stays s ON s.id = n.stay_id
     WHERE s.hotel_id = $1 AND n.night = ANY($2::date[]) AND n.holds AND s.status NOT IN ('cancelled', 'no_show')
     GROUP BY n.night`,
    [hotelId, dates],
  );
  const closed = await rows<Row & { business_date: IsoDate; result: CloseResult }>(
    from, "SELECT business_date, result FROM closed_days WHERE hotel_id = $1 AND business_date = ANY($2::date[])", [hotelId, dates]);
  const open = await inserted<Row & { available: number }>(
    from, "SELECT count(*)::int AS available FROM rooms WHERE hotel_id = $1 AND status <> 'out_of_order'", [hotelId]);
  return dates.map((date) => {
    const found = counts.find((count) => count.night === date);
    const frozen = closed.find((day) => day.business_date === date);
    const available = frozen ? frozen.result.figures.roomsAvailable : open.available;
    return { date, figures: figuresFor(available, found?.sold ?? 0, found?.revenue ?? 0) };
  });
}

export function rangeErrors(from: unknown, to: unknown, limit: number): Record<string, string> {
  const message = "Enter a valid date range.";
  if (!isIsoDate(from)) return { from: message };
  if (!isIsoDate(to) || to < from || daysBetween(from, to) + 1 > limit) return { to: message };
  return {};
}

export async function reportView(hotelId: string, query: URLSearchParams): Promise<Reply> {
  const from = query.get("from");
  const to = query.get("to");
  const errors = rangeErrors(from, to, MAX_REPORT_NIGHTS);
  if (Object.keys(errors).length > 0 || !from || !to) throw fail.invalid(errors);
  const nights = await nightFigures(database(), hotelId, nightsBetween(from, addDays(to, 1)));
  const totals = nights.reduce(
    (sum, { figures }) => ({ available: sum.available + figures.roomsAvailable, sold: sum.sold + figures.roomsSold, revenue: sum.revenue + figures.roomRevenueCents }),
    { available: 0, sold: 0, revenue: 0 },
  );
  const report: Report = {
    from, to, ...figuresFor(totals.available, totals.sold, totals.revenue),
    nights: nights.map(({ date, figures }) => ({ date, ...figures })),
  };
  return ok(report);
}

