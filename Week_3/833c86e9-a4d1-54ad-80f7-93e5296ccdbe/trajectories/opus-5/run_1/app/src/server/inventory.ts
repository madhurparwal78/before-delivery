import { query } from './db';
import { Amenity } from '../shared/types';
import { datesBetween } from './zone';

export interface PropertyRow {
  code: string;
  name: string;
  destination: string;
  x: number;
  y: number;
  stars: number;
  amenities: Amenity[];
  zone: string;
  vat_pct: number;
  city_minor: number;
  levy_pct: number;
  breakfast_minor: number;
  single_pct: number;
  policy: { days_before: number; hour: number; refund_pct: number }[];
}

export interface RoomTypeRow {
  code: string;
  property: string;
  name: string;
  included_adults: number;
  max_adults: number;
  max_guests: number;
  extra_adult_minor: number;
  child_minor: number;
  rooms: number;
  base_rate_minor: number;
}

export interface NightRow {
  room_type: string;
  date: string;
  base_rate_minor: number;
  allotment: number;
  min_stay: number;
  max_stay: number;
  closed_to_arrival: boolean;
  closed_to_departure: boolean;
  stop_sell: boolean;
  release_days: number;
}

export interface DestinationRow {
  code: string;
  name: string;
  zone: string;
  cx: number;
  cy: number;
}

export interface Inventory {
  properties: Map<string, PropertyRow>;
  roomTypes: Map<string, RoomTypeRow[]>;
  roomType: Map<string, RoomTypeRow>;
  nights: Map<string, Map<string, NightRow>>;
  taken: Map<string, Map<string, number>>;
}

const DATE_FIELDS = `room_type, to_char(date, 'YYYY-MM-DD') as date, base_rate_minor, allotment,
  min_stay, max_stay, closed_to_arrival, closed_to_departure, stop_sell, release_days`;

export async function loadProperties(codes: string[]): Promise<PropertyRow[]> {
  if (codes.length === 0) return [];
  return query<PropertyRow>(
    `select code, name, destination, x, y, stars, amenities, zone, vat_pct, city_minor,
       levy_pct, breakfast_minor, single_pct, policy
     from properties where code = any($1) order by code`,
    [codes],
  );
}

export async function loadProperty(code: string): Promise<PropertyRow | null> {
  const rows = await loadProperties([code]);
  return rows.length > 0 ? rows[0] : null;
}

export async function loadDestination(code: string): Promise<DestinationRow | null> {
  const rows = await query<DestinationRow>('select code, name, zone, cx, cy from destinations where code = $1', [code]);
  return rows.length > 0 ? rows[0] : null;
}

export async function loadDestinations(): Promise<DestinationRow[]> {
  return query<DestinationRow>('select code, name, zone, cx, cy from destinations order by name');
}

export async function propertiesOfDestination(dest: string): Promise<string[]> {
  const rows = await query<{ code: string }>('select code from properties where destination = $1 order by code', [dest]);
  return rows.map((r) => r.code);
}

/**
 * Loads properties, room types, nightly rates and the live claims on every
 * night in `[from, toExclusive)`, which is where rooms left comes from.
 */
export async function loadInventory(
  propertyCodes: string[],
  from: string,
  toExclusive: string,
  options: { excludeBooking?: string; excludeHold?: string } = {},
): Promise<Inventory> {
  const properties = new Map<string, PropertyRow>();
  for (const p of await loadProperties(propertyCodes)) properties.set(p.code, p);
  const roomTypes = new Map<string, RoomTypeRow[]>();
  const roomType = new Map<string, RoomTypeRow>();
  const types = propertyCodes.length
    ? await query<RoomTypeRow>(
        `select code, property, name, included_adults, max_adults, max_guests, extra_adult_minor,
           child_minor, rooms, base_rate_minor
         from room_types where property = any($1) order by code`,
        [propertyCodes],
      )
    : [];
  for (const t of types) {
    const list = roomTypes.get(t.property) ?? [];
    list.push(t);
    roomTypes.set(t.property, list);
    roomType.set(t.code, t);
  }
  const typeCodes = types.map((t) => t.code);
  const nights = new Map<string, Map<string, NightRow>>();
  if (typeCodes.length > 0) {
    const rows = await query<NightRow>(
      `select ${DATE_FIELDS} from nights where room_type = any($1) and date >= $2 and date <= $3`,
      [typeCodes, from, toExclusive],
    );
    for (const row of rows) {
      const byDate = nights.get(row.room_type) ?? new Map<string, NightRow>();
      byDate.set(row.date, row);
      nights.set(row.room_type, byDate);
    }
  }
  const taken = new Map<string, Map<string, number>>();
  if (typeCodes.length > 0) {
    const rows = await query<{ room_type: string; date: string; n: string }>(
      `select c.room_type, to_char(c.date, 'YYYY-MM-DD') as date, count(*) as n
       from claims c
       where c.active and c.room_type = any($1) and c.date >= $2 and c.date <= $3
         and ($4::text is null or c.code is null or c.code <> $4)
         and ($5::text is null or c.hold_id is null or c.hold_id <> $5)
       group by c.room_type, c.date`,
      [typeCodes, from, toExclusive, options.excludeBooking ?? null, options.excludeHold ?? null],
    );
    for (const row of rows) {
      const byDate = taken.get(row.room_type) ?? new Map<string, number>();
      byDate.set(row.date, Number(row.n));
      taken.set(row.room_type, byDate);
    }
  }
  return { properties, roomTypes, roomType, nights, taken };
}

export function nightOf(inv: Inventory, roomType: string, date: string): NightRow | null {
  return inv.nights.get(roomType)?.get(date) ?? null;
}

export function roomsLeft(inv: Inventory, roomType: string, date: string): number {
  const night = nightOf(inv, roomType, date);
  if (!night) return 0;
  const used = inv.taken.get(roomType)?.get(date) ?? 0;
  return Math.max(0, night.allotment - used);
}

export function stayDates(inDate: string, outDate: string): string[] {
  return datesBetween(inDate, outDate);
}
