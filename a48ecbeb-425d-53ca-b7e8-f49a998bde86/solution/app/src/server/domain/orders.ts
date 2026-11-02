import { query, rows, type Client, type Row } from "../db.js";
import { ApiError } from "../http.js";
import { rateLabel } from "./money.js";
import type { Quote } from "./quote.js";
import type { RefundableParts, RefundSplit } from "./refunds.js";

export type OrderStatus = "pending_payment" | "paid" | "picking" | "packed" | "shipped" | "refunded";

/** The fulfilment state machine. `refunded` is reached only by a confirmed full refund. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["paid"],
  paid: ["picking", "refunded"],
  picking: ["packed", "refunded"],
  packed: ["shipped", "refunded"],
  shipped: ["refunded"],
  refunded: [],
};

export function assertTransition(number: string, from: OrderStatus, to: OrderStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new ApiError(409, "illegal_transition", `Order ${number} can't move to ${to} from here.`);
  }
}

export const QUEUE_STATUSES: OrderStatus[] = ["paid", "picking", "packed"];

export type ShipTo = {
  name: string;
  line1: string;
  line2: string;
  city: string;
  province: string;
  postal_code: string;
};

interface NewOrder {
  userId: string;
  email: string;
  customerName: string;
  kind: "checkout" | "renewal";
  subscriptionId: string | null;
  quote: Quote;
  shipTo: ShipTo;
  renewalInvoiceId: string | null;
}

/** Creates a pending_payment order with its lines and tax lines; numbers rise from CB-100001. */
export async function insertOrder(client: Client, order: NewOrder): Promise<string> {
  const [{ n }] = await rows<{ n: string }>(client, "SELECT nextval('order_number_seq')::text AS n");
  const number = `CB-${n.padStart(6, "0")}`;
  const q = order.quote;
  await rows(
    client,
    `INSERT INTO orders (number, user_id, email, customer_name, kind, status, province, subscribe, subscription_id,
       goods_cents, discount_cents, discounted_goods_cents, shipping_cents, deposit_cents, total_cents, threshold_cents,
       ship_to, renewal_invoice_id)
     VALUES ($1, $2, $3, $4, $5, 'pending_payment', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      number,
      order.userId,
      order.email,
      order.customerName,
      order.kind,
      q.province,
      q.subscribe,
      order.subscriptionId,
      q.goodsCents,
      q.discountCents,
      q.discountedGoodsCents,
      q.shippingCents,
      q.depositCents,
      q.totalCents,
      q.thresholdCents,
      JSON.stringify(order.shipTo),
      order.renewalInvoiceId,
    ],
  );
  for (const [i, line] of q.lines.entries()) {
    await rows(
      client,
      `INSERT INTO order_lines (order_number, position, flavour, quantity, unit_price_cents, goods_cents, discount_cents, deposit_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [number, i, line.flavour, line.quantity, line.unitPriceCents, line.goodsCents, line.discountCents, line.depositCents],
    );
  }
  for (const [i, tax] of q.taxes.entries()) {
    await rows(client, "INSERT INTO order_taxes (order_number, position, name, rate_milli, cents) VALUES ($1, $2, $3, $4, $5)", [
      number,
      i,
      tax.name,
      tax.rateMilli,
      tax.cents,
    ]);
  }
  return number;
}

export interface OrderRow {
  number: string;
  user_id: string;
  email: string;
  customer_name: string;
  kind: "checkout" | "renewal";
  status: OrderStatus;
  refund_status: "none" | "partially_refunded" | "refunded";
  placed_at: Date;
  paid_at: Date | null;
  province: string;
  subscribe: boolean;
  subscription_id: string | null;
  goods_cents: number;
  discount_cents: number;
  discounted_goods_cents: number;
  shipping_cents: number;
  deposit_cents: number;
  total_cents: number;
  threshold_cents: number;
  ship_to: ShipTo;
  kb_payment_id: string | null;
  [key: string]: unknown;
}

export interface LineRow {
  order_number: string;
  flavour: string;
  quantity: number;
  unit_price_cents: number;
  goods_cents: number;
  discount_cents: number;
  deposit_cents: number;
  [key: string]: unknown;
}

export interface TaxRow {
  order_number: string;
  name: string;
  rate_milli: number;
  cents: number;
  [key: string]: unknown;
}

export interface RefundRow {
  id: string;
  order_number: string;
  status: "pending_provider" | "applied" | "rejected";
  amount_cents: number;
  reason: string;
  full_refund: boolean;
  split: RefundSplit;
  created_at: Date;
  [key: string]: unknown;
}

export interface FullOrder {
  order: OrderRow;
  lines: LineRow[];
  taxes: TaxRow[];
  refunds: RefundRow[];
}

/** Loads orders with their lines, taxes and refunds, in the order of `numbers` (inside `client`'s transaction when given). */
export async function loadOrders(numbers: string[], client?: Client): Promise<FullOrder[]> {
  if (numbers.length === 0) return [];
  const read = <T extends Row>(sql: string) => (client ? rows<T>(client, sql, [numbers]) : query<T>(sql, [numbers]));
  const orders = await read<OrderRow>("SELECT * FROM orders WHERE number = ANY($1)");
  const lines = await read<LineRow>("SELECT * FROM order_lines WHERE order_number = ANY($1) ORDER BY position");
  const taxes = await read<TaxRow>("SELECT * FROM order_taxes WHERE order_number = ANY($1) ORDER BY position");
  const refunds = await read<RefundRow>("SELECT * FROM refunds WHERE order_number = ANY($1) ORDER BY created_at");
  return numbers.flatMap((n) => {
    const order = orders.find((o) => o.number === n);
    return order
      ? [
          {
            order,
            lines: lines.filter((l) => l.order_number === n),
            taxes: taxes.filter((t) => t.order_number === n),
            refunds: refunds.filter((r) => r.order_number === n),
          },
        ]
      : [];
  });
}

export function refundFigures(full: FullOrder): { refunded: number; refundable: number } {
  const applied = full.refunds.filter((r) => r.status === "applied").reduce((a, r) => a + r.amount_cents, 0);
  const pending = full.refunds.filter((r) => r.status === "pending_provider").reduce((a, r) => a + r.amount_cents, 0);
  return { refunded: applied, refundable: full.order.total_cents - applied - pending };
}

export function refundableParts(full: FullOrder): RefundableParts {
  return {
    lines: full.lines.map((l) => ({
      flavour: l.flavour,
      discountedGoodsCents: l.goods_cents - l.discount_cents,
      depositCents: l.deposit_cents,
    })),
    shippingCents: full.order.shipping_cents,
    taxes: full.taxes.map((t) => ({ name: t.name, cents: t.cents })),
  };
}

export function refundJson(r: RefundRow) {
  return {
    id: r.id,
    status: r.status,
    amount_cents: r.amount_cents,
    reason: r.reason,
    split: r.split,
    created_at: r.created_at.toISOString(),
  };
}

export function orderJson(full: FullOrder) {
  const { order } = full;
  const { refunded, refundable } = refundFigures(full);
  return {
    number: order.number,
    status: order.status,
    refund_status: order.refund_status,
    placed_at: order.placed_at.toISOString(),
    province: order.province,
    subscription_id: order.subscription_id,
    lines: full.lines.map((l) => ({
      flavour: l.flavour,
      quantity: l.quantity,
      unit_price_cents: l.unit_price_cents,
      goods_cents: l.goods_cents,
      discount_cents: l.discount_cents,
      deposit_cents: l.deposit_cents,
    })),
    goods_cents: order.goods_cents,
    discount_cents: order.discount_cents,
    discounted_goods_cents: order.discounted_goods_cents,
    shipping_cents: order.shipping_cents,
    deposit_cents: order.deposit_cents,
    taxes: full.taxes.map((t) => ({ name: t.name, rate: rateLabel(t.rate_milli), cents: t.cents })),
    total_cents: order.total_cents,
    refunded_cents: refunded,
    refundable_cents: order.status === "pending_payment" ? 0 : refundable,
    ship_to: order.ship_to,
    refunds: full.refunds.map(refundJson),
    thank_you_url: `/orders/${order.number}/thanks`,
    invoice_url: `/api/orders/${order.number}/invoice.pdf`,
  };
}

export const paymentKey = (database: string, number: string): string => `${database}/${number}`;
