import type { PoolClient } from 'pg'
import { addDays, daysBetween, isoWeekday, isRealDay, localDate, span } from '../shared/dates'
import type { CalendarCell } from '../shared/types'
import { fail, notFound, validation } from './errors'
import { one, pool, rows, type Db } from './db'
import type { Identity } from './auth'
import { loadNights } from './restrictions'
import { announceAvailability } from './holds'
import { quoteChanged } from './scheduler'
import { priceRooms, type QuoteRow } from './quotes'
import { getProperty, roomTypesOf, stayContext } from './catalog'
import type { RoomTypeData } from './allocation'

/** 401 without a session, 404 for a property the caller does not manage. */
export function requireManager(identity: Identity, code: string): void {
  if (!identity.user) fail(401, 'unauthorized')
  if (!identity.user?.manages.includes(code)) notFound()
}

export async function calendar(db: Db, code: string, from: string, days: number, now: Date) {
  const roomTypes = await rows<{ code: string; name: string; rooms: number }>(db, `SELECT code, name, rooms FROM room_types WHERE property = $1 ORDER BY code`, [code])
  const to = addDays(from, days - 1)
  const maps = await loadNights(db, roomTypes.map((room) => room.code), from, to, now)
  const cells: CalendarCell[] = []
  for (const room of roomTypes) {
    for (const date of span(from, addDays(to, 1))) {
      const row = maps.get(room.code)?.get(date)
      if (row) cells.push({ room_type: room.code, date, rate_minor: row.rate_minor, allotment: row.allotment, left: row.left, min_stay: row.min_stay, max_stay: row.max_stay, closed_to_arrival: row.closed_to_arrival, closed_to_departure: row.closed_to_departure, stop_sell: row.stop_sell, release_days: row.release_days })
    }
  }
  return { room_types: roomTypes, cells }
}

interface EditBody {
  room_types?: unknown; from?: unknown; to?: unknown; weekdays?: unknown; rate_minor?: unknown; rooms?: unknown; min_stay?: unknown; max_stay?: unknown
  closed_to_arrival?: unknown; closed_to_departure?: unknown; stop_sell?: unknown; season_name?: unknown; replace?: unknown
}

const whole = (value: unknown, min: number): value is number => Number.isInteger(value) && (value as number) >= min

function overlapOf(season: { from_date: string; to_date: string; weekdays: number[] }, from: string, to: string, weekdays: number[]): string[] {
  const start = season.from_date > from ? season.from_date : from
  const end = season.to_date < to ? season.to_date : to
  return span(start, addDays(end, 1)).filter((day) => {
    const weekday = isoWeekday(day)
    return weekdays.includes(weekday) && season.weekdays.includes(weekday)
  })
}

export async function editNights(client: PoolClient, code: string, body: EditBody, now: Date): Promise<{ changed_nights: number; season: { name: string } | null; stale: QuoteRow[]; touched: { roomTypes: string[]; dates: string[] } }> {
  const roomTypes = await rows<{ code: string }>(client, `SELECT code FROM room_types WHERE property = $1`, [code])
  const fields: Record<string, string> = {}
  const chosen = Array.isArray(body.room_types) ? body.room_types.filter((value): value is string => typeof value === 'string') : []
  if (!chosen.length || chosen.some((type) => !roomTypes.some((room) => room.code === type))) fields.room_types = 'invalid'
  if (!isRealDay(body.from)) fields.from = 'invalid'
  if (!isRealDay(body.to)) fields.to = 'invalid'
  const weekdays = Array.isArray(body.weekdays) ? [...new Set(body.weekdays.filter((day): day is number => Number.isInteger(day) && day >= 1 && day <= 7))] : []
  if (!weekdays.length) fields.weekdays = 'invalid'
  if (!fields.from && !fields.to && (body.from as string) > (body.to as string)) fields.to = 'out_of_range'
  for (const key of ['rate_minor', 'rooms', 'min_stay', 'max_stay'] as const) if (body[key] !== undefined && !whole(body[key], key === 'rooms' ? 0 : 1)) fields[key] = key === 'rate_minor' ? 'edit.rate_min' : 'invalid'
  for (const key of ['closed_to_arrival', 'closed_to_departure', 'stop_sell'] as const) if (body[key] !== undefined && typeof body[key] !== 'boolean') fields[key] = 'invalid'
  if (Object.keys(fields).length) validation(fields)
  const from = body.from as string
  const to = body.to as string
  const dates = span(from, addDays(to, 1)).filter((day) => weekdays.includes(isoWeekday(day)))
  if (whole(body.min_stay, 1) && whole(body.max_stay, 1) && body.max_stay < body.min_stay) fields.max_stay = 'edit.max_below_min'
  else if (whole(body.max_stay, 1) || whole(body.min_stay, 1)) {
    const clash = await one(client, `SELECT 1 FROM nights WHERE room_type = ANY($1) AND date = ANY($2) AND (($3::int IS NOT NULL AND $3 < min_stay AND $4::int IS NULL) OR ($4::int IS NOT NULL AND $4 > max_stay AND $3::int IS NULL)) LIMIT 1`,
      [chosen, dates, body.max_stay ?? null, body.min_stay ?? null])
    if (clash) fields.max_stay = 'edit.max_below_min'
  }
  const multiple = from !== to
  const name = typeof body.season_name === 'string' ? body.season_name.trim() : ''
  if (multiple && !name) fields.season_name = 'edit.season_name'
  let soldCount: number | null = null
  if (whole(body.rooms, 0)) {
    const sold = await one<{ n: number }>(client,
      `SELECT COALESCE(max(c), 0)::int AS n FROM (SELECT count(*) AS c FROM occupancy o LEFT JOIN holds h ON h.id = o.hold_id
         WHERE o.room_type = ANY($1) AND o.date = ANY($2) AND (o.hold_id IS NULL OR (h.state = 'live' AND h.expires_at > $3)) GROUP BY o.room_type, o.date) x`, [chosen, dates, now])
    if ((sold?.n ?? 0) > body.rooms) {
      fields.rooms = 'edit.rooms_sold'
      soldCount = sold?.n ?? 0
    }
  }
  if (Object.keys(fields).length) validation(fields, soldCount !== null ? { n: soldCount } : {})
  const replaced = body.replace
  if (multiple) {
    const seasons = await rows<{ id: number; name: string; room_types: string[]; from_date: string; to_date: string; weekdays: number[] }>(
      client, `SELECT * FROM seasons WHERE property = $1 AND room_types && $2 ORDER BY name`, [code, chosen])
    const clashes = seasons.filter((season) => !(typeof replaced === 'string' && season.name === replaced) && overlapOf(season, from, to, weekdays).length)
    if (clashes.length) {
      const shared = overlapOf(clashes[0], from, to, weekdays)
      fail(409, 'season_overlap', { season: name, other: clashes[0].name, from: shared[0], to: shared[shared.length - 1] })
    }
    if (typeof replaced === 'string') await client.query(`DELETE FROM seasons WHERE property = $1 AND name = $2`, [code, replaced])
    await client.query(`INSERT INTO seasons (property, name, room_types, from_date, to_date, weekdays) VALUES ($1,$2,$3,$4,$5,$6)`, [code, name, chosen, from, to, weekdays])
  }
  const staleBefore = body.rate_minor !== undefined ? await liveQuotes(client, code, from, to, now) : []
  const set: string[] = []
  const params: unknown[] = [chosen, dates]
  const add = (column: string, value: unknown): void => {
    if (value !== undefined) {
      params.push(value)
      set.push(`${column} = $${params.length}`)
    }
  }
  add('rate_minor', body.rate_minor)
  add('allotment', body.rooms)
  add('min_stay', body.min_stay)
  add('max_stay', body.max_stay)
  add('closed_to_arrival', body.closed_to_arrival)
  add('closed_to_departure', body.closed_to_departure)
  add('stop_sell', body.stop_sell)
  let changed = 0
  if (set.length) {
    await client.query(`SELECT 1 FROM nights WHERE room_type = ANY($1) AND date = ANY($2) ORDER BY room_type, date FOR UPDATE`, [chosen, dates])
    changed = (await client.query(`UPDATE nights SET ${set.join(', ')} WHERE room_type = ANY($1) AND date = ANY($2)`, params)).rowCount ?? 0
  }
  return { changed_nights: changed, season: multiple ? { name } : null, stale: staleBefore, touched: { roomTypes: chosen, dates } }
}

export async function liveQuotes(db: Db, code: string, from: string, to: string, now: Date): Promise<QuoteRow[]> {
  return rows<QuoteRow>(db, `SELECT * FROM quotes WHERE property = $1 AND NOT stale AND expires_at > $2 AND in_date <= $4 AND out_date > $3 AND NOT EXISTS (SELECT 1 FROM holds h WHERE h.quote_id = quotes.id AND h.state = 'converted')`, [code, now, from, to])
}

/** After a committed edit: broadcast availability and mark quotes whose night rates changed as stale. */
export async function afterEdit(code: string, result: Awaited<ReturnType<typeof editNights>>, now: Date): Promise<void> {
  await announceAvailability(code, result.touched.roomTypes, result.touched.dates)
  const property = await getProperty(pool, code)
  const roomTypes = (await roomTypesOf(pool, [code])).get(code) as RoomTypeData[]
  for (const quote of result.stale) {
    const ctx = await stayContext(pool, property!, roomTypes, quote.in_date, quote.out_date, now, quote.tier_pct)
    ctx.leadDays = daysBetween(localDate(quote.created_at, property!.zone), quote.in_date)
    const repriced = priceRooms(ctx, quote.rooms)
    const differs = repriced.some((room, i) => room.nights.some((night, k) => night.total_minor !== quote.rooms[i].nights[k].total_minor))
    if (differs && (await one(pool, `UPDATE quotes SET stale = true, stale_sent = true WHERE id = $1 AND NOT stale RETURNING id`, [quote.id]))) await quoteChanged(quote, 'rate', now)
  }
}

