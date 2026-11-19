import type { Hotel } from "../shared/api";
import type { IsoDate } from "../shared/dates";
import { inserted, rows, type Queryable, type Row } from "./db";
import type { TaxRateInForce } from "./rules/pricing";

export interface HotelRecord {
  id: string;
  name: string;
  timeZone: string;
  clockNow: Date | null;
  businessDate: IsoDate;
}

interface HotelRow extends Row { id: string; name: string; time_zone: string; business_date: IsoDate; clock_now: Date | null }

export async function loadHotel(from: Queryable, hotelId: string, lock: boolean | "share" = false): Promise<HotelRecord> {
  const clause = lock === "share" ? " FOR SHARE" : lock ? " FOR UPDATE" : "";
  const row = await inserted<HotelRow>(from, `SELECT * FROM hotels WHERE id = $1${clause}`, [hotelId]);
  return { id: row.id, name: row.name, timeZone: row.time_zone, businessDate: row.business_date, clockNow: row.clock_now };
}

export function hotelView(hotel: HotelRecord): Hotel {
  return { id: hotel.id, name: hotel.name, timeZone: hotel.timeZone, businessDate: hotel.businessDate };
}

export async function taxRatesOf(from: Queryable, hotelId: string): Promise<TaxRateInForce[]> {
  const found = await rows<Row & { hundredths: number; start_date: IsoDate | null }>(
    from, "SELECT hundredths, start_date FROM tax_rates WHERE hotel_id = $1", [hotelId]);
  return found.map((rate) => ({ hundredths: rate.hundredths, startDate: rate.start_date }));
}

/** Rooms in room-number order: numerically when the number is digits. */
export const ROOM_ORDER = "COALESCE(NULLIF(regexp_replace(r.number, '\\D', '', 'g'), '')::int, 0), r.number";
