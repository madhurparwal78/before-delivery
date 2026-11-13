import type { PoolClient } from 'pg'
import { CURRENCIES, type Currency } from '../shared/i18n'
import { DAY_MS, addDays, isRealDay, span } from '../shared/dates'
import { fail, validation } from './errors'
import { one, tx } from './db'
import { hashPassword, token } from './auth'
import { seedNights } from './seed'
import { getProperty, roomTypesOf, stayContext } from './catalog'
import type { RoomTypeData } from './allocation'
import { completionOf, newCode } from './bookings'
import { recordPair } from './ledger'
import { priceRooms, summarize, currentRates, validateRooms, type Selection } from './quotes'
import { config } from './config'
import { tierFor, tierOf } from './loyalty'
import { insertHold, type HoldRow } from './holds'

type Json = Record<string, any>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const int = (value: unknown, min = 0): value is number => Number.isInteger(value) && (value as number) >= min
const num = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function check(list: unknown, name: string, each: (item: Json, at: string) => string | null): Json[] {
  if (list === undefined) return []
  if (!Array.isArray(list)) return validation({ [name]: 'invalid' })
  list.forEach((item, index) => {
    const problem = isObject(item) ? each(item, `${name}.${index}`) : `${name}.${index}`
    if (problem) validation({ [problem]: 'invalid' })
  })
  return list as Json[]
}

interface SeedResult {
  users: string[]; destinations: string[]; properties: string[]
  bookings: { code: string; state: string; version: number; quote_id: string | null; hold_id: string | null; expires_at: string | null; review_link: string }[]
  reviews: { id: string; state: string }[]
}

const exists = (code: string): never => fail(409, 'exists', { code })

export async function gradingSeed(body: Json, now: Date): Promise<{ result: SeedResult; touched: { property: string; roomTypes: string[]; dates: string[] }[]; properties: string[] }> {
  const destinations = check(body.destinations, 'destinations', (d, at) => (!text(d.code) ? `${at}.code` : !text(d.name) ? `${at}.name` : !text(d.zone) ? `${at}.zone` : !num(d.cx) ? `${at}.cx` : !num(d.cy) ? `${at}.cy` : null))
  const properties = check(body.properties, 'properties', (p, at) => {
    if (!text(p.code)) return `${at}.code`
    if (!text(p.name)) return `${at}.name`
    if (!text(p.destination)) return `${at}.destination`
    if (!num(p.x)) return `${at}.x`
    if (!num(p.y)) return `${at}.y`
    if (!int(p.stars, 1) || p.stars > 5) return `${at}.stars`
    if (p.amenities !== undefined && (!Array.isArray(p.amenities) || p.amenities.some((a: unknown) => typeof a !== 'string'))) return `${at}.amenities`
    if (p.policy !== undefined && (!Array.isArray(p.policy) || p.policy.some((t: Json) => !int(t?.days_before) || !int(t?.hour) || t.hour > 23 || !int(t?.refund_pct) || t.refund_pct > 100))) return `${at}.policy`
    for (const key of ['vat_pct', 'city_minor', 'levy_pct', 'breakfast_minor', 'single_pct']) if (p[key] !== undefined && !int(p[key])) return `${at}.${key}`
    if (!Array.isArray(p.room_types) || !p.room_types.length) return `${at}.room_types`
    for (const [i, r] of p.room_types.entries()) {
      if (!isObject(r) || !text(r.code) || !text(r.name)) return `${at}.room_types.${i}`
      for (const key of ['included_adults', 'max_adults', 'max_guests', 'extra_adult_minor', 'child_minor', 'rooms', 'base_rate_minor']) if (!int(r[key])) return `${at}.room_types.${i}.${key}`
    }
    return null
  })
  const users = check(body.users, 'users', (u, at) => (!text(u.username) ? `${at}.username` : !text(u.password) ? `${at}.password` : !['guest', 'manager', 'operator'].includes(u.role) ? `${at}.role` : null))
  const nights = check(body.nights, 'nights', (n, at) => (!text(n.room_type) ? `${at}.room_type` : !isRealDay(n.from) ? `${at}.from` : !isRealDay(n.to) ? `${at}.to` : null))
  const bookings = check(body.bookings, 'bookings', (b, at) => {
    if (!text(b.property)) return `${at}.property`
    if (!isRealDay(b.in) || !isRealDay(b.out) || b.out <= b.in) return `${at}.in`
    if (!text(b.given_name) || !text(b.surname)) return `${at}.surname`
    if (!['held', 'confirmed', 'completed', 'cancelled', 'no_show'].includes(b.state ?? 'confirmed')) return `${at}.state`
    if (!CURRENCIES.includes((b.currency ?? 'EUR') as Currency)) return `${at}.currency`
    return Array.isArray(b.rooms) && b.rooms.length ? null : `${at}.rooms`
  })
  const reviews = check(body.reviews, 'reviews', (r, at) => (!text(r.property) ? `${at}.property` : !Array.isArray(r.scores) || r.scores.length !== 5 || r.scores.some((s: unknown) => !int(s, 1) || (s as number) > 10) ? `${at}.scores` : !['pending', 'published', 'rejected'].includes(r.state ?? 'pending') ? `${at}.state` : null))

  return tx(async (client) => {
    const result: SeedResult = { users: [], destinations: [], properties: [], bookings: [], reviews: [] }
    const touched: { property: string; roomTypes: string[]; dates: string[] }[] = []
    for (const d of destinations) {
      if (await one(client, `SELECT 1 FROM destinations WHERE code = $1`, [d.code])) exists(d.code)
      await client.query(`INSERT INTO destinations (code, name, zone, cx, cy) VALUES ($1,$2,$3,$4,$5)`, [d.code, d.name, d.zone, d.cx, d.cy])
      result.destinations.push(d.code)
    }
    for (const p of properties) {
      if (await one(client, `SELECT 1 FROM properties WHERE code = $1`, [p.code])) exists(p.code)
      if (!(await one(client, `SELECT 1 FROM destinations WHERE code = $1`, [p.destination]))) validation({ destination: 'invalid' })
      await client.query(
        `INSERT INTO properties (code, name, destination, x, y, stars, amenities, policy, vat_pct, city_minor, levy_pct, breakfast_minor, single_pct) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [p.code, p.name, p.destination, p.x, p.y, p.stars, p.amenities ?? [], JSON.stringify(p.policy ?? []), p.vat_pct ?? 0, p.city_minor ?? 0, p.levy_pct ?? 0, p.breakfast_minor ?? 0, p.single_pct ?? 0],
      )
      for (const r of p.room_types) {
        if (await one(client, `SELECT 1 FROM room_types WHERE code = $1`, [r.code])) exists(r.code)
        await client.query(
          `INSERT INTO room_types (code, property, name, included_adults, max_adults, max_guests, extra_adult_minor, child_minor, rooms, base_rate_minor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [r.code, p.code, r.name, r.included_adults, r.max_adults, r.max_guests, r.extra_adult_minor, r.child_minor, r.rooms, r.base_rate_minor],
        )
        await seedNights(client, r.code, r.base_rate_minor, r.base_rate_minor, r.rooms)
      }
      result.properties.push(p.code)
    }
    const userIds = new Map<string, number>()
    for (const u of users) {
      const username = String(u.username).toLowerCase()
      const created = await one<{ id: number }>(client, `INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3) ON CONFLICT (username) DO NOTHING RETURNING id`, [username, hashPassword(u.password), u.role])
      if (!created) exists(username)
      userIds.set(username, created!.id)
      for (const property of u.manages ?? []) await client.query(`INSERT INTO manages (user_id, property) VALUES ($1,$2)`, [created!.id, property])
      for (const stay of u.completed_stays ?? []) await completedStay(client, created!.id, stay, now)
      result.users.push(username)
    }
    for (const n of nights) {
      const set: string[] = []
      const params: unknown[] = [n.room_type, n.from, n.to]
      const columns: Record<string, string> = { base_rate_minor: 'rate_minor', allotment: 'allotment', min_stay: 'min_stay', max_stay: 'max_stay', closed_to_arrival: 'closed_to_arrival', closed_to_departure: 'closed_to_departure', stop_sell: 'stop_sell', release_days: 'release_days' }
      for (const [field, column] of Object.entries(columns)) {
        if (n[field] !== undefined) {
          params.push(n[field])
          set.push(`${column} = $${params.length}`)
        }
      }
      if (set.length) await client.query(`UPDATE nights SET ${set.join(', ')} WHERE room_type = $1 AND date BETWEEN $2 AND $3`, params)
    }
    for (const b of bookings) {
      const seeded = await seedBooking(client, b, userIds, now)
      result.bookings.push(seeded.entry)
      touched.push(seeded.touched)
    }
    for (const r of reviews) {
      const guest = r.guest ? userIds.get(String(r.guest).toLowerCase()) ?? (await one<{ id: number }>(client, `SELECT id FROM users WHERE username = $1`, [String(r.guest).toLowerCase()]))?.id ?? null : null
      const id = token(8)
      const created = new Date(now.getTime() - (r.age_days ?? 0) * DAY_MS)
      await client.query(`INSERT INTO reviews (id, property, guest_user, scores, comment, created_at, state) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, r.property, guest, r.scores, r.comment ?? '', created, r.state ?? 'pending'])
      result.reviews.push({ id, state: r.state ?? 'pending' })
    }
    return { result, touched, properties: result.properties }
  })
}

async function completedStay(client: PoolClient, userId: number, stay: Json, now: Date): Promise<void> {
  const property = await getProperty(client, stay.property)
  if (!property || !isRealDay(stay.checkout)) return validation({ completed_stays: 'invalid' })
  const rooms = (await roomTypesOf(client, [property.code])).get(property.code) as RoomTypeData[]
  await insertBooking(client, {
    property, rooms, selection: [{ room_type: rooms[0].code, plan: 'refundable', breakfast: false, adults: 2, ages: [] }], arrival: addDays(stay.checkout, -1), departure: stay.checkout,
    currency: 'EUR', given: 'Guest', surname: 'Guest', ownerUser: userId, state: 'completed', now, tierPct: 0, tierName: tierOf(0).name,
  })
}

interface BookingInput {
  property: NonNullable<Awaited<ReturnType<typeof getProperty>>>; rooms: RoomTypeData[]; selection: Selection[]; arrival: string; departure: string; currency: Currency
  given: string; surname: string; ownerUser: number | null; state: 'held' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'; now: Date; tierPct: number; tierName: string
}

async function insertBooking(client: PoolClient, input: BookingInput): Promise<{ code: string; reviewToken: string; quoteId: string | null; holdId: string | null; expires: Date | null; roomTypes: string[] }> {
  const { property, selection, arrival, departure, now } = input
  const ctx = await stayContext(client, property, input.rooms, arrival, departure, now, input.tierPct)
  const priced = priceRooms(ctx, selection)
  const rates = await currentRates(client)
  const code = newCode()
  const reviewToken = token(16)
  const completes = completionOf(departure, property.zone)
  await client.query(
    `INSERT INTO bookings (code, owner_user, property, in_date, out_date, given_name, surname, card_last4, currency, tier, tier_pct, rates, created_at, completes_at, review_token, completion_sent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'0002',$8,$9,$10,$11,$12,$13,$14,$15)`,
    [code, input.ownerUser, property.code, arrival, departure, input.given, input.surname, input.currency, input.tierName, input.tierPct, JSON.stringify(rates), now, completes, reviewToken, input.state === 'completed'],
  )
  for (const [index, room] of priced.entries()) {
    const paid = input.state === 'held' ? 0 : room.total_minor
    await client.query(
      `INSERT INTO booking_rooms (booking, n, room_type, plan, breakfast, adults, ages, state, nights, total_minor, paid_minor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [code, index + 1, room.room_type, room.plan, room.breakfast, room.adults, room.ages, input.state, JSON.stringify(room.nights), room.total_minor, paid],
    )
  }
  if (input.state !== 'held') await recordPair(client, code, 'charge', 'guest', 'property', priced.reduce((sum, room) => sum + room.total_minor, 0), now)
  if (input.state === 'completed') {
    await client.query(`INSERT INTO inbox (visitor, user_id, at, kind, property, link) VALUES (NULL,$1,$2,'review',$3,$4)`, [input.ownerUser, completes, property.code, `/reviews/${reviewToken}`])
  }
  let quoteId: string | null = null
  let holdId: string | null = null
  let expires: Date | null = null
  if (input.state === 'held') {
    quoteId = token(12)
    holdId = token(12)
    expires = new Date(now.getTime() + config.holdMs)
    const visitor = `seed-${code}`
    const summary = summarize(priced, arrival, departure, input.currency, rates)
    await client.query(
      `INSERT INTO quotes (id, visitor, user_id, property, in_date, out_date, currency, tier, tier_pct, rates, rooms, total_minor, taxable_minor, expires_at, hold_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [quoteId, visitor, input.ownerUser, property.code, arrival, departure, input.currency, input.tierName, input.tierPct, JSON.stringify(rates), JSON.stringify(priced), summary.total_minor, summary.taxable_minor, new Date(now.getTime() + config.quoteTtlMs), holdId, now],
    )
    const hold: HoldRow = { id: holdId, quote_id: quoteId, visitor, user_id: input.ownerUser, property: property.code, expires_at: expires, state: 'live', booking_code: code }
    await insertHold(client, hold, selection, arrival, departure, now)
    await client.query(`UPDATE bookings SET hold_id = $2 WHERE code = $1`, [code, holdId])
  } else if (input.state !== 'cancelled') {
    for (const [index, room] of priced.entries()) for (const date of span(arrival, departure)) await client.query(`INSERT INTO occupancy (room_type, date, booking_code, room_n) VALUES ($1,$2,$3,$4)`, [room.room_type, date, code, index + 1])
  }
  return { code, reviewToken, quoteId, holdId, expires, roomTypes: priced.map((room) => room.room_type) }
}

async function seedBooking(client: PoolClient, b: Json, userIds: Map<string, number>, now: Date) {
  const property = await getProperty(client, b.property)
  if (!property) return validation({ property: 'invalid' })
  const rooms = (await roomTypesOf(client, [property.code])).get(property.code) as RoomTypeData[]
  const selection = validateRooms(rooms, b.rooms)
  let ownerUser: number | null = null
  if (b.guest) {
    const name = String(b.guest).toLowerCase()
    ownerUser = userIds.get(name) ?? (await one<{ id: number }>(client, `SELECT id FROM users WHERE username = $1`, [name]))?.id ?? null
    if (ownerUser === null) return validation({ guest: 'invalid' })
  }
  const tier = await tierFor(client, ownerUser, now)
  const state = (b.state ?? 'confirmed') as BookingInput['state']
  const made = await insertBooking(client, {
    property, rooms, selection, arrival: b.in, departure: b.out, currency: (b.currency ?? 'EUR') as Currency, given: b.given_name, surname: b.surname,
    ownerUser, state, now, tierPct: tier.pct, tierName: tier.name,
  })
  const row = await one<{ version: number }>(client, `SELECT version FROM bookings WHERE code = $1`, [made.code])
  return {
    entry: { code: made.code, state, version: row!.version, quote_id: made.quoteId, hold_id: made.holdId, expires_at: made.expires ? made.expires.toISOString() : null, review_link: `/reviews/${made.reviewToken}` },
    touched: { property: property.code, roomTypes: made.roomTypes, dates: span(b.in, b.out) },
  }
}

