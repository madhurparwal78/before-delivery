/** Cart endpoints. The cart is an order in an open state, repriced on every read. */
import { route, type RouteContext } from './router.js'
import { ApiError, send_json } from './http.js'
import { load_variant } from './catalogue.js'
import { InsufficientStock, reserve_units, release_units } from './stock.js'
import { reprice_cart, OPEN_STATES, new_order_key, order_view, unit_price, type OrderRow } from './orders.js'

const MAX_QTY = 999

async function open_order(ctx: RouteContext): Promise<OrderRow> {
  const caller = ctx.caller!
  const tier = caller.is_approved_trade() ? 'trade' : 'retail'
  const found = await ctx.client.query<OrderRow>(
    `SELECT id, order_key, user_id, status, payment_method, price_tier, purchase_order, card_last4,
            subtotal_cents, gst_cents, total_cents, captured_cents, refunded_cents, kb_payment_id,
            kb_invoice_id, invoice_number, invoice_date, due_date, created_at
     FROM orders WHERE user_id=$1 AND status IN ('cart','declined','gateway_unavailable') ORDER BY id DESC LIMIT 1`,
    [caller.id],
  )
  if (found.rows[0]) return found.rows[0]
  const created = await ctx.client.query<OrderRow>(
    `INSERT INTO orders (order_key, user_id, status, price_tier) VALUES ($1,$2,'cart',$3)
     RETURNING id, order_key, user_id, status, payment_method, price_tier, purchase_order, card_last4,
               subtotal_cents, gst_cents, total_cents, captured_cents, refunded_cents, kb_payment_id,
               kb_invoice_id, invoice_number, invoice_date, due_date, created_at`,
    [new_order_key(), caller.id, tier],
  )
  return created.rows[0]!
}

async function cart_reply(ctx: RouteContext): Promise<void> {
  const order = await open_order(ctx)
  await reprice_cart(ctx.client, order.id, order.price_tier as 'retail' | 'trade')
  const fresh = await fetch_order(ctx.client, order.id)
  send_json(ctx.res, 200, { order: await order_view(ctx.client, fresh, ctx.api.today()) })
}

async function fetch_order(client: RouteContext['client'], id: number): Promise<OrderRow> {
  const row = await client.query<OrderRow>(
    `SELECT id, order_key, user_id, status, payment_method, price_tier, purchase_order, card_last4,
            subtotal_cents, gst_cents, total_cents, captured_cents, refunded_cents, kb_payment_id,
            kb_invoice_id, invoice_number, invoice_date, due_date, created_at
     FROM orders WHERE id=$1`,
    [id],
  )
  return row.rows[0]!
}

/** Check the caller's cart is in an editable state. */
function assert_editable(order: OrderRow): void {
  if (!OPEN_STATES.includes(order.status)) {
    throw new ApiError(409, 'invalid_state', undefined)
  }
}

export function cart_routes(api: Parameters<typeof route>[0]): void {
  route(api, 'GET', '/api/cart', async (ctx: RouteContext) => {
    if (!ctx.caller) throw new ApiError(401, 'unauthenticated')
    await cart_reply(ctx)
  })

  route(api, 'POST', '/api/cart/lines', async (ctx: RouteContext) => {
    if (!ctx.caller) throw new ApiError(401, 'unauthenticated')
    const body = ctx.body
    const variant_code = typeof body['variant_code'] === 'string' ? body['variant_code'] : ''
    const quantity = typeof body['quantity'] === 'number' ? body['quantity'] : NaN
    if (variant_code === '') throw new ApiError(422, 'validation_failed', { variant_code: 'required' })
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      throw new ApiError(422, 'validation_failed', { quantity: 'out_of_range' })
    }
    const variant = await load_variant(ctx.client, variant_code)
    if (!variant) throw new ApiError(404, 'not_found')
    const order = await open_order(ctx)
    assert_editable(order)
    const tier = order.price_tier as 'retail' | 'trade'
    const existing = await ctx.client.query<{ id: number; quantity: number }>(
      `SELECT id, quantity FROM order_lines WHERE order_id=$1 AND variant_id=$2`,
      [order.id, variant.id],
    )
    const new_quantity = (existing.rows[0]?.quantity ?? 0) + quantity
    if (variant.clearance && new_quantity > variant.stock_on_hand) {
      throw new ApiError(409, 'insufficient_stock', undefined)
    }
    const unit = unit_price(tier, variant.retail_price_cents, variant.trade_price_cents)
    if (existing.rows[0]) {
      await ctx.client.query('UPDATE order_lines SET quantity=$1, line_total_cents=$2 WHERE id=$3', [
        new_quantity,
        unit * new_quantity,
        existing.rows[0].id,
      ])
    } else {
      const product = await ctx.client.query<{ name: string }>(
        'SELECT p.name FROM products p JOIN variants v ON v.product_id=p.id WHERE v.id=$1',
        [variant.id],
      )
      await ctx.client.query(
        `INSERT INTO order_lines (order_id, variant_id, product_name, quantity, unit_price_cents, line_total_cents)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [order.id, variant.id, product.rows[0]!.name, quantity, unit, unit * quantity],
      )
    }
    await cart_reply(ctx)
  })

  route(api, 'PATCH', '/api/cart/lines/:code', async (ctx: RouteContext) => {
    if (!ctx.caller) throw new ApiError(401, 'unauthenticated')
    const body = ctx.body
    const quantity = typeof body['quantity'] === 'number' ? body['quantity'] : NaN
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QTY) {
      throw new ApiError(422, 'validation_failed', { quantity: 'out_of_range' })
    }
    const variant = await load_variant(ctx.client, ctx.params['code']!)
    if (!variant) throw new ApiError(404, 'not_found')
    const order = await open_order(ctx)
    assert_editable(order)
    const line = await ctx.client.query<{ id: number; quantity: number }>(
      `SELECT id, quantity FROM order_lines WHERE order_id=$1 AND variant_id=$2`,
      [order.id, variant.id],
    )
    if (line.rows.length === 0) throw new ApiError(404, 'not_found')
    if (quantity === 0) {
      await ctx.client.query('DELETE FROM order_lines WHERE id=$1', [line.rows[0].id])
    } else {
      if (variant.clearance && quantity > variant.stock_on_hand) {
        throw new ApiError(409, 'insufficient_stock', undefined)
      }
      const tier = order.price_tier as 'retail' | 'trade'
      const unit = unit_price(tier, variant.retail_price_cents, variant.trade_price_cents)
      await ctx.client.query('UPDATE order_lines SET quantity=$1, unit_price_cents=$2, line_total_cents=$3 WHERE id=$4', [
        quantity,
        unit,
        unit * quantity,
        line.rows[0].id,
      ])
    }
    await cart_reply(ctx)
  })
}

export { open_order, cart_reply, assert_editable, fetch_order, MAX_QTY, InsufficientStock, reserve_units, release_units }
