import { VENUES, type Venue } from "../../shared/catalog.js";
import { requireCaller } from "../auth.js";
import { endLapsedHolds, venueById } from "../commissions.js";
import { pool, query, type Db } from "../db.js";
import { fail, invalid, ok, type Request, type Router } from "../http.js";
import { BOOKABLE_TO_DAYS, addDays, dayBounds, daysBetween, isBookable, isCalendarDate, isoInZone, localDate } from "../rules/calendar.js";

async function search(req: Request) {
  const q = (req.url.searchParams.get("q") ?? "").trim().toLowerCase();
  const venues = q
    ? VENUES.filter((v) => [v.name, v.address, v.city].some((field) => field.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8)
    : [];
  return ok({ venues });
}

interface TakenDay {
  date: string;
  status: string;
  client_id: string;
}

/** Days held or booked; callers end lapsed holds first, so a held row here is an active hold. */
async function takenDays(db: Db, venue: Venue, from: string, to: string): Promise<TakenDay[]> {
  return query<TakenDay & Record<string, unknown>>(
    `SELECT h.date, h.status, c.client_id FROM holds h JOIN commissions c ON c.id = h.commission_id
     WHERE h.venue_id = $1 AND h.date BETWEEN $2 AND $3 AND h.status IN ('held', 'booked')`,
    [venue.id, from, to], db,
  );
}

/** The up-to-three earliest free bookable dates after `date`. */
export async function nextFreeDays(db: Db, venue: Venue, date: string, now: number): Promise<string[]> {
  const last = addDays(localDate(now, venue.timeZone), BOOKABLE_TO_DAYS);
  const taken = new Set((await takenDays(db, venue, addDays(date, 1), last)).map((d) => d.date));
  const free: string[] = [];
  for (let day = addDays(date, 1); free.length < 3 && daysBetween(day, last) >= 0; day = addDays(day, 1)) {
    if (!taken.has(day) && isBookable(day, venue.timeZone, now)) free.push(day);
  }
  return free;
}

async function days(req: Request) {
  const caller = await requireCaller(req);
  const venue = venueById(req.params.venueId) ?? fail(404, "not_found");
  const from = req.url.searchParams.get("from");
  const to = req.url.searchParams.get("to");
  if (!isCalendarDate(from)) invalid({ from: "Pick a start date as YYYY-MM-DD." });
  if (!isCalendarDate(to)) invalid({ to: "Pick an end date as YYYY-MM-DD." });
  if (daysBetween(from, to) + 1 > 62) invalid({ to: "Ask for at most 62 days." });
  const now = Date.now();
  await endLapsedHolds(pool, now, { venueId: venue.id });
  const taken = new Map((await takenDays(pool, venue, from, to)).map((d) => [d.date, d]));
  const list = [];
  for (let day = from; daysBetween(day, to) >= 0; day = addDays(day, 1)) {
    const hold = taken.get(day);
    const status = hold
      ? hold.status === "booked" ? "booked" : hold.client_id === caller.id ? "yours" : "held"
      : isBookable(day, venue.timeZone, now) ? "free" : "unavailable";
    const bounds = dayBounds(day, venue.timeZone);
    list.push({ date: day, status, startsAt: isoInZone(bounds.startsAt, venue.timeZone), endsAt: isoInZone(bounds.endsAt, venue.timeZone) });
  }
  return ok({ days: list });
}

export function registerVenues(router: Router): void {
  router.add("GET", "/api/venues", search);
  router.add("GET", "/api/venues/:venueId/days", days);
}
