import { query, one, withTransaction } from '../db/db.js';
import { ApiError } from '../errors.js';
import { discountedPrice, seatRefundAmount } from './money.js';
import { orderRef, randomToken } from './ids.js';
import * as kb from '../providers/billing.js';
import { queueEmail } from '../providers/email.js';
import type { Locale } from '../locales.js';
import type { ModelRow } from './models.js';
import { planOf } from './plans.js';
import { config } from '../config.js';
import { randomUUID } from 'node:crypto';

export type LicenceType = 'personal' | 'commercial' | 'studio' | 'edition';
export type OrderStatus = 'pending' | 'paid' | 'partially_refunded' | 'refunded';

export interface OrderRow {
  id: number;
  order_ref: string;
  receipt_token: string;
  buyer_email: string;
  model_id: number;
  licence: LicenceType;
  seats: number;
  amount_cents: number;
  refunded_cents: number;
  refunded_seats: number;
  status: OrderStatus;
  edition_number: number | null;
  edition_total: number | null;
  locale: Locale;
  upgraded_to: string | null;
  upgrade_from_id: number | null;
  kb_account_id: string | null;
  kb_invoice_id: string | null;
  kb_payment_id: string | null;
  kb_payment_method_id: string | null;
  kb_item_uuid: string | null;
  created_at: string;
}

export const ORDER_COLUMNS = `id, order_ref, receipt_token, buyer_email, model_id, licence, seats, amount_cents,
  refunded_cents, refunded_seats, status, edition_number, edition_total, locale, upgraded_to, upgrade_from_id,
  kb_account_id, kb_invoice_id, kb_payment_id, kb_payment_method_id, kb_item_uuid, created_at`;

export const seatsOf = (licence: LicenceType): number => (licence === 'studio' ? 3 : 1);

/** A licence's price is its list price × (100 − discount) / 100, rounded half up — the single computation. */
export function currentPriceCents(model: ModelRow, licence: Exclude<LicenceType, 'edition'>): number | null {
  const list =
    licence === 'personal'
      ? model.price_personal_cents
      : licence === 'commercial'
        ? model.price_commercial_cents
        : model.price_studio_cents;
  if (list === null) return null;
  return discountedPrice(list, model.discount_percent);
}

export async function getOrderByReceipt(token: string): Promise<OrderRow | null> {
  return one<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE receipt_token = $1`, [token]);
}

export async function getOrderByRef(ref: string): Promise<OrderRow | null> {
  return one<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE order_ref = $1`, [ref]);
}

export interface CheckoutInput {
  modelSlug: string;
  licence: LicenceType;
  email: string;
  terms: boolean;
  locale: Locale;
  upgradeFromToken?: string;
}

export interface CheckoutOutcome {
  order_ref: string;
  receipt_token: string;
  licence: LicenceType;
  amount_cents: number;
  edition_number: number | null;
}

/**
 * One checkout: claim (editions), one Kill Bill charge, one PURCHASE payment, then
 * the order exists. Resumable: a retried checkout with the same key reuses its order
 * row and its recorded Kill Bill ids, so no second charge is ever created.
 */
export async function performCheckout(input: CheckoutInput, idemKey: string): Promise<CheckoutOutcome> {
  const modelRow = await one<ModelRow>('SELECT * FROM models WHERE slug = $1', [input.modelSlug]);
  if (modelRow === null) throw new ApiError(404, 'not_found');
  const planRow = await one<{ plan: string }>('SELECT plan FROM plan_state WHERE id = 1');
  const plan = planOf(planRow?.plan ?? 'free');

  let amountCents: number;
  let editionNumber: number | null = null;
  let editionTotal: number | null = null;
  let upgradeFrom: OrderRow | null = null;
  let licence: LicenceType = input.licence;

  if (input.upgradeFromToken !== undefined) {
    upgradeFrom = await getOrderByReceipt(input.upgradeFromToken);
    if (upgradeFrom === null) throw new ApiError(404, 'not_found');
    if (upgradeFrom.licence === 'edition' || upgradeFrom.status === 'refunded' || upgradeFrom.upgraded_to !== null) {
      throw new ApiError(409, 'upgrade_not_possible');
    }
    const chain = await upgradeChainPaid(upgradeFrom.id);
    const target = input.licence;
    const targetPrice = target === 'edition' ? null : currentPriceCents(modelRow, target);
    const upgradeOk =
      (upgradeFrom.licence === 'personal' && (target === 'commercial' || target === 'studio')) ||
      (upgradeFrom.licence === 'commercial' && target === 'studio');
    if (!upgradeOk || targetPrice === null) throw new ApiError(409, 'upgrade_not_possible');
    amountCents = targetPrice - chain;
    if (amountCents <= 0) throw new ApiError(409, 'upgrade_not_possible');
    licence = target;
  } else if (input.licence === 'edition') {
    if (!plan.editions || modelRow.edition_total === null || modelRow.edition_price_cents === null || modelRow.state !== 'published') {
      throw new ApiError(409, 'edition_unavailable');
    }
    const claim = await claimEditionCopy(modelRow.id);
    if (claim === null) throw new ApiError(409, 'edition_sold_out');
    editionNumber = claim.number;
    editionTotal = modelRow.edition_total;
    amountCents = modelRow.edition_price_cents;
  } else {
    const price = currentPriceCents(modelRow, input.licence);
    if (price === null) throw new ApiError(404, 'not_found');
    amountCents = price;
  }

  const order = await insertPendingOrder(input, licence, amountCents, editionNumber, editionTotal, upgradeFrom, idemKey);

  const failedBeforeCharge = order.kb_account_id === null;
  try {
    await chargeInKillBill(order, modelRow.title, licence, input.upgradeFromToken !== undefined, editionNumber);
  } catch (err) {
    if (failedBeforeCharge) {
      // Nothing is recorded in Kill Bill yet, so the checkout can be safely abandoned.
      if (editionNumber !== null) await releaseEditionCopy(order.model_id, editionNumber);
      await query('DELETE FROM orders WHERE id = $1', [order.id]);
    }
    throw err;
  }

  await withTransaction(async client => {
    await client.query(`UPDATE orders SET status = 'paid' WHERE id = $1`, [order.id]);
    if (upgradeFrom !== null) {
      await client.query(`UPDATE orders SET upgraded_to = $2 WHERE id = $1`, [upgradeFrom.id, licence]);
    }
  });

  const finalOrder = await one<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1`, [order.id]);
  if (finalOrder === null) throw new Error('order vanished');

  await queueEmail({
    kind: 'receipt',
    order: {
      ref: finalOrder.order_ref,
      email: finalOrder.buyer_email,
      locale: finalOrder.locale,
      licence: finalOrder.licence,
      amountCents: finalOrder.amount_cents,
      editionNumber: finalOrder.edition_number,
      editionTotal: finalOrder.edition_total,
      modelTitle: modelRow.title,
      receiptToken: finalOrder.receipt_token,
    },
  });

  return {
    order_ref: finalOrder.order_ref,
    receipt_token: finalOrder.receipt_token,
    licence: finalOrder.licence,
    amount_cents: finalOrder.amount_cents,
    edition_number: finalOrder.edition_number,
  };
}

async function insertPendingOrder(
  input: CheckoutInput,
  licence: LicenceType,
  amountCents: number,
  editionNumber: number | null,
  editionTotal: number | null,
  upgradeFrom: OrderRow | null,
  idemKey: string,
): Promise<OrderRow> {
  const existing = await one<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE idem_key = $1`, [idemKey]);
  if (existing !== null) return existing;
  return withTransaction(async client => {
    const result = await client.query<OrderRow>(
      `INSERT INTO orders (order_ref, receipt_token, buyer_email, model_id, licence, seats, amount_cents, status, edition_number, edition_total, locale, upgrade_from_id, idem_key)
       VALUES ($1, $2, $3, (SELECT id FROM models WHERE slug = $4), $5, $6, $7, 'pending', $8, $9, $10, $11, $12)
       RETURNING ${ORDER_COLUMNS}`,
      [
        orderRef(),
        randomToken(24),
        input.email,
        input.modelSlug,
        licence,
        seatsOf(licence),
        amountCents,
        editionNumber,
        editionTotal,
        input.locale,
        upgradeFrom?.id ?? null,
        idemKey,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('insert failed');
    if (editionNumber !== null) {
      await client.query(
        `UPDATE edition_copies SET order_id = $1, status = 'claimed' WHERE model_id = $2 AND number = $3 AND order_id IS NULL`,
        [row.id, row.model_id, editionNumber],
      );
      await client.query(`UPDATE models SET edition_sales = edition_sales + 1 WHERE id = $1`, [row.model_id]);
    }
    return row;
  });
}

/** The single edition claim: under the model lock, exactly one checkout claims the last copy. */
export async function claimEditionCopy(modelId: number): Promise<{ number: number } | null> {
  return withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [modelId]);
    const model = await client.query<{ edition_total: number | null }>(
      'SELECT edition_total FROM models WHERE id = $1 FOR UPDATE',
      [modelId],
    );
    const total = model.rows[0]?.edition_total ?? null;
    if (total === null) return null;
    const copies = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM edition_copies WHERE model_id = $1',
      [modelId],
    );
    const used = Number(copies.rows[0]?.count ?? '0');
    if (used >= total) return null;
    const number = used + 1;
    await client.query(
      `INSERT INTO edition_copies (model_id, number, status) VALUES ($1, $2, 'claimed') ON CONFLICT DO NOTHING`,
      [modelId, number],
    );
    return { number };
  });
}

export async function editionRemaining(modelId: number): Promise<number> {
  const row = await one<{ total: number | null; used: string }>(
    `SELECT m.edition_total AS total,
       (SELECT count(*)::text AS used FROM edition_copies c WHERE c.model_id = m.id) AS used
     FROM models m WHERE m.id = $1`,
    [modelId],
  );
  if (row === null || row.total === null) return 0;
  return row.total - Number(row.used);
}

async function releaseEditionCopy(modelId: number, number: number): Promise<void> {
  await withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [modelId]);
    await client.query(
      'DELETE FROM edition_copies WHERE model_id = $1 AND number = $2 AND order_id IS NULL',
      [modelId, number],
    );
    await client.query(`UPDATE models SET edition_sales = GREATEST(edition_sales - 1, 0) WHERE id = $1`, [modelId]);
  });
}

/** Buyer Kill Bill account: created on first purchase, EUR, external payment method. */
async function ensureBuyerAccount(email: string): Promise<{ accountId: string; paymentMethodId: string }> {
  const externalKey = `turnstone-${config.instance}-buyer-${email.toLowerCase()}`;
  const existing = await kb.getAccountByExternalKey(externalKey);
  const ensureMethod = async (accountId: string): Promise<string> => {
    const methods = await kb.listPaymentMethods(accountId);
    const method = methods.find(m => m.pluginName === '__EXTERNAL_PAYMENT__');
    if (method !== undefined) return method.paymentMethodId;
    await kb.createExternalPaymentMethod(accountId, `${externalKey}-pm`);
    const after = await kb.listPaymentMethods(accountId);
    const created = after.find(m => m.pluginName === '__EXTERNAL_PAYMENT__');
    if (created === undefined) throw new Error('payment method missing');
    return created.paymentMethodId;
  };
  if (existing !== null) {
    return { accountId: existing.accountId, paymentMethodId: await ensureMethod(existing.accountId) };
  }
  const account = await kb.createAccount(externalKey, email);
  return { accountId: account.accountId, paymentMethodId: await ensureMethod(account.accountId) };
}

function chargeDescription(modelTitle: string, licence: LicenceType, editionNumber: number | null, isUpgrade: boolean): string {
  if (isUpgrade) return `${modelTitle} · Upgrade to ${licenceName(licence)} licence`;
  if (licence === 'edition' && editionNumber !== null) return `${modelTitle} · Edition copy No. ${editionNumber}`;
  return `${modelTitle} · ${licenceName(licence)} licence`;
}

function licenceName(licence: LicenceType): string {
  if (licence === 'personal') return 'Personal';
  if (licence === 'commercial') return 'Commercial';
  return 'Studio';
}

/** Creates the external charge and PURCHASE payment, reusing whatever already exists. */
async function chargeInKillBill(
  order: OrderRow,
  modelTitle: string,
  licence: LicenceType,
  isUpgrade: boolean,
  editionNumber: number | null,
): Promise<void> {
  const description = chargeDescription(modelTitle, licence, editionNumber, isUpgrade);
  const amountEur = kb.centsToEurString(order.amount_cents);

  let accountId = order.kb_account_id;
  let paymentMethodId = order.kb_payment_method_id;
  if (accountId === null || paymentMethodId === null) {
    const ensured = await ensureBuyerAccount(order.buyer_email);
    accountId = ensured.accountId;
    paymentMethodId = ensured.paymentMethodId;
    await query('UPDATE orders SET kb_account_id = $2, kb_payment_method_id = $3 WHERE id = $1', [
      order.id,
      accountId,
      paymentMethodId,
    ]);
  }

  const itemUuid = order.kb_item_uuid ?? randomUUID();
  let invoiceId = order.kb_invoice_id;
  if (invoiceId === null) {
    const existingInvoice = await findInvoiceWithItem(accountId, itemUuid, order.amount_cents);
    if (existingInvoice !== null) {
      invoiceId = existingInvoice;
    } else {
      const charge = await kb.createExternalCharge(accountId, itemUuid, amountEur, description);
      invoiceId = charge.invoiceId;
    }
    await query('UPDATE orders SET kb_invoice_id = $2, kb_item_uuid = $3 WHERE id = $1', [order.id, invoiceId, itemUuid]);
  }

  if (order.kb_payment_id === null) {
    const paymentExternalKey = `turnstone-purchase-${order.order_ref}`;
    const payments = await kb.listPayments(accountId);
    const already = payments.find(p => p.purchasedAmount !== 0);
    if (already === undefined) {
      await kb.createPurchasePayment(accountId, paymentMethodId, amountEur, paymentExternalKey);
    }
    const after = await kb.listPayments(accountId);
    const payment = after.find(p => p.purchasedAmount !== 0);
    if (payment === undefined) throw new Error('payment not found after purchase');
    await query('UPDATE orders SET kb_payment_id = $2 WHERE id = $1', [order.id, payment.paymentId]);
  }
}

async function findInvoiceWithItem(accountId: string, itemUuid: string, amountCents: number): Promise<string | null> {
  const invoiceIds = await kb.listInvoiceIds(accountId);
  for (const invoiceId of invoiceIds) {
    const invoice = await kb.getInvoice(invoiceId);
    if (invoice.items.some(item => item.invoiceItemId === itemUuid)) {
      void amountCents;
      return invoiceId;
    }
  }
  return null;
}

/** Net amount paid across the upgrade chain, after refunds. */
export async function upgradeChainPaid(orderId: number): Promise<number> {
  const rows = await query<{ amount_cents: number; refunded_cents: number }>(
    `WITH RECURSIVE chain AS (
       SELECT id, amount_cents, refunded_cents, upgrade_from_id FROM orders WHERE id = $1
       UNION ALL
       SELECT o.id, o.amount_cents, o.refunded_cents, o.upgrade_from_id
       FROM orders o JOIN chain ON o.id = chain.upgrade_from_id
     )
     SELECT amount_cents, refunded_cents FROM chain`,
    [orderId],
  );
  return rows.rows.reduce((acc, row) => acc + row.amount_cents - row.refunded_cents, 0);
}

export interface RefundOutcome {
  order_ref: string;
  refund_cents: number;
  refunded_cents: number;
  refundable_cents: number;
  status: OrderStatus;
}

/** Applies a refund: Kill Bill REFUND first, then the order record and one refund email. */
export async function applyRefund(orderRefValue: string, kind: 'full' | 'seats', seats: number | null, idemKey: string): Promise<RefundOutcome> {
  const order = await getOrderByRef(orderRefValue);
  if (order === null) throw new ApiError(404, 'not_found');
  const refundable = order.status === 'refunded' ? 0 : order.amount_cents - order.refunded_cents;
  if (refundable <= 0) throw new ApiError(409, 'nothing_to_refund');

  let refundCents: number;
  if (kind === 'full') {
    refundCents = refundable;
  } else {
    if (order.licence !== 'studio') {
      throw new ApiError(422, 'validation_failed', undefined, { seats: 'Choose fewer seats than the licence still holds.' });
    }
    const remainingSeats = order.seats - order.refunded_seats;
    if (seats === null || seats < 1 || seats >= remainingSeats) {
      throw new ApiError(422, 'validation_failed', undefined, { seats: 'Choose fewer seats than the licence still holds.' });
    }
    refundCents = seatRefundAmount(order.amount_cents, seats);
  }

  const externalKey = `turnstone-refund-${order.order_ref}-${order.refunded_cents + refundCents}`;
  const pending = await one<{ id: number; status: string }>(
    'SELECT id, status FROM refunds WHERE external_key = $1',
    [externalKey],
  );
  if (pending === null) {
    await query(
      'INSERT INTO refunds (order_id, kind, seats, amount_cents, external_key, status) VALUES ($1, $2, $3, $4, $5, $6)',
      [order.id, kind, seats, refundCents, externalKey, 'pending'],
    );
  }
  if (pending?.status !== 'confirmed') {
    await kb.createRefund(order.kb_payment_id ?? '', kb.centsToEurString(refundCents), externalKey);
    await query('UPDATE refunds SET status = $2 WHERE external_key = $1', [externalKey, 'confirmed']);
  }

  const newRefunded = order.refunded_cents + refundCents;
  const newRefundedSeats = kind === 'seats' ? order.refunded_seats + (seats ?? 0) : order.seats;
  const status: OrderStatus = newRefunded >= order.amount_cents ? 'refunded' : 'partially_refunded';
  await withTransaction(async client => {
    await client.query(
      `UPDATE orders SET refunded_cents = $2, refunded_seats = $3, status = $4 WHERE id = $1`,
      [order.id, newRefunded, newRefundedSeats, status],
    );
    if (status === 'refunded' && order.edition_number !== null) {
      await client.query(
        `UPDATE edition_copies SET status = 'retired' WHERE model_id = $1 AND number = $2`,
        [order.model_id, order.edition_number],
      );
    }
  });

  await queueEmail({
    kind: 'refund',
    order: { ref: order.order_ref, email: order.buyer_email, locale: order.locale, refundCents },
  });

  return {
    order_ref: order.order_ref,
    refund_cents: refundCents,
    refunded_cents: newRefunded,
    refundable_cents: status === 'refunded' ? 0 : order.amount_cents - newRefunded,
    status,
  };
}

export async function orderRefunds(orderId: number): Promise<{ amount_cents: number; created_at: string }[]> {
  const rows = await query<{ amount_cents: number; created_at: string }>(
    'SELECT amount_cents, created_at FROM refunds WHERE order_id = $1 AND status = $2 ORDER BY id',
    [orderId, 'confirmed'],
  );
  return rows.rows;
}

export async function upgradeOptionsFor(order: OrderRow, purchasable: boolean): Promise<{ licence: Exclude<LicenceType, 'edition'>; amount_cents: number }[]> {
  if (!purchasable) return [];
  if (order.status === 'refunded' || order.upgraded_to !== null || order.licence === 'edition') return [];
  const modelRow = await one<ModelRow>('SELECT * FROM models WHERE id = $1', [order.model_id]);
  if (modelRow === null) return [];
  const chain = await upgradeChainPaid(order.id);
  const targets: Exclude<LicenceType, 'edition'>[] =
    order.licence === 'personal' ? ['commercial', 'studio'] : order.licence === 'commercial' ? ['studio'] : [];
  const options: { licence: Exclude<LicenceType, 'edition'>; amount_cents: number }[] = [];
  for (const target of targets) {
    const price = currentPriceCents(modelRow, target);
    if (price === null) continue;
    const amount = price - chain;
    if (amount <= 0) continue;
    options.push({ licence: target, amount_cents: amount });
  }
  return options;
}
