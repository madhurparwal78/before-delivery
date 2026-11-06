/** Taking money: the staged payment request, scheduled collection, and believing Kill Bill's notifications. */
import type { PoolClient } from 'pg';
import { oneOf } from '../shared/choice.js';
import type { StageName, StageStatus, User } from '../shared/types.js';
import { orderedHub, orderedPack } from './catalogue.js';
import { addDays, addMonthsAnchored, amsterdamDate, amsterdamToday, shopNow } from './clock.js';
import { one, query, sql, theRow, transaction, type Db } from './db.js';
import { fail, invalid } from './errors.js';
import type { Reply } from './http.js';
import { KillBillUnreachable, centsOf, ensureAccount, killbillIsUp, purchase, readPayment, type KbTransaction } from './killbill.js';
import { queueMail } from './mail.js';
import { receiptMail } from './mailtext.js';
import { STAGES } from './pricing.js';
import { orderSpecs } from './quotes.js';
import { loadOrder, orderRow, ownOrder, repriceQuoted, type OrderRow, type StoredDonor } from './orders.js';
import { RegistryUnreachable, readPlate, registryUnreachable } from './registry.js';
import { applyDrawOutcome } from './refunds.js';

interface StageRow { stage: StageName; position: number; status: StageStatus; amount_cents: number; attempts: number; due_date: string }
interface PaymentRecord { external_key: string; order_id: string; stage: StageName; user_id: string; collection: boolean; amount_cents: number; outcome: 'success' | 'failed' | null }

const CLOSED_STATES = ['withdrawn', 'paid in full', 'kit dispatched', 'fitted', 'inspection passed'];
const FAILURE_STATUSES = new Set(['PAYMENT_FAILURE', 'PLUGIN_FAILURE']);
const MAX_ATTEMPTS = 3;
const RETRY_DAYS = 3;

function stageRows(db: Db, orderId: string): Promise<StageRow[]> {
  return query<StageRow>(db, 'SELECT stage, position, status, amount_cents, attempts, due_date FROM stages WHERE order_id = $1 ORDER BY position', [orderId]);
}

interface Intent { externalKey: string; stage: StageName; amount: number; previousStatus: StageStatus; previousState: OrderRow['state']; nextState: OrderRow['state']; ownerId: string }

/** Record the intent to take a stage's money: the stage turns pending and the order moves, before any call to Kill Bill. */
async function markPending(client: Db, row: OrderRow, stage: StageRow, externalKey: string, collection: boolean): Promise<Intent> {
  const nextState: OrderRow['state'] = row.state === 'quoted' ? 'deposit pending' : row.state === 'deposit confirmed' ? 'instalments running' : row.state;
  await query(client, "UPDATE stages SET status = 'pending', attempts = attempts + 1 WHERE order_id = $1 AND stage = $2", [row.id, stage.stage]);
  await query(client, 'UPDATE orders SET state = $2 WHERE id = $1', [row.id, nextState]);
  await query(client, 'INSERT INTO payments (external_key, order_id, stage, user_id, collection, amount_cents) VALUES ($1,$2,$3,$4,$5,$6)', [
    externalKey, row.id, stage.stage, row.user_id, collection, stage.amount_cents,
  ]);
  return { externalKey, stage: stage.stage, amount: stage.amount_cents, previousStatus: stage.status, previousState: row.state, nextState, ownerId: row.user_id };
}

/** Undo an intent that never reached Kill Bill. */
async function revertIntent(orderId: string, intent: Intent): Promise<void> {
  await transaction(async (client) => {
    const row = await orderRow(client, orderId, true);
    const gone = await one(client, 'DELETE FROM payments WHERE external_key = $1 AND outcome IS NULL RETURNING external_key', [intent.externalKey]);
    if (!row || !gone) return;
    await query(client, "UPDATE stages SET status = $3, attempts = attempts - 1 WHERE order_id = $1 AND stage = $2 AND status = 'pending'", [orderId, intent.stage, intent.previousStatus]);
    if (row.state === intent.nextState) await query(client, 'UPDATE orders SET state = $2 WHERE id = $1', [orderId, intent.previousState]);
  });
}

type Sent = 'sent' | 'refused' | 'unreachable';

async function dispatchPurchase(intent: Intent): Promise<Sent> {
  try {
    const owner = await theRow<{ id: string; email: string; name: string }>(sql, 'SELECT id, email, name FROM users WHERE id = $1', [intent.ownerId]);
    const accountId = await ensureAccount(owner);
    const sent = await purchase(accountId, intent.externalKey, intent.amount);
    if (sent.kind === 'refused') return 'refused';
    await query(sql, 'UPDATE payments SET kb_payment_id = $2, kb_transaction_id = $3 WHERE external_key = $1', [intent.externalKey, sent.paymentId, sent.transactionId]);
    return 'sent';
  } catch (error) {
    if (error instanceof KillBillUnreachable) return 'unreachable';
    throw error;
  }
}

function sameDonor(stored: StoredDonor, read: { model: string; firstAdmissionYear: number; roadClass: number; plateColour: string; registeredMassT: number }): boolean {
  return stored.model === read.model && stored.firstAdmissionYear === read.firstAdmissionYear && stored.roadClass === read.roadClass
    && stored.plateColour === read.plateColour && stored.registeredMassT === read.registeredMassT;
}

/** The deposit gate in its published order. Throws a refusal, or answers true when a newer inspection fee re-quoted the order. */
async function depositGate(client: PoolClient, row: OrderRow, stage: StageName): Promise<boolean> {
  const kit = row.kind === 'kit' && stage === 'deposit' ? row : null;
  if (kit) {
    if (!kit.donor.confirmed) throw fail(409, 'donor_unconfirmed');
    if (kit.verdict !== 'fits') throw fail(409, 'fit_not_passed');
  }
  if (!(await killbillIsUp(client))) throw fail(503, 'payments_paused');
  if (!kit) return false;
  let read;
  try {
    read = await readPlate(kit.donor.plate, kit.donor.country);
  } catch (error) {
    if (error instanceof RegistryUnreachable) throw registryUnreachable();
    throw error;
  }
  if (!read || !sameDonor(kit.donor, read)) throw fail(409, 'donor_changed');
  if (!kit.class_move || kit.state !== 'quoted') return false;
  const today = amsterdamToday();
  const specs = orderSpecs(orderedPack(kit.config.packId), orderedHub(kit.config.hubId), kit.fulfilment, kit.delivery_country, kit.donor.country, true, today);
  const lines = await query<{ code: string; gross_cents: number }>(client, 'SELECT code, gross_cents FROM order_lines WHERE order_id = $1', [row.id]);
  const quoted = lines.find((l) => l.code.startsWith('INSPECT-'))?.gross_cents;
  if (quoted === specs.find((l) => l.code.startsWith('INSPECT-'))?.grossCents) return false;
  await repriceQuoted(client, row.id, specs, today);
  return true;
}

export async function payStage(user: User, orderId: string, stageInput: unknown, key: string): Promise<Reply> {
  const stage = oneOf(stageInput, STAGES);
  if (!stage) throw invalid({ stage: 'Choose deposit, instalment-1, instalment-2 or instalment-3.' });
  const result = await transaction(async (client): Promise<Intent | 'requoted'> => {
    const row = await ownOrder(client, user, orderId, true);
    const stages = await stageRows(client, orderId);
    const target = stages.filter((s) => s.stage === stage)[0];
    if ((row.state === 'quoted' && stage !== 'deposit') || CLOSED_STATES.includes(row.state)) throw fail(409, 'illegal_transition');
    if (target.status === 'paid') throw fail(409, 'stage_already_paid');
    if (stages.some((s) => s.position < target.position && s.status !== 'paid')) throw fail(409, 'stage_out_of_order');
    if (stages.some((s) => s.status === 'pending')) throw fail(409, 'payment_in_flight');
    if (await one(client, "SELECT 1 FROM refunds WHERE order_id = $1 AND status = 'pending'", [orderId])) throw fail(409, 'refund_in_flight');
    if (await depositGate(client, row, stage)) return 'requoted';
    return markPending(client, row, target, `${user.id}:${key}`, false);
  });
  if (result === 'requoted') throw fail(409, 'quote_changed');
  const sent = await dispatchPurchase(result);
  if (sent !== 'sent') {
    await revertIntent(orderId, result);
    throw sent === 'refused' ? fail(402, 'payment_refused') : fail(503, 'payments_paused');
  }
  return { status: 202, body: await loadOrder(sql, orderId) };
}

// ---- believing notifications --------------------------------------------------------------------------------------------

function outcomeOf(transaction: KbTransaction): 'success' | 'failed' | null {
  if (transaction.status === 'SUCCESS') return 'success';
  return FAILURE_STATUSES.has(transaction.status) ? 'failed' : null;
}

/** A delivery is believed only through a fresh read of the payment: its transactions, not the event, decide. */
export async function handleNotification(body: Record<string, unknown>): Promise<void> {
  const paymentId = body['objectId'];
  if (body['objectType'] !== 'PAYMENT' || typeof paymentId !== 'string') return;
  const payment = await readPayment(paymentId);
  if (!payment) return;
  for (const kb of payment.transactions) {
    const outcome = outcomeOf(kb);
    if (!outcome) continue;
    const record = await one<PaymentRecord>(sql, 'SELECT external_key, order_id, stage, user_id, collection, amount_cents, outcome FROM payments WHERE external_key = $1', [kb.transactionExternalKey]);
    if (record) {
      if (record.outcome === null && kb.transactionType === 'PURCHASE' && kb.currency === 'EUR' && centsOf(kb.amount) === record.amount_cents) {
        await applyPurchase(record, outcome, payment.paymentId, kb.transactionId);
      }
    } else if (kb.transactionType === 'REFUND' && kb.currency === 'EUR') {
      await applyDrawOutcome(kb, payment.paymentId, outcome);
    }
  }
}

async function applyPurchase(record: PaymentRecord, outcome: 'success' | 'failed', kbPaymentId: string | null, kbTransactionId: string | null): Promise<void> {
  await transaction(async (client) => {
    const row = await orderRow(client, record.order_id, true);
    const claimed = await one(client, 'UPDATE payments SET outcome = $2, kb_payment_id = COALESCE($3, kb_payment_id), kb_transaction_id = COALESCE($4, kb_transaction_id) WHERE external_key = $1 AND outcome IS NULL RETURNING external_key', [
      record.external_key, outcome, kbPaymentId, kbTransactionId,
    ]);
    if (!row || !claimed) return;
    if (kbPaymentId) await query(client, 'INSERT INTO notifications (payment_id) VALUES ($1)', [kbPaymentId]);
    const stage = (await stageRows(client, record.order_id)).filter((s) => s.stage === record.stage)[0];
    if (stage.status !== 'pending') return;
    if (outcome === 'failed') {
      if (!record.collection) {
        await query(client, "UPDATE stages SET status = 'failed' WHERE order_id = $1 AND stage = $2", [record.order_id, record.stage]);
      } else if (stage.attempts >= MAX_ATTEMPTS) {
        await query(client, "UPDATE stages SET status = 'overdue' WHERE order_id = $1 AND stage = $2", [record.order_id, record.stage]);
        await query(client, "UPDATE orders SET state = 'in arrears' WHERE id = $1", [record.order_id]);
      } else {
        await query(client, "UPDATE stages SET status = 'scheduled' WHERE order_id = $1 AND stage = $2", [record.order_id, record.stage]);
      }
      return;
    }
    await confirmStage(client, row, record.stage);
  });
}

async function confirmStage(client: PoolClient, row: OrderRow, stage: StageName): Promise<void> {
  const confirmedAt = shopNow();
  await query(client, "UPDATE stages SET status = 'paid', confirmed_at = $3 WHERE order_id = $1 AND stage = $2", [row.id, stage, confirmedAt.toISOString()]);
  if (stage === 'deposit') {
    const day = amsterdamDate(confirmedAt.getTime());
    for (const [month, name] of (['instalment-1', 'instalment-2', 'instalment-3'] as const).entries()) {
      await query(client, 'UPDATE stages SET due_date = $3 WHERE order_id = $1 AND stage = $2', [row.id, name, addMonthsAnchored(day, month + 1)]);
    }
    await query(client, "UPDATE orders SET state = 'deposit confirmed' WHERE id = $1", [row.id]);
  } else if (stage === 'instalment-3') {
    await query(client, "UPDATE orders SET state = 'paid in full' WHERE id = $1", [row.id]);
  } else {
    const overdue = await one(client, "SELECT 1 FROM stages WHERE order_id = $1 AND status = 'overdue'", [row.id]);
    if (!overdue && row.state === 'in arrears') {
      await query(client, "UPDATE orders SET state = 'instalments running' WHERE id = $1", [row.id]);
    }
  }
  const order = await loadOrder(client, row.id);
  const owner = await theRow<{ email: string }>(client, 'SELECT email FROM users WHERE id = $1', [row.user_id]);
  const mail = receiptMail(order, order.schedule.filter((s) => s.stage === stage)[0]);
  await queueMail(client, `receipt:${row.id}:${stage}`, owner.email, mail.subject, mail.body);
}

// ---- scheduled collection -------------------------------------------------------------------------------------------------

/** A refused collection counts as a failed attempt at once. */
async function failCollection(intent: Intent): Promise<void> {
  const record = await one<PaymentRecord>(sql, 'SELECT external_key, order_id, stage, user_id, collection, amount_cents, outcome FROM payments WHERE external_key = $1', [intent.externalKey]);
  if (record) await applyPurchase(record, 'failed', null, null);
}

async function collectOrder(orderId: string, today: string): Promise<void> {
  const intent = await transaction(async (client): Promise<Intent | null> => {
    const row = await orderRow(client, orderId, true);
    if (!row || !['deposit confirmed', 'instalments running', 'in arrears'].includes(row.state)) return null;
    if (await one(client, "SELECT 1 FROM refunds WHERE order_id = $1 AND status = 'pending'", [orderId])) return null;
    if (row.state === 'in arrears') {
      await query(client, "UPDATE stages SET status = 'overdue' WHERE order_id = $1 AND stage <> 'deposit' AND status IN ('scheduled', 'failed') AND due_date <= $2", [orderId, today]);
      return null;
    }
    const next = (await stageRows(client, orderId)).filter((s) => s.stage !== 'deposit').find((s) => s.status !== 'paid');
    if (!next || (next.status !== 'scheduled' && next.status !== 'failed')) return null;
    if (addDays(next.due_date, RETRY_DAYS * next.attempts) > today || !(await killbillIsUp(client))) return null;
    return markPending(client, row, next, `collect:${orderId}:${next.stage}:${next.attempts + 1}`, true);
  });
  if (!intent) return;
  const sent = await dispatchPurchase(intent);
  if (sent === 'unreachable') await revertIntent(orderId, intent);
  else if (sent === 'refused') await failCollection(intent);
}

/** Collect every instalment that has fallen due on the shop clock; no client is involved. */
export async function collectDue(): Promise<void> {
  const today = amsterdamToday();
  const due = await query<{ id: string }>(
    sql,
    `SELECT DISTINCT o.id FROM orders o JOIN stages s ON s.order_id = o.id
     WHERE o.state IN ('deposit confirmed', 'instalments running', 'in arrears') AND s.stage <> 'deposit' AND s.status IN ('scheduled', 'failed') AND s.due_date <= $1`,
    [today],
  );
  for (const { id } of due) await collectOrder(id, today);
}

