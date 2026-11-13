import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { Db, nextCounter } from '../db/pool';
import { publish } from '../services/live';
import { CheckoutRow, holdStatus } from './holds';
import { publishStockFor } from './events';
import { refundGiftCard, giftCardLast4, lockGiftCard } from './giftcards';
import { loadDiscount } from './discounts';
import { warrantyYearsFor } from './constants';
import {
  ORDER_STATUS_WORDS,
  TIMELINE_LABELS,
  TotalsDiscount,
  addYears,
  computeTotals,
  hasCabinFit,
  windowState
} from './rules';
import { drawFromAccount, lockVariants, writeMovement } from './stock';

export type OrderRow = {
  number: string;
  user_id: string;
  kind: string;
  status: string;
  payment_status: string;
  placed_at: Date;
  delivered_at: Date | null;
  confirmation_emailed_at: Date | null;
  email: string;
  phone: string | null;
  address: Record<string, unknown> | null;
  shipping_method: string;
  gift: boolean;
  gift_message: string;
  discount_code: string | null;
  gift_card_code: string | null;
  totals: { subtotal: number; discount: number; shipping: number; tax: number; gift_card: number; total: number };
  shipping_tax: number;
  payment_amount: number;
  card_amount: number;
  gift_card_amount: number;
  card_last4: string | null;
  refunded: number;
  version: number;
};

export type OrderLineRow = {
  id: string;
  order_number: string;
  variant_id: string;
  sku: string;
  product: string;
  product_slug: string;
  category: string;
  colour: string;
  size: string;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
  line_discount: number;
  line_tax: number;
  fulfillment: string;
  carrier: string | null;
  tracking_number: string | null;
  returned_quantity: number;
  refunded_amount: number;
  position: number;
};

export async function loadOrder(client: Db, number: string): Promise<OrderRow | null> {
  return client.one<OrderRow>('SELECT * FROM orders WHERE number = $1', [number]);
}

export async function loadOrderLines(client: Db, number: string): Promise<OrderLineRow[]> {
  return client.query<OrderLineRow>(
    'SELECT * FROM order_lines WHERE order_number = $1 ORDER BY position ASC',
    [number]
  );
}

export function linePaidAmount(line: OrderLineRow): number {
  return line.line_subtotal - line.line_discount + line.line_tax;
}

export type ExchangeCandidate = { sku: string; colour: string; size: string; available: number };

export async function exchangeCandidates(
  client: Db,
  line: OrderLineRow
): Promise<ExchangeCandidate[]> {
  const rows = await client.query<{ sku: string; colour: string; size: string; position: number; available: string }>(
    `SELECT v.sku, v.colour, v.size, v.position,
            coalesce((SELECT sum(quantity) FROM stock_entries e
                      WHERE e.variant_id = v.id AND e.account = 'available'), 0)::bigint AS available
     FROM variants v
     WHERE v.product_id = (SELECT product_id FROM variants WHERE id = $1)
       AND v.id <> $1 AND v.price = $2
     ORDER BY v.position ASC`,
    [line.variant_id, line.unit_price]
  );
  return rows.map((row) => ({
    sku: row.sku,
    colour: row.colour,
    size: row.size,
    available: Number(row.available)
  }));
}

export async function orderPayload(client: Db, order: OrderRow, now: Date): Promise<Record<string, unknown>> {
  const lines = await loadOrderLines(client, order.number);
  const timeline = await client.query<{ status: string; at: Date }>(
    'SELECT status, at FROM order_timeline WHERE order_number = $1 ORDER BY id ASC',
    [order.number]
  );
  const registrations = await client.query<{ id: string; order_line_id: string; covered_until: Date }>(
    `SELECT id, order_line_id, covered_until FROM warranty_registrations
     WHERE order_line_id = ANY($1::uuid[])`,
    [lines.map((line) => line.id)]
  );

  const returnWindow = windowState(order.delivered_at, config.returnWindowDays, now);
  const trialWindow = windowState(order.delivered_at, config.trialWindowDays, now);

  return {
    number: order.number,
    status: order.status,
    version: order.version,
    placed_at: order.placed_at.toISOString(),
    delivered_at: order.delivered_at === null ? null : order.delivered_at.toISOString(),
    confirmation_emailed_at:
      order.confirmation_emailed_at === null ? null : order.confirmation_emailed_at.toISOString(),
    payment: {
      status: order.payment_status,
      amount: order.payment_amount,
      card_amount: order.card_amount,
      gift_card_amount: order.gift_card_amount,
      card_last4: order.card_last4,
      refunded: order.refunded
    },
    lines: lines.map((line) => {
      const registration = registrations.find((item) => item.order_line_id === line.id);
      const deliveredLine = line.fulfillment === 'delivered';
      return {
        id: line.id,
        sku: line.sku,
        product: line.product,
        colour: line.colour,
        size: line.size,
        quantity: line.quantity,
        unit_price: line.unit_price,
        line_subtotal: line.line_subtotal,
        line_discount: line.line_discount,
        line_tax: line.line_tax,
        fulfillment: line.fulfillment,
        shipment:
          line.carrier === null || line.tracking_number === null
            ? null
            : { carrier: line.carrier, tracking_number: line.tracking_number },
        return_eligible:
          deliveredLine && returnWindow !== null && returnWindow.open && line.returned_quantity < line.quantity,
        trial_eligible:
          deliveredLine &&
          trialWindow !== null &&
          trialWindow.open &&
          hasCabinFit(line.category) &&
          line.returned_quantity < line.quantity,
        warranty:
          registration === undefined
            ? null
            : {
                registration_id: registration.id,
                covered_until: registration.covered_until.toISOString()
              }
      };
    }),
    totals: order.totals,
    shipping_tax: order.shipping_tax,
    timeline: timeline.map((item) => ({
      status: item.status,
      label: TIMELINE_LABELS[item.status] ?? ORDER_STATUS_WORDS[item.status] ?? item.status,
      at: item.at.toISOString()
    })),
    return_window: returnWindow,
    trial_window: trialWindow,
    server_time: now.toISOString()
  };
}

export async function publishOrder(client: Db, order: OrderRow): Promise<void> {
  const lines = await loadOrderLines(client, order.number);
  await publish(
    client,
    'order',
    {
      number: order.number,
      status: order.status,
      payment_status: order.payment_status,
      version: order.version,
      lines: lines.map((line) => ({
        id: line.id,
        fulfillment: line.fulfillment,
        shipment:
          line.carrier === null || line.tracking_number === null
            ? null
            : { carrier: line.carrier, tracking_number: line.tracking_number }
      }))
    },
    { userId: order.user_id }
  );
}

export async function addTimeline(client: Db, number: string, status: string, at: Date): Promise<void> {
  await client.query('INSERT INTO order_timeline (order_number, status, at) VALUES ($1, $2, $3)', [
    number,
    status,
    at
  ]);
}

export async function checkoutTotals(
  client: Db,
  checkout: CheckoutRow,
  giftCardBalanceValue: number
): Promise<{
  lines: Array<{
    sku: string;
    variant_id: string;
    product: string;
    product_slug: string;
    category: string;
    colour: string;
    size: string;
    quantity: number;
    unit_price: number;
    line_subtotal: number;
    line_discount: number;
    line_tax: number;
  }>;
  totals: { subtotal: number; discount: number; shipping: number; tax: number; gift_card: number; total: number };
  grand_total: number;
  shipping_tax: number;
}> {
  const variantIds = checkout.lines.map((line) => line.variant_id);
  const rows =
    variantIds.length === 0
      ? []
      : await client.query<{
          id: string;
          sku: string;
          colour: string;
          size: string;
          price: number;
          product: string;
          product_slug: string;
          category: string;
        }>(
          `SELECT v.id, v.sku, v.colour, v.size, v.price, p.name AS product, p.slug AS product_slug, p.category
           FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ANY($1::uuid[])`,
          [variantIds]
        );

  let discount: TotalsDiscount | null = null;
  if (checkout.discount_code !== null) {
    const row = await loadDiscount(client, checkout.discount_code);
    if (row !== null) {
      discount = { code: row.code, kind: row.kind, value: row.value, collection: row.collection };
    }
  }

  const detailed = checkout.lines.map((line) => {
    const variant = rows.find((row) => row.id === line.variant_id);
    const unitPrice = line.price ?? variant?.price ?? 0;
    return {
      sku: line.sku,
      variant_id: line.variant_id,
      product: variant?.product ?? line.sku,
      product_slug: variant?.product_slug ?? '',
      category: variant?.category ?? 'accessories',
      colour: variant?.colour ?? '',
      size: variant?.size ?? '',
      quantity: line.quantity,
      unit_price: unitPrice
    };
  });

  const method = checkout.shipping_method === 'express' ? 'express' : 'standard';
  const result = computeTotals({
    lines: detailed.map((line) => ({
      sku: line.sku,
      category: line.category,
      unit_price: line.unit_price,
      quantity: line.quantity
    })),
    discount,
    shippingMethod: method,
    giftCardBalance: giftCardBalanceValue
  });

  return {
    lines: detailed.map((line, index) => ({
      ...line,
      line_subtotal: result.lines[index].line_subtotal,
      line_discount: result.lines[index].line_discount,
      line_tax: result.lines[index].line_tax
    })),
    totals: result.totals,
    grand_total: result.grand_total,
    shipping_tax: result.shipping_tax
  };
}

export async function checkoutPayload(
  client: Db,
  checkout: CheckoutRow,
  giftCardBalanceValue: number,
  now: Date
): Promise<Record<string, unknown>> {
  const computed = await checkoutTotals(client, checkout, giftCardBalanceValue);
  return {
    id: checkout.id,
    step: checkout.step,
    contact: { email: checkout.email, phone: checkout.phone },
    delivery: checkout.address,
    shipping_method: checkout.shipping_method,
    gift: checkout.gift,
    gift_message: checkout.gift_message,
    lines: computed.lines.map((line) => ({
      sku: line.sku,
      product: line.product,
      colour: line.colour,
      size: line.size,
      quantity: line.quantity,
      unit_price: line.unit_price,
      line_subtotal: line.line_subtotal,
      line_discount: line.line_discount
    })),
    discount: checkout.discount_code,
    gift_card:
      checkout.gift_card_code === null
        ? null
        : { last4: giftCardLast4(checkout.gift_card_code), balance: giftCardBalanceValue },
    totals: computed.totals,
    hold: holdStatus(checkout, now),
    server_time: now.toISOString()
  };
}

export async function nextOrderNumber(client: Db): Promise<string> {
  const value = await nextCounter(client, 'order_number', 100001);
  return `RH-${value}`;
}

export async function commitHeldLines(client: Db, checkout: CheckoutRow, ref: string): Promise<void> {
  await lockVariants(client, checkout.lines.map((line) => line.variant_id));
  for (const line of checkout.lines) {
    await writeMovement(
      client,
      line.variant_id,
      'order_committed',
      ref,
      line.location ?? 'bhiwandi',
      line.quantity
    );
  }
}

export type RefundSplit = { amount: number; card_amount: number; gift_card_amount: number };

export async function issueRefund(
  client: Db,
  order: OrderRow,
  amount: number,
  reason: string,
  ref: string
): Promise<RefundSplit> {
  if (amount <= 0) return { amount: 0, card_amount: 0, gift_card_amount: 0 };
  const row = await client.one<{ total: string }>(
    'SELECT coalesce(sum(card_amount), 0)::bigint AS total FROM refunds WHERE order_number = $1',
    [order.number]
  );
  const cardRefunded = row === null ? 0 : Number(row.total);
  const cardPart = Math.max(0, Math.min(amount, order.card_amount - cardRefunded));
  const giftPart = amount - cardPart;

  await client.query(
    `INSERT INTO refunds (id, order_number, amount, card_amount, gift_card_amount, reason, ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), order.number, amount, cardPart, giftPart, reason, ref]
  );

  if (giftPart > 0 && order.gift_card_code !== null) {
    await lockGiftCard(client, order.gift_card_code);
    await refundGiftCard(client, order.gift_card_code, giftPart, order.number);
  }

  const refunded = order.refunded + amount;
  const paymentStatus = refunded >= order.payment_amount ? 'refunded' : 'partially_refunded';
  await client.query(
    'UPDATE orders SET refunded = $2, payment_status = $3, version = version + 1 WHERE number = $1',
    [order.number, refunded, paymentStatus]
  );
  order.refunded = refunded;
  order.payment_status = paymentStatus;
  order.version += 1;

  return { amount, card_amount: cardPart, gift_card_amount: giftPart };
}

export async function createZeroValueOrder(
  client: Db,
  options: {
    userId: string;
    email: string;
    kind: 'exchange' | 'replacement';
    sourceOrder: OrderRow;
    variantId: string;
    quantity: number;
    reason: 'exchange_committed' | 'replacement_committed';
    ref: string;
  }
): Promise<OrderRow> {
  const number = await nextOrderNumber(client);
  const now = new Date();
  const totals = { subtotal: 0, discount: 0, shipping: 0, tax: 0, gift_card: 0, total: 0 };
  await client.query(
    `INSERT INTO orders (number, user_id, kind, status, payment_status, placed_at, email, phone, address,
                         shipping_method, totals, shipping_tax, payment_amount, card_amount, gift_card_amount,
                         card_last4, confirmation_emailed_at)
     VALUES ($1, $2, $3, 'placed', 'captured', $4, $5, $6, $7::jsonb, $8, $9::jsonb, 0, 0, 0, 0, NULL, $4)`,
    [
      number,
      options.userId,
      options.kind,
      now,
      options.email,
      options.sourceOrder.phone,
      JSON.stringify(options.sourceOrder.address),
      options.sourceOrder.shipping_method,
      JSON.stringify(totals)
    ]
  );
  await addTimeline(client, number, 'placed', now);

  const variant = await client.one<{
    sku: string;
    colour: string;
    size: string;
    product: string;
    product_slug: string;
    category: string;
  }>(
    `SELECT v.sku, v.colour, v.size, p.name AS product, p.slug AS product_slug, p.category
     FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`,
    [options.variantId]
  );
  await client.query(
    `INSERT INTO order_lines (id, order_number, variant_id, sku, product, product_slug, category, colour, size,
                              quantity, unit_price, line_subtotal, line_discount, line_tax, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 0, 0, 0, 1)`,
    [
      randomUUID(),
      number,
      options.variantId,
      variant!.sku,
      variant!.product,
      variant!.product_slug,
      variant!.category,
      variant!.colour,
      variant!.size,
      options.quantity
    ]
  );

  await lockVariants(client, [options.variantId]);
  await drawFromAccount(client, options.variantId, options.reason, options.ref, options.quantity, 'available');
  await publishStockFor(client, [options.variantId]);

  const created = await loadOrder(client, number);
  await publishOrder(client, created!);
  return created!;
}

export function warrantyCoveredUntil(category: string, deliveredAt: Date): Date {
  return addYears(deliveredAt, warrantyYearsFor(category));
}
