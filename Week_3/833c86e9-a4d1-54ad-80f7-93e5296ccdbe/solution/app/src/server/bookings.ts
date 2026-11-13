import type { PoolClient } from 'pg'
import type { Currency } from '../shared/i18n'
import { addDays, localDate, localMoment, localWall, span } from '../shared/dates'
import { isActive, isLive, ACTIVE_STATES, refundKind, rnd } from '../shared/rules'
import type { Booking, BookingRoom, CancellationTier, QuoteRoom } from '../shared/types'
import { fail, validation } from './errors'
import { one, rows, type Db } from './db'
import { token } from './auth'
import { announceAvailability } from './holds'
import { balance, entries, recordPair } from './ledger'
import { deadlineTiers, tierInForce } from './deadlines'
import { getProperty, roomTypesOf, stayContext, type PropertyRow } from './catalog'
import { restricted, priceRooms, selectionReason, summarize, validateStay, type QuoteRow, type Selection } from './quotes'
import { tierFor } from './loyalty'
import type { RoomTypeData } from './allocation'
import { cardFieldErrors, charge, requireValid, type CardFields } from './payment'

export interface BookingRow {
  code: string; version: number; owner_visitor: string | null; owner_user: number | null; property: string; in_date: string; out_date: string
  given_name: string; surname: string; card_last4: string; currency: Currency; tier: string; tier_pct: number; rates: Record<Currency, number>
  hold_id: string | null; created_at: Date; completes_at: Date; ledger_seq: number; invoice_seq: number; review_token: string
}

interface RoomRow {
  booking: string; n: number; room_type: string; plan: 'refundable' | 'nonrefundable'; breakfast: boolean; adults: number; ages: number[]; state: string
  nights: QuoteRoom['nights']; total_minor: number; paid_minor: number; refunded_minor: number
}

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789'
export const newCode = (): string => 'KW-' + Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('')

export const completionOf = (departure: string, zone: string): Date => localMoment(departure, 11, zone)

/** The share of an amount that comes back at a refund percentage, half up. */
const refundFor = (amount: number, pct: number): number => rnd(amount * pct, 100)

/** No-shows can be marked from noon on the day after arrival until the stay completes. */
const noShowWindow = (row: BookingRow, zone: string): { opens: Date; closes: Date } => ({ opens: localMoment(addDays(row.in_date, 1), 12, zone), closes: row.completes_at })

export async function loadRow(db: Db, code: string): Promise<BookingRow | undefined> {
  return one<BookingRow>(db, `SELECT * FROM bookings WHERE code = $1`, [code.toUpperCase()])
}

export async function loadRooms(db: Db, code: string): Promise<RoomRow[]> {
  return rows<RoomRow>(db, `SELECT * FROM booking_rooms WHERE booking = $1 ORDER BY n`, [code])
}

interface Caller { visitor: string | null; user: { id: number; role: string; manages: string[] } | null }

export async function canSee(db: Db, row: BookingRow, caller: Caller): Promise<'guest' | 'manager' | null> {
  if (caller.user && row.owner_user === caller.user.id) return 'guest'
  if (caller.visitor && row.owner_visitor === caller.visitor) return 'guest'
  if (caller.visitor && (await one(db, `SELECT 1 FROM booking_access WHERE booking = $1 AND visitor = $2`, [row.code, caller.visitor]))) return 'guest'
  if (caller.user?.manages.includes(row.property)) return 'manager'
  return null
}

function stateOf(rooms: RoomRow[]): string {
  const open = rooms.filter((room) => isLive(room.state))
  return open.length ? open[0].state : 'cancelled'
}

export async function bookingView(db: Db, code: string, now: Date): Promise<Booking> {
  const row = (await loadRow(db, code))!
  const property = (await getProperty(db, row.property))!
  const rooms = await loadRooms(db, code)
  const ledger = await entries(db, code)
  const tiers = deadlineTiers(property.policy, row.in_date, property.zone)
  const active = rooms.filter((room) => isActive(room.state))
  const force = tierInForce(tiers, now)
  const refundableLeft = active.some((room) => room.plan === 'refundable')
  const pct = refundableLeft ? force.pct : 0
  const counted = rooms.filter((room) => isLive(room.state))
  const priced = counted.length ? counted : rooms
  const quoteRooms: QuoteRoom[] = priced.map((room) => ({ room_type: room.room_type, plan: room.plan, breakfast: room.breakfast, adults: room.adults, ages: room.ages, nights: room.nights, total_minor: room.total_minor }))
  const summary = summarize(quoteRooms, row.in_date, row.out_date, row.currency, row.rates)
  const eur = summarize(quoteRooms, row.in_date, row.out_date, 'EUR', row.rates)
  const noShow = noShowWindow(row, property.zone)
  return {
    code: row.code, version: row.version, state: stateOf(rooms), property: { code: property.code, name: property.name, zone: property.zone },
    in: row.in_date, out: row.out_date, given_name: row.given_name, surname: row.surname, card_last4: row.card_last4, quote_currency: row.currency,
    rooms: rooms.map((room): BookingRoom => ({
      n: room.n, room_type: room.room_type, plan: room.plan, breakfast: room.breakfast, adults: room.adults, ages: room.ages, state: room.state,
      paid_minor: room.paid_minor, refunded_minor: room.refunded_minor, nights: room.nights,
    })),
    total_minor: priced.reduce((sum, room) => sum + room.total_minor, 0),
    paid_minor: rooms.reduce((sum, room) => sum + room.paid_minor, 0), refunded_minor: rooms.reduce((sum, room) => sum + room.refunded_minor, 0),
    cancellation: {
      tiers: tiers.map((tier): CancellationTier => ({ kind: refundKind(tier.refund_pct), refund_pct: tier.refund_pct, deadline_utc: tier.at.toISOString(), deadline_local: localWall(tier.at, property.zone) })),
      status: { kind: refundKind(pct), refund_pct: pct, until_utc: pct > 0 && force.until ? force.until.toISOString() : null },
    },
    no_show_open: active.length > 0 && now.getTime() >= noShow.opens.getTime() && now.getTime() < noShow.closes.getTime(),
    ledger, balance_minor: balance(ledger), approx_minor: summary.converted_total_minor,
    nights: eur.nights,
  }
}

export interface PayInput extends CardFields { given_name: string; surname: string }

/** Turns a live hold into a confirmed booking and records the charge pair. */
export async function confirmHold(client: PoolClient, hold: { id: string; booking_code: string | null }, quote: QuoteRow, input: PayInput, now: Date, owner: { visitor: string; user: number | null }): Promise<string> {
  const property = (await getProperty(client, quote.property))!
  const last4 = charge(input)
  const code = hold.booking_code ?? newCode()
  if (hold.booking_code) {
    await client.query(`UPDATE bookings SET given_name = $2, surname = $3, card_last4 = $4, hold_id = NULL WHERE code = $1`, [code, input.given_name, input.surname, last4])
    const confirmed = await client.query(`UPDATE booking_rooms SET state = 'confirmed', paid_minor = total_minor WHERE booking = $1 AND state = 'held'`, [code])
    if (!confirmed.rowCount) fail(409, 'invalid_state')
  } else {
    await client.query(
      `INSERT INTO bookings (code, owner_visitor, owner_user, property, in_date, out_date, given_name, surname, card_last4, currency, tier, tier_pct, rates, created_at, completes_at, review_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [code, owner.visitor, owner.user, quote.property, quote.in_date, quote.out_date, input.given_name, input.surname, last4, quote.currency, quote.tier, quote.tier_pct,
        JSON.stringify(quote.rates), now, completionOf(quote.out_date, property.zone), token(16)],
    )
    for (const [index, room] of quote.rooms.entries()) {
      await client.query(
        `INSERT INTO booking_rooms (booking, n, room_type, plan, breakfast, adults, ages, state, nights, total_minor, paid_minor) VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,$9,$9)`,
        [code, index + 1, room.room_type, room.plan, room.breakfast, room.adults, room.ages, JSON.stringify(room.nights), room.total_minor],
      )
    }
  }
  await client.query(`UPDATE occupancy SET hold_id = NULL, booking_code = $2 WHERE hold_id = $1`, [hold.id, code])
  const converted = await client.query(`UPDATE holds SET state = 'converted' WHERE id = $1 AND state = 'live'`, [hold.id])
  if (!converted.rowCount) fail(409, 'invalid_state')
  await recordPair(client, code, 'charge', 'guest', 'property', quote.total_minor, now)
  return code
}

async function lockBooking(client: PoolClient, code: string): Promise<BookingRow> {
  return (await one<BookingRow>(client, `SELECT * FROM bookings WHERE code = $1 FOR UPDATE`, [code]))!
}

function checkVersion(row: BookingRow, header: string | undefined): void {
  if (header !== undefined && `"${row.version}"` !== header.trim() && String(row.version) !== header.trim()) fail(409, 'version_conflict')
}

function requireIfMatch(header: string | undefined, fields: Record<string, string> = {}): Record<string, string> {
  return header === undefined ? { ...fields, 'If-Match': 'required' } : fields
}

function parseRooms(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length < 1 || !value.every((n) => Number.isInteger(n) && n >= 1)) return null
  return [...new Set(value as number[])].sort((a, b) => a - b)
}

interface CancelPlan { refund: number; pct: number; perRoom: { room: RoomRow; refund: number }[]; retained: number }

export async function planCancellation(row: BookingRow, property: PropertyRow, rooms: RoomRow[], chosen: number[], now: Date): Promise<CancelPlan> {
  const picked = chosen.map((n) => rooms.find((room) => room.n === n))
  if (picked.some((room) => !room || !isActive(room.state))) return fail(409, 'invalid_state')
  const force = tierInForce(deadlineTiers(property.policy, row.in_date, property.zone), now)
  const perRoom = (picked as RoomRow[]).map((room) => {
    const net = room.paid_minor - room.refunded_minor
    return { room, refund: room.plan === 'nonrefundable' ? 0 : refundFor(net, force.pct) }
  })
  const refund = perRoom.reduce((sum, entry) => sum + entry.refund, 0)
  const retained = perRoom.reduce((sum, entry) => sum + entry.room.paid_minor - entry.room.refunded_minor, 0) - refund
  const refundable = perRoom.some((entry) => entry.room.plan === 'refundable')
  return { refund, pct: refundable ? force.pct : 0, perRoom, retained }
}

export function parseRoomList(raw: string | undefined): number[] {
  const list = parseRooms((raw ?? '').split(',').filter(Boolean).map(Number))
  return list ?? fail(409, 'invalid_state')
}

export async function cancelRooms(client: PoolClient, code: string, body: { rooms?: unknown }, ifMatch: string | undefined, now: Date, after: Deferred): Promise<{ refund: number }> {
  const row = await lockBooking(client, code)
  checkVersion(row, ifMatch)
  const chosen = parseRooms(body.rooms)
  const fields = requireIfMatch(ifMatch)
  if (!chosen) fields.rooms = 'invalid'
  if (Object.keys(fields).length) validation(fields)
  const property = (await getProperty(client, row.property))!
  const rooms = await loadRooms(client, code)
  const plan = await planCancellation(row, property, rooms, chosen as number[], now)
  const roomTypes: string[] = []
  for (const { room, refund } of plan.perRoom) {
    const cancelled = await client.query(`UPDATE booking_rooms SET state = 'cancelled', refunded_minor = refunded_minor + $3 WHERE booking = $1 AND n = $2 AND state = ANY($4)`, [code, room.n, refund, ACTIVE_STATES])
    if (!cancelled.rowCount) fail(409, 'invalid_state')
    await client.query(`DELETE FROM occupancy WHERE booking_code = $1 AND room_n = $2`, [code, room.n])
    roomTypes.push(room.room_type)
  }
  if (plan.refund > 0) await recordPair(client, code, 'refund', 'property', 'guest', plan.refund, now)
  await client.query(`INSERT INTO cancellations (booking, property, retained_minor, at) VALUES ($1,$2,$3,$4)`, [code, row.property, plan.retained, now])
  await client.query(`UPDATE bookings SET version = version + 1 WHERE code = $1`, [code])
  after.push(() => announceAvailability(row.property, roomTypes, span(row.in_date, row.out_date)))
  return { refund: plan.refund }
}

/** Events to announce once the surrounding transaction has committed. */
export type Deferred = (() => Promise<void>)[]

export async function flush(after: Deferred): Promise<void> {
  for (const run of after.splice(0)) await run()
}

interface ChangePlan {
  rooms: Selection[]; priced: QuoteRoom[]; newTotal: number; paid: number; pay: number; refund: number; pct: number; roomRows: RoomRow[]
}

export async function planChange(client: PoolClient, row: BookingRow, property: PropertyRow, body: { in?: unknown; out?: unknown }, now: Date): Promise<ChangePlan> {
  const rooms = await loadRooms(client, row.code)
  const active = rooms.filter((room) => isActive(room.state))
  if (!active.length || row.in_date <= localDate(now, property.zone)) return fail(409, 'invalid_state')
  if (active.some((room) => room.plan === 'nonrefundable')) return fail(422, 'nonrefundable')
  const stay = validateStay({ ...body, currency: row.currency })
  const roomTypes = (await roomTypesOf(client, [property.code])).get(property.code) as RoomTypeData[]
  const tier = await tierFor(client, row.owner_user, now)
  const ctx = await stayContext(client, property, roomTypes, stay.in, stay.out, now, tier.pct, row.code)
  const selection: Selection[] = active.map((room) => ({ room_type: room.room_type, plan: room.plan, breakfast: room.breakfast, adults: room.adults, ages: room.ages }))
  const reason = selectionReason(ctx, selection)
  if (reason) return restricted(reason)
  const priced = priceRooms(ctx, selection)
  const newTotal = priced.reduce((sum, room) => sum + room.total_minor, 0)
  const paid = active.reduce((sum, room) => sum + room.paid_minor - room.refunded_minor, 0)
  const difference = newTotal - paid
  const force = tierInForce(deadlineTiers(property.policy, row.in_date, property.zone), now)
  const refund = difference < 0 ? refundFor(-difference, force.pct) : 0
  return { rooms: selection, priced, newTotal, paid, pay: Math.max(difference, 0), refund, pct: force.pct, roomRows: active }
}

/** Splits an amount over rooms in proportion to their new totals; the shares always add up to the amount. */
function share(amount: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  const parts = weights.map((weight) => Math.floor((amount * weight) / sum))
  let rest = amount - parts.reduce((a, b) => a + b, 0)
  for (let i = 0; rest > 0; i = (i + 1) % parts.length, rest--) parts[i] += 1
  return parts
}

export async function applyChange(client: PoolClient, code: string, body: { in?: unknown; out?: unknown } & CardFields, ifMatch: string | undefined, now: Date, after: Deferred): Promise<void> {
  const row = await lockBooking(client, code)
  checkVersion(row, ifMatch)
  const property = (await getProperty(client, row.property))!
  const plan = await planChange(client, row, property, body, now)
  const fields = requireIfMatch(ifMatch, plan.pay > 0 ? cardFieldErrors(body) : {})
  requireValid(fields)
  if (plan.pay > 0) charge(body)
  const stay = validateStay({ ...body, currency: row.currency })
  const types = [...new Set(plan.rooms.map((room) => room.room_type))].sort()
  await client.query(`SELECT 1 FROM nights WHERE room_type = ANY($1) AND date >= $2 AND date <= $3 ORDER BY room_type, date FOR UPDATE`, [types, stay.in, stay.out])
  const recheck = await planChange(client, row, property, body, now)
  const moneyIn = share(plan.pay, recheck.priced.map((room) => room.total_minor))
  const moneyOut = share(recheck.refund, recheck.priced.map((room) => room.total_minor))
  const freed = await rows<{ room_type: string; date: string }>(client, `DELETE FROM occupancy WHERE booking_code = $1 AND room_n = ANY($2) RETURNING room_type, date`, [code, plan.roomRows.map((room) => room.n)])
  for (const [index, room] of plan.roomRows.entries()) {
    await client.query(
      `UPDATE booking_rooms SET state = 'changed', nights = $3, total_minor = $4, paid_minor = paid_minor + $5, refunded_minor = refunded_minor + $6 WHERE booking = $1 AND n = $2`,
      [code, room.n, JSON.stringify(recheck.priced[index].nights), recheck.priced[index].total_minor, moneyIn[index], moneyOut[index]],
    )
    for (const date of span(stay.in, stay.out)) await client.query(`INSERT INTO occupancy (room_type, date, booking_code, room_n) VALUES ($1,$2,$3,$4)`, [room.room_type, date, code, room.n])
  }
  if (plan.pay > 0) await recordPair(client, code, 'change', 'guest', 'property', plan.pay, now)
  else if (recheck.refund > 0) await recordPair(client, code, 'change', 'property', 'guest', recheck.refund, now)
  await client.query(`UPDATE bookings SET in_date = $2, out_date = $3, completes_at = $4, version = version + 1 WHERE code = $1`, [code, stay.in, stay.out, completionOf(stay.out, property.zone)])
  const dates = [...new Set([...freed.map((entry) => entry.date), ...span(stay.in, stay.out)])].sort()
  after.push(() => announceAvailability(row.property, types, dates))
}

export async function markNoShow(client: PoolClient, code: string, ifMatch: string | undefined, now: Date): Promise<void> {
  const row = await lockBooking(client, code)
  const fields = requireIfMatch(ifMatch)
  checkVersion(row, ifMatch)
  const property = (await getProperty(client, row.property))!
  const rooms = (await loadRooms(client, code)).filter((room) => isActive(room.state))
  const noShow = noShowWindow(row, property.zone)
  if (!rooms.length || now.getTime() >= noShow.closes.getTime()) fail(409, 'invalid_state')
  if (now.getTime() < noShow.opens.getTime()) fail(409, 'too_early')
  if (Object.keys(fields).length) validation(fields)
  await client.query(`UPDATE booking_rooms SET state = 'no_show' WHERE booking = $1 AND state = ANY($2)`, [code, ACTIVE_STATES])
  await client.query(`UPDATE bookings SET version = version + 1 WHERE code = $1`, [code])
}

