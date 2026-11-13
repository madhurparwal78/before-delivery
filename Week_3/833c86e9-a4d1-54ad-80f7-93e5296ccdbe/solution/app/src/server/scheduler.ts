import { ACTIVE_STATES } from '../shared/rules'
import { RECONNECT_LOOKBACK_MS } from './config'
import { one, pool, rows, tx } from './db'
import { emit, type LiveEvent } from './events'
import * as clock from './clock'
import { endHold, announceAvailability } from './holds'
import { currentRates, summarize, priceRooms, type QuoteRow } from './quotes'
import { getProperty, roomTypesOf, stayContext } from './catalog'
import type { RoomTypeData } from './allocation'
import { tierFor } from './loyalty'
import { accountPayload } from './accounts'

let lastRun = 0
let running: Promise<void> | null = null

/** The converted total of a quote's selection priced now, with the owner's current tier and the current currency table. */
export async function repricedTotal(row: QuoteRow, now: Date): Promise<number> {
  const property = (await getProperty(pool, row.property))!
  const roomTypes = (await roomTypesOf(pool, [row.property])).get(row.property) as RoomTypeData[]
  const tier = await tierFor(pool, row.user_id, now)
  const ctx = await stayContext(pool, property, roomTypes, row.in_date, row.out_date, now, tier.pct)
  return summarize(priceRooms(ctx, row.rooms), row.in_date, row.out_date, row.currency, await currentRates(pool)).converted_total_minor
}

async function quoteChangedEvent(row: QuoteRow, reason: 'rate' | 'expired', now: Date, target: LiveEvent['target']): Promise<LiveEvent> {
  const old = summarize(row.rooms, row.in_date, row.out_date, row.currency, row.rates).converted_total_minor
  return { name: 'quote.changed', data: { quote_id: row.id, reason, old_total_minor: old, new_total_minor: await repricedTotal(row, now) }, target }
}

export async function quoteChanged(row: QuoteRow, reason: 'rate' | 'expired', now: Date): Promise<void> {
  await emit(await quoteChangedEvent(row, reason, now, { visitor: row.visitor, user: row.user_id }))
}

interface Due { at: number; run: () => Promise<void> }

async function collect(now: Date): Promise<Due[]> {
  const due: Due[] = []
  for (const hold of await rows<{ id: string; due: Date }>(pool, `SELECT id, expires_at AS due FROM holds WHERE state = 'live' AND expires_at <= $1`, [now])) {
    due.push({ at: hold.due.getTime(), run: () => expireHold(hold.id) })
  }
  for (const quote of await rows<{ id: string; due: Date }>(pool, `SELECT id, expires_at AS due FROM quotes WHERE NOT expiry_sent AND expires_at <= $1`, [now])) {
    due.push({ at: quote.due.getTime(), run: () => expireQuote(quote.id, now) })
  }
  for (const booking of await rows<{ code: string; due: Date }>(pool, `SELECT code, completes_at AS due FROM bookings WHERE NOT completion_sent AND completes_at <= $1`, [now])) {
    due.push({ at: booking.due.getTime(), run: () => completeBooking(booking.code, now) })
  }
  return due.sort((a, b) => a.at - b.at)
}

async function expireHold(id: string): Promise<void> {
  const ended = await tx(async (client) => {
    const hold = await one<{ visitor: string; user_id: number | null }>(client, `SELECT visitor, user_id FROM holds WHERE id = $1`, [id])
    const freed = await endHold(client, id, 'expired')
    return freed && hold ? { freed, hold } : null
  })
  if (!ended) return
  await emit({ name: 'hold.expired', data: { hold_id: id }, target: { visitor: ended.hold.visitor, user: ended.hold.user_id } })
  await announceAvailability(ended.freed.property, ended.freed.roomTypes, ended.freed.dates)
}

async function expireQuote(id: string, now: Date): Promise<void> {
  const row = await one<QuoteRow>(pool, `UPDATE quotes SET expiry_sent = true WHERE id = $1 AND NOT expiry_sent RETURNING *`, [id])
  if (row) await quoteChanged(row, 'expired', now)
}

async function completeBooking(code: string, now: Date): Promise<void> {
  const result = await tx(async (client) => {
    const flagged = await one<{ owner_user: number | null; owner_visitor: string | null; property: string; review_token: string }>(
      client, `UPDATE bookings SET completion_sent = true WHERE code = $1 AND NOT completion_sent RETURNING owner_user, owner_visitor, property, review_token`, [code])
    if (!flagged) return null
    const done = await rows(client, `UPDATE booking_rooms SET state = 'completed' WHERE booking = $1 AND state = ANY($2) RETURNING n`, [code, ACTIVE_STATES])
    if (!done.length) return null
    await client.query(`INSERT INTO inbox (visitor, user_id, at, kind, property, link) VALUES ($1,$2,$3,'review',$4,$5)`, [flagged.owner_visitor, flagged.owner_user, now, flagged.property, `/reviews/${flagged.review_token}`])
    return flagged.owner_user
  })
  if (result !== null) await emit({ name: 'account.changed', data: await accountPayload(result, now, false), target: { user: result } })
}

/** Applies everything that has fallen due on the server clock, in time order. */
export async function settle(force = false): Promise<void> {
  if (running) return running
  if (!force && Date.now() - lastRun < 100) return
  running = (async () => {
    try {
      await clock.refresh()
      const now = clock.now()
      for (const item of await collect(now)) await item.run()
    } finally {
      lastRun = Date.now()
      running = null
    }
  })()
  return running
}

export async function announceClock(): Promise<void> {
  await emit({ name: 'clock', data: { now: clock.now().toISOString() }, target: null })
}

export async function initialEvents(visitor: string, user: number | null, now: Date): Promise<LiveEvent[]> {
  const events: LiveEvent[] = [{ name: 'clock', data: { now: now.toISOString() }, target: null }]
  const since = new Date(now.getTime() - RECONNECT_LOOKBACK_MS)
  const holds = await rows<{ id: string }>(pool, `SELECT id FROM holds WHERE (visitor = $1 OR user_id = $2) AND state = 'expired' AND created_at > $3 ORDER BY expires_at DESC LIMIT 10`, [visitor, user, since])
  for (const hold of holds) events.push({ name: 'hold.expired', data: { hold_id: hold.id }, target: null })
  const quotes = await rows<QuoteRow>(
    pool,
    `SELECT q.* FROM quotes q WHERE (q.visitor = $1 OR q.user_id = $2) AND (q.stale OR q.expires_at <= $3) AND q.created_at > $4
        AND NOT EXISTS (SELECT 1 FROM holds h WHERE h.quote_id = q.id AND h.state = 'converted') ORDER BY q.created_at DESC LIMIT 10`,
    [visitor, user, now, since],
  )
  for (const quote of quotes) events.push(await quoteChangedEvent(quote, quote.stale ? 'rate' : 'expired', now, null))
  return events
}

