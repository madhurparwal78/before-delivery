import { daysBetween, localDate } from '../shared/dates'
import type { PolicyTier } from '../shared/types'
import { one, rows, type Db } from './db'
import type { RoomTypeData, StayContext } from './allocation'
import { loadNights } from './restrictions'
import type { PropertyTerms } from './pricing'

export interface PropertyRow extends PropertyTerms {
  code: string; name: string; destination: string; zone: string; x: number; y: number; stars: number
  amenities: string[]; policy: PolicyTier[]
}

const PROPERTY_SELECT = `SELECT p.*, d.zone FROM properties p JOIN destinations d ON d.code = p.destination`

export async function getProperty(db: Db, code: string): Promise<PropertyRow | undefined> {
  return one<PropertyRow>(db, `${PROPERTY_SELECT} WHERE p.code = $1`, [code])
}

export async function propertiesIn(db: Db, destination: string): Promise<PropertyRow[]> {
  return rows<PropertyRow>(db, `${PROPERTY_SELECT} WHERE p.destination = $1 ORDER BY p.code`, [destination])
}

export async function roomTypesOf(db: Db, properties: string[]): Promise<Map<string, RoomTypeData[]>> {
  const found = await rows<RoomTypeData & { property: string }>(db, `SELECT * FROM room_types WHERE property = ANY($1) ORDER BY code`, [properties])
  const byProperty = new Map<string, RoomTypeData[]>(properties.map((code) => [code, []]))
  for (const room of found) byProperty.get(room.property)?.push(room)
  return byProperty
}

export async function stayContext(
  db: Db, property: PropertyRow, roomTypes: RoomTypeData[], arrival: string, departure: string, now: Date, tierPct: number,
  ignoreBooking: string | null = null, ignoreHold: string | null = null,
): Promise<StayContext> {
  const today = localDate(now, property.zone)
  const nights = await loadNights(db, roomTypes.map((room) => room.code), arrival, departure, now, ignoreBooking, ignoreHold)
  return { terms: property, roomTypes, nights, arrival, departure, today, leadDays: daysBetween(today, arrival), tierPct }
}
