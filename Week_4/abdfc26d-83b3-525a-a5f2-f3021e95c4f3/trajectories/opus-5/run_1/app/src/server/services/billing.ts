import { query, transaction, type Queryable } from '../db/pool.js';
import { nextInvoiceNumber } from '../domain/sequences.js';
import { allocateSaleSplit, PLATFORM_HOLDER_NAME } from '../domain/split.js';
import { grantCredits } from '../domain/ledger.js';
import { canMovePlan } from '../domain/states.js';
import {
  getInvoice,
  invoicePayments,
  KillBillUnavailable,
  accountInvoiceIds,
  type Payment,
} from '../providers/killbill.js';
import { planByCode, type PlanCode } from '../../shared/plans.js';
import { loadOrder } from './orders.js';

/** A purchase for the invoice's full amount, as the Kill Bill read shows it. */
function hasFullPurchase(payments: readonly Payment[], amountCents: number): Payment | null {
  for (const payment of payments) {
    const purchased = payment.transactions.filter(
      (transaction) => transaction.type === 'PURCHASE' && transaction.status === 'SUCCESS',
    );
    const total = purchased.reduce((sum, transaction) => sum + transaction.amountCents, 0);
    if (purchased.length > 0 && total >= amountCents) return payment;
  }
  return null;
}

function hasFailedPayment(payments: readonly Payment[]): boolean {
  return payments.some((payment) =>
    payment.transactions.some(
      (transaction) =>
        transaction.type === 'PURCHASE' &&
        (transaction.status === 'PAYMENT_FAILURE' || transaction.status === 'PLUGIN_FAILURE'),
    ),
  );
}

interface SplitHolder {
  readonly party: 'creator' | 'remixer' | 'platform';
  readonly userId: string | null;
  readonly name: string;
}

async function splitHolders(client: Queryable, orderId: string): Promise<SplitHolder[]> {
  const result = await client.query<{
    piece_creator_id: string;
    piece_creator_name: string;
    source_creator_id: string | null;
    source_creator_name: string | null;
  }>(
    `SELECT p.creator_id AS piece_creator_id,
            creator.display_name AS piece_creator_name,
            source.creator_id AS source_creator_id,
            source_creator.display_name AS source_creator_name
     FROM edition_orders o
     JOIN pieces p ON p.id = o.piece_id
     JOIN app_users creator ON creator.id = p.creator_id
     LEFT JOIN pieces source ON source.id = p.remix_of_id
     LEFT JOIN app_users source_creator ON source_creator.id = source.creator_id
     WHERE o.id = $1`,
    [orderId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Order ${orderId} has no piece`);

  const platform: SplitHolder = { party: 'platform', userId: null, name: PLATFORM_HOLDER_NAME };

  if (row.source_creator_id && row.source_creator_name) {
    return [
      { party: 'creator', userId: row.source_creator_id, name: row.source_creator_name },
      { party: 'remixer', userId: row.piece_creator_id, name: row.piece_creator_name },
      platform,
    ];
  }
  return [
    { party: 'creator', userId: row.piece_creator_id, name: row.piece_creator_name },
    platform,
  ];
}

/**
 * Confirmation, in one transaction: the order moves to paid, paid_at is set, the
 * edition is assigned, the split rows are written and the invoice number is taken.
 */
export async function confirmOrderPaid(orderId: string, paymentId: string): Promise<boolean> {
  return transaction(async (client) => {
    const row = await loadOrder(client, orderId, true);
    if (!row || row.state !== 'paying') return false;

    const paidAt = new Date();
    const invoiceNumber = await nextInvoiceNumber(client, paidAt);

    await client.query(
      `UPDATE edition_orders
       SET state = 'paid', paid_at = $2, invoice_number = $3, invoice_status = 'pending',
           killbill_payment_id = COALESCE($4, killbill_payment_id)
       WHERE id = $1`,
      [row.id, paidAt, invoiceNumber, paymentId],
    );

    const holders = await splitHolders(client, row.id);
    const isRemix = holders.some((holder) => holder.party === 'remixer');
    const shares = allocateSaleSplit(row.net_cents, isRemix);

    for (const share of shares) {
      const holder = holders.find((candidate) => candidate.party === share.party);
      if (!holder) continue;
      await client.query(
        `INSERT INTO split_rows (order_id, party, holder_user_id, holder_name, kind, amount_cents,
                                 occurred_at)
         VALUES ($1, $2, $3, $4, 'sale', $5, $6)`,
        [row.id, share.party, holder.userId, holder.name, share.amountCents, paidAt],
      );
    }

    return true;
  });
}

async function failOrder(orderId: string): Promise<boolean> {
  const result = await query(
    "UPDATE edition_orders SET state = 'failed' WHERE id = $1 AND state = 'paying'",
    [orderId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Applies what a fresh Kill Bill read shows about one order's invoice. */
export async function reconcileOrder(orderId: string): Promise<void> {
  const row = await transaction((client) => loadOrder(client, orderId, false));
  if (!row || row.state !== 'paying' || !row.killbill_invoice_id) return;

  const invoice = await getInvoice(row.killbill_invoice_id);
  if (!invoice) return;
  const payments = await invoicePayments(row.killbill_invoice_id);

  const purchase = hasFullPurchase(payments, invoice.amountCents);
  if (purchase) {
    await confirmOrderPaid(orderId, purchase.paymentId);
    return;
  }
  if (hasFailedPayment(payments)) {
    await failOrder(orderId);
  }
}

export async function reconcileCreditPack(purchaseId: string): Promise<void> {
  const result = await query<{
    id: string;
    user_id: string;
    credits: number;
    killbill_invoice_id: string | null;
  }>(
    "SELECT id, user_id, credits, killbill_invoice_id FROM credit_pack_purchases WHERE id = $1 AND state = 'paying'",
    [purchaseId],
  );
  const purchase = result.rows[0];
  if (!purchase || !purchase.killbill_invoice_id) return;

  const invoice = await getInvoice(purchase.killbill_invoice_id);
  if (!invoice) return;
  const payments = await invoicePayments(purchase.killbill_invoice_id);

  const paid = hasFullPurchase(payments, invoice.amountCents);
  if (paid) {
    await transaction(async (client) => {
      const claim = await client.query(
        "UPDATE credit_pack_purchases SET state = 'paid', killbill_payment_id = $2 WHERE id = $1 AND state = 'paying'",
        [purchase.id, paid.paymentId],
      );
      if ((claim.rowCount ?? 0) === 0) return;
      await grantCredits(client, 'pack', purchase.user_id, purchase.credits);
    });
    return;
  }
  if (hasFailedPayment(payments)) {
    await query("UPDATE credit_pack_purchases SET state = 'failed' WHERE id = $1 AND state = 'paying'", [
      purchase.id,
    ]);
  }
}

/**
 * Grants a plan's credits once per subscription invoice id, and makes a
 * pending plan active on its first confirmed subscription invoice.
 */
async function applySubscriptionInvoice(
  planId: string,
  userId: string,
  planCode: PlanCode,
  killbillInvoiceId: string,
): Promise<void> {
  await transaction(async (client) => {
    const claim = await client.query(
      `INSERT INTO plan_invoice_grants (killbill_invoice_id, plan_id) VALUES ($1, $2)
       ON CONFLICT (killbill_invoice_id) DO NOTHING
       RETURNING killbill_invoice_id`,
      [killbillInvoiceId, planId],
    );
    if (claim.rows.length === 0) return;

    await grantCredits(client, 'grant', userId, planByCode(planCode).credits);

    const plan = await client.query<{ state: string }>(
      'SELECT state FROM creator_plans WHERE id = $1 FOR UPDATE',
      [planId],
    );
    const state = plan.rows[0]?.state;
    if (state === 'pending_payment' && canMovePlan('pending_payment', 'active')) {
      await client.query("UPDATE creator_plans SET state = 'active' WHERE id = $1", [planId]);
    }
  });
}

/** Reads a plan account's invoices and applies every confirmed subscription invoice. */
export async function reconcilePlan(planId: string): Promise<void> {
  const result = await query<{
    id: string;
    user_id: string;
    code: PlanCode;
    killbill_account_id: string | null;
    killbill_subscription_id: string | null;
  }>(
    `SELECT id, user_id, code, killbill_account_id, killbill_subscription_id
     FROM creator_plans WHERE id = $1`,
    [planId],
  );
  const plan = result.rows[0];
  if (!plan || !plan.killbill_account_id || !plan.killbill_subscription_id) return;

  for (const invoiceId of await accountInvoiceIds(plan.killbill_account_id)) {
    const invoice = await getInvoice(invoiceId);
    if (!invoice || !invoice.subscriptionIds.includes(plan.killbill_subscription_id)) continue;
    const payments = await invoicePayments(invoiceId);
    if (hasFullPurchase(payments, invoice.amountCents)) {
      await applySubscriptionInvoice(plan.id, plan.user_id, plan.code, invoiceId);
    }
  }
}

export interface BillingEvent {
  readonly eventType: string;
  readonly objectId: string;
  readonly accountId: string;
  readonly paymentId: string;
}

/** An event's identity is processed at most once, even when it arrives twice at once. */
async function claimEventIdentity(event: BillingEvent): Promise<boolean> {
  const identity = `${event.eventType}|${event.objectId}|${event.paymentId}`;
  const claim = await query(
    `INSERT INTO processed_billing_events (identity) VALUES ($1)
     ON CONFLICT (identity) DO NOTHING
     RETURNING identity`,
    [identity],
  );
  return claim.rows.length > 0;
}

const HANDLED_EVENTS = new Set(['INVOICE_PAYMENT_SUCCESS', 'INVOICE_PAYMENT_FAILED']);

/**
 * Handles a verified callback. The app re-reads the invoice's payments from the
 * Kill Bill API and acts only on what that read shows. Anything it cannot match
 * to an order, a pack or a known plan is ignored.
 */
export async function handleBillingEvent(event: BillingEvent): Promise<void> {
  if (!HANDLED_EVENTS.has(event.eventType)) return;
  if (!(await claimEventIdentity(event))) return;

  const order = await query<{ id: string }>(
    'SELECT id FROM edition_orders WHERE killbill_invoice_id = $1',
    [event.objectId],
  );
  if (order.rows[0]) {
    await reconcileOrder(order.rows[0].id);
    return;
  }

  const pack = await query<{ id: string }>(
    'SELECT id FROM credit_pack_purchases WHERE killbill_invoice_id = $1',
    [event.objectId],
  );
  if (pack.rows[0]) {
    await reconcileCreditPack(pack.rows[0].id);
    return;
  }

  const plan = await query<{ id: string }>(
    'SELECT id FROM creator_plans WHERE killbill_account_id = $1 ORDER BY created_at DESC LIMIT 1',
    [event.accountId],
  );
  if (plan.rows[0]) {
    await reconcilePlan(plan.rows[0].id);
  }
}

/**
 * Reconciles each entity on its own, so one slow Kill Bill read never delays
 * another's confirmation, and a failure on one leaves the rest untouched.
 */
async function reconcileEach(
  ids: readonly string[],
  reconcile: (id: string) => Promise<void>,
): Promise<void> {
  await Promise.all(
    ids.map(async (id) => {
      try {
        await reconcile(id);
      } catch (error) {
        if (!(error instanceof KillBillUnavailable)) {
          process.stderr.write(`reconcile ${id} failed: ${String(error)}\n`);
        }
      }
    }),
  );
}

/**
 * Polls Kill Bill while an order or purchase is paying, or a plan is awaiting
 * its first confirmation, applying the same confirmation as the callbacks.
 */
export async function pollUnconfirmedPayments(): Promise<void> {
  const [orders, packs, plans] = await Promise.all([
    query<{ id: string }>(
      "SELECT id FROM edition_orders WHERE state = 'paying' AND killbill_invoice_id IS NOT NULL",
    ),
    query<{ id: string }>("SELECT id FROM credit_pack_purchases WHERE state = 'paying'"),
    query<{ id: string }>("SELECT id FROM creator_plans WHERE state = 'pending_payment'"),
  ]);

  await Promise.all([
    reconcileEach(
      orders.rows.map((row) => row.id),
      reconcileOrder,
    ),
    reconcileEach(
      packs.rows.map((row) => row.id),
      reconcileCreditPack,
    ),
    reconcileEach(
      plans.rows.map((row) => row.id),
      reconcilePlan,
    ),
  ]);
}

/**
 * Sweeps the plans Kill Bill bills monthly, so each new subscription invoice
 * grants its credits once even if no callback arrived.
 */
export async function sweepBilledPlans(): Promise<void> {
  const plans = await query<{ id: string }>(
    "SELECT id FROM creator_plans WHERE state IN ('active','cancelling')",
  );
  await reconcileEach(
    plans.rows.map((row) => row.id),
    reconcilePlan,
  );
}
