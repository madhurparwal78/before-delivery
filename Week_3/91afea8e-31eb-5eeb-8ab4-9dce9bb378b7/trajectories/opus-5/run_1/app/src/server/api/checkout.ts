/** Checkout: all or nothing, one order per key, one claim per unit of stock. */

import { config } from '../config.js';
import { one, query, transaction, type Tx } from '../db.js';
import { emiAmountAllowed } from '../domain/emi.js';
import {
  cardNetwork,
  luhnValid,
  newId,
  countCodePoints,
} from '../domain/identity.js';
import { allocate } from '../domain/money.js';
import { ApiError, notFound, validationFailed } from '../http/errors.js';
import { json, route, type Ctx, type Reply } from '../http/router.js';
import { readIdempotencyKey, withIdempotency } from '../idempotency.js';
import { kbAccountFor, pollProviderPayment } from '../payments.js';
import { recordPurchase, recordRefund } from '../services/killbill.js';
import { startNetbanking, startUpiCollect, BANKS } from '../services/provider.js';
import { storeShipmentDocuments } from '../documents.js';
import { loadQuote } from '../quote.js';
import { FIELD, pincodeNotServiceable } from '../../shared/messages.js';
import type { LegMethod, PaymentMethod } from '../../shared/types.js';

type CardInput = {
  savedCardId: string | null;
  number: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  cvv: string;
  name: string;
  save: boolean;
  network: string | null;
  last4: string | null;
};

type PaymentInput = {
  method: PaymentMethod | null;
  useBalance: boolean;
  vpa: string | null;
  bankCode: string | null;
  tenureMonths: number | null;
  card: CardInput | null;
};

type PlannedLeg = {
  method: LegMethod;
  amountPaise: number;
  externalKey: string;
  shipmentId: string | null;
  confirmsAtOnce: boolean;
  cardLast4: string | null;
  cardNetwork: string | null;
};

function readObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readPaymentInput(ctx: Ctx, errors: Record<string, string>): PaymentInput {
  const payment = readObject(ctx.body.payment);
  const methods: PaymentMethod[] = ['upi', 'card', 'netbanking', 'emi', 'cod'];
  const rawMethod = payment.method;
  const method =
    rawMethod === null || rawMethod === undefined
      ? null
      : methods.includes(rawMethod as PaymentMethod)
        ? (rawMethod as PaymentMethod)
        : null;
  if (rawMethod !== null && rawMethod !== undefined && method === null) {
    errors.method = FIELD.unsettable;
  }
  const useBalance = payment.use_balance === true;

  const upi = readObject(payment.upi);
  const netbanking = readObject(payment.netbanking);
  const emi = readObject(payment.emi);
  const cardSource = method === 'emi' ? readObject(emi.card) : readObject(payment.card);

  let card: CardInput | null = null;
  if (method === 'card' || method === 'emi') {
    const savedCardId = typeof cardSource.saved_card_id === 'string' ? cardSource.saved_card_id : null;
    const cvv = typeof cardSource.cvv === 'string' ? cardSource.cvv : '';
    if (!/^[0-9]{3}$/.test(cvv)) errors.cvv = FIELD.tooShort('Name', 3);
    if (savedCardId !== null) {
      card = {
        savedCardId,
        number: null,
        expiryMonth: null,
        expiryYear: null,
        cvv,
        name: '',
        save: false,
        network: null,
        last4: null,
      };
    } else {
      const number = typeof cardSource.number === 'string' ? cardSource.number.replace(/\s/g, '') : '';
      const expiryMonth = typeof cardSource.expiry_month === 'number' ? cardSource.expiry_month : 0;
      const expiryYear = typeof cardSource.expiry_year === 'number' ? cardSource.expiry_year : 0;
      const name = typeof cardSource.name === 'string' ? cardSource.name : '';
      const network = cardNetwork(number);
      if (!/^[0-9]{12,19}$/.test(number) || !luhnValid(number)) {
        errors.number = FIELD.unknownCardNetwork;
      } else if (network === null) {
        errors.number = FIELD.unknownCardNetwork;
      }
      const now = new Date();
      const expired =
        expiryYear < now.getUTCFullYear() ||
        (expiryYear === now.getUTCFullYear() && expiryMonth < now.getUTCMonth() + 1);
      if (expiryMonth < 1 || expiryMonth > 12 || expired) {
        errors.expiry_month = FIELD.unsettable;
      }
      if (countCodePoints(name) < 1 || countCodePoints(name) > 60) {
        errors.name = FIELD.tooShort('Name', 1);
      }
      card = {
        savedCardId: null,
        number,
        expiryMonth,
        expiryYear,
        cvv,
        name,
        save: cardSource.save === true,
        network,
        last4: number.slice(-4),
      };
    }
  }

  let vpa: string | null = null;
  if (method === 'upi') {
    const value = typeof upi.vpa === 'string' ? upi.vpa.trim() : '';
    if (!/^[^@\s]{1,}@[^@\s]{1,}$/.test(value) || value.length < 2 || value.length > 256) {
      errors.vpa = FIELD.tooShort('Name', 2);
    }
    vpa = value;
  }

  let bankCode: string | null = null;
  if (method === 'netbanking') {
    const value = typeof netbanking.bank_code === 'string' ? netbanking.bank_code : '';
    if (!BANKS.some((bank) => bank.code === value)) errors.bank_code = FIELD.unsettable;
    bankCode = value;
  }

  let tenureMonths: number | null = null;
  if (method === 'emi') {
    const value = typeof emi.tenure_months === 'number' ? emi.tenure_months : 0;
    if (![3, 6, 9, 12].includes(value)) errors.tenure_months = FIELD.unsettable;
    tenureMonths = value;
  }

  return { method, useBalance, vpa, bankCode, tenureMonths, card };
}

async function claimStock(tx: Tx, listingId: string, quantity: number): Promise<boolean> {
  const rows = await tx.query<{ stock: number }>(
    `UPDATE listings SET stock = stock - $2, updated_at = now()
      WHERE id = $1 AND stock >= $2 RETURNING stock`,
    [listingId, quantity],
  );
  return rows.length > 0;
}

async function performCheckout(ctx: Ctx): Promise<Reply> {
  const accountId = ctx.account?.accountId ?? '';
  const allowed = ['address_id', 'expected_payable_paise', 'payment'];
  const errors: Record<string, string> = {};
  for (const key of Object.keys(ctx.body)) {
    if (!allowed.includes(key)) errors[key] = FIELD.unsettable;
  }
  const addressId = typeof ctx.body.address_id === 'string' ? ctx.body.address_id : '';
  const expectedPayable =
    typeof ctx.body.expected_payable_paise === 'number' ? ctx.body.expected_payable_paise : null;
  if (expectedPayable === null) errors.expected_payable_paise = FIELD.unsettable;
  const payment = readPaymentInput(ctx, errors);
  if (Object.keys(errors).length > 0) throw validationFailed(errors);

  const address = await one<{ id: string; pincode: string }>(
    `SELECT id, pincode FROM addresses WHERE id = $1 AND account_id = $2`,
    [addressId, accountId],
  );
  if (address === null) throw notFound();

  await query(
    `UPDATE cart_state SET address_id = $2, pincode = $3, payment_method = $4, use_balance = $5,
            emi_tenure_months = $6
      WHERE account_id = $1`,
    [
      accountId,
      addressId,
      address.pincode,
      payment.method,
      payment.method === 'emi' ? false : payment.useBalance,
      payment.tenureMonths,
    ],
  );

  const { quote, perLine, perParcel } = await loadQuote(accountId);
  if (quote.lines.filter((line) => line.selected).length === 0) {
    throw validationFailed({ lines: FIELD.cartLineLimit });
  }
  if (quote.parcels.some((parcel) => !parcel.serviceable)) {
    throw validationFailed({ address_id: pincodeNotServiceable(address.pincode) });
  }
  if (quote.payable_paise !== expectedPayable) {
    throw new ApiError(409, 'price_changed', {}, { quote });
  }
  if (payment.method === 'cod' && !quote.cod.eligible) {
    throw validationFailed({ method: quote.cod.message ?? '' });
  }
  if (payment.method === 'emi') {
    const amount = quote.payable_paise + quote.emi_discount_paise;
    if (!emiAmountAllowed(amount)) throw validationFailed({ method: FIELD.emiTooSmall });
  }
  if (quote.due_paise > 0 && payment.method === null) {
    throw validationFailed({ method: FIELD.unsettable });
  }
  if (quote.due_paise === 0 && payment.method !== null) {
    throw validationFailed({ method: FIELD.unsettable });
  }

  let savedCard: { network: string; last4: string } | null = null;
  if (payment.card !== null && payment.card.savedCardId !== null) {
    const card = await one<{ network: string; last4: string }>(
      `SELECT network, last4 FROM cards WHERE card_id = $1 AND account_id = $2`,
      [payment.card.savedCardId, accountId],
    );
    if (card === null) throw notFound();
    savedCard = card;
  }

  const orderId = newId('CH-', 8);
  const paymentId = newId('PAY-', 10);
  const recordedLegs: { kbPaymentId: string; amountPaise: number; legId: string }[] = [];

  try {
    const result = await transaction(async (tx) => {
      for (const line of perLine.values()) {
        const claimed = await claimStock(tx, line.listing.listing_id, line.quantity);
        if (!claimed) {
          throw new ApiError(409, 'sold_out', {}, { listing_ids: [line.listing.listing_id] });
        }
      }

      if (quote.balance_applied_paise > 0) {
        const held = await tx.query<{ id: string }>(
          `UPDATE accounts SET balance_paise = balance_paise - $2
            WHERE id = $1 AND balance_paise >= $2 RETURNING id`,
          [accountId, quote.balance_applied_paise],
        );
        if (held.length === 0) throw new ApiError(409, 'price_changed', {}, { quote });
      }

      await tx.query(
        `INSERT INTO orders (id, account_id, payable_paise, status, coupon_code, address)
         VALUES ($1, $2, $3, $4, $5,
           (SELECT to_jsonb(a) - 'account_id' - 'created_seq' FROM addresses a WHERE a.id = $6))`,
        [
          orderId,
          accountId,
          quote.payable_paise,
          payment.method === 'upi' || payment.method === 'netbanking' ? 'awaiting_payment' : 'placed',
          quote.coupon?.code ?? null,
          addressId,
        ],
      );

      const awaiting = payment.method === 'upi' || payment.method === 'netbanking';
      await tx.query(
        `INSERT INTO payments (payment_id, order_id, account_id, method, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          paymentId,
          orderId,
          accountId,
          payment.method,
          awaiting ? 'awaiting_customer' : payment.method === 'cod' ? 'pending' : 'confirmed',
          awaiting
            ? new Date(Date.now() + config.upiExpirySeconds * 1000).toISOString()
            : null,
        ],
      );

      const shipments: {
        shipmentId: string;
        sellerId: string;
        sellerName: string;
        promiseDate: string;
        total: number;
      }[] = [];
      for (const parcel of quote.parcels) {
        const shipmentId = newId('SH-', 8);
        const plan = perParcel.get(parcel.seller_id);
        if (plan === undefined) continue;
        const lineTotals = plan.lineIds.reduce(
          (sum, lineId) => sum + (perLine.get(lineId)?.lineTotal ?? 0),
          0,
        );
        await tx.query(
          `INSERT INTO shipments (id, order_id, seller_id, account_id, state, promise_date, speed,
                                  delivery_fee_paise, cod_fee_paise, gift_wrap_paise, payment_kind)
           VALUES ($1, $2, $3, $4, 'placed', $5, $6, $7, $8, $9, $10)`,
          [
            shipmentId,
            orderId,
            parcel.seller_id,
            accountId,
            parcel.promise_date,
            parcel.speed,
            parcel.delivery_fee_paise,
            parcel.cod_fee_paise,
            plan.giftWrap,
            payment.method === 'cod' ? 'cod' : 'prepaid',
          ],
        );
        await tx.query(`INSERT INTO shipment_timeline (shipment_id, state) VALUES ($1, 'placed')`, [
          shipmentId,
        ]);
        for (const lineId of plan.lineIds) {
          const line = perLine.get(lineId);
          const quoteLine = quote.lines.find((entry) => entry.line_id === lineId);
          if (line === undefined || quoteLine === undefined) continue;
          await tx.query(
            `INSERT INTO shipment_lines (line_id, shipment_id, listing_id, title, quantity,
               unit_price_paise, coupon_share_paise, line_total_paise, gst_rate, taxable_value_paise,
               cgst_paise, sgst_paise, igst_paise, gift_wrap, gift_message, emi_subvention_paise)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
            [
              newId('SL-'),
              shipmentId,
              line.listing.listing_id,
              line.listing.title,
              line.quantity,
              line.unitPrice,
              line.couponShare,
              line.lineTotal,
              quoteLine.gst_rate,
              quoteLine.taxable_value_paise,
              quoteLine.cgst_paise,
              quoteLine.sgst_paise,
              quoteLine.igst_paise,
              line.giftWrap,
              line.giftMessage,
              line.emiSubvention,
            ],
          );
        }
        shipments.push({
          shipmentId,
          sellerId: parcel.seller_id,
          sellerName: parcel.seller_name,
          promiseDate: parcel.promise_date ?? '',
          total: lineTotals + parcel.delivery_fee_paise + parcel.cod_fee_paise + plan.giftWrap,
        });
      }

      const planned: PlannedLeg[] = [];
      if (quote.balance_applied_paise > 0) {
        planned.push({
          method: 'balance',
          amountPaise: quote.balance_applied_paise,
          externalKey: `${orderId}-balance`,
          shipmentId: null,
          confirmsAtOnce: true,
          cardLast4: null,
          cardNetwork: null,
        });
      }
      if (quote.due_paise > 0 && payment.method !== null) {
        if (payment.method === 'cod') {
          const shares = allocate(
            quote.due_paise,
            shipments.map((shipment) => shipment.total),
          );
          shipments.forEach((shipment, index) => {
            planned.push({
              method: 'cod',
              amountPaise: shares[index],
              externalKey: `${orderId}-cod-${shipment.shipmentId}`,
              shipmentId: shipment.shipmentId,
              confirmsAtOnce: false,
              cardLast4: null,
              cardNetwork: null,
            });
          });
        } else {
          const network = savedCard?.network ?? payment.card?.network ?? null;
          const last4 = savedCard?.last4 ?? payment.card?.last4 ?? null;
          planned.push({
            method: payment.method,
            amountPaise: quote.due_paise,
            externalKey: `${orderId}-${payment.method}`,
            shipmentId: null,
            confirmsAtOnce: payment.method === 'card' || payment.method === 'emi',
            cardLast4: payment.method === 'card' || payment.method === 'emi' ? last4 : null,
            cardNetwork: payment.method === 'card' || payment.method === 'emi' ? network : null,
          });
        }
      }

      const legIds = new Map<string, string>();
      for (const leg of planned) {
        const legId = newId('LEG-');
        legIds.set(leg.externalKey, legId);
        await tx.query(
          `INSERT INTO payment_legs (leg_id, payment_id, order_id, shipment_id, method, amount_paise,
             status, external_key, card_last4, card_network)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            legId,
            paymentId,
            orderId,
            leg.shipmentId,
            leg.method,
            leg.amountPaise,
            leg.confirmsAtOnce ? 'confirmed' : 'pending',
            leg.externalKey,
            leg.cardLast4,
            leg.cardNetwork,
          ],
        );
      }

      const kbAccountId = planned.some((leg) => leg.confirmsAtOnce)
        ? await kbAccountFor(accountId)
        : null;
      for (const leg of planned) {
        if (!leg.confirmsAtOnce) continue;
        if (kbAccountId === null) throw new ApiError(503, 'payments_unavailable');
        const kbPaymentId = await recordPurchase({
          kbAccountId,
          externalKey: leg.externalKey,
          amountPaise: leg.amountPaise,
        });
        if (kbPaymentId === null) throw new ApiError(503, 'payments_unavailable');
        const legId = legIds.get(leg.externalKey) ?? '';
        recordedLegs.push({ kbPaymentId, amountPaise: leg.amountPaise, legId });
        await tx.query(
          `UPDATE payment_legs SET kb_payment_id = $2, kb_recorded = true WHERE leg_id = $1`,
          [legId, kbPaymentId],
        );
      }

      if (payment.method === 'upi') {
        const started = await startUpiCollect({
          paymentId,
          vpa: payment.vpa ?? '',
          amountPaise: quote.due_paise,
          expiresInSeconds: config.upiExpirySeconds,
        });
        if (!started) throw new ApiError(503, 'upi_unavailable');
      }
      if (payment.method === 'netbanking') {
        const started = await startNetbanking({
          paymentId,
          bankCode: payment.bankCode ?? '',
          amountPaise: quote.due_paise,
        });
        if (!started) throw new ApiError(503, 'netbanking_unavailable');
      }

      if (payment.card !== null && payment.card.savedCardId === null && payment.card.save) {
        await tx.query(
          `INSERT INTO cards (card_id, account_id, network, last4, expiry_month, expiry_year, name)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            newId('card-'),
            accountId,
            payment.card.network ?? '',
            payment.card.last4 ?? '',
            payment.card.expiryMonth ?? 0,
            payment.card.expiryYear ?? 0,
            payment.card.name,
          ],
        );
      }

      for (const lineId of perLine.keys()) {
        await tx.query(`DELETE FROM cart_lines WHERE line_id = $1`, [lineId]);
      }
      await tx.query(
        `UPDATE cart_state SET coupon_code = NULL, payment_method = NULL, use_balance = false,
                emi_tenure_months = NULL
          WHERE account_id = $1`,
        [accountId],
      );

      const legs = await tx.query<{ method: LegMethod; amount_paise: number; status: string }>(
        `SELECT method, amount_paise, status FROM payment_legs WHERE order_id = $1 ORDER BY created_seq`,
        [orderId],
      );

      return {
        order_id: orderId,
        status: awaiting ? ('awaiting_payment' as const) : ('placed' as const),
        payable_paise: quote.payable_paise,
        shipments: shipments.map((shipment) => ({
          shipment_id: shipment.shipmentId,
          seller_id: shipment.sellerId,
          seller_name: shipment.sellerName,
          state: 'placed' as const,
          promise_date: shipment.promiseDate,
        })),
        payment: {
          payment_id: paymentId,
          status: awaiting ? ('awaiting_customer' as const) : ('confirmed' as const),
          expires_at: awaiting
            ? new Date(Date.now() + config.upiExpirySeconds * 1000).toISOString()
            : null,
          legs,
        },
        confirmation_url: `/orders/${orderId}/placed`,
      };
    });

    for (const shipment of result.shipments) {
      void storeShipmentDocuments(shipment.shipment_id);
    }
    return json(result, 201);
  } catch (error) {
    for (const leg of recordedLegs) {
      await recordRefund({
        kbPaymentId: leg.kbPaymentId,
        transactionExternalKey: `${leg.legId}-undo`,
        amountPaise: leg.amountPaise,
      });
    }
    throw error;
  }
}

export function registerCheckoutRoutes(): void {
  route('POST', '/api/checkout', 'shopper', async (ctx) => {
    const key = readIdempotencyKey(ctx.headers['idempotency-key']);
    const { reply, replayed } = await withIdempotency(
      ctx.account?.accountId ?? '',
      key,
      ctx.body,
      () => performCheckout(ctx),
    );
    if (replayed) ctx.responseHeaders['idempotent-replayed'] = 'true';
    return reply;
  });

  route('GET', '/api/payments/:paymentId', 'shopper', async (ctx) => {
    const payment = await one<{
      payment_id: string;
      method: PaymentMethod | null;
      status: string;
      expires_at: string | null;
      order_id: string;
    }>(
      `SELECT payment_id, method, status, expires_at, order_id FROM payments
        WHERE payment_id = $1 AND account_id = $2`,
      [ctx.params.paymentId, ctx.account?.accountId],
    );
    if (payment === null) throw notFound();
    if (payment.status === 'awaiting_customer') await pollProviderPayment(payment.payment_id);
    const fresh = await one<{
      payment_id: string;
      method: PaymentMethod | null;
      status: string;
      expires_at: string | null;
    }>(
      `SELECT payment_id, method, status, expires_at FROM payments WHERE payment_id = $1`,
      [payment.payment_id],
    );
    const legs = await query<{ method: LegMethod; amount_paise: number; status: string }>(
      `SELECT method, amount_paise, status FROM payment_legs WHERE order_id = $1 ORDER BY created_seq`,
      [payment.order_id],
    );
    return json({
      payment_id: payment.payment_id,
      method: fresh?.method ?? payment.method,
      status: fresh?.status ?? payment.status,
      expires_at: fresh?.expires_at ?? payment.expires_at,
      legs,
    });
  });
}
