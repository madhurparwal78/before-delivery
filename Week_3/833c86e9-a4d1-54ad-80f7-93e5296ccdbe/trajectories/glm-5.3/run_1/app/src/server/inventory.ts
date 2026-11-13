import type { Db } from "./db.js";
import { checkStay, arrivalCheck, type NightInventory, type Reason } from "../domain/restrictions.js";
import { eachNight, nightsBetween } from "../domain/dates.js";
import { clock } from "./clock.js";
import { priceNight, type Plan, type PriceLine } from "../domain/pricing.js";
import { convertTotal, splitAcrossNights, DECIMALS, type CurrencyCode, type RatesPpm } from "../domain/money.js";

export interface PropertyRow {
  id: number;
  code: string;
  name: string;
  destination: string;
  zone: string;
  x: number;
  y: number;
  stars: number;
  amenities: string[];
  vat_pct: number;
  city_minor: number;
  levy_pct: number;
  breakfast_minor: number;
  single_pct: number;
  policy: { days_before: number; hour: number; refund_pct: number }[];
  cx: number;
  cy: number;
}

export interface RoomTypeRow {
  id: number;
  code: string;
  property_id: number;
  name: string;
  included_adults: number;
  max_adults: number;
  max_guests: number;
  extra_adult_minor: number;
  child_minor: number;
  base_rate_minor: number;
  rooms: number;
}

export async function getProperty(db: Db, code: string): Promise<PropertyRow | null> {
  const r = await db.query(
    `SELECT p.id, p.code, p.name, p.destination, d.zone, p.x, p.y, p.stars, p.amenities,
            p.vat_pct, p.city_minor, p.levy_pct, p.breakfast_minor, p.single_pct, p.policy,
            d.cx, d.cy
     FROM properties p JOIN destinations d ON d.code = p.destination
     WHERE p.code = $1`,
    [code]
  );
  return r.rows[0] ?? null;
}

export async function getRoomTypes(db: Db, propertyId: number): Promise<RoomTypeRow[]> {
  const r = await db.query("SELECT * FROM room_types WHERE property_id = $1 ORDER BY code", [propertyId]);
  return r.rows;
}

export type Occupancy = { kind: "hold" | "booked"; room_type_id: number; date: string; count: number };

function clockNowIso(): string {
  return clock.now().toISOString();
}

export async function occupancyFor(db: Db, propertyId: number, fromIso: string, toIso: string, excludeHold?: string, excludeBooking?: number): Promise<Map<number, Map<string, number>>> {
  const map = new Map<number, Map<string, number>>();
  const add = (rtid: number, date: string, n: number) => {
    let byDate = map.get(rtid);
    if (!byDate) { byDate = new Map(); map.set(rtid, byDate); }
    byDate.set(date, (byDate.get(date) ?? 0) + n);
  };
  // Live holds: one row per room of each hold, joined to its room type.
  const held = await db.query(
    `SELECT room, rt.id AS rtid
     FROM holds h,
     LATERAL jsonb_array_elements(h.rooms) AS room
     JOIN room_types rt ON rt.code = room->>'room_type'
     WHERE h.property_id = $1 AND h.expires_at > $2 AND ($3::text IS NULL OR h.id <> $3)`,
    [propertyId, clockNowIso(), excludeHold ?? null]
  );
  for (const row of held.rows) {
    for (const date of row.room.nights as string[]) add(row.rtid, date, 1);
  }
  // Booked rooms that still occupy inventory.
  const booked = await db.query(
    `SELECT room, rt.id AS rtid
     FROM bookings b,
     LATERAL jsonb_array_elements(b.rooms) AS room
     JOIN room_types rt ON rt.code = room->>'room_type'
     WHERE b.property_id = $1
       AND b.state IN ('confirmed','changed','no_show')
       AND b.out_date >= $2 AND b.in_date <= $3
       AND ($4::bigint IS NULL OR b.id <> $4)`,
    [propertyId, fromIso, toIso, excludeBooking ?? null]
  );
  for (const row of booked.rows) {
    for (const date of row.room.nights as string[]) add(row.rtid, date, 1);
  }
  return map;
}

/** Rooms left per room type per night within a date window. */
export async function inventoryFor(db: Db, propertyId: number, roomTypes: RoomTypeRow[], nights: string[], opts: { excludeHold?: string; excludeBooking?: number } = {}): Promise<Map<string, Map<string, NightInventory>>> {
  const occ = await occupancyFor(db, propertyId, nights[0], addOne(nights[nights.length - 1]), opts.excludeHold, opts.excludeBooking);
  const rows = await db.query(
    `SELECT n.* FROM nights n WHERE n.property_id = $1 AND n.date >= $2 AND n.date <= $3`,
    [propertyId, nights[0], nights[nights.length - 1]]
  );
  const byRt = new Map<number, Map<string, NightInventory>>();
  for (const row of rows.rows) {
    let m = byRt.get(Number(row.room_type_id));
    if (!m) { m = new Map(); byRt.set(Number(row.room_type_id), m); }
    const date = typeof row.date === "string" ? row.date.slice(0, 10) : new Date(row.date).toISOString().slice(0, 10);
    m.set(date, {
      date,
      rate_minor: row.rate_minor,
      allotment: row.allotment,
      left: Math.max(0, row.allotment - (occ.get(Number(row.room_type_id))?.get(date) ?? 0)),
      min_stay: row.min_stay,
      max_stay: row.max_stay,
      closed_to_arrival: row.closed_to_arrival,
      closed_to_departure: row.closed_to_departure,
      stop_sell: row.stop_sell,
      release_days: row.release_days
    });
  }
  const out = new Map<string, Map<string, NightInventory>>();
  for (const rt of roomTypes) out.set(rt.code, byRt.get(rt.id) ?? new Map());
  return out;
}

function addOne(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export type RoomPlacement = { room_type: string; adults: number; ages: number[] };

export type PriceRoomOpts = {
  property: PropertyRow;
  roomType: RoomTypeRow;
  plan: Plan;
  breakfast: boolean;
  adults: number;
  ages: number[];
  nights: string[];
  rates: Map<string, NightInventory>;
  today: string;
  tier_pct: number;
};

/** Price one room over all nights. */
export function priceRoom(o: PriceRoomOpts): { room_type: string; plan: Plan; breakfast: boolean; adults: number; ages: number[]; nights: { date: string; lines: PriceLine[]; total_minor: number; taxable_minor: number }[]; total_minor: number; amount_minor: number } {
  const daysAhead = daysBetweenDates(o.today, o.nights[0]);
  const nights = o.nights.map((date) => {
    const inv = o.rates.get(date)!;
    const priced = priceNight({
      room_type: o.roomType.code,
      base_rate_minor: inv.rate_minor,
      plan: o.plan,
      breakfast: o.breakfast,
      adults: o.adults,
      ages: o.ages,
      tax: {
        vat_pct: o.property.vat_pct,
        city_minor: o.property.city_minor,
        levy_pct: o.property.levy_pct,
        breakfast_minor: o.property.breakfast_minor,
        single_pct: o.property.single_pct
      },
      roomType: {
        included_adults: o.roomType.included_adults,
        max_adults: o.roomType.max_adults,
        max_guests: o.roomType.max_guests,
        extra_adult_minor: o.roomType.extra_adult_minor,
        child_minor: o.roomType.child_minor
      },
      nights: o.nights.length,
      days_ahead: daysAhead,
      tier_pct: o.tier_pct
    });
    return { date, lines: priced.lines, total_minor: priced.total_minor, taxable_minor: priced.taxable_minor };
  });
  const total = nights.reduce((s, n) => s + n.total_minor, 0);
  const amount = nights.reduce((s, n) => s + roomAmount(n.lines), 0);
  return { room_type: o.roomType.code, plan: o.plan, breakfast: o.breakfast, adults: o.adults, ages: o.ages, nights, total_minor: total, amount_minor: amount };
}

function roomAmount(lines: PriceLine[]): number {
  let x = 0;
  for (const l of lines) {
    if (l.key === "breakfast") continue;
    if (l.key === "vat" || l.key === "city_tax" || l.key === "tourism_levy" || l.key === "night_total") continue;
    x += l.minor;
  }
  return x;
}

function daysBetweenDates(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

export { checkStay, arrivalCheck };
export type { Reason, NightInventory };
export { convertTotal, splitAcrossNights, DECIMALS };
export type { CurrencyCode, RatesPpm };
export { nightsBetween };
