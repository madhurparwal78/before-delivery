import { withClient, type DbClient } from '../db.js';
import { putObject } from '../services/s3.js';
import { invoicePdf, packingSlipPdf } from '../pdf.js';
import { pushStockLevels } from './catalogue.js';
import { pool } from '../db.js';

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'picking'
  | 'packed'
  | 'shipped'
  | 'refunded';

export interface OrderRow {
  number: string;
  user_id: string;
  status: OrderStatus;
  refund_status: 'none' | 'partially_refunded' | 'refunded';
  placed_at: Date;
  province: string;
  subscription_id: string | null;
  lines: {
    flavour: string;
    quantity: number;
    unit_price_cents: number;
    goods_cents: number;
    discount_cents: number;
    deposit_cents: number;
  }[];
  goods_cents: number;
  discount_cents: number;
  discounted_goods_cents: number;
  shipping_cents: number;
  deposit_cents: number;
  taxes: { name: string; rate: string; cents: number }[];
  total_cents: number;
  refunded_cents: number;
  ship_to: { name: string; line1: string; line2?: string; city: string; province: string; postal_code: string };
  card: { brand: string; last4: string } | null;
  kb_account_id: string | null;
  kb_invoice_id: string | null;
  email: string;
}

const TRANSITIONS: Record<string, string[]> = {
  paid: ['picking'],
  picking: ['packed'],
  packed: ['shipped'],
};

export function transitionAllowed(from: OrderStatus, to: 'picking' | 'packed' | 'shipped'): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export async function nextOrderNumber(client: DbClient): Promise<string> {
  await client.query(
    'insert into order_numbers (dummy, last_number) values (true, 100000) on conflict (dummy) do nothing'
  );
  const q = await client.query<{ last_number: number }>('update order_numbers set last_number = last_number + 1 returning last_number');
  return `CB-${q.rows[0].last_number}`;
}

export async function insertOrder(client: DbClient, order: Omit<OrderRow, 'status' | 'refund_status' | 'placed_at' | 'refunded_cents'>): Promise<OrderRow> {
  const q = await client.query(
    `insert into orders (number, user_id, province, subscription_id, lines, goods_cents, discount_cents,
      discounted_goods_cents, shipping_cents, deposit_cents, taxes, total_cents, ship_to, card,
      kb_account_id, kb_invoice_id, email, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'pending_payment')
     returning *`,
    [
      order.number,
      order.user_id,
      order.province,
      order.subscription_id,
      JSON.stringify(order.lines),
      order.goods_cents,
      order.discount_cents,
      order.discounted_goods_cents,
      order.shipping_cents,
      order.deposit_cents,
      JSON.stringify(order.taxes),
      order.total_cents,
      JSON.stringify(order.ship_to),
      order.card ? JSON.stringify(order.card) : null,
      order.kb_account_id,
      order.kb_invoice_id,
      order.email,
    ]
  );
  return q.rows[0] as unknown as OrderRow;
}

export async function getOrder(number: string, client?: DbClient): Promise<OrderRow | null> {
  const c = client ?? (await withClient(async (x) => x));
  const q = await c.query('select * from orders where number = $1', [number]);
  return (q.rows[0] as unknown as OrderRow) ?? null;
}

export async function markOrderPaid(number: string): Promise<void> {
  await withClient(async (client) => {
    await client.query("update orders set status = 'paid' where number = $1", [number]);
  });
}

export async function writeOrderPdfs(order: OrderRow): Promise<void> {
  const invoice = await invoicePdf({
    number: order.number,
    placed_at: order.placed_at,
    province: order.province,
    lines: order.lines,
    goods_cents: order.goods_cents,
    discount_cents: order.discount_cents,
    discounted_goods_cents: order.discounted_goods_cents,
    shipping_cents: order.shipping_cents,
    deposit_cents: order.deposit_cents,
    taxes: order.taxes,
    total_cents: order.total_cents,
    ship_to: order.ship_to,
  });
  const slip = await packingSlipPdf({
    number: order.number,
    ship_to: order.ship_to,
    cans: order.lines.map((l) => ({ flavour: l.flavour, quantity: l.quantity })),
  });
  await putObject(`orders/${order.number}/invoice.pdf`, invoice, 'application/pdf');
  await putObject(`orders/${order.number}/packing-slip.pdf`, slip, 'application/pdf');
}

export async function sellHeldCans(holdId: string, orderNumber: string, flavour: string, qty: number): Promise<void> {
  await pool.query(
    "insert into stock_ledger (flavour, kind, qty, hold_id, order_number) values ($1, 'sold', $2, $3, $4)",
    [flavour, qty, holdId, orderNumber]
  );
}

export async function deleteOrderRow(number: string): Promise<void> {
  await pool.query('delete from orders where number = $1', [number]);
}

export async function restockOrderCans(order: OrderRow): Promise<void> {
  await withClient(async (client) => {
    for (const line of order.lines) {
      await client.query(
        "insert into stock_ledger (flavour, kind, qty, order_number) values ($1, 'returned', $2, $3)",
        [line.flavour, line.quantity, order.number]
      );
    }
  });
  await pushStockLevels();
}

export async function listOrdersForUser(userId: string): Promise<OrderRow[]> {
  return withClient(async (client) => {
    const q = await client.query('select * from orders where user_id = $1 order by placed_at desc', [userId]);
    return q.rows as unknown as OrderRow[];
  });
}

