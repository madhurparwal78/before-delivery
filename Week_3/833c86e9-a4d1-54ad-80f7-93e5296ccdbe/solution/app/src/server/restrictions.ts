import { MAX_NIGHTS } from './config'
import { daysBetween, span } from '../shared/dates'
import type { Reason } from '../shared/types'
import { rows, type Db } from './db'

export interface NightRow {
  date: string; rate_minor: number; allotment: number; min_stay: number; max_stay: number
  closed_to_arrival: boolean; closed_to_departure: boolean; stop_sell: boolean; release_days: number; left: number
}

export type NightMap = Map<string, NightRow>

/** Rows for [from, to] inclusive with rooms left (allotment − live holds − booked), never below zero. */
export async function loadNights(db: Db, roomTypes: string[], from: string, to: string, at: Date, ignoreBooking: string | null = null, ignoreHold: string | null = null): Promise<Map<string, NightMap>> {
  const found = await rows<NightRow & { room_type: string }>(
    db,
    `SELECT n.room_type, n.date, n.rate_minor, n.allotment, n.min_stay, n.max_stay, n.closed_to_arrival, n.closed_to_departure, n.stop_sell, n.release_days,
            GREATEST(n.allotment - COALESCE(o.taken, 0), 0)::int AS left
       FROM nights n
       LEFT JOIN (
         SELECT o.room_type, o.date, count(*)::int AS taken
           FROM occupancy o LEFT JOIN holds h ON h.id = o.hold_id
          WHERE o.room_type = ANY($1) AND o.date BETWEEN $2 AND $3
            AND (o.hold_id IS NULL OR (h.state = 'live' AND h.expires_at > $4))
            AND ($5::text IS NULL OR o.booking_code IS DISTINCT FROM $5::text)
            AND ($6::text IS NULL OR o.hold_id IS DISTINCT FROM $6::text)
          GROUP BY o.room_type, o.date) o ON o.room_type = n.room_type AND o.date = n.date
      WHERE n.room_type = ANY($1) AND n.date BETWEEN $2 AND $3`,
    [roomTypes, from, to, at, ignoreBooking, ignoreHold],
  )
  const byType = new Map<string, NightMap>(roomTypes.map((code) => [code, new Map()]))
  for (const row of found) byType.get(row.room_type)?.set(row.date, row)
  return byType
}

/** The arrival-only checks: release, closed to arrival, stop sell and at least one room left. */
export function arrivalReason(map: NightMap, arrival: string, today: string): Reason | null {
  const row = map.get(arrival)
  if (!row) return { code: 'sold_out', date: arrival }
  if (daysBetween(today, arrival) < row.release_days) return { code: 'release', n: row.release_days }
  if (row.closed_to_arrival) return { code: 'no_arrival', date: arrival }
  if (row.stop_sell) return { code: 'stop_sell', date: arrival }
  if (row.left < 1) return { code: 'sold_out', date: arrival }
  return null
}

/** The checks that remain once an arrival is known: closed to departure, minimum and maximum stay, then each night. */
export function departureReason(map: NightMap, arrival: string, departure: string, wanted: number): Reason | null {
  const nights = daysBetween(arrival, departure)
  const first = map.get(arrival)
  const last = map.get(departure)
  if (last?.closed_to_departure) return { code: 'no_departure', date: departure }
  if (first && nights < first.min_stay) return { code: 'min_stay', date: arrival, n: first.min_stay }
  if (first && nights > first.max_stay) return { code: 'max_stay', date: arrival, n: first.max_stay }
  if (nights > MAX_NIGHTS) return { code: 'max_stay', date: arrival, n: MAX_NIGHTS }
  const dates = span(arrival, departure)
  for (const day of dates) if (map.get(day)?.stop_sell) return { code: 'stop_sell', date: day }
  for (const day of dates) if ((map.get(day)?.left ?? 0) < wanted) return { code: 'sold_out', date: day }
  return null
}

/** A stay for `wanted` rooms of one room type, checked in the published order; the first failure wins. */
export function stayReason(map: NightMap, arrival: string, departure: string, today: string, wanted: number): Reason | null {
  const row = map.get(arrival)
  if (row && daysBetween(today, arrival) < row.release_days) return { code: 'release', n: row.release_days }
  if (row?.closed_to_arrival) return { code: 'no_arrival', date: arrival }
  return departureReason(map, arrival, departure, wanted)
}
