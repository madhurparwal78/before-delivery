import { OPEN_RIDE_STATES } from "../domain/rideStates";
import { isoBrussels } from "../../shared/time";
import type { SearchRide } from "../../shared/api";
import { segmentPriceCents } from "../../shared/money";
import { freeSeats } from "../../shared/seats";
import type { City } from "../../shared/towns";
import { brusselsInstant, dateKey, parseDateKey, addDays } from "../../shared/time";
import { now } from "../clock";
import type { Db } from "../db";
import { bookingClosesAt } from "../domain/deadlines";
import { segmentKm } from "../domain/route";
import { loadRide, publicMember, seatMapOf, type RideRecord } from "./views";

export type SortKey = "earliest" | "price" | "shortest";

interface SearchQuery {
  from: City;
  to: City;
  date: string;
  seats: number;
  instantOnly: boolean;
  verifiedOnly: boolean;
  sort: SortKey;
}

interface Candidate {
  ride: RideRecord;
  fromIndex: number;
  toIndex: number;
  seatsLeft: number;
  priceCents: number;
  boarding: Date;
  alighting: Date;
}

async function candidates(db: Db, query: SearchQuery): Promise<Candidate[]> {
  const day = parseDateKey(query.date);
  if (!day) return [];
  const start = brusselsInstant(day.year, day.month, day.day, 0, 0);
  const next = addDays(day, 1);
  const end = brusselsInstant(next.year, next.month, next.day, 0, 0);
  const { rows } = await db.query<{ id: string }>(
    `SELECT r.id FROM rides r JOIN members m ON m.id = r.driver_id
      WHERE r.state = ANY($5) AND r.departure >= $1 AND r.departure < $2
        AND ($3 = false OR r.booking_mode = 'instant') AND ($4 = false OR m.id_state = 'verified')`,
    [new Date(start.getTime() - 12 * 3_600_000), end, query.instantOnly, query.verifiedOnly, OPEN_RIDE_STATES],
  );
  const at = now();
  const found: Candidate[] = [];
  for (const { id } of rows) {
    const ride = await loadRide(db, id);
    if (!ride) continue;
    const fromIndex = ride.route.cities.indexOf(query.from);
    const toIndex = ride.route.cities.indexOf(query.to);
    if (fromIndex < 0 || toIndex <= fromIndex) continue;
    const boarding = ride.route.times[fromIndex] as Date;
    if (dateKey(boarding) !== query.date) continue;
    if (at.getTime() >= bookingClosesAt(ride.row.booking_mode, boarding).getTime()) continue;
    const seatsLeft = freeSeats(await seatMapOf(db, ride, at), fromIndex, toIndex).length;
    if (seatsLeft < query.seats) continue;
    const km = segmentKm(ride.route, fromIndex, toIndex);
    found.push({
      ride, fromIndex, toIndex, seatsLeft, boarding,
      alighting: ride.route.times[toIndex] as Date,
      priceCents: segmentPriceCents(ride.row.price_cents, km, ride.route.routeKm),
    });
  }
  return found;
}

const byId = (a: Candidate, b: Candidate): number => a.ride.row.id.localeCompare(b.ride.row.id);
const byBoarding = (a: Candidate, b: Candidate): number => a.boarding.getTime() - b.boarding.getTime() || byId(a, b);

const ORDER: Record<SortKey, (a: Candidate, b: Candidate) => number> = {
  earliest: byBoarding,
  price: (a, b) => a.priceCents - b.priceCents || byBoarding(a, b),
  shortest: (a, b) =>
    a.alighting.getTime() - a.boarding.getTime() - (b.alighting.getTime() - b.boarding.getTime()) || byBoarding(a, b),
};

export async function searchRides(db: Db, query: SearchQuery): Promise<SearchRide[]> {
  const sorted = (await candidates(db, query)).sort(ORDER[query.sort]);
  const results: SearchRide[] = [];
  for (const c of sorted) {
    results.push({
      id: c.ride.row.id,
      driver: await publicMember(db, c.ride.row.driver_id),
      from: query.from,
      to: query.to,
      boarding_time: isoBrussels(c.boarding),
      alighting_time: isoBrussels(c.alighting),
      segment_km: segmentKm(c.ride.route, c.fromIndex, c.toIndex),
      segment_price_cents: c.priceCents,
      seats_left: c.seatsLeft,
      booking_mode: c.ride.row.booking_mode,
      version: c.ride.row.version,
    });
  }
  return results;
}
