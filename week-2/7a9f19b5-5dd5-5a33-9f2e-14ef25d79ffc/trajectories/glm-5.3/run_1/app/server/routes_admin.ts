/** Admin endpoints: trade applications, orders, stock, service health. */
import { route, type RouteContext } from './router.js'
import { ApiError, send_json } from './http.js'
import { order_view, due_date_from, type OrderRow } from './orders.js'
import { adjust_units, StockBelowZero } from './stock.js'
import { begin_idempotent, store_reply, clear_idempotent, release_idempotent, RequestInProgress, IdempotencyConflict, IdempotencyKeyRequired } from './idempotency.js'
import {
  kb_capture, kb_refund, kb_create_invoice, kb_record_payment, kb_get_account, kb_create_account,
  kb_add_payment_method, KbPaymentUnavailable,
} from './killbill.js'
import { trade_approved_email, trade_declined_email } from './mail.js'
import {
  probe_postgres as probe_pg, probe_killbill as probe_kb, probe_smtp, probe_minio as probe_s3,
  probe_pocketbase as probe_pb,
} from './probes.js'

const ORDER_COLUMNS = `SELECT id, order_key, user_id, status, payment_method, price_tier, purchase_order, card_last4,
  subtotal_cents, gst_cents, total_cents, captured_cents, refunded_cents, kb_payment_id,
  kb_invoice_id, invoice_number, invoice_date, due_date, created_at`

function require_admin(ctx: RouteContext): void {
  if (!ctx.caller) throw new ApiError(401, 'unauthenticated')
  if (!ctx.caller.is_admin()) throw new ApiError(403, 'forbidden')
}

async function order_for_admin(ctx: RouteContext, key: string): Promise<OrderRow> {
  const row = await ctx.client.query<OrderRow>(
    `${ORDER_COLUMNS} FROM orders WHERE order_key=$1`,
    [key],
  )
  if (row.rows.length === 0) throw new ApiError(404, 'not_found')
  return row.rows[0]
}

function idempotency_key(ctx: RouteContext): string | undefined {
  const value = ctx.req.headers['idempotency-key']
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0]
  return undefined
}

async function load_order(ctx: RouteContext, id: number): Promise<OrderRow> {
  const row = await ctx.client.query<OrderRow>(`${ORDER_COLUMNS} FROM orders WHERE id=$1`, [id])
  return row.rows[0]!
}

export function admin_routes(api: Parameters<typeof route>[0]): void {
  route(api, 'GET', '/api/admin/trade-applications', async (ctx: RouteContext) => {
    require_admin(ctx)
    const status = ctx.url.searchParams.get('status')
    const rows = await ctx.client.query(
      `SELECT a.id, u.name AS applicant_name, u.email AS applicant_email, a.business_name, a.nzbn, a.occupation,
              a.status, a.submitted_at, a.decided_at, a.decline_reason
       FROM trade_applications a JOIN users u ON u.id=a.user_id
       ${status ? 'WHERE a.status=$1' : ''} ORDER BY a.id`,
      status ? [status] : [],
    )
    send_json(ctx.res, 200, {
      applications: rows.rows.map((r) => ({
        id: r.id,
        applicant_name: r.applicant_name,
        applicant_email: r.applicant_email,
        business_name: r.business_name,
        nzbn: r.nzbn,
        occupation: r.occupation,
        status: r.status,
        submitted_at: r.submitted_at.toISOString(),
        decided_at: r.decided_at ? r.decided_at.toISOString() : null,
        decline_reason: r.decline_reason,
      })),
    })
  })

  for (const decision of ['approve', 'decline'] as const) {
    route(api, 'POST', `/api/admin/trade-applications/:id/${decision}`, async (ctx: RouteContext) => {
      require_admin(ctx)
      const id = Number(ctx.params['id'])
      const reason = decision === 'decline' ? (ctx.body)['reason'] : undefined
      if (decision === 'decline') {
        if (typeof reason !== 'string' || reason.trim().length < 1 || reason.length > 500) {
          throw new ApiError(422, 'validation_failed', { reason: 'out_of_range' })
        }
      }
      const row = await ctx.client.query(
        'SELECT a.status, u.email, u.name FROM trade_applications a JOIN users u ON u.id=a.user_id WHERE a.id=$1',
        [id],
      )
      if (row.rows.length === 0) throw new ApiError(404, 'not_found')
      const app = row.rows[0]
      if (app.status !== 'submitted') {
        throw new ApiError(409, 'invalid_state', undefined)
      }
      const new_status = decision === 'approve' ? 'approved' : 'declined'
      await ctx.client.query(
        `UPDATE trade_applications SET status=$1, decided_at=now(), decline_reason=$2 WHERE id=$3`,
        [new_status, decision === 'decline' ? (reason as string) : null, id],
      )
      await ctx.client.query(`UPDATE users SET trade_status=$1 WHERE email=$2`, [new_status, app.email])
      const email = decision === 'approve' ? trade_approved_email(app.name) : trade_declined_email(app.name, reason as string)
      try {
        await ctx.api.deps.mailer.send(app.email, email.subject, email.text, email.html)
      } catch {
        // Mail outage: the decision stands; the notice is retried manually.
      }
      const result = await ctx.client.query(
        `SELECT a.id, u.name AS applicant_name, u.email AS applicant_email, a.business_name, a.nzbn, a.occupation,
                a.status, a.submitted_at, a.decided_at, a.decline_reason
         FROM trade_applications a JOIN users u ON u.id=a.user_id WHERE a.id=$1`,
        [id],
      )
      const r = result.rows[0]
      send_json(ctx.res, 200, {
        application: {
          id: r.id,
          applicant_name: r.applicant_name,
          applicant_email: r.applicant_email,
          business_name: r.business_name,
          nzbn: r.nzbn,
          occupation: r.occupation,
          status: r.status,
          submitted_at: r.submitted_at.toISOString(),
          decided_at: r.decided_at ? r.decided_at.toISOString() : null,
          decline_reason: r.decline_reason,
        },
      })
    })
  }

  route(api, 'GET', '/api/admin/orders', async (ctx: RouteContext) => {
    require_admin(ctx)
    const rows = await ctx.client.query<OrderRow>(
      `${ORDER_COLUMNS} FROM orders WHERE status NOT IN ('cart','declined','gateway_unavailable') ORDER BY created_at DESC`,
    )
    const orders = []
    for (const row of rows.rows) {
      const view = await order_view(ctx.client, row, ctx.api.today())
      const customer = await ctx.client.query<{ email: string }>('SELECT email FROM users WHERE id=$1', [row.user_id])
      orders.push({ ...view, customer_email: customer.rows[0]!.email })
    }
    send_json(ctx.res, 200, { orders })
  })

  route(api, 'POST', '/api/admin/orders/:orderKey/dispatch', async (ctx: RouteContext) => {
    require_admin(ctx)
    const order = await order_for_admin(ctx, ctx.params['orderKey']!)
    if (order.status !== 'authorised' && order.status !== 'placed') {
      throw new ApiError(409, 'invalid_state', undefined)
    }
    try {
      if (order.status === 'authorised') {
        await kb_capture_with_account(ctx, order)
      } else {
        await invoice_account_order(ctx, order)
      }
    } catch (err) {
      if (err instanceof KbPaymentUnavailable) {
        send_json(ctx.res, 503, { error: 'payment_unavailable' })
        return
      }
      throw err
    }
    const fresh = await load_order(ctx, order.id)
    send_json(ctx.res, 200, { order: await order_view(ctx.client, fresh, ctx.api.today()) })
  })

  route(api, 'POST', '/api/admin/orders/:orderKey/refunds', async (ctx: RouteContext) => {
    require_admin(ctx)
    const key = idempotency_key(ctx)
    const body = ctx.body
    const endpoint = 'refund'
    try {
      const stored = await begin_idempotent(ctx.client, ctx.caller!.id, endpoint, key, JSON.stringify(body))
      if (stored && !stored.in_progress) {
        send_json(ctx.res, stored.status!, stored.body as unknown as Record<string, unknown>)
        return
      }
      const order = await order_for_admin(ctx, ctx.params['orderKey']!)
      const amount_cents = typeof body['amount_cents'] === 'number' ? body['amount_cents'] : NaN
      const reason = typeof body['reason'] === 'string' ? body['reason'] : ''
      const errors: Record<string, string> = {}
      if (!Number.isInteger(amount_cents) || amount_cents < 1) errors['amount_cents'] = 'out_of_range'
      if (reason.trim().length < 1 || reason.length > 200) errors['reason'] = 'out_of_range'
      const refundable = (order.captured_cents ?? 0) - order.refunded_cents
      if (refundable <= 0) errors['amount_cents'] = 'exceeds_refundable'
      else if (amount_cents > refundable) errors['amount_cents'] = 'exceeds_refundable'
      if (Object.keys(errors).length > 0) throw new ApiError(422, 'validation_failed', errors)
      if (order.status !== 'captured' && order.status !== 'partially_refunded') {
        throw new ApiError(409, 'invalid_state', undefined)
      }
      const n = await next_refund_n(ctx, order)
      try {
        const txn = await kb_refund(order.kb_payment_id!, order.order_key, n, amount_cents)
        const insert = await ctx.client.query<{ id: number }>(
          `INSERT INTO refunds (order_id, amount_cents, reason, kb_transaction_id) VALUES ($1,$2,$3,$4) RETURNING id`,
          [order.id, amount_cents, reason, txn],
        )
        const refunded = order.refunded_cents + amount_cents
        const status = refunded >= (order.captured_cents ?? 0) ? 'refunded' : 'partially_refunded'
        await ctx.client.query('UPDATE orders SET refunded_cents=$1, status=$2, updated_at=now() WHERE id=$3', [
          refunded,
          status,
          order.id,
        ])
        const fresh = await load_order(ctx, order.id)
        const view = await order_view(ctx.client, fresh, ctx.api.today())
        const refund_row = await ctx.client.query(
          'SELECT id, amount_cents, reason, kb_transaction_id, created_at FROM refunds WHERE id=$1',
          [insert.rows[0]!.id],
        )
        const body_reply = {
          refund: {
            id: refund_row.rows[0].id,
            amount_cents: refund_row.rows[0].amount_cents,
            reason: refund_row.rows[0].reason,
            kb_transaction_id: refund_row.rows[0].kb_transaction_id,
            created_at: refund_row.rows[0].created_at.toISOString(),
          },
          order: view,
        }
        await store_reply(ctx.client, ctx.caller!.id, endpoint, key!, 201, body_reply)
        send_json(ctx.res, 201, body_reply)
      } catch (err) {
        if (err instanceof KbPaymentUnavailable) {
          await clear_idempotent(ctx.client, ctx.caller!.id, endpoint, key!)
          send_json(ctx.res, 503, { error: 'payment_unavailable' })
          return
        }
        throw err
      }
    } catch (err) {
      if (err instanceof IdempotencyKeyRequired) throw new ApiError(400, 'idempotency_key_required')
      if (err instanceof RequestInProgress) throw new ApiError(409, 'request_in_progress')
      if (err instanceof IdempotencyConflict) throw new ApiError(409, 'idempotency_conflict')
      throw err
    } finally {
      release_idempotent(ctx.caller!.id, endpoint, key)
    }
  })

  route(api, 'POST', '/api/admin/orders/:orderKey/record-payment', async (ctx: RouteContext) => {
    require_admin(ctx)
    const order = await order_for_admin(ctx, ctx.params['orderKey']!)
    const body = ctx.body
    const amount_cents = typeof body['amount_cents'] === 'number' ? body['amount_cents'] : NaN
    if (order.status !== 'invoiced') throw new ApiError(409, 'invalid_state', undefined)
    if (amount_cents !== order.total_cents) {
      throw new ApiError(422, 'validation_failed', { amount_cents: 'must_equal_balance' })
    }
    try {
      const key = `lf-user-${order.user_id}`
      const existing = await kb_get_account(key)
      const account_id = existing ? existing.accountId : await kb_create_account(key, await buyer_name(ctx, order))
      await kb_record_payment(account_id, order.kb_invoice_id!, order.order_key, amount_cents)
    } catch (err) {
      if (err instanceof KbPaymentUnavailable) {
        send_json(ctx.res, 503, { error: 'payment_unavailable' })
        return
      }
      throw err
    }
    await ctx.client.query(`UPDATE orders SET status='paid', updated_at=now() WHERE id=$1`, [order.id])
    const fresh = await load_order(ctx, order.id)
    send_json(ctx.res, 200, { order: await order_view(ctx.client, fresh, ctx.api.today()) })
  })

  route(api, 'GET', '/api/admin/stock', async (ctx: RouteContext) => {
    require_admin(ctx)
    const items = await ctx.client.query(
      `SELECT v.id, v.code AS variant_code, p.name AS product_name, v.clearance_price_cents, v.stock_on_hand
       FROM variants v JOIN products p ON p.id=v.product_id WHERE v.clearance=true ORDER BY v.id`,
    )
    const out = []
    for (const item of items.rows) {
      const movements = await ctx.client.query(
        `SELECT delta, reason, order_key, note, created_at FROM stock_movements WHERE variant_id=$1 ORDER BY id`,
        [item.id],
      )
      out.push({
        variant_code: item.variant_code,
        product_name: item.product_name,
        clearance_price_cents: item.clearance_price_cents,
        stock_on_hand: item.stock_on_hand,
        movements: movements.rows.map((m) => ({
          delta: m.delta,
          reason: m.reason,
          order_key: m.order_key,
          note: m.note,
          created_at: m.created_at.toISOString(),
        })),
      })
    }
    send_json(ctx.res, 200, { items: out })
  })

  route(api, 'PATCH', '/api/admin/variants/:code', async (ctx: RouteContext) => {
    require_admin(ctx)
    const body = ctx.body
    const variant = await ctx.client.query<{ id: number; clearance: boolean; stock_on_hand: number }>(
      'SELECT id, clearance, stock_on_hand FROM variants WHERE code=$1',
      [ctx.params['code']!],
    )
    if (variant.rows.length === 0) throw new ApiError(404, 'not_found')
    const v = variant.rows[0]
    if (body['stock_adjust'] !== undefined) {
      const delta = body['stock_adjust']
      if (typeof delta !== 'number' || !Number.isInteger(delta)) {
        throw new ApiError(422, 'validation_failed', { stock_adjust: 'invalid' })
      }
      const note = typeof body['note'] === 'string' ? body['note'] : null
      try {
        const stock = await adjust_units(ctx.client, v.id, delta, note)
        const fresh = await ctx.client.query(
          `SELECT v.code AS variant_code, p.name AS product_name, v.clearance_price_cents, v.stock_on_hand FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=$1`,
          [v.id],
        )
        send_json(ctx.res, 200, { item: { ...fresh.rows[0], stock_on_hand: stock } })
        return
      } catch (err) {
        if (err instanceof StockBelowZero) throw new ApiError(409, 'stock_below_zero', undefined)
        throw err
      }
    }
    if (body['clearance_price_cents'] !== undefined) {
      const price = body['clearance_price_cents']
      if (price === null) {
        await ctx.client.query(`UPDATE variants SET clearance=false, clearance_price_cents=null WHERE id=$1`, [v.id])
      } else if (typeof price === 'number' && Number.isInteger(price)) {
        await ctx.client.query(`UPDATE variants SET clearance=true, clearance_price_cents=$1 WHERE id=$2`, [price, v.id])
      } else {
        throw new ApiError(422, 'validation_failed', { clearance_price_cents: 'invalid' })
      }
    }
    const fresh = await ctx.client.query(
      `SELECT v.code AS variant_code, p.name AS product_name, v.clearance_price_cents, v.stock_on_hand FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=$1`,
      [v.id],
    )
    send_json(ctx.res, 200, { item: fresh.rows[0] })
  })

  route(api, 'GET', '/api/admin/health', async (ctx: RouteContext) => {
    require_admin(ctx)
    const [postgres, killbill, mailpit, minio, pocketbase] = await Promise.all([
      probe_pg(),
      probe_kb(),
      probe_smtp(),
      probe_s3(),
      probe_pb(),
    ])
    send_json(ctx.res, 200, {
      services: {
        postgres: postgres ? 'up' : 'down',
        killbill: killbill ? 'up' : 'down',
        mailpit: mailpit ? 'up' : 'down',
        minio: minio ? 'up' : 'down',
        pocketbase: pocketbase ? 'up' : 'down',
      },
    })
  })
}

async function next_refund_n(ctx: RouteContext, order: OrderRow): Promise<number> {
  const row = await ctx.client.query<{ kb_next_refund_n: number }>(
    'SELECT kb_next_refund_n FROM orders WHERE id=$1',
    [order.id],
  )
  const n = row.rows[0]!.kb_next_refund_n
  await ctx.client.query('UPDATE orders SET kb_next_refund_n=kb_next_refund_n+1 WHERE id=$1', [order.id])
  return n
}

async function kb_capture_with_account(ctx: RouteContext, order: OrderRow): Promise<void> {
  const key = `lf-user-${order.user_id}`
  let account_id: string
  const existing = await kb_get_account(key)
  account_id = existing ? existing.accountId : await kb_create_account(key, await buyer_name(ctx, order))
  await kb_add_payment_method(account_id)
  await kb_capture(order.kb_payment_id!, order.order_key, order.total_cents!)
  await ctx.client.query(
    `UPDATE orders SET status='captured', captured_cents=$1, updated_at=now() WHERE id=$2`,
    [order.total_cents, order.id],
  )
}

async function invoice_account_order(ctx: RouteContext, order: OrderRow): Promise<void> {
  const key = `lf-user-${order.user_id}`
  const existing = await kb_get_account(key)
  const account_id = existing ? existing.accountId : await kb_create_account(key, await buyer_name(ctx, order))
  await kb_add_payment_method(account_id)
  const lines = await ctx.client.query(
    'SELECT v.code, l.quantity, l.line_total_cents FROM order_lines l JOIN variants v ON v.id=l.variant_id WHERE l.order_id=$1',
    [order.id],
  )
  const items = lines.rows.map((l) => ({
    description: `${l.code} x ${l.quantity}`,
    amount_cents: l.line_total_cents,
  }))
  items.push({ description: 'GST 15%', amount_cents: order.gst_cents! })
  const invoice = await kb_create_invoice(account_id, items)
  await ctx.client.query(
    `UPDATE orders SET status='invoiced', kb_invoice_id=$1, invoice_number=$2, invoice_date=$3, due_date=$4, updated_at=now() WHERE id=$5`,
    [invoice.invoiceId, invoice.invoiceNumber, invoice.invoiceDate, due_date_from(invoice.invoiceDate), order.id],
  )
}

async function buyer_name(ctx: RouteContext, order: OrderRow): Promise<string> {
  const user = await ctx.client.query<{ name: string }>('SELECT name FROM users WHERE id=$1', [order.user_id])
  return user.rows[0]!.name
}
