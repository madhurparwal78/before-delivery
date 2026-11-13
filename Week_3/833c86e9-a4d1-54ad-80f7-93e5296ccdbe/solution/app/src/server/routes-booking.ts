import type { PoolClient } from 'pg'
import { span } from '../shared/dates'
import { CURRENCIES, type Currency } from '../shared/i18n'
import { config } from './config'
import { ApiError, fail, notFound, validation } from './errors'
import { one, pool, tx } from './db'
import { preferences, token } from './auth'
import { jsonBody, limit, needUser, needVisitor, noContent, route, send, sendText, type Ctx } from './http'
import { begin, remember, storeRefusal } from './idempotency'
import { buildQuote, currentRates, findQuote, ownsQuote, quoteFromRow, saveQuote, summarize, validateStay } from './quotes'
import { createHold, endHold, holdView, announceAvailability, type HoldRow } from './holds'
import { tierFor } from './loyalty'
import { applyChange, bookingView, canSee, cancelRooms, confirmHold, flush, loadRooms, loadRow, markNoShow, parseRoomList, planCancellation, planChange, type BookingRow, type Deferred, type PayInput } from './bookings'
import { cardFieldErrors, nameErrors, requireValid } from './payment'
import { repricedTotal } from './scheduler'
import { getProperty } from './catalog'
import { reviewAccess, submitReview, pendingReviews, moderate } from './reviews'
import { invoiceHtml, storageNotice } from './invoice'
import * as storage from './storage'

async function gate(ctx: Ctx, code: string): Promise<{ row: BookingRow; role: 'guest' | 'manager' }> {
  const row = await loadRow(pool, code)
  const role = row ? await canSee(pool, row, { visitor: ctx.identity.visitor, user: ctx.identity.user }) : null
  if (!row || !role) return notFound()
  return { row, role }
}

const etag = (version: number): string => `"${version}"`

export function registerBooking(): void {
  route('POST', '/api/quotes', async (ctx) => {
    const body = await jsonBody(ctx)
    const visitor = needVisitor(ctx)
    const stay = validateStay(body)
    const user = ctx.identity.user?.id ?? null
    const quoteId = token(12)
    const saved = await tx(async (client) => {
      if (body.hold_id !== undefined) await ownLiveHold(client, body.hold_id, visitor, user, ctx.now)
      const tier = await tierFor(client, user, ctx.now)
      const built = await buildQuote(client, { property: String(body.property), ...stay, rooms: body.rooms, adults: body.adults, ages: body.ages, holdId: typeof body.hold_id === 'string' ? body.hold_id : null }, tier, await currentRates(client), ctx.now, { visitor, user })
      const holdId = typeof body.hold_id === 'string' ? body.hold_id : null
      const quote = await saveQuote(client, built, { visitor, user }, tier.pct, ctx.now, config.quoteTtlMs, quoteId, holdId)
      if (holdId) {
        await client.query(`UPDATE holds SET quote_id = $2 WHERE id = $1`, [holdId, quoteId])
      }
      return quote
    })
    send(ctx.res, 201, saved)
  })

  route('POST', '/api/quotes/preview', async (ctx) => {
    const body = await jsonBody(ctx)
    const stay = validateStay(body)
    const user = ctx.identity.user?.id ?? null
    const tier = await tierFor(pool, user, ctx.now)
    const built = await buildQuote(pool, { property: String(body.property), ...stay, rooms: body.rooms, adults: body.adults, ages: body.ages }, tier, await currentRates(pool), ctx.now, { visitor: ctx.identity.visitor, user }, true)
    send(ctx.res, 200, { ...built.quote, restriction: built.restriction })
  })

  route('GET', '/api/quotes/:id', async (ctx) => {
    const row = await findQuote(pool, ctx.params.id)
    if (!row || !ownsQuote(row, ctx.identity.visitor, ctx.identity.user?.id ?? null)) return notFound()
    const display = ctx.query.get('cur')
    send(ctx.res, 200, await quoteFromRow(pool, row, ctx.now, display && (CURRENCIES as readonly string[]).includes(display) ? (display as Currency) : row.currency))
  })

  route('POST', '/api/holds', async (ctx) => {
    const body = await jsonBody(ctx)
    const visitor = needVisitor(ctx)
    const row = typeof body.quote_id === 'string' ? await findQuote(pool, body.quote_id) : undefined
    if (!row || !ownsQuote(row, visitor, ctx.identity.user?.id ?? null)) return notFound()
    const result = await tx(async (client) => {
      const made = await createHold(client, row, ctx.now)
      return { ...made, rooms: row.rooms }
    })
    if (result.created) await announceAvailability(row.property, row.rooms.map((room) => room.room_type), span(row.in_date, row.out_date))
    send(ctx.res, 201, holdView(result.hold, result.rooms))
  })

  route('DELETE', '/api/holds/:id', async (ctx) => {
    const hold = await one<HoldRow>(pool, `SELECT * FROM holds WHERE id = $1`, [ctx.params.id])
    if (!hold || !(hold.visitor === ctx.identity.visitor || (ctx.identity.user && hold.user_id === ctx.identity.user.id))) return notFound()
    const freed = await tx((client) => endHold(client, hold.id, 'released'))
    if (freed) await announceAvailability(freed.property, freed.roomTypes, freed.dates)
    noContent(ctx.res)
  })

  route('POST', '/api/bookings', async (ctx) => {
    const body = await jsonBody(ctx)
    const visitor = needVisitor(ctx)
    const user = ctx.identity.user?.id ?? null
    const key = ctx.req.headers['idempotency-key'] as string | undefined
    const scope = `bookings|${visitor}`
    try {
      const reply = await tx(async (client): Promise<{ status: number; body: unknown; replayed?: boolean }> => {
        const hold = typeof body.hold_id === 'string' ? await one<HoldRow>(client, `SELECT * FROM holds WHERE id = $1 FOR UPDATE`, [body.hold_id]) : undefined
        const quote = typeof body.quote_id === 'string' ? await findQuote(client, body.quote_id) : undefined
        if (!hold || !quote || !ownsQuote(hold, visitor, user) || !ownsQuote(quote, visitor, user) || hold.quote_id !== quote.id) return notFound()
        const stored = await begin(client, scope, key, body, ctx.now)
        if (stored) return { ...stored, replayed: true }
        if (hold.state === 'converted') return fail(409, 'invalid_state')
        if (hold.state !== 'live' || hold.expires_at <= ctx.now) return fail(410, 'hold_expired')
        if (quote.stale || quote.expires_at <= ctx.now) {
          const old = summarize(quote.rooms, quote.in_date, quote.out_date, quote.currency, quote.rates).converted_total_minor
          return fail(409, 'price_changed', { old_total_minor: old, new_total_minor: await repricedTotal(quote, ctx.now) })
        }
        const fields = { ...nameErrors(body), ...cardFieldErrors(body), ...(key ? {} : { 'Idempotency-Key': 'required' }) }
        requireValid(fields)
        const payment: PayInput = { given_name: String(body.given_name), surname: String(body.surname), card_number: body.card_number, expiry: body.expiry, security_code: body.security_code, step_up_code: body.step_up_code }
        const code = await confirmHold(client, hold, quote, payment, ctx.now, { visitor, user })
        const view = await bookingView(client, code, ctx.now)
        await remember(client, scope, key, body, 201, view, ctx.now)
        return { status: 201, body: view }
      })
      send(ctx.res, reply.replayed && reply.status === 201 ? 200 : reply.status, reply.body)
    } catch (error) {
      if (error instanceof ApiError && error.status === 402) await storeRefusal(scope, key, body, error, ctx.now)
      throw error
    }
  })

  route('POST', '/api/bookings/find', async (ctx) => {
    const body = await jsonBody(ctx)
    const visitor = needVisitor(ctx)
    limit('lookup', visitor, config.lookupRate)
    const row = typeof body.code === 'string' ? await loadRow(pool, body.code.trim()) : undefined
    if (!row || typeof body.surname !== 'string' || row.surname.trim().toLowerCase() !== body.surname.trim().toLowerCase()) return notFound()
    await pool.query(`INSERT INTO booking_access (booking, visitor) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [row.code, visitor])
    send(ctx.res, 200, { code: row.code })
  })

  route('GET', '/api/bookings/:code', async (ctx) => {
    const { row } = await gate(ctx, ctx.params.code)
    const view = await bookingView(pool, row.code, ctx.now)
    send(ctx.res, 200, view, { etag: etag(view.version) })
  })

  route('GET', '/api/bookings/:code/cancellations/preview', async (ctx) => {
    const { row } = await gate(ctx, ctx.params.code)
    const property = (await getProperty(pool, row.property))!
    const plan = await planCancellation(row, property, await loadRooms(pool, row.code), parseRoomList(ctx.query.get('rooms') ?? undefined), ctx.now)
    send(ctx.res, 200, { refund_minor: plan.refund, refund_pct: plan.pct })
  })

  route('POST', '/api/bookings/:code/cancellations', async (ctx) => {
    const body = await jsonBody(ctx)
    const { row } = await gate(ctx, ctx.params.code)
    const after: Deferred = []
    const refund = await tx((client) => cancelRooms(client, row.code, body, ctx.req.headers['if-match'] as string | undefined, ctx.now, after))
    await flush(after)
    send(ctx.res, 201, { refund_minor: refund.refund, booking: await bookingView(pool, row.code, ctx.now) })
  })

  route('POST', '/api/bookings/:code/changes/preview', async (ctx) => {
    const body = await jsonBody(ctx)
    const { row } = await gate(ctx, ctx.params.code)
    const property = (await getProperty(pool, row.property))!
    const plan = await tx((client) => planChange(client, row, property, body, ctx.now))
    send(ctx.res, 200, { new_total_minor: plan.newTotal, paid_minor: plan.paid, ...(plan.newTotal >= plan.paid ? { pay_minor: plan.pay } : { refund_minor: plan.refund }) })
  })

  route('POST', '/api/bookings/:code/changes', async (ctx) => {
    const body = await jsonBody(ctx)
    const { row } = await gate(ctx, ctx.params.code)
    const visitor = needVisitor(ctx)
    const key = ctx.req.headers['idempotency-key'] as string | undefined
    const scope = `changes|${row.code}|${visitor}`
    const after: Deferred = []
    try {
      const reply = await tx(async (client): Promise<{ status: number; body: unknown }> => {
        const stored = await begin(client, scope, key, body, ctx.now)
        if (stored) return stored
        if (!key) validation({ 'Idempotency-Key': 'required' })
        await applyChange(client, row.code, body, ctx.req.headers['if-match'] as string | undefined, ctx.now, after)
        const view = await bookingView(client, row.code, ctx.now)
        await remember(client, scope, key, body, 200, view, ctx.now)
        return { status: 200, body: view }
      })
      await flush(after)
      send(ctx.res, reply.status, reply.body)
    } catch (error) {
      if (error instanceof ApiError && error.status === 402) await storeRefusal(scope, key, body, error, ctx.now)
      throw error
    }
  })

  route('POST', '/api/bookings/:code/no-show', async (ctx) => {
    const { row, role } = await gate(ctx, ctx.params.code)
    if (role !== 'manager') return fail(403, 'forbidden')
    await tx((client) => markNoShow(client, row.code, ctx.req.headers['if-match'] as string | undefined, ctx.now))
    send(ctx.res, 200, await bookingView(pool, row.code, ctx.now))
  })

  route('GET', '/bookings/:code/invoice', async (ctx) => {
    const { row } = await gate(ctx, ctx.params.code)
    const prefs = await preferences(ctx.identity)
    try {
      const key = `invoices/${row.code}.html`
      const fresh = await one<{ ledger_seq: number; invoice_seq: number }>(pool, `SELECT ledger_seq, invoice_seq FROM bookings WHERE code = $1`, [row.code])
      let body = fresh && fresh.ledger_seq === fresh.invoice_seq ? await storage.get(key) : null
      if (!body) {
        const view = await bookingView(pool, row.code, ctx.now)
        await storage.put(key, invoiceHtml(view, prefs.lang), 'text/html; charset=utf-8')
        await pool.query(`UPDATE bookings SET invoice_seq = $2 WHERE code = $1`, [row.code, fresh?.ledger_seq])
        body = await storage.get(key)
      }
      sendText(ctx.res, 200, 'text/html; charset=utf-8', body as Buffer)
    } catch (error) {
      if (error instanceof storage.StorageUnavailable) return sendText(ctx.res, 503, 'text/html; charset=utf-8', storageNotice(prefs.lang))
      throw error
    }
  })

  route('GET', '/api/reviews/:token', async (ctx) => {
    const access = await reviewAccess(pool, ctx.params.token, ctx.now)
    send(ctx.res, 200, { property: access.propertyName, in: access.booking.in_date, out: access.booking.out_date, open_until: access.openUntil.toISOString() })
  })

  route('POST', '/api/reviews/:token', async (ctx) => {
    const body = await jsonBody(ctx)
    send(ctx.res, 201, await submitReview(ctx.params.token, body, ctx.now))
  })

  route('GET', '/api/moderation/reviews', async (ctx) => {
    const user = needUser(ctx)
    if (user.role !== 'operator') return fail(403, 'forbidden')
    send(ctx.res, 200, await pendingReviews(pool))
  })

  for (const [action, state] of [['publish', 'published'], ['reject', 'rejected']] as const) {
    route('POST', `/api/moderation/reviews/:id/${action}`, async (ctx) => {
      const user = needUser(ctx)
      const found = await one(pool, `SELECT 1 FROM reviews WHERE id = $1`, [ctx.params.id])
      if (!found) return notFound()
      if (user.role !== 'operator') return fail(403, 'forbidden')
      send(ctx.res, 200, await moderate(ctx.params.id, state))
    })
  }
}

async function ownLiveHold(client: PoolClient, holdId: unknown, visitor: string, user: number | null, now: Date): Promise<void> {
  const hold = typeof holdId === 'string' ? await one<HoldRow>(client, `SELECT * FROM holds WHERE id = $1`, [holdId]) : undefined
  if (!hold || !ownsQuote(hold, visitor, user)) return notFound()
  if (hold.state !== 'live' || hold.expires_at <= now) return fail(410, 'hold_expired')
}
