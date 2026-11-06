/** Checkout: card authorisation and monthly-account placement. */
import { route, type RouteContext } from './router.js'
import { ApiError, send_json } from './http.js'
import { assert_editable, fetch_order, MAX_QTY } from './routes_cart.js'
import {
  order_view, type OrderRow,
} from './orders.js'
import { reserve_units, release_units, InsufficientStock } from './stock.js'
import { begin_idempotent, store_reply, clear_idempotent, release_idempotent, RequestInProgress, IdempotencyConflict, IdempotencyKeyRequired } from './idempotency.js'
import { current_expiry } from './clock.js'
import {
  kb_create_account, kb_add_payment_method, kb_get_account, kb_authorise, kb_find_payment_by_key,
  is_declined_card, KbPaymentUnavailable,
} from './killbill.js'
import { order_confirmation_email } from './mail.js'

function luhn_valid(digits: string): boolean {
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i])
    if (alt) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

interface CardInput { number: string; expiry: string; cvc: string; name: string }
interface DeliveryInput { name: string; address: string; city: string; postcode: string }

function read_card(body: Record<string, unknown>): CardInput {
  const card = (body['card'] ?? {}) as Record<string, unknown>
  return {
    number: typeof card['number'] === 'string' ? card['number'].replace(/\s+/g, '') : '',
    expiry: typeof card['expiry'] === 'string' ? card['expiry'] : '',
    cvc: typeof card['cvc'] === 'string' ? card['cvc'] : '',
    name: typeof card['name'] === 'string' ? card['name'] : '',
  }
}

function read_delivery(body: Record<string, unknown>): DeliveryInput {
  const delivery = (body['delivery'] ?? {}) as Record<string, unknown>
  return {
    name: typeof delivery['name'] === 'string' ? delivery['name'] : '',
    address: typeof delivery['address'] === 'string' ? delivery['address'] : '',
    city: typeof delivery['city'] === 'string' ? delivery['city'] : '',
    postcode: typeof delivery['postcode'] === 'string' ? delivery['postcode'] : '',
  }
}

function validate_card(card: CardInput): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!/^\d{16}$/.test(card.number) || !luhn_valid(card.number)) errors['card.number'] = 'invalid'
  const expiry_m = /^(\d{2})\/(\d{2})$/.exec(card.expiry)
  const now = current_expiry()
  if (!expiry_m) {
    errors['card.expiry'] = 'invalid'
  } else {
    const month = Number(expiry_m[1])
    const year = 2000 + Number(expiry_m[2])
    if (month < 1 || month > 12) errors['card.expiry'] = 'invalid'
    else if (year < now.year || (year === now.year && month < now.month)) errors['card.expiry'] = 'invalid'
  }
  if (!/^\d{3}$/.test(card.cvc)) errors['card.cvc'] = 'invalid'
  if (card.name.trim() === '') errors['card.name'] = 'required'
  return errors
}

function validate_delivery(delivery: DeliveryInput): Record<string, string> {
  const errors: Record<string, string> = {}
  if (delivery.name.trim() === '') errors['delivery.name'] = 'required'
  if (delivery.address.trim() === '') errors['delivery.address'] = 'required'
  if (delivery.city.trim() === '') errors['delivery.city'] = 'required'
  if (!/^\d{4}$/.test(delivery.postcode)) errors['delivery.postcode'] = 'invalid'
  return errors
}

/** Kill Bill account for the buyer: created on first need, reused afterwards. */
async function buyer_kb_account(user_id: number, name: string): Promise<string> {
  const key = `lf-user-${user_id}`
  const existing = await kb_get_account(key)
  if (existing) return existing.accountId
  return await kb_create_account(key, name)
}

export function checkout_routes(api: Parameters<typeof route>[0]): void {
  route(api, 'POST', '/api/orders/:orderKey/authorise', async (ctx: RouteContext) => {
    if (!ctx.caller) throw new ApiError(401, 'unauthenticated')
    const idempotency_key = header(ctx.req, 'idempotency-key')
    const body = ctx.body
    const endpoint = 'authorise'
    try {
      const fingerprint = JSON.stringify(body)
      const stored = await begin_idempotent(ctx.client, ctx.caller.id, endpoint, idempotency_key, fingerprint)
      if (stored && !stored.in_progress) {
        send_json(ctx.res, stored.status!, stored.body as unknown as Record<string, unknown>)
        return
      }
      const order = await order_by_key(ctx, ctx.params['orderKey']!)
      const card = read_card(body)
      const delivery = read_delivery(body)
      const field_errors = { ...validate_card(card), ...validate_delivery(delivery) }
      if (Object.keys(field_errors).length > 0) {
        throw new ApiError(422, 'validation_failed', field_errors)
      }
      assert_editable(order)
      const lines = await load_lines(ctx, order.id)
      if (lines.length === 0) throw new ApiError(409, 'empty_cart')

      let declined = false
      let payment_id = ''
      let kb_error = false
      // Reserve clearance units before any Kill Bill call, atomically against stock.
      await reserve_for_order(ctx, order)
      // Look for an existing successful authorisation (for example after a timeout).
      let existing: Awaited<ReturnType<typeof kb_find_payment_by_key>> = null
      try {
        existing = await kb_find_payment_by_key(order.order_key)
      } catch {
        existing = null
      }
      const already_authorised = existing?.transactions.find((t) => t.status === 'SUCCESS' && t.transactionType === 'AUTHORIZE')

      if (already_authorised) {
        payment_id = existing!.paymentId
      } else {
        try {
          const account_id = await buyer_kb_account(ctx.caller.id, ctx.caller.name)
          const payment_method = await kb_add_payment_method(account_id)
          const result = await kb_authorise_with_method(account_id, payment_method, order.order_key, order.total_cents!, card.number)
          declined = result.declined
          payment_id = result.paymentId
        } catch (err) {
          if (err instanceof KbPaymentUnavailable) {
            kb_error = true
          } else {
            throw err
          }
        }
      }

      if (kb_error) {
        await ctx.client.query(`UPDATE orders SET status='gateway_unavailable' WHERE id=$1`, [order.id])
        await release_reserved(ctx, order)
        const fresh = await fetch_order(ctx.client, order.id)
        const view = await order_view(ctx.client, fresh, ctx.api.today())
        await clear_idempotent(ctx.client, ctx.caller.id, endpoint, idempotency_key!)
        send_json(ctx.res, 503, { error: 'payment_unavailable' }, { order: view })
        return
      }

      if (declined) {
        await ctx.client.query(`UPDATE orders SET status='declined', card_last4=$1 WHERE id=$2`, [card.number.slice(-4), order.id])
        await release_reserved(ctx, order)
        const fresh = await fetch_order(ctx.client, order.id)
        const view = await order_view(ctx.client, fresh, ctx.api.today())
        await store_reply(ctx.client, ctx.caller.id, endpoint, idempotency_key!, 402, { error: 'card_declined', order: view })
        send_json(ctx.res, 402, { error: 'card_declined' }, { order: view })
        return
      }

      // Authorised: freeze the cart.
      await ctx.client.query(
        `UPDATE orders SET status='authorised', payment_method='card', card_last4=$1,
         delivery_name=$2, delivery_address=$3, delivery_city=$4, delivery_postcode=$5, kb_payment_id=$6
         WHERE id=$7`,
        [card.number.slice(-4), delivery.name, delivery.address, delivery.city, delivery.postcode, payment_id, order.id],
      )
      const fresh = await fetch_order(ctx.client, order.id)
      const view = await order_view(ctx.client, fresh, ctx.api.today())
      await store_reply(ctx.client, ctx.caller.id, endpoint, idempotency_key!, 200, { order: view })
      await send_confirmation(ctx, fresh)
      send_json(ctx.res, 200, { order: view })
    } catch (err) {
      if (err instanceof IdempotencyKeyRequired) throw new ApiError(400, 'idempotency_key_required')
      if (err instanceof RequestInProgress) throw new ApiError(409, 'request_in_progress')
      if (err instanceof IdempotencyConflict) throw new ApiError(409, 'idempotency_conflict')
      if (err instanceof SoldOut) {
        send_json(ctx.res, 409, { error: 'insufficient_stock' }, { available: err.available })
        return
      }
      throw err
    } finally {
      release_idempotent(ctx.caller!.id, endpoint, idempotency_key)
    }
  })

  route(api, 'POST', '/api/orders/:orderKey/place-on-account', async (ctx: RouteContext) => {
    if (!ctx.caller) throw new ApiError(401, 'unauthenticated')
    if (!ctx.caller.is_approved_trade()) throw new ApiError(403, 'trade_account_required')
    const idempotency_key = header(ctx.req, 'idempotency-key')
    const body = ctx.body
    const endpoint = 'place-on-account'
    try {
      const stored = await begin_idempotent(ctx.client, ctx.caller.id, endpoint, idempotency_key, JSON.stringify(body))
      if (stored && !stored.in_progress) {
        send_json(ctx.res, stored.status!, stored.body as unknown as Record<string, unknown>)
        return
      }
      const order = await order_by_key(ctx, ctx.params['orderKey']!)
      assert_editable(order)
      const delivery = read_delivery(body)
      const field_errors = validate_delivery(delivery)
      const purchase_order = typeof body['purchase_order'] === 'string' ? body['purchase_order'] : ''
      if (purchase_order.length > 40) field_errors['purchase_order'] = 'too_long'
      if (Object.keys(field_errors).length > 0) throw new ApiError(422, 'validation_failed', field_errors)
      const lines = await load_lines(ctx, order.id)
      if (lines.length === 0) throw new ApiError(409, 'empty_cart')
      await reserve_for_order(ctx, order)
      await ctx.client.query(
        `UPDATE orders SET status='placed', payment_method='account', purchase_order=$1,
         delivery_name=$2, delivery_address=$3, delivery_city=$4, delivery_postcode=$5
         WHERE id=$6`,
        [purchase_order || null, delivery.name, delivery.address, delivery.city, delivery.postcode, order.id],
      )
      const fresh = await fetch_order(ctx.client, order.id)
      const view = await order_view(ctx.client, fresh, ctx.api.today())
      await store_reply(ctx.client, ctx.caller.id, endpoint, idempotency_key!, 200, { order: view })
      await send_confirmation(ctx, fresh)
      send_json(ctx.res, 200, { order: view })
    } catch (err) {
      if (err instanceof IdempotencyKeyRequired) throw new ApiError(400, 'idempotency_key_required')
      if (err instanceof RequestInProgress) throw new ApiError(409, 'request_in_progress')
      if (err instanceof IdempotencyConflict) throw new ApiError(409, 'idempotency_conflict')
      if (err instanceof SoldOut) {
        send_json(ctx.res, 409, { error: 'insufficient_stock' }, { available: err.available })
        return
      }
      throw err
    } finally {
      release_idempotent(ctx.caller!.id, endpoint, idempotency_key)
    }
  })

  route(api, 'GET', '/api/orders', async (ctx: RouteContext) => {
    if (!ctx.caller) throw new ApiError(401, 'unauthenticated')
    const rows = await ctx.client.query<OrderRow>(
      `SELECT id, order_key, user_id, status, payment_method, price_tier, purchase_order, card_last4,
              subtotal_cents, gst_cents, total_cents, captured_cents, refunded_cents, kb_payment_id,
              kb_invoice_id, invoice_number, invoice_date, due_date, created_at
       FROM orders WHERE user_id=$1 AND status NOT IN ('cart','declined','gateway_unavailable')
       ORDER BY created_at DESC`,
      [ctx.caller.id],
    )
    const orders = []
    for (const row of rows.rows) {
      orders.push(await order_view(ctx.client, row, ctx.api.today()))
    }
    send_json(ctx.res, 200, { orders })
  })

  route(api, 'GET', '/api/orders/:orderKey', async (ctx: RouteContext) => {
    if (!ctx.caller) throw new ApiError(401, 'unauthenticated')
    const order = await order_by_key(ctx, ctx.params['orderKey']!, ctx.caller.is_admin() ? null : ctx.caller.id)
    send_json(ctx.res, 200, { order: await order_view(ctx.client, order, ctx.api.today()) })
  })
}

function header(req: RouteContext['req'], name: string): string | undefined {
  const value = req.headers[name]
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0]
  return undefined
}

async function order_by_key(ctx: RouteContext, key: string, owner_id: number | null = null): Promise<OrderRow> {
  const owner = owner_id ?? ctx.caller!.id
  const row = await ctx.client.query<OrderRow>(
    `SELECT id, order_key, user_id, status, payment_method, price_tier, purchase_order, card_last4,
            subtotal_cents, gst_cents, total_cents, captured_cents, refunded_cents, kb_payment_id,
            kb_invoice_id, invoice_number, invoice_date, due_date, created_at
     FROM orders WHERE order_key=$1 AND user_id=$2`,
    [key, owner],
  )
  if (row.rows.length === 0) throw new ApiError(404, 'not_found')
  return row.rows[0]
}

async function load_lines(ctx: RouteContext, order_id: number): Promise<{ variant_id: number; quantity: number }[]> {
  const rows = await ctx.client.query<{ variant_id: number; quantity: number }>(
    'SELECT variant_id, quantity FROM order_lines WHERE order_id=$1',
    [order_id],
  )
  return rows.rows
}

/** Reserve clearance units inside this transaction. Throws insufficient_stock. */
class SoldOut extends Error {
  constructor(public available: number) {
    super('insufficient_stock')
  }
}

async function reserve_for_order(ctx: RouteContext, order: OrderRow): Promise<void> {
  const lines = await load_lines(ctx, order.id)
  for (const line of lines) {
    const variant = await ctx.client.query<{ id: number; clearance: boolean; stock_on_hand: number }>(
      'SELECT id, clearance, stock_on_hand FROM variants WHERE id=$1',
      [line.variant_id],
    )
    const v = variant.rows[0]
    if (!v?.clearance) continue
    try {
      await reserve_units(ctx.client, v.id, line.quantity, order.order_key)
    } catch (err) {
      if (err instanceof InsufficientStock) throw new SoldOut(err.available)
      throw err
    }
  }
}

/** Release this order's sale movements (decline or provider outage). */
async function release_reserved(ctx: RouteContext, order: OrderRow): Promise<void> {
  const moves = await ctx.client.query<{ variant_id: number; delta: number }>(
    `SELECT variant_id, delta FROM stock_movements WHERE order_key=$1 AND reason='sale'`,
    [order.order_key],
  )
  for (const move of moves.rows) {
    await release_units(ctx.client, move.variant_id, -move.delta, order.order_key)
  }
}

async function send_confirmation(ctx: RouteContext, order: OrderRow): Promise<void> {
  const already = await ctx.client.query<{ confirmation_sent: boolean }>(
    'SELECT confirmation_sent FROM orders WHERE id=$1',
    [order.id],
  )
  if (already.rows[0]!.confirmation_sent) return
  const view = await order_view(ctx.client, order, ctx.api.today())
  const user = await ctx.client.query<{ email: string }>('SELECT email FROM users WHERE id=$1', [order.user_id])
  const email = order_confirmation_email(view)
  await ctx.api.deps.mailer.send(user.rows[0]!.email, email.subject, email.text, email.html)
  await ctx.client.query('UPDATE orders SET confirmation_sent=true WHERE id=$1', [order.id])
}

async function kb_authorise_with_method(
  account_id: string,
  _payment_method: string,
  order_key: string,
  total_cents: number,
  card_number: string,
): Promise<{ declined: boolean; paymentId: string }> {
  // The published decline card fails before any Kill Bill payment is created.
  if (is_declined_card(card_number)) {
    return { declined: true, paymentId: '' }
  }
  const result = await kb_authorise(account_id, order_key, total_cents)
  return { declined: result.declined, paymentId: result.paymentId }
}

export { buyer_kb_account, header, order_by_key, load_lines, reserve_for_order, release_reserved, send_confirmation, validate_delivery, MAX_QTY }
