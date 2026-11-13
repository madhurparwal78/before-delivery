import type { PoolClient } from 'pg'
import { span } from '../shared/dates'
import { config } from './config'
import { fail } from './errors'
import { one, rows, type Db } from './db'
import { emit } from './events'
import { selectionReason, type QuoteRow, type Selection } from './quotes'
import { getProperty, roomTypesOf, stayContext } from './catalog'
import type { RoomTypeData } from './allocation'
import { token } from './auth'

export interface HoldRow {
  id: string; quote_id: string; visitor: string; user_id: number | null; property: string; expires_at: Date; state: 'live' | 'expired' | 'converted' | 'released'
  booking_code: string | null
}

export async function announceAvailability(property: string, roomTypes: Iterable<string>, dates: string[]): Promise<void> {
  for (const room_type of new Set(roomTypes)) await emit({ name: 'availability', data: { property, room_type, dates }, target: null })
}

export const holdView = (hold: HoldRow, rooms: Selection[]) => ({
  id: hold.id, quote_id: hold.quote_id, expires_at: hold.expires_at.toISOString(),
  rooms: rooms.map(({ room_type, plan, breakfast, adults, ages }) => ({ room_type, plan, breakfast, adults, ages })),
})

/** Reserves every room of a quote or none, all in one step under row locks on the affected nights. */
export async function createHold(client: PoolClient, quote: QuoteRow, now: Date): Promise<{ hold: HoldRow; created: boolean }> {
  await client.query('SELECT 1 FROM quotes WHERE id = $1 FOR UPDATE', [quote.id])
  if (quote.hold_id) {
    const existing = await one<HoldRow>(client, `SELECT * FROM holds WHERE id = $1`, [quote.hold_id])
    if (existing && existing.state === 'live' && existing.expires_at > now) return { hold: existing, created: false }
  }
  if (quote.expires_at <= now) return fail(410, 'quote_expired')
  const types = [...new Set(quote.rooms.map((room) => room.room_type))].sort()
  await client.query(`SELECT 1 FROM nights WHERE room_type = ANY($1) AND date >= $2 AND date <= $3 ORDER BY room_type, date FOR UPDATE`, [types, quote.in_date, quote.out_date])
  const property = (await getProperty(client, quote.property))!
  const roomTypes = (await roomTypesOf(client, [quote.property])).get(quote.property) as RoomTypeData[]
  const ctx = await stayContext(client, property, roomTypes, quote.in_date, quote.out_date, now, quote.tier_pct)
  const reason = selectionReason(ctx, quote.rooms)
  if (reason?.code === 'sold_out') return fail(409, 'sold_out', { date: reason.date })
  if (reason) return fail(422, 'restricted', { reason })
  const hold: HoldRow = {
    id: token(12), quote_id: quote.id, visitor: quote.visitor, user_id: quote.user_id, property: quote.property,
    expires_at: new Date(now.getTime() + config.holdMs), state: 'live', booking_code: null,
  }
  await insertHold(client, hold, quote.rooms, quote.in_date, quote.out_date, now)
  await client.query('UPDATE quotes SET hold_id = $1 WHERE id = $2', [hold.id, quote.id])
  return { hold, created: true }
}

export async function insertHold(db: Db, hold: HoldRow, rooms: Selection[], arrival: string, departure: string, now: Date): Promise<void> {
  await db.query(
    `INSERT INTO holds (id, quote_id, visitor, user_id, property, expires_at, state, booking_code, created_at) VALUES ($1,$2,$3,$4,$5,$6,'live',$7,$8)`,
    [hold.id, hold.quote_id, hold.visitor, hold.user_id, hold.property, hold.expires_at, hold.booking_code, now],
  )
  for (const [index, room] of rooms.entries()) {
    for (const date of span(arrival, departure)) await db.query(`INSERT INTO occupancy (room_type, date, hold_id, room_n) VALUES ($1,$2,$3,$4)`, [room.room_type, date, hold.id, index + 1])
  }
}

/** Ends a live hold: its rooms return to sale. Returns true when this call ended it. */
export async function endHold(client: PoolClient, id: string, state: 'expired' | 'released'): Promise<{ property: string; roomTypes: string[]; dates: string[] } | null> {
  const ended = await one<HoldRow>(client, `UPDATE holds SET state = $2 WHERE id = $1 AND state = 'live' RETURNING *`, [id, state])
  if (!ended) return null
  const freed = await rows<{ room_type: string; date: string }>(client, `DELETE FROM occupancy WHERE hold_id = $1 RETURNING room_type, date`, [id])
  if (ended.booking_code) await client.query(`UPDATE booking_rooms SET state = 'expired' WHERE booking = $1 AND state = 'held'`, [ended.booking_code])
  return { property: ended.property, roomTypes: freed.map((row) => row.room_type), dates: [...new Set(freed.map((row) => row.date))].sort() }
}
