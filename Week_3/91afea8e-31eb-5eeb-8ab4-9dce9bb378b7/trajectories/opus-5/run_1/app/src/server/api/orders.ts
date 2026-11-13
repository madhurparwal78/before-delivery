/** Orders, shipments, invoices and returns, each reachable only by the people who own them. */

import { one, query } from '../db.js';
import { newId } from '../domain/identity.js';
import { indiaDate } from '../domain/time.js';
import { shipmentMoveAllowed } from '../domain/transitions.js';
import { ApiError, invalidTransition, notFound, validationFailed } from '../http/errors.js';
import { json, pdf, route, type Ctx } from '../http/router.js';
import { Validator } from '../http/validate.js';
import { readInvoice } from '../documents.js';
import {
  createRefund,
  lineRefundAmount,
  releaseShipmentStock,
  pollProviderPayment,
} from '../payments.js';
import { returnableUntil, returnView, sellerShipmentView, shopperShipmentView } from '../views.js';
import { decodeCursor, encodeCursor } from '../searchQuery.js';
import { FIELD } from '../../shared/messages.js';
import { formatPromiseDate } from '../../shared/format.js';
import type { LegMethod, PaymentMethod } from '../../shared/types.js';

function accountOf(ctx: Ctx): string {
  return ctx.account?.accountId ?? '';
}

async function ownedShipment(ctx: Ctx, shipmentId: string): Promise<{
  id: string;
  order_id: string;
  account_id: string;
  seller_id: string;
  state: string;
  label_stored: boolean;
  payment_kind: 'prepaid' | 'cod';
  delivered_on: string | null;
}> {
  const shipment = await one<{
    id: string;
    order_id: string;
    account_id: string;
    seller_id: string;
    state: string;
    label_stored: boolean;
    payment_kind: 'prepaid' | 'cod';
    delivered_on: string | null;
  }>(
    `SELECT s.id, s.order_id, s.account_id, s.seller_id, s.state, s.label_stored, s.payment_kind,
            s.delivered_on::text AS delivered_on
       FROM shipments s WHERE s.id = $1`,
    [shipmentId],
  );
  if (shipment === null) throw notFound();
  const role = ctx.account?.role;
  if (role === 'shopper' && shipment.account_id !== accountOf(ctx)) throw notFound();
  if (role === 'seller') {
    const seller = await one<{ id: string }>(`SELECT id FROM sellers WHERE account_id = $1`, [
      accountOf(ctx),
    ]);
    if (seller === null || seller.id !== shipment.seller_id) throw notFound();
  }
  return shipment;
}

export function registerOrderRoutes(): void {
  route('GET', '/api/orders', 'shopper', async (ctx) => {
    const limitRaw = ctx.query.get('limit');
    let limit = 24;
    if (limitRaw !== null && limitRaw !== '') {
      const parsed = Number(limitRaw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 24) {
        throw validationFailed({ limit: FIELD.badSearchLimit });
      }
      limit = parsed;
    }
    const cursor = decodeCursor(ctx.query.get('cursor'));
    const rows = await query<{
      order_id: string;
      placed_at: string;
      payable_paise: number;
      created_seq: number;
      shipment_count: number;
      shipment_states: string[];
    }>(
      `SELECT o.id AS order_id, o.placed_at, o.payable_paise, o.created_seq,
              count(s.id)::int AS shipment_count,
              COALESCE(array_agg(s.state ORDER BY s.created_seq) FILTER (WHERE s.id IS NOT NULL), ARRAY[]::text[])
                AS shipment_states
         FROM orders o LEFT JOIN shipments s ON s.order_id = o.id
        WHERE o.account_id = $1
          AND ($2::timestamptz IS NULL OR o.placed_at < $2::timestamptz
               OR (o.placed_at = $2::timestamptz AND o.created_seq < $3::bigint))
        GROUP BY o.id, o.placed_at, o.payable_paise, o.created_seq
        ORDER BY o.placed_at DESC, o.created_seq DESC
        LIMIT $4`,
      [accountOf(ctx), cursor?.t ?? null, cursor?.s ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    return json({
      orders: page.map((row) => ({
        order_id: row.order_id,
        placed_at: new Date(row.placed_at).toISOString(),
        payable_paise: row.payable_paise,
        shipment_count: row.shipment_count,
        shipment_states: row.shipment_states,
      })),
      next_cursor:
        rows.length > limit && page.length > 0
          ? encodeCursor({
              t: new Date(page[page.length - 1].placed_at).toISOString(),
              s: page[page.length - 1].created_seq,
            })
          : null,
    });
  });

  route('GET', '/api/orders/:orderId', 'shopper', async (ctx) => {
    const order = await one<{
      id: string;
      placed_at: string;
      payable_paise: number;
      address: Record<string, unknown>;
    }>(
      `SELECT id, placed_at, payable_paise, address FROM orders WHERE id = $1 AND account_id = $2`,
      [ctx.params.orderId, accountOf(ctx)],
    );
    if (order === null) throw notFound();
    const payment = await one<{
      payment_id: string;
      method: PaymentMethod | null;
      status: string;
      expires_at: string | null;
    }>(
      `SELECT payment_id, method, status, expires_at FROM payments WHERE order_id = $1`,
      [order.id],
    );
    if (payment !== null && payment.status === 'awaiting_customer') {
      await pollProviderPayment(payment.payment_id);
    }
    const fresh = await one<{
      payment_id: string;
      method: PaymentMethod | null;
      status: string;
      expires_at: string | null;
    }>(`SELECT payment_id, method, status, expires_at FROM payments WHERE order_id = $1`, [order.id]);
    const legs = await query<{
      method: LegMethod;
      amount_paise: number;
      status: string;
      card_last4: string | null;
      card_network: string | null;
    }>(
      `SELECT method, amount_paise, status, card_last4, card_network FROM payment_legs
        WHERE order_id = $1 ORDER BY created_seq`,
      [order.id],
    );
    const shipmentIds = await query<{ id: string }>(
      `SELECT id FROM shipments WHERE order_id = $1 ORDER BY created_seq`,
      [order.id],
    );
    const shipments = [];
    for (const row of shipmentIds) {
      const view = await shopperShipmentView(row.id);
      if (view !== null) shipments.push(view);
    }
    return json({
      order_id: order.id,
      placed_at: new Date(order.placed_at).toISOString(),
      address: order.address,
      payment:
        fresh === null
          ? null
          : {
              payment_id: fresh.payment_id,
              method: fresh.method,
              status: fresh.status,
              expires_at: fresh.expires_at === null ? null : new Date(fresh.expires_at).toISOString(),
              legs,
            },
      shipments,
      payable_paise: order.payable_paise,
    });
  });

  route(
    'GET',
    '/api/shipments/:shipmentId',
    'signed_in',
    async (ctx) => {
      const shipment = await ownedShipment(ctx, ctx.params.shipmentId);
      if (ctx.account?.role === 'seller') {
        const view = await sellerShipmentView(shipment.id);
        if (view === null) throw notFound();
        return json(view);
      }
      if (ctx.account?.role !== 'shopper') throw notFound();
      const view = await shopperShipmentView(shipment.id);
      if (view === null) throw notFound();
      return json(view);
    },
    { exactKeys: true },
  );

  route(
    'POST',
    '/api/shipments/:shipmentId/cancel',
    'shopper',
    async (ctx) => {
      const shipment = await ownedShipment(ctx, ctx.params.shipmentId);
      if (!shipmentMoveAllowed(shipment.state as 'placed', 'cancelled', 'shopper')) {
        throw invalidTransition(shipment.state, 'cancelled');
      }
      await query(`UPDATE shipments SET state = 'cancelled' WHERE id = $1`, [shipment.id]);
      await query(`INSERT INTO shipment_timeline (shipment_id, state) VALUES ($1, 'cancelled')`, [
        shipment.id,
      ]);
      await releaseShipmentStock(shipment.id);
      const totals = await one<{
        prepaid: number;
      }>(
        `SELECT (COALESCE(sum(sl.line_total_paise), 0) + s.gift_wrap_paise + s.delivery_fee_paise)::bigint
                  AS prepaid
           FROM shipments s LEFT JOIN shipment_lines sl ON sl.shipment_id = s.id
          WHERE s.id = $1
          GROUP BY s.id, s.gift_wrap_paise, s.delivery_fee_paise`,
        [shipment.id],
      );
      if (shipment.payment_kind === 'prepaid' && totals !== null && totals.prepaid > 0) {
        await createRefund({
          orderId: shipment.order_id,
          shipmentId: shipment.id,
          shipmentLineId: null,
          quantity: null,
          amountPaise: totals.prepaid,
          kind: 'cancel',
          reason: 'Shipment cancelled',
        });
      }
      const view = await shopperShipmentView(shipment.id);
      if (view === null) throw notFound();
      return json(view);
    },
    { exactKeys: true },
  );

  route('GET', '/api/shipments/:shipmentId/invoice', 'signed_in', async (ctx) => {
    const role = ctx.account?.role;
    const shipment =
      role === 'support'
        ? await one<{ id: string; order_id: string; invoice_stored: boolean }>(
            `SELECT id, order_id, invoice_stored FROM shipments WHERE id = $1`,
            [ctx.params.shipmentId],
          )
        : await (async () => {
            const owned = await ownedShipment(ctx, ctx.params.shipmentId);
            return one<{ id: string; order_id: string; invoice_stored: boolean }>(
              `SELECT id, order_id, invoice_stored FROM shipments WHERE id = $1`,
              [owned.id],
            );
          })();
    if (shipment === null) throw notFound();
    if (!shipment.invoice_stored) throw new ApiError(409, 'document_pending');
    const bytes = await readInvoice(shipment.order_id, shipment.id);
    if (bytes === null) throw new ApiError(409, 'document_pending');
    return pdf(bytes, `INV-${shipment.id}.pdf`);
  });

  route('POST', '/api/returns', 'shopper', async (ctx) => {
    const validator = new Validator(ctx.body, ['shipment_line_id', 'quantity', 'reason']);
    const lineId = typeof ctx.body.shipment_line_id === 'string' ? ctx.body.shipment_line_id : '';
    const quantity = validator.integer('quantity', {
      min: 1,
      max: 10,
      message: FIELD.quantityOverTen,
    });
    const reason = validator.text('reason', { label: 'Reason', min: 0, max: 500 });
    validator.done();

    const line = await one<{
      line_id: string;
      shipment_id: string;
      quantity: number;
      refunded_quantity: number;
      return_days: number;
      state: string;
      delivered_on: string | null;
      account_id: string;
      seller_id: string;
      order_id: string;
    }>(
      `SELECT sl.line_id, sl.shipment_id, sl.quantity, sl.refunded_quantity, c.return_days,
              s.state, s.delivered_on::text AS delivered_on, s.account_id, s.seller_id, s.order_id
         FROM shipment_lines sl
         JOIN shipments s ON s.id = sl.shipment_id
         JOIN listings l ON l.id = sl.listing_id
         JOIN products p ON p.id = l.product_id
         JOIN categories c ON c.slug = p.category_slug
        WHERE sl.line_id = $1`,
      [lineId],
    );
    if (line === null || line.account_id !== accountOf(ctx)) throw notFound();
    if (line.state !== 'delivered') throw invalidTransition(line.state, 'return_requested');
    if (line.return_days === 0) throw new ApiError(409, 'not_returnable');
    const until = returnableUntil(line.delivered_on, line.return_days);
    if (until !== null && indiaDate() > until) {
      throw new ApiError(409, 'return_window_closed', { date: formatPromiseDate(until) });
    }
    const openReturns = await query<{ quantity: number }>(
      `SELECT quantity FROM returns WHERE shipment_line_id = $1 AND state IN ('requested','picked')`,
      [lineId],
    );
    const reserved =
      line.refunded_quantity + openReturns.reduce((sum, row) => sum + row.quantity, 0);
    const availableUnits = line.quantity - reserved;
    if (quantity > availableUnits) {
      throw validationFailed({ quantity: FIELD.refundTooLarge(Math.max(availableUnits, 0)) });
    }

    const returnId = newId('RT-');
    await query(
      `INSERT INTO returns (id, shipment_line_id, shipment_id, account_id, seller_id, quantity, reason, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'requested')`,
      [
        returnId,
        lineId,
        line.shipment_id,
        line.account_id,
        line.seller_id,
        quantity,
        reason,
      ],
    );
    return json(
      {
        return_id: returnId,
        state: 'requested',
        quantity,
        refund_estimate_paise: await lineRefundAmount(lineId, quantity),
      },
      201,
    );
  });

  route('GET', '/api/returns/:returnId', 'signed_in', async (ctx) => {
    const row = await one<{ account_id: string; seller_id: string }>(
      `SELECT account_id, seller_id FROM returns WHERE id = $1`,
      [ctx.params.returnId],
    );
    if (row === null) throw notFound();
    const role = ctx.account?.role;
    if (role === 'shopper' && row.account_id !== accountOf(ctx)) throw notFound();
    if (role === 'seller') {
      const seller = await one<{ id: string }>(`SELECT id FROM sellers WHERE account_id = $1`, [
        accountOf(ctx),
      ]);
      if (seller === null || seller.id !== row.seller_id) throw notFound();
    }
    const view = await returnView(ctx.params.returnId);
    if (view === null) throw notFound();
    return json(view);
  });
}
