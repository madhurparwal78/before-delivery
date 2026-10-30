import type { PoolClient } from 'pg';
import { isoSeconds } from '../clock.js';
import { one, rows } from '../db.js';
import { formatCents } from '../money.js';
import { formatShipDate } from '../tz.js';
import type { Breakdown, CreditShape, TaxComponentShape } from './checkout.js';

export interface OrderRow {
  number: string;
  user_id: string;
  status: string;
  placed_at: Date;
  country: string;
  addr_name: string;
  addr_line1: string;
  addr_city: string;
  addr_postal_code: string;
  addr_phone: string;
  subtotal_cents: number;
  discounts: { code: string; amount_cents: number }[];
  credits: CreditShape[];
  taxable_cents: number;
  shipping_cents: number;
  packed_batteries: number;
  standalone_batteries: number;
  dangerous_goods_cents: number;
  taxes: TaxComponentShape[];
  tax_cents: number;
  total_cents: number;
  ships_on: Date;
  arrives_on: Date;
  trade_in_id: string | null;
  billing_account_key: string | null;
  billing_invoice_id: string | null;
}

export interface OrderLineRow {
  id: string;
  type: string;
  sku: string;
  build_code: string | null;
  name: string;
  quantity: number;
  unit_cents: number;
  line_cents: number;
}

function isoDateOf(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

export async function orderShape(client: PoolClient, order: OrderRow): Promise<Record<string, unknown>> {
  const lineRows = await rows<OrderLineRow>(
    client,
    'SELECT id, type, sku, build_code, name, quantity, unit_cents, line_cents FROM order_lines WHERE order_number = $1 ORDER BY id',
    [order.number],
  );
  const plans = await rows<{ line_id: string; protected_until: Date }>(
    client,
    'SELECT line_id, protected_until FROM protection_plans WHERE order_number = $1 AND voided = false',
    [order.number],
  );
  const planByLine = new Map(plans.map((p) => [String(p.line_id), p.protected_until]));
  const eventRows = await rows<{ status: string; at: Date; by_email: string }>(
    client,
    'SELECT status, at, by_email FROM order_events WHERE order_number = $1 ORDER BY id',
    [order.number],
  );

  return {
    number: order.number,
    status: order.status,
    placed_at: isoSeconds(order.placed_at),
    country: order.country,
    address: {
      name: order.addr_name,
      line1: order.addr_line1,
      city: order.addr_city,
      postal_code: order.addr_postal_code,
      phone: order.addr_phone,
    },
    lines: lineRows.map((line) => {
      const until = planByLine.get(String(line.id));
      return {
        id: Number(line.id),
        type: line.type,
        sku: line.sku,
        code: line.build_code,
        name: line.name,
        quantity: line.quantity,
        unit_cents: line.unit_cents,
        line_cents: line.line_cents,
        protected_until: until ? isoSeconds(until) : null,
      };
    }),
    subtotal_cents: order.subtotal_cents,
    discounts: order.discounts,
    credits: order.credits,
    taxable_cents: order.taxable_cents,
    shipping_cents: order.shipping_cents,
    packed_batteries: order.packed_batteries,
    standalone_batteries: order.standalone_batteries,
    dangerous_goods_cents: order.dangerous_goods_cents,
    taxes: order.taxes,
    tax_cents: order.tax_cents,
    total_cents: order.total_cents,
    ships_on: isoDateOf(order.ships_on),
    arrives_on: isoDateOf(order.arrives_on),
    trade_in_id: order.trade_in_id === null ? null : Number(order.trade_in_id),
    billing_account_key: order.billing_account_key,
    billing_invoice_id: order.billing_invoice_id,
    events: eventRows.map((e) => ({ status: e.status, at: isoSeconds(e.at), by: e.by_email })),
  };
}

export async function loadOrderRow(client: PoolClient, number: string): Promise<OrderRow | undefined> {
  return one<OrderRow>(client, 'SELECT * FROM orders WHERE number = $1', [number]);
}

/** The itemised Kill Bill charge: one item per non-zero total component. */
export function chargeItems(
  orderNumber: string,
  breakdown: Pick<Breakdown, 'taxable_cents' | 'shipping_cents' | 'dangerous_goods_cents' | 'tax_cents'>,
): { description: string; amountCents: number }[] {
  return [
    { description: `${orderNumber} merchandise`, amountCents: breakdown.taxable_cents },
    { description: `${orderNumber} shipping`, amountCents: breakdown.shipping_cents },
    { description: `${orderNumber} dangerous goods`, amountCents: breakdown.dangerous_goods_cents },
    { description: `${orderNumber} tax`, amountCents: breakdown.tax_cents },
  ].filter((item) => item.amountCents !== 0);
}

export function orderConfirmationBody(
  orderNumber: string,
  lines: { name: string; quantity: number; line_cents: number }[],
  breakdown: Breakdown,
): string {
  const body: string[] = [`Order ${orderNumber}`];
  for (const line of lines) body.push(`${line.name} x ${line.quantity}: ${formatCents(line.line_cents)}`);
  const takenOff =
    breakdown.discounts.reduce((sum, d) => sum + d.amount_cents, 0) +
    breakdown.credits.reduce((sum, c) => sum + c.amount_cents, 0);
  if (takenOff !== 0) body.push(`Discounts and credits: -${formatCents(takenOff)}`);
  body.push(`Shipping: ${formatCents(breakdown.shipping_cents)}`);
  body.push(`Dangerous goods handling: ${formatCents(breakdown.dangerous_goods_cents)}`);
  for (const tax of breakdown.taxes) body.push(`${tax.name}: ${formatCents(tax.amount_cents)}`);
  body.push(`Tax: ${formatCents(breakdown.tax_cents)}`);
  body.push(`Total: ${formatCents(breakdown.total_cents)}`);
  body.push(`Arrives ${formatShipDate(breakdown.arrives_on)}`);
  return body.join('\n');
}
