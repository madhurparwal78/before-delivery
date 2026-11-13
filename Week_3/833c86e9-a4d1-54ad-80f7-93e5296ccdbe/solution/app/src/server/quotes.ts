import { CURRENCIES, type Currency } from '../shared/i18n'
import { daysBetween, isRealDay, span } from '../shared/dates'
import { MAX_ADULTS, MAX_ROOMS } from '../shared/rules'
import type { Quote, QuoteNight, QuoteRoom, Reason } from '../shared/types'
import { MAX_NIGHTS } from './config'
import { fail, validation } from './errors'
import { one, rows, type Db } from './db'
import { recommend, typeFits, type RoomTypeData, type StayContext } from './allocation'
import { getProperty, roomTypesOf, stayContext, type PropertyRow } from './catalog'
import { convertNights, occupancyOf, priceNight, sumLines, type Plan, type RatesPpm } from './pricing'
import type { Tier } from './loyalty'

export interface Selection { room_type: string; plan: Plan; breakfast: boolean; adults: number; ages: number[] }

export const DEFAULT_RATES: RatesPpm = { EUR: 1000000, USD: 1080000, JPY: 161500000, KWD: 332000 }

export async function currentRates(db: Db): Promise<RatesPpm> {
  const row = await one<{ value: RatesPpm }>(db, `SELECT value FROM settings WHERE key = 'currency'`)
  return row?.value ?? DEFAULT_RATES
}

const isInt = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max

export function parseAges(value: unknown): number[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 8) return null
  return value.every((age) => isInt(age, 0, 17)) ? (value as number[]) : null
}

/** Validates the dates and currency of a quote request (422 validation on failure). */
export function validateStay(body: { in?: unknown; out?: unknown; currency?: unknown }): { in: string; out: string; currency: Currency } {
  const fields: Record<string, string> = {}
  if (!isRealDay(body.in)) fields.in = body.in === undefined ? 'required' : 'invalid'
  if (!isRealDay(body.out)) fields.out = body.out === undefined ? 'required' : 'invalid'
  if (!fields.in && !fields.out) {
    const nights = daysBetween(body.in as string, body.out as string)
    if (nights < 1 || nights > MAX_NIGHTS) fields.out = 'out_of_range'
  }
  if (!CURRENCIES.includes(body.currency as Currency)) fields.currency = body.currency === undefined ? 'required' : 'invalid'
  if (Object.keys(fields).length) validation(fields)
  return { in: body.in as string, out: body.out as string, currency: body.currency as Currency }
}

export function validateRooms(roomTypes: RoomTypeData[], value: unknown): Selection[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ROOMS) return validation({ rooms: value === undefined ? 'required' : 'invalid' })
  const rooms: Selection[] = []
  value.forEach((entry, index) => {
    const room = roomTypes.find((candidate) => candidate.code === entry?.room_type)
    const ages = parseAges(entry?.ages)
    const fields: Record<string, string> = {}
    if (!room) fields[`rooms.${index}.room_type`] = 'invalid'
    if (entry?.plan !== 'refundable' && entry?.plan !== 'nonrefundable') fields[`rooms.${index}.plan`] = 'invalid'
    if (typeof entry?.breakfast !== 'boolean') fields[`rooms.${index}.breakfast`] = 'invalid'
    if (!room || !isInt(entry?.adults, 1, room.max_adults)) fields[`rooms.${index}.adults`] = 'out_of_range'
    if (!ages) fields[`rooms.${index}.ages`] = 'invalid'
    else if (room && isInt(entry?.adults, 1, MAX_ADULTS) && entry.adults + ages.length > room.max_guests) fields[`rooms.${index}.ages`] = 'out_of_range'
    if (Object.keys(fields).length) validation(fields)
    rooms.push({ room_type: entry.room_type, plan: entry.plan, breakfast: entry.breakfast, adults: entry.adults, ages: ages as number[] })
  })
  return rooms
}

export function priceRooms(ctx: StayContext, selection: Selection[]): QuoteRoom[] {
  const dates = span(ctx.arrival, ctx.departure)
  return selection.map((room) => {
    const data = ctx.roomTypes.find((candidate) => candidate.code === room.room_type) as RoomTypeData
    const map = ctx.nights.get(room.room_type)!
    const nights = dates.map((date) =>
      priceNight(ctx.terms, data, room.plan, room.breakfast, occupancyOf(room.adults, room.ages), {
        date, rate_minor: map.get(date)?.rate_minor ?? data.base_rate_minor, nights: dates.length, leadDays: ctx.leadDays, tierPct: ctx.tierPct,
      }),
    )
    return { ...room, nights, total_minor: nights.reduce((sum, night) => sum + night.total_minor, 0) }
  })
}

/** The first inventory or restriction failure over the chosen room counts, in room type code order. */
export function selectionReason(ctx: StayContext, selection: Selection[]): Reason | null {
  const counts = new Map<string, number>()
  for (const room of selection) counts.set(room.room_type, (counts.get(room.room_type) ?? 0) + 1)
  for (const [code, count] of [...counts].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const reason = typeFits(ctx, code, count)
    if (reason) return reason
  }
  return null
}

export function restricted(reason: Reason): never {
  return fail(422, 'restricted', { reason })
}

export function summarize(rooms: QuoteRoom[], arrival: string, departure: string, currency: Currency, ppm: RatesPpm): Omit<Quote, 'id' | 'property' | 'tier' | 'expires_at' | 'hold_id' | 'rooms'> {
  const dates = span(arrival, departure)
  const totals = dates.map((_, i) => rooms.reduce((sum, room) => sum + room.nights[i].total_minor, 0))
  const taxable = dates.map((_, i) => rooms.reduce((sum, room) => sum + room.nights[i].taxable_minor, 0))
  const converted = convertNights(totals, ppm[currency], currency)
  const convertedTaxable = convertNights(taxable, ppm[currency], currency)
  const nights: QuoteNight[] = dates.map((date, i) => {
    const lines = sumLines(rooms.map((room) => room.nights[i]))
    const discount = rooms.some((room) => room.plan === 'nonrefundable') || lines.some((line) => ['occupancy', 'length_of_stay', 'early_booking', 'last_minute', 'loyalty'].includes(line.key) && line.minor < 0)
    return {
      date, total_minor: totals[i], taxable_minor: taxable[i], converted_minor: converted.split[i], converted_taxable_minor: convertedTaxable.split[i],
      state: discount ? 'discount' : 'base', lines,
    }
  })
  return {
    in: arrival, out: departure, nights_count: dates.length, currency, rates_ppm: ppm, nights,
    total_minor: totals.reduce((a, b) => a + b, 0), taxable_minor: taxable.reduce((a, b) => a + b, 0),
    converted_total_minor: converted.total, converted_taxable_minor: convertedTaxable.total,
  }
}

/** Applies the night states `held` and `closed` from the server's current inventory. */
async function applyStates(db: Db, quote: Quote, ctx: StayContext, owner: { visitor: string | null; user: number | null }, now: Date): Promise<void> {
  const held = await rows<{ date: string }>(
    db,
    `SELECT DISTINCT o.date FROM occupancy o JOIN holds h ON h.id = o.hold_id
      WHERE h.property = $1 AND h.state = 'live' AND h.expires_at > $2 AND (h.visitor = $3 OR h.user_id = $4) AND o.date >= $5 AND o.date < $6`,
    [quote.property, now, owner.visitor, owner.user, quote.in, quote.out],
  )
  const heldDates = new Set(held.map((row) => row.date))
  const counts = new Map<string, number>()
  for (const room of quote.rooms) counts.set(room.room_type, (counts.get(room.room_type) ?? 0) + 1)
  for (const night of quote.nights) {
    if (heldDates.has(night.date)) {
      night.state = 'held'
      continue
    }
    const closed = [...counts].some(([code, count]) => {
      const row = ctx.nights.get(code)?.get(night.date)
      return !row || row.stop_sell || row.left < count
    })
    if (closed) night.state = 'closed'
  }
}

interface Built { quote: Quote; ctx: StayContext; property: PropertyRow; roomTypes: RoomTypeData[]; restriction: Reason | null }

export async function buildQuote(
  db: Db,
  input: { property: string; in: string; out: string; currency: Currency; rooms: unknown; adults?: unknown; ages?: unknown; holdId?: string | null },
  tier: Tier,
  ppm: RatesPpm,
  now: Date,
  owner: { visitor: string | null; user: number | null },
  lenient = false,
): Promise<Built> {
  const property = await getProperty(db, input.property)
  if (!property) return fail(404, 'not_found')
  const roomTypes = (await roomTypesOf(db, [property.code])).get(property.code) as RoomTypeData[]
  const ctx = await stayContext(db, property, roomTypes, input.in, input.out, now, tier.pct, null, input.holdId ?? null)
  let selection: Selection[]
  let restriction: Reason | null = null
  if (input.rooms === undefined) {
    const ages = parseAges(input.ages)
    if (!isInt(input.adults ?? 2, 1, MAX_ADULTS) || !ages) return validation({ [!ages ? 'ages' : 'adults']: 'invalid' })
    const found = recommend(ctx, { adults: (input.adults ?? 2) as number, ages })
    if (!found) {
      const reason = typeFits(ctx, roomTypes[0].code, 1) ?? { code: 'sold_out' as const, date: input.in }
      return restricted(reason)
    }
    selection = found.rooms.map((room) => ({ ...room, plan: 'refundable' as const, breakfast: false }))
  } else {
    selection = validateRooms(roomTypes, input.rooms)
    restriction = selectionReason(ctx, selection)
    if (restriction && !lenient) return restricted(restriction)
  }
  const rooms = priceRooms(ctx, selection)
  const quote: Quote = { id: null, property: property.code, tier: tier.name, expires_at: null, hold_id: null, rooms, ...summarize(rooms, input.in, input.out, input.currency, ppm) }
  await applyStates(db, quote, ctx, owner, now)
  return { quote, ctx, property, roomTypes, restriction }
}

export interface QuoteRow {
  id: string; visitor: string; user_id: number | null; property: string; in_date: string; out_date: string; currency: Currency
  tier: string; tier_pct: number; rates: RatesPpm; rooms: QuoteRoom[]; total_minor: number; taxable_minor: number
  expires_at: Date; hold_id: string | null; stale: boolean; created_at: Date
}

export async function quoteFromRow(db: Db, row: QuoteRow, now: Date, display: Currency = row.currency): Promise<Quote> {
  const property = await getProperty(db, row.property)
  const roomTypes = (await roomTypesOf(db, [row.property])).get(row.property) as RoomTypeData[]
  const ctx = await stayContext(db, property as PropertyRow, roomTypes, row.in_date, row.out_date, now, row.tier_pct)
  const quote: Quote = {
    id: row.id, property: row.property, tier: row.tier, expires_at: row.expires_at.toISOString(), hold_id: row.hold_id, rooms: row.rooms,
    ...summarize(row.rooms, row.in_date, row.out_date, display, row.rates),
  }
  await applyStates(db, quote, ctx, { visitor: row.visitor, user: row.user_id }, now)
  return quote
}

export async function saveQuote(db: Db, built: Built, owner: { visitor: string; user: number | null }, tierPct: number, now: Date, ttlMs: number, id: string, holdId: string | null): Promise<Quote> {
  const { quote } = built
  const expires = new Date(now.getTime() + ttlMs)
  await db.query(
    `INSERT INTO quotes (id, visitor, user_id, property, in_date, out_date, currency, tier, tier_pct, rates, rooms, total_minor, taxable_minor, expires_at, hold_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [id, owner.visitor, owner.user, quote.property, quote.in, quote.out, quote.currency, quote.tier, tierPct, JSON.stringify(quote.rates_ppm), JSON.stringify(quote.rooms), quote.total_minor, quote.taxable_minor, expires, holdId, now],
  )
  return { ...quote, id, expires_at: expires.toISOString(), hold_id: holdId }
}

export async function findQuote(db: Db, id: string): Promise<QuoteRow | undefined> {
  return one<QuoteRow>(db, `SELECT * FROM quotes WHERE id = $1`, [id])
}

export const ownsQuote = (row: { visitor: string; user_id: number | null }, visitor: string | null, user: number | null): boolean =>
  row.visitor === visitor || (user !== null && row.user_id === user)
