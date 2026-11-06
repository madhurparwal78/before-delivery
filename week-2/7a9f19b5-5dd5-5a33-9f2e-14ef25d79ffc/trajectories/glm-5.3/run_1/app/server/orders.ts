/**
 * Order domain: state machine, totals, projections.
 */
import type { DbClient } from './db.js'
import { gst_cents } from './domain.js'

export const ORDER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function new_order_key(): string {
  let key = ''
  for (let i = 0; i < 8; i++) {
    key += ORDER_ALPHABET[Math.floor(Math.random() * ORDER_ALPHABET.length)]
  }
  return `LF-${key}`
}

export const CARD_STATES: Record<string, string[]> = {
  cart: ['authorised', 'declined', 'gateway_unavailable'],
  declined: ['authorised', 'declined', 'gateway_unavailable'],
  gateway_unavailable: ['authorised', 'declined', 'gateway_unavailable'],
  authorised: ['captured'],
  captured: ['partially_refunded', 'refunded'],
  partially_refunded: ['partially_refunded', 'refunded'],
}

export const ACCOUNT_STATES: Record<string, string[]> = {
  cart: ['placed'],
  placed: ['invoiced'],
  invoiced: ['paid'],
}

export function display_status(status: string, due_date: string | null, today: string): string {
  if (status === 'invoiced' && due_date && due_date < today) return 'Overdue'
  switch (status) {
    case 'cart': return 'Cart'
    case 'authorised': return 'Authorised'
    case 'captured': return 'Paid'
    case 'partially_refunded': return 'Partly refunded'
    case 'refunded': return 'Refunded'
    case 'declined': return 'Declined'
    case 'gateway_unavailable': return 'Payment pending'
    case 'placed': return 'Placed'
    case 'invoiced': return 'Invoiced'
    case 'paid': return 'Paid'
    default: return status
  }
}

export interface OrderLineView {
  variant_code: string
  product_name: string
  quantity: number
  unit_price_cents: number
  line_total_cents: number
}

export interface RefundView {
  id: number
  amount_cents: number
  reason: string
  kb_transaction_id: string
  created_at: string
}

export interface OrderView {
  order_key: string
  status: string
  display_status: string
  payment_method: string | null
  price_tier: 'retail' | 'trade'
  lines: OrderLineView[]
  subtotal_cents: number
  gst_cents: number
  total_cents: number
  captured_cents: number
  refunded_cents: number
  refunds: RefundView[]
  card_last4: string | null
  purchase_order: string | null
  invoice: { kb_invoice_id: string; invoice_number: string; invoice_date: string; due_date: string } | null
  created_at: string
}

export interface OrderRow {
  id: number
  order_key: string
  user_id: number
  status: string
  payment_method: string | null
  price_tier: 'retail' | 'trade'
  purchase_order: string | null
  card_last4: string | null
  subtotal_cents: number | null
  gst_cents: number | null
  total_cents: number | null
  captured_cents: number | null
  refunded_cents: number
  kb_payment_id: string | null
  kb_invoice_id: string | null
  invoice_number: string | null
  invoice_date: string | null
  due_date: string | null
  created_at: Date
}

export async function order_view(client: DbClient, row: OrderRow, today: string): Promise<OrderView> {
  const lines = await client.query<{
    variant_code: string
    product_name: string
    quantity: number
    unit_price_cents: number
    line_total_cents: number
  }>(
    `SELECT v.code AS variant_code, l.product_name, l.quantity, l.unit_price_cents, l.line_total_cents
     FROM order_lines l JOIN variants v ON v.id=l.variant_id WHERE l.order_id=$1 ORDER BY l.id`,
    [row.id],
  )
  const refunds = await client.query<RefundView>(
    `SELECT id, amount_cents, reason, kb_transaction_id, created_at FROM refunds WHERE order_id=$1 ORDER BY id`,
    [row.id],
  )
  return {
    order_key: row.order_key,
    status: row.status === 'invoiced' && row.due_date && row.due_date < today ? 'overdue' : row.status,
    display_status: display_status(row.status, row.due_date, today),
    payment_method: row.payment_method,
    price_tier: row.price_tier,
    lines: lines.rows,
    subtotal_cents: row.subtotal_cents ?? 0,
    gst_cents: row.gst_cents ?? 0,
    total_cents: row.total_cents ?? 0,
    captured_cents: row.captured_cents ?? 0,
    refunded_cents: row.refunded_cents,
    refunds: refunds.rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() })),
    card_last4: row.card_last4,
    purchase_order: row.purchase_order,
    invoice:
      row.kb_invoice_id && row.invoice_number && row.invoice_date && row.due_date
        ? {
            kb_invoice_id: row.kb_invoice_id,
            invoice_number: row.invoice_number,
            invoice_date: row.invoice_date,
            due_date: row.due_date,
          }
        : null,
    created_at: row.created_at.toISOString(),
  }
}

/** Recompute the cart's totals at the caller's tier. Freezes once it leaves the cart state. */
export async function reprice_cart(client: DbClient, order_id: number, tier: 'retail' | 'trade'): Promise<void> {
  const lines = await client.query<{ id: number; variant_id: number; quantity: number; retail: number; trade: number }>(
    `SELECT l.id, l.variant_id, l.quantity, v.retail_price_cents AS retail, v.trade_price_cents AS trade
     FROM order_lines l JOIN variants v ON v.id=l.variant_id WHERE l.order_id=$1 ORDER BY l.id`,
    [order_id],
  )
  let subtotal = 0
  for (const line of lines.rows) {
    const unit = tier === 'trade' ? line.trade : line.retail
    const total = unit * line.quantity
    subtotal += total
    await client.query('UPDATE order_lines SET unit_price_cents=$1, line_total_cents=$2 WHERE id=$3', [
      unit,
      total,
      line.id,
    ])
  }
  const gst = gst_cents(subtotal)
  await client.query('UPDATE orders SET subtotal_cents=$1, gst_cents=$2, total_cents=$3, updated_at=now() WHERE id=$4', [
    subtotal,
    gst,
    subtotal + gst,
    order_id,
  ])
}

export const OPEN_STATES = ['cart', 'declined', 'gateway_unavailable']

export function unit_price(tier: 'retail' | 'trade', retail: number, trade: number): number {
  return tier === 'trade' ? trade : retail
}

/** The 20th of the month after a date. */
export function due_date_from(invoice_date: string): string {
  const d = new Date(`${invoice_date}T00:00:00Z`)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth()
  const due = new Date(Date.UTC(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1, 20))
  return due.toISOString().slice(0, 10)
}
