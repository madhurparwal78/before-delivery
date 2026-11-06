import { BANNERS, CART, CONFLICTS, FIELD_MESSAGES } from '../../shared/copy.js';
import { scentName } from '../../shared/catalog.js';
import { BAR_PRICE_CENTS, dropOrderPrice, PROVINCES } from '../../shared/money.js';
import type { Locale, ShippingAddress } from '../../shared/types.js';
import { takeNumber } from '../db/numbers.js';
import { db, withTransaction, type Queryable } from '../db/pool.js';
import { orderConfirmationMail } from '../email/templates.js';
import { shipOnFor } from '../domain/shipping.js';
import {
  boundedText,
  parseBody,
  readLiteral,
  readPostalCode,
  readShape,
  readStringList,
} from '../http/body.js';
import type { ApiResponse, RequestContext } from '../http/context.js';
import { errors } from '../http/errors.js';
import { runIdempotent } from '../http/idempotency.js';
import { effectiveHoldStatus, HOLD_COLUMNS, type HoldRow } from '../repo/cart.js';
import { ensureKillbillAccount } from '../repo/customers.js';
import { loadOrder, serializeOrder } from '../repo/orders.js';
import { requireCustomer } from './sessions.js';
import { BillingUnavailableError, killbill } from '../services/killbill.js';
import { noteBillingFailure } from '../services/billing-status.js';
import { enqueueNotice, wakeOutbox } from '../services/outbox.js';

export const SHIPPING_SHAPE = {
  name: boundedText(FIELD_MESSAGES.name, 1, 120),
  line1: boundedText(FIELD_MESSAGES.line1, 1, 200),
  city: boundedText(FIELD_MESSAGES.city, 1, 120),
  province: readLiteral(
    PROVINCES.map((province) => province.code),
    FIELD_MESSAGES.province,
  ),
  postal_code: readPostalCode,
} as const;

const CHECKOUT_SHAPE = {
  holds: readStringList(FIELD_MESSAGES.holds, 1),
  shipping: readShape(SHIPPING_SHAPE),
} as const;

function peekHoldIds(body: unknown): string[] {
  if (body === null || typeof body !== 'object') return [];
  const raw = (body as Record<string, unknown>)['holds'];
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string');
}

async function settingsCutoff(client: Queryable): Promise<string> {
  const result = await client.query<{ packing_cutoff_local: string }>(
    'SELECT packing_cutoff_local FROM settings WHERE id = 1',
  );
  return result.rows[0]?.packing_cutoff_local ?? '14:00';
}

export async function postCheckout(ctx: RequestContext): Promise<ApiResponse> {
  const customer = requireCustomer(ctx);
  const cartId = ctx.cartId;
  const requestedIds = peekHoldIds(ctx.body);

  // Precedence: a hold that is not this cart's is a 404 before the idempotency key is even read.
  if (requestedIds.length > 0) {
    const owned = await db.query<{ id: string }>(
      `SELECT id FROM holds WHERE id = ANY($1::uuid[]) AND cart_id = $2`,
      [requestedIds.filter((id) => /^[0-9a-fA-F-]{36}$/.test(id)), cartId ?? ''],
    );
    if (owned.rowCount !== requestedIds.length) throw errors.notFound();
  }

  return runIdempotent(ctx, 'checkout', customer.id, async () => {
    const now = new Date();
    if (requestedIds.length > 0) {
      const rows = await db.query<HoldRow>(
        `SELECT ${HOLD_COLUMNS} FROM holds WHERE id = ANY($1::uuid[])`,
        [requestedIds],
      );
      const statuses = rows.rows.map((row) => effectiveHoldStatus(row, now));
      if (statuses.includes('expired')) throw errors.gone('hold_expired', CART.holdExpired);
      if (statuses.some((status) => status !== 'active')) {
        throw errors.conflict('hold_not_active', CONFLICTS.holdNotActive);
      }
    }

    const parsed = parseBody(ctx.body, CHECKOUT_SHAPE);
    if (!parsed.ok) throw errors.invalid(parsed.fields);
    const shipping: ShippingAddress = parsed.value.shipping;
    const holdIds = parsed.value.holds;

    const orderNumber = await placeOrder({
      ctx,
      customer,
      cartId: cartId ?? '',
      holdIds,
      shipping,
    });
    const record = await loadOrder(db, orderNumber);
    if (!record) throw errors.notFound();
    wakeOutbox();
    return { status: 201, body: { order: serializeOrder(record) } };
  });
}

type PlaceOrderInput = {
  ctx: RequestContext;
  customer: { id: string; email: string; locale: Locale };
  cartId: string;
  holdIds: readonly string[];
  shipping: ShippingAddress;
};

async function placeOrder(input: PlaceOrderInput): Promise<string> {
  try {
    return await withTransaction(async (client) => {
      const held = await client.query<HoldRow>(
        `SELECT ${HOLD_COLUMNS} FROM holds WHERE id = ANY($1::uuid[]) AND cart_id = $2
          ORDER BY batch_code, bar FOR UPDATE`,
        [[...input.holdIds], input.cartId],
      );
      if (held.rowCount !== input.holdIds.length) throw errors.notFound();
      const now = new Date();
      for (const row of held.rows) {
        const status = effectiveHoldStatus(row, now);
        if (status === 'expired') throw errors.gone('hold_expired', CART.holdExpired);
        if (status !== 'active') throw errors.conflict('hold_not_active', CONFLICTS.holdNotActive);
      }

      const scents = await client.query<{ code: string; scent: string }>(
        'SELECT code, scent FROM batches WHERE code = ANY($1)',
        [[...new Set(held.rows.map((row) => row.batch_code))]],
      );
      const scentOf = new Map(scents.rows.map((row) => [row.code, row.scent]));
      const price = dropOrderPrice(held.rows.length, input.shipping.province);
      const orderNumber = await takeNumber(client, 'order');
      const accountId = await ensureKillbillAccount(
        client,
        input.customer,
        input.shipping.name,
        'loafline',
      );

      const barCharges = held.rows.map((row) => ({
        key: `bar:${row.batch_code}:${row.bar}`,
        description: `Bar ${row.bar} \u00B7 ${row.batch_code} \u00B7 ${scentName(
          scentOf.get(row.batch_code) ?? row.batch_code,
          'en-CA',
        )}`,
        amountCents: BAR_PRICE_CENTS,
      }));
      const charges = [
        ...barCharges,
        { key: 'shipping', description: 'Shipping', amountCents: price.shipping_fee.cents },
      ];
      const draft = await killbill.createDraftCharges(accountId, charges, 'loafline');
      const items: Record<string, string> = {};
      charges.forEach((charge, index) => {
        const item = draft.items[index];
        if (item) items[charge.key] = item.invoiceItemId;
      });
      const taxItems = await killbill.addTaxItems(
        accountId,
        draft.invoiceId,
        price.taxes.map((line) => ({ description: line.code, amountCents: line.amount.cents })),
        'loafline',
      );
      price.taxes.forEach((line, index) => {
        const item = taxItems[index];
        if (item) items[`tax:${line.code}`] = item.invoiceItemId;
      });
      await killbill.commitInvoice(draft.invoiceId, 'loafline');
      const paymentId = await killbill.payInvoice({
        accountId,
        invoiceId: draft.invoiceId,
        amountCents: price.total.cents,
        externalKey: orderNumber,
        actor: 'loafline',
      });

      const paidAt = new Date();
      const shipOn = shipOnFor(paidAt, await settingsCutoff(client));
      await client.query(
        `INSERT INTO orders (number, customer_id, email, locale, status, fulfilment, placed_at,
            ship_on, shipping, subtotal_cents, shipping_cents, taxes, total_cents, version,
            killbill_invoice_id, killbill_payment_id, killbill_items)
         VALUES ($1, $2, $3, $4, 'paid', 'to_pack', $5, $6, $7, $8, $9, $10, $11, 1, $12, $13, $14)`,
        [
          orderNumber,
          input.customer.id,
          input.customer.email,
          input.customer.locale,
          paidAt,
          shipOn,
          JSON.stringify(input.shipping),
          price.subtotal.cents,
          price.shipping_fee.cents,
          JSON.stringify(price.taxes),
          price.total.cents,
          draft.invoiceId,
          paymentId,
          JSON.stringify(items),
        ],
      );
      for (const row of held.rows) {
        await client.query(
          `INSERT INTO order_lines (order_number, batch_code, scent, bar, unit_price_cents)
           VALUES ($1, $2, $3, $4, $5)`,
          [orderNumber, row.batch_code, scentOf.get(row.batch_code) ?? row.batch_code, row.bar, BAR_PRICE_CENTS],
        );
      }
      await client.query(`UPDATE holds SET status = 'converted' WHERE id = ANY($1::uuid[])`, [
        [...input.holdIds],
      ]);
      const byBatch = new Map<string, number[]>();
      for (const row of held.rows) {
        byBatch.set(row.batch_code, [...(byBatch.get(row.batch_code) ?? []), row.bar]);
      }
      for (const [batch, bars] of [...byBatch].sort(([left], [right]) => (left < right ? -1 : 1))) {
        await client.query(
          `INSERT INTO stock_movements (batch_code, kind, bars, ref) VALUES ($1, 'sale', $2, $3)`,
          [batch, bars.sort((left, right) => left - right), orderNumber],
        );
      }
      const mail = orderConfirmationMail(
        {
          number: orderNumber,
          lines: held.rows.map((row) => ({
            batch: row.batch_code,
            scent: scentOf.get(row.batch_code) ?? row.batch_code,
            bar: row.bar,
            unit_price: { cents: BAR_PRICE_CENTS, currency: 'CAD' },
            refunded: false,
          })),
          subtotal: price.subtotal,
          shipping_fee: price.shipping_fee,
          taxes: price.taxes,
          total: price.total,
          ship_on: shipOn,
        },
        input.customer.locale,
      );
      await enqueueNotice(client, {
        key: `order.${orderNumber}`,
        kind: 'order_confirmation',
        recipient: input.customer.email,
        locale: input.customer.locale,
        subject: mail.subject,
        body: mail.body,
      });
      return orderNumber;
    });
  } catch (error) {
    if (error instanceof BillingUnavailableError) {
      noteBillingFailure();
      throw errors.billingUnavailable(BANNERS.checkoutShort);
    }
    throw error;
  }
}
