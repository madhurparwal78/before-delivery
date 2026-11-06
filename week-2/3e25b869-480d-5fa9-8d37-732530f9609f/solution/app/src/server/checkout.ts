// Checkout: from active holds to a paid order, all or nothing.
import { dropScent, pick } from '../shared/catalog.js';
import { BAR_CENTS, dropTotals, SHIPPING_CENTS } from '../shared/money.js';
import { type Customer, requireCustomer } from './auth.js';
import { packingCutoff, settleSoldOut } from './batches.js';
import { list, object, peek, read, shippingAddress, type ShippingAddress, text } from './body.js';
import { pool, takeSequenceNumber, tx } from './db.js';
import { orderNotice } from './emails.js';
import { ApiError, conflict, notFound } from './errors.js';
import { HOLD_COLUMNS, type HoldRow, isUuid } from './holds.js';
import { route } from './http.js';
import { idempotent } from './idempotency.js';
import { BillingUnavailable, chargeInvoice, ensureAccount, payInvoice } from './killbill.js';
import { barKey, type KbItems, loadOrder, orderJson, shipOn } from './orders.js';
import { drain, enqueue } from './outbox.js';

const holdIds = list(
  text((m) => m.fields.holds, 1, 64),
  (m) => m.fields.holds,
);
const checkoutBody = object({ holds: holdIds, shipping: shippingAddress });

/** The customer's Kill Bill account, created at their first checkout or subscription and remembered. */
export async function customerAccount(customer: Customer, shipping: ShippingAddress): Promise<string> {
  if (customer.kb_account_id) return customer.kb_account_id;
  const accountId = await ensureAccount(customer.email, shipping.name, customer.locale);
  await pool.query('UPDATE customers SET kb_account_id = $2 WHERE id = $1', [customer.id, accountId]);
  return accountId;
}

route('POST', '/api/checkout', async (ctx) => {
  const customer = await requireCustomer(ctx);
  const ids = peek(holdIds, (ctx.body as { holds?: unknown } | null | undefined)?.holds, ctx.m) ?? [];
  const cartId = ctx.cookies.pdl_cart ?? '';
  const known = ids.every(isUuid)
    ? (await pool.query<{ id: string }>('SELECT id FROM holds WHERE id = ANY($1) AND cart_id = $2', [ids, cartId])).rows
    : [];
  if (known.length !== new Set(ids).size) throw notFound(ctx.m);

  return idempotent(ctx, `checkout:${customer.id}`, () =>
    tx(async (db) => {
      const holds = (await db.query<HoldRow>(`SELECT ${HOLD_COLUMNS(2)} FROM holds h WHERE h.id = ANY($1) ORDER BY h.batch_code, h.bar FOR UPDATE`, [
        ids,
        ctx.now,
      ])).rows;
      if (holds.some((h) => h.status === 'expired')) throw new ApiError(410, 'hold_expired', ctx.m.hold_expired);
      if (holds.some((h) => h.status !== 'active')) throw conflict('hold_not_active', ctx.m.holdNotActive);
      const body = read(checkoutBody, ctx.body, ctx.m);

      const number = await takeSequenceNumber('PDL');
      const totals = dropTotals(holds.length, body.shipping.province);
      const scents = (await db.query<{ code: string; scent: string }>('SELECT code, scent FROM batches WHERE code = ANY($1)', [
        holds.map((h) => h.batch_code),
      ])).rows;
      const scentOf = (code: string) => scents.find((s) => s.code === code)?.scent ?? '';
      let paid: { invoiceId: string; paymentId: string; items: KbItems };
      try {
        const accountId = await customerAccount(customer, body.shipping);
        const invoice = await chargeInvoice(
          accountId,
          [
            ...holds.map((h) => ({
              description: `Bar ${h.bar} · ${h.batch_code} · ${pick(dropScent(scentOf(h.batch_code))?.name ?? { en: '', fr: '' }, 'en-CA')}`,
              cents: BAR_CENTS,
            })),
            { description: 'Shipping', cents: SHIPPING_CENTS },
          ],
          totals.taxes.map((t) => ({ code: t.code, cents: t.amount.cents })),
        );
        const paymentId = await payInvoice(accountId, invoice.invoiceId, totals.total.cents, number);
        const itemFor = (description: string) => invoice.items.find((i) => i.description === description)?.invoiceItemId ?? '';
        paid = {
          invoiceId: invoice.invoiceId,
          paymentId,
          items: {
            bars: Object.fromEntries(
              holds.map((h) => [barKey(h.batch_code, h.bar), invoice.items.find((i) => i.description.startsWith(`Bar ${h.bar} · ${h.batch_code} ·`))?.invoiceItemId ?? '']),
            ),
            shipping: itemFor('Shipping'),
            taxes: Object.fromEntries(totals.taxes.map((t) => [t.code, itemFor(t.code)])),
          },
        };
      } catch (error) {
        if (error instanceof BillingUnavailable) throw new ApiError(503, 'billing_unavailable', ctx.m.checkoutUnavailable);
        throw error;
      }

      const placedAt = new Date();
      const shipDate = shipOn(placedAt, await packingCutoff(db));
      await db.query(
        `INSERT INTO orders (number, customer_id, status, fulfilment, placed_at, ship_on, locale, email, shipping, subtotal_cents,
           shipping_cents, taxes, total_cents, version, kb_invoice_id, kb_payment_id, kb_items)
         VALUES ($1,$2,'paid','to_pack',$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,$13,$14)`,
        [
          number,
          customer.id,
          placedAt,
          shipDate,
          ctx.locale,
          customer.email,
          JSON.stringify(body.shipping),
          totals.subtotal.cents,
          totals.shipping_fee.cents,
          JSON.stringify(totals.taxes),
          totals.total.cents,
          paid.invoiceId,
          paid.paymentId,
          JSON.stringify(paid.items),
        ],
      );
      for (const h of holds) {
        await db.query('INSERT INTO order_lines (order_number, batch_code, bar, unit_cents) VALUES ($1,$2,$3,$4)', [number, h.batch_code, h.bar, BAR_CENTS]);
      }
      await db.query(`UPDATE holds SET status = 'converted' WHERE id = ANY($1)`, [body.holds]);
      for (const code of [...new Set(holds.map((h) => h.batch_code))]) {
        const bars = holds.filter((h) => h.batch_code === code).map((h) => h.bar);
        await db.query(`INSERT INTO movements (batch_code, kind, bars, ref, at) VALUES ($1,'sale',$2,$3,$4)`, [code, bars, number, placedAt]);
        await settleSoldOut(db, code, placedAt);
      }
      const loaded = await loadOrder(db, number);
      const order = orderJson(loaded as NonNullable<typeof loaded>);
      await enqueue(
        db,
        orderNotice({
          number,
          email: customer.email,
          locale: ctx.locale,
          lines: order.lines.map((l) => ({ batch: l.batch, scent: l.scent, bar: l.bar, unit_cents: l.unit_price.cents })),
          subtotal: totals.subtotal.cents,
          shipping: totals.shipping_fee.cents,
          taxes: totals.taxes,
          total: totals.total.cents,
          shipOn: shipDate,
        }),
        placedAt,
      );
      return { status: 201, body: { order } };
    }).then((reply) => {
      void drain();
      return reply;
    }),
  );
});

