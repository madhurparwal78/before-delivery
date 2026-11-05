import { pool, type Db } from './db.js';
import type { Amount } from './money.js';
import { formatMoney } from './money.js';
import {
  chargeInvoice,
  invoiceHasBeenNoticed,
  markInvoiceNoticed,
  openAmountOf,
  orderReceiptPath,
  queueEmail,
  receiptEmail,
  recordInvoice,
  type ChargeContext,
  listAccountInvoicesSafe,
} from './billing.js';
import { cardDecision } from './cards.js';
import { baDate, config, newId } from './util.js';
import { getAccount, type AccountRow } from './auth.js';
import { cancelPlanNow, loadPlanState, planStatus } from './plans.js';
import { getOrder, type OrderRow } from './orders.js';

const MAX_ATTEMPTS = 3;

/** One scan of renewal invoices, dunning attempts and their notices. */
export async function dunningScan(): Promise<void> {
  const client = await pool.connect().catch(() => null);
  if (!client) return;
  try {
    const careOrders = await client.query(
      "SELECT DISTINCT o.id FROM orders o JOIN accounts a ON a.id = o.account_id WHERE o.plan IN ('care-lite', 'care-plus') AND o.killbill_subscription_id IS NOT NULL",
    );
    for (const row of careOrders.rows as { id: string }[]) {
      await processCareOrder(client, row.id).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

async function processCareOrder(db: Db, orderId: string): Promise<void> {
  const order = await getOrder(db, orderId);
  if (!order || !order.accountId || !order.killbillSubscriptionId) return;
  const account = await getAccount(db, order.accountId);
  if (!account?.killbillAccountId) return;
  const state = await loadPlanState(db, order.accountId).catch(() => null);
  if (!state) return;
  const invoices = await listAccountInvoicesSafe(account.killbillAccountId);
  const subscriptionId = order.killbillSubscriptionId;
  const known = await db.query('SELECT invoice_id FROM invoice_records WHERE order_id = $1', [order.id]);
  const knownIds = new Set((known.rows as { invoice_id: string }[]).map((r) => r.invoice_id));

  for (const invoice of invoices) {
    if (!invoice.items.some((item) => item.subscriptionId === subscriptionId && item.itemType === 'RECURRING')) continue;
    if (invoice.items.some((item) => item.itemType === 'REPAIR_ADJ')) continue;
    if (knownIds.has(invoice.invoiceId)) continue;
    const open = openAmountOf(invoice);
    await recordInvoice(db, { invoiceId: invoice.invoiceId, accountId: order.accountId!, orderId: order.id, kind: 'renewal' });
    if (open && !(await invoiceHasBeenNoticed(db, invoice.invoiceId))) {
      await markInvoiceNoticed(db, invoice.invoiceId);
      await sendInvoiceNotice(db, order.accountId!, open, invoice.invoiceNumber);
    }
  }

  if (planStatus(state) === 'cancelled') return;
  const openRenewal = state.openRenewal;
  if (!openRenewal) return;

  const attemptRows = await db.query(
    'SELECT attempt_no, due_at, attempted_at, succeeded FROM dunning_attempts WHERE order_id = $1 AND invoice_id = $2 ORDER BY attempt_no ASC',
    [order.id, openRenewal.invoiceId],
  );
  const attempts = attemptRows.rows as { attempt_no: number; due_at: Date; attempted_at: Date | null; succeeded: boolean }[];
  if (attempts.length === 0) {
    await runDunningAttempt(db, order, account, openRenewal.invoiceId, openRenewal.amount, 1, new Date(), []);
    return;
  }
  const pending = attempts.find((a) => !a.succeeded && a.attempted_at === null);
  if (pending && new Date(pending.due_at) <= new Date()) {
    await runDunningAttempt(db, order, account, openRenewal.invoiceId, openRenewal.amount, pending.attempt_no, new Date(pending.due_at), attempts);
  }
}

export async function sendInvoiceNotice(db: Db, accountId: string, amount: Amount, invoiceNumber: string): Promise<void> {
  const owner = await accountOwnerEmail(db, accountId);
  await queueEmail(db, {
    to: owner,
    subject: `Invoice ${invoiceNumber} from Pampero Build Co.: ${formatMoney(amount)}`,
    body: [
      `A new invoice from Pampero Build Co.`,
      ``,
      `Amount: ${formatMoney(amount)}`,
      `Due amount: ${formatMoney(amount)}`,
      ``,
      `View and pay it at ${config.publicUrl}/portal/invoices`,
    ].join('\n'),
  });
}

async function runDunningAttempt(
  db: Db,
  order: OrderRow,
  account: AccountRow,
  invoiceId: string,
  amount: Amount,
  attemptNo: number,
  dueAt: Date,
  priorAttempts: { attempt_no: number; attempted_at: Date | null; succeeded: boolean }[],
): Promise<void> {
  if (attemptNo > MAX_ATTEMPTS) return;
  const owner = await accountOwnerEmail(db, order.accountId!);
  if (!(await claimDunningAttempt(db, order.id, invoiceId, attemptNo, dueAt))) {
    // another process owns this attempt
    return;
  }
  const decision = cardDecision(account.cardLast4 ?? '');
  if (decision === 'approve') {
    const chargeCtx: ChargeContext = {
      accountId: account.id,
      killbillAccountId: account.killbillAccountId!,
      currency: account.currency,
      cardLast4: account.cardLast4 ?? '',
    };
    try {
      await chargeInvoice(chargeCtx, invoiceId, amount, `${invoiceId}-renewal`);
    } catch {
      // billing unreachable: release the claim so a later scan retries
      await db.query('UPDATE dunning_attempts SET attempted_at = NULL WHERE order_id = $1 AND invoice_id = $2 AND attempt_no = $3', [order.id, invoiceId, attemptNo]);
      return;
    }
    await db.query('UPDATE dunning_attempts SET succeeded = true, attempted_at = now() WHERE order_id = $1 AND invoice_id = $2 AND attempt_no = $3', [order.id, invoiceId, attemptNo]);
    await db.query('DELETE FROM dunning_attempts WHERE order_id = $1 AND invoice_id = $2 AND succeeded = false AND attempted_at IS NULL', [order.id, invoiceId]);
    await queueEmail(db, { ...receiptEmail(order.number, 'renewal', amount, orderReceiptPath(order.id)), to: owner });
    return;
  }

  const nextAttempt = attemptNo + 1;
  let nextDue: Date | null = null;
  if (nextAttempt <= MAX_ATTEMPTS) {
    const attemptOne = priorAttempts.find((a) => a.attempt_no === 1)?.attempted_at;
    const base = attemptOne ? new Date(attemptOne) : new Date();
    const offsetDays = nextAttempt === 2 ? 3 : 7;
    nextDue = new Date(base.getTime() + offsetDays * config.dunningDaySeconds * 1000);
    await db.query(
      `INSERT INTO dunning_attempts (id, order_id, invoice_id, attempt_no, due_at, attempted_at, succeeded)
       VALUES ($1, $2, $3, $4, $5, NULL, false)
       ON CONFLICT (order_id, invoice_id, attempt_no) DO NOTHING`,
      [newId(), order.id, invoiceId, nextAttempt, nextDue.toISOString()],
    );
  }
  const cancelled = attemptNo >= MAX_ATTEMPTS;
  await queueEmail(db, {
    to: owner,
    subject: `Care plan payment failed (attempt ${attemptNo} of 3)`,
    body: [
      `Your care plan payment of ${formatMoney(amount)} failed.`,
      '',
      cancelled
        ? 'This was the third and final attempt, so your care plan is cancelled.'
        : `We will try again on ${dateLabel(nextDue!)}.`,
      '',
      `Update your card at ${config.publicUrl}/portal/plan`,
    ].join('\n'),
  });
  if (cancelled) {
    const state = await loadPlanState(db, order.accountId!);
    if (state && planStatus(state) === 'past_due') {
      await cancelPlanNow(db, state).catch(() => undefined);
    }
  }
}

/** Claim one dunning attempt across every app process so it runs exactly once. */
async function claimDunningAttempt(db: Db, orderId: string, invoiceId: string, attemptNo: number, dueAt: Date): Promise<boolean> {
  const existing = await db.query(
    'UPDATE dunning_attempts SET attempted_at = now() WHERE order_id = $1 AND invoice_id = $2 AND attempt_no = $3 AND attempted_at IS NULL RETURNING attempt_no',
    [orderId, invoiceId, attemptNo],
  );
  if ((existing.rowCount ?? 0) > 0) return true;
  const inserted = await db.query(
    `INSERT INTO dunning_attempts (id, order_id, invoice_id, attempt_no, due_at, attempted_at, succeeded)
     VALUES ($1, $2, $3, $4, $5, now(), false)
     ON CONFLICT (order_id, invoice_id, attempt_no) DO NOTHING RETURNING attempt_no`,
    [newId(), orderId, invoiceId, attemptNo, dueAt.toISOString()],
  );
  return (inserted.rowCount ?? 0) > 0;
}

export function dateLabel(date: Date): string {
  const [y, m, day] = baDate(date).split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${day} ${months[m! - 1]} ${y}`;
}

async function accountOwnerEmail(db: Db, accountId: string): Promise<string> {
  const result = await db.query("SELECT email FROM users WHERE account_id = $1 AND role = 'client_owner' LIMIT 1", [accountId]);
  const row = result.rows[0] as { email: string } | undefined;
  return row?.email ?? 'client@pampero.test';
}

export function startDunningWorker(): void {
  void (async () => {
    for (;;) {
      await dunningScan().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  })();
}
