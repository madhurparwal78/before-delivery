import type { Db } from './db.js';
import type { Amount } from './money.js';
import { amountFromMinor, amountToString } from './money.js';
import { createChargeInvoice, createSubscription, getInvoice, voidInvoice, type KbInvoice } from './killbill.js';
import {
  BillingUnavailable,
  authorizeCharge,
  captureCharge,
  createFolderMarker,
  ensureBillingReachable,
  ensureKillbillAccount,
  openAmountOf,
  orderReceiptPath,
  queueEmail,
  receiptEmail,
  recordInvoice,
  voidAuthorization,
  waitForFirstInvoice,
  type ChargeContext,
} from './billing.js';
import { cardDecision, declineError, validateCard, type CardInput } from './cards.js';
import { isCarePlan, invalidTransition, type OrderState } from './domain.js';
import { getOrder, tryLockOrder, type OrderRow } from './orders.js';
import { getAccount } from './auth.js';
import { HttpError, newId, sleep } from './util.js';

export interface PayResult {
  orderId: string;
  orderNumber: string;
  paymentKind: 'deposit' | 'balance' | 'care';
  amount: Amount;
  killbillPaymentId: string;
  killbillInvoiceId: string;
}

const LOCK_WAIT_MS = 15_000;

/**
 * The one place that pays an order: deposit, launch balance or first care month.
 * All-or-nothing: any failure after the authorization voids it and voids the
 * invoice created for this Pay, leaving no folder, receipt or ledger row.
 */
export async function payOrder(db: Db, order: OrderRow, card: CardInput): Promise<PayResult> {
  // A concurrent Pay with another key for the same order: wait for it, then refuse.
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    await db.query('BEGIN');
    const held = await tryLockOrder(db, order.id);
    if (held === 'busy') {
      await db.query('COMMIT');
      const current = await getOrder(db, order.id);
      if (current && current.state !== order.state) {
        throw invalidTransition(current.state, nextTarget(order));
      }
      if (Date.now() > deadline) throw new BillingUnavailable();
      await sleep(250);
      continue;
    }
    if (held === null) {
      await db.query('ROLLBACK');
      throw new HttpError(404, 'not_found', 'We could not find that.');
    }
    if (held.state !== 'accepted' && held.state !== 'balance_invoiced') {
      await db.query('ROLLBACK');
      throw invalidTransition(held.state, nextTarget(held));
    }
    const validCard = validateCard(card);
    if (cardDecision(validCard.last4) === 'decline') {
      await db.query('ROLLBACK');
      throw declineError();
    }
    await ensureBillingReachable();
    return await payLocked(db, held, validCard.last4);
  }
}

function nextTarget(order: OrderRow): OrderState {
  if (order.state === 'accepted') return isCarePlan(order.plan) ? 'paid_in_full' : 'deposit_paid';
  if (order.state === 'balance_invoiced') return 'paid_in_full';
  return order.state;
}

async function accountOwnerEmail(db: Db, accountId: string): Promise<string> {
  const result = await db.query("SELECT email FROM users WHERE account_id = $1 AND role = 'client_owner' LIMIT 1", [accountId]);
  const row = result.rows[0] as { email: string } | undefined;
  return row?.email ?? 'client@pampero.test';
}

async function payLocked(db: Db, order: OrderRow, cardLast4: string): Promise<PayResult> {
  let paymentKey = '';
  let createdInvoiceId: string | null = null;
  let authorized: { paymentId: string; paymentMethodId: string } | null = null;
  let authAmount: Amount | null = null;
  try {
    const account = order.accountId ? await getAccount(db, order.accountId) : null;
    if (!account) throw new HttpError(403, 'forbidden', 'Only the client owner may pay this order.');
    const ownerEmail = await accountOwnerEmail(db, account.id);
    const killbillAccountId = await ensureKillbillAccount(db, account.id, account.businessName, ownerEmail, account.currency);
    const chargeCtx: ChargeContext = { accountId: account.id, killbillAccountId, currency: account.currency, cardLast4 };

    let invoice: KbInvoice | null = null;
    let paymentKind: 'deposit' | 'balance' | 'care' | null = null;

    if (order.state === 'accepted' && !isCarePlan(order.plan)) {
      const dueNow = amountFromMinor(order.currency, BigInt(order.due_now_minor));
      invoice = await createChargeInvoice(killbillAccountId, `${order.number} deposit`, dueNow);
      paymentKind = 'deposit';
      paymentKey = `${order.id}-deposit`;
    } else if (order.state === 'accepted' && isCarePlan(order.plan)) {
      if (!order.killbillSubscriptionId) {
        const price = amountFromMinor(order.currency, BigInt(order.total_minor));
        const sub = await createSubscription({
          accountId: killbillAccountId,
          bundleExternalKey: `care-${order.id}`,
          planName: order.plan === 'care-lite' ? 'care-lite-monthly' : 'care-plus-monthly',
          recurringPrice: price,
        });
        await db.query('UPDATE orders SET killbill_bundle_id = $1, killbill_subscription_id = $2 WHERE id = $3', [
          sub.bundleId,
          sub.subscriptionId,
          order.id,
        ]);
        order.killbillSubscriptionId = sub.subscriptionId;
        order.killbillBundleId = sub.bundleId;
      }
      invoice = await waitForFirstInvoice(killbillAccountId, order.killbillSubscriptionId, 60_000);
      paymentKind = 'care';
      paymentKey = `${order.id}-care`;
    } else if (order.state === 'balance_invoiced') {
      const balanceInvoiceId = await findBalanceInvoiceId(db, order.id);
      if (!balanceInvoiceId) throw invalidTransition(order.state, 'paid_in_full');
      invoice = await getInvoice(balanceInvoiceId);
      paymentKind = 'balance';
      paymentKey = `${order.id}-balance`;
    } else {
      throw invalidTransition(order.state, nextTarget(order));
    }
    createdInvoiceId = invoice.invoiceId;
    const open = openAmountOf(invoice);

    if (paymentKind === 'balance' && open === null) {
      // billing already holds the whole balance covered by account credit
      await writePaymentLedger(db, order, 'balance', amountFromMinor(order.currency, 0n), '', invoice.invoiceId, ownerEmail);
      await db.query('COMMIT');
      return { orderId: order.id, orderNumber: order.number, paymentKind, amount: amountFromMinor(order.currency, 0n), killbillPaymentId: '', killbillInvoiceId: invoice.invoiceId };
    }

    const amount =
      open ??
      (paymentKind === 'care'
        ? amountFromMinor(order.currency, BigInt(order.due_now_minor))
        : amountFromMinor(order.currency, BigInt(paymentKind === 'deposit' ? order.due_now_minor : order.due_at_launch_minor)));

    authorized = await authorizeCharge(chargeCtx, amount, paymentKey);
    authAmount = amount;

    await createFolderMarker(order.id);

    await writePaymentLedger(db, order, paymentKind, amount, authorized.paymentId, invoice.invoiceId, ownerEmail);

    await captureCharge(chargeCtx, authorized, invoice.invoiceId, amount, paymentKey);

    await db.query('COMMIT');
    await db.query('UPDATE accounts SET card_last4 = $1 WHERE id = $2 AND card_last4 IS NULL', [cardLast4, account.id]);

    return { orderId: order.id, orderNumber: order.number, paymentKind: paymentKind!, amount, killbillPaymentId: authorized.paymentId, killbillInvoiceId: invoice.invoiceId };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    if (authorized && authAmount) {
      await voidAuthorization(chargeCtxOf(order, cardLast4), authorized, authAmount, paymentKey).catch(() => undefined);
    }
    if (createdInvoiceId) {
      await voidInvoice(createdInvoiceId).catch(() => undefined);
    }
    throw err;
  }
}

function chargeCtxOf(order: OrderRow, cardLast4: string): ChargeContext {
  return { accountId: order.accountId ?? '', killbillAccountId: '', currency: order.currency, cardLast4 };
}

async function findBalanceInvoiceId(db: Db, orderId: string): Promise<string | null> {
  const result = await db.query("SELECT invoice_id FROM invoice_records WHERE order_id = $1 AND kind = 'balance'", [orderId]);
  const row = result.rows[0] as { invoice_id: string } | undefined;
  return row?.invoice_id ?? null;
}

async function writePaymentLedger(db: Db, order: OrderRow, paymentKind: 'deposit' | 'balance' | 'care', amount: Amount, killbillPaymentId: string, killbillInvoiceId: string, ownerEmail: string): Promise<void> {
  const nextState: OrderState = isCarePlan(order.plan)
    ? 'paid_in_full'
    : paymentKind === 'deposit'
      ? 'deposit_paid'
      : 'paid_in_full';
  if (paymentKind === 'deposit' && !order.projectId) {
    const account = await getAccount(db, order.accountId!);
    const projectId = newId();
    await db.query('INSERT INTO projects (id, order_id, business_name, plan_name) VALUES ($1, $2, $3, $4)', [
      projectId,
      order.id,
      account?.businessName ?? '',
      order.planName,
    ]);
    await db.query('UPDATE orders SET project_id = $1 WHERE id = $2', [projectId, order.id]);
  }
  await db.query('UPDATE orders SET state = $1 WHERE id = $2', [nextState, order.id]);
  await db.query(
    'INSERT INTO payments (id, order_id, kind, amount_minor, currency, killbill_payment_id, killbill_invoice_id, captured_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())',
    [newId(), order.id, paymentKind, amount.minor, amount.currency, killbillPaymentId, killbillInvoiceId],
  );
  await recordInvoice(db, {
    invoiceId: killbillInvoiceId,
    accountId: order.accountId!,
    orderId: order.id,
    kind: paymentKind,
  });
  if (amount.minor > 0n) {
    const email = receiptEmail(order.number, paymentKind, amount, orderReceiptPath(order.id));
    await queueEmail(db, { ...email, to: ownerEmail });
  }
}

export function payResponse(result: PayResult): Record<string, unknown> {
  return {
    payment: {
      kind: result.paymentKind,
      amount: amountToString(result.amount),
      currency: result.amount.currency,
      killbillPaymentId: result.killbillPaymentId,
    },
    receiptUrl: orderReceiptPath(result.orderId),
  };
}
