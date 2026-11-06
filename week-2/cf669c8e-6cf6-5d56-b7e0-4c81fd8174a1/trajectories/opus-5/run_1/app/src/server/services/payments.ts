/**
 * Taking money.
 *
 * Every refusal on a payment request is decided in one total order, published
 * under Paying, and the deposit gate sits at position 6 with its own order.
 * None of the refusals makes a Kill Bill call.
 *
 * A payment reads `pending` until a believed notification marks it paid: the
 * shop never moves money state from its own reads outside handling a
 * notification.
 */

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type { Order, StageName, User } from '../../shared/types.js';
import { amsterdamDate } from '../domain/clock.js';
import { STAGE_ORDER } from '../domain/money.js';
import { inspectionFeeOn, isClassMove, kitLines, kitNotices } from '../domain/quote.js';
import { poolQueryable, query, transact } from '../db/pool.js';
import {
  KillbillRefused,
  KillbillUnreachable,
  createAccount,
  killbillStatus,
  purchase,
} from '../providers/killbill.js';
import { lookupPlate } from '../providers/registry.js';
import {
  assembleOrder,
  loadOrder,
  loadOrderForUpdate,
  requoteOrder,
  type LoadedOrder,
} from '../store/orders.js';
import { ApiError, conflict, notFound, paymentRefused, paymentsPaused, registryUnreachable } from '../http/errors.js';
import { donorMatches, resolveDonor } from './donors.js';
import type { Answer } from './idempotency.js';

/** States from which no payment can be taken. */
const CLOSED_TO_PAYMENT: readonly string[] = [
  'withdrawn',
  'paid in full',
  'kit dispatched',
  'fitted',
  'inspection passed',
];

export function isStageName(value: unknown): value is StageName {
  return STAGE_ORDER.includes(value as StageName);
}

/**
 * Refusals 1 to 5 of the published order. These are the ones that race, so
 * they are re-run under the order's row lock before any state changes.
 */
function guardStage(loaded: LoadedOrder, stage: StageName): void {
  const { order, stages, refunds } = loaded;

  if (CLOSED_TO_PAYMENT.includes(order.state)) throw conflict('illegal_transition');
  if (order.state === 'quoted' && stage !== 'deposit') throw conflict('illegal_transition');

  const named = stages.find((row) => row.stage === stage);
  if (!named) throw conflict('illegal_transition');
  if (named.status === 'paid') throw conflict('stage_already_paid');

  const position = STAGE_ORDER.indexOf(stage);
  for (const earlier of STAGE_ORDER.slice(0, position)) {
    const row = stages.find((s) => s.stage === earlier);
    if (row && row.status !== 'paid') throw conflict('stage_out_of_order');
  }

  if (stages.some((row) => row.status === 'pending')) throw conflict('payment_in_flight');
  if (refunds.some((refund) => refund.status === 'pending')) throw conflict('refund_in_flight');
}

/**
 * The deposit gate, in its published order. A hand-entered quote never becomes
 * confirmed, so the rider looks up the plate and makes a new quote.
 */
async function runGate(loaded: LoadedOrder, stage: StageName): Promise<void> {
  const { order } = loaded;
  const isKitDeposit = order.kind === 'kit' && stage === 'deposit';

  if (isKitDeposit) {
    if (!order.donor?.confirmed) throw conflict('donor_unconfirmed');
    if (order.fit_verdict !== 'fits') throw conflict('fit_not_passed');
  }

  // Applies to every stage, kit or bike.
  if (killbillStatus() === 'down') throw paymentsPaused();

  if (!isKitDeposit) return;

  const donor = order.donor;
  const config = order.config;
  if (!donor?.plate || !config) throw conflict('donor_unconfirmed');

  const fresh = await lookupPlate(donor.plate, donor.country);
  if (fresh.outcome === 'unreachable') throw registryUnreachable();
  if (fresh.outcome === 'not_found') throw conflict('donor_changed');

  const reread = await resolveDonor({ plate: donor.plate, country: donor.country });
  if (!donorMatches(donor, reread)) throw conflict('donor_changed');

  await requoteIfFeeChanged(loaded);
}

/**
 * A deposit on a `quoted` order whose fee is no longer current re-quotes the
 * order, makes no Kill Bill call, and answers `quote_changed`.
 */
async function requoteIfFeeChanged(loaded: LoadedOrder): Promise<void> {
  const { order } = loaded;
  const config = order.config;
  const donor = order.donor;
  if (!config || !donor) return;
  if (order.state !== 'quoted') return;
  if (!isClassMove(donor.roadClass, config.roadClass)) return;

  const today = amsterdamDate();
  const current = inspectionFeeOn(donor.country, today);
  const quoted = loaded.lines.find((line) => line.code.startsWith('INSPECT-'));
  if (quoted && quoted.gross_cents === current.grossCents) return;

  await transact(async (client) => {
    const drafts = kitLines(
      config.packId,
      config.hubId,
      donor.roadClass,
      config.roadClass,
      donor.country,
      config.fulfilment,
      config.country,
      today,
    );
    await requoteOrder(client, order.id, drafts, {
      notices: kitNotices(donor.roadClass, config.roadClass),
      feeQuoteDate: today,
    });
  });

  throw conflict('quote_changed');
}

/** The rider's Kill Bill account, created on first use. */
export async function ensureKillbillAccount(user: User): Promise<string> {
  const existing = await query<{ account_id: string }>(
    'SELECT account_id FROM killbill_accounts WHERE user_id = $1',
    [user.id],
  );
  const found = existing.rows[0];
  if (found) return found.account_id;

  const externalKey = `rider-${user.id}`;
  const accountId = await createAccount(user.id, user.name, user.email);
  await query(
    `INSERT INTO killbill_accounts(user_id, account_id, external_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO NOTHING`,
    [user.id, accountId, externalKey],
  );
  const after = await query<{ account_id: string }>(
    'SELECT account_id FROM killbill_accounts WHERE user_id = $1',
    [user.id],
  );
  return after.rows[0]?.account_id ?? accountId;
}

interface ClaimedAttempt {
  paymentId: string;
  attempt: number;
  amountCents: number;
}

/**
 * Claim the attempt and move the stage to `pending` before any provider call,
 * so a notification arriving at once already finds a payment this shop knows.
 */
async function claimAttempt(
  orderId: string,
  stage: StageName,
  externalKey: string,
  guard: (loaded: LoadedOrder) => void,
): Promise<ClaimedAttempt> {
  return transact(async (client) => {
    const loaded = await loadOrderForUpdate(client, orderId);
    if (!loaded) throw notFound();
    guard(loaded);

    const row = loaded.stages.find((s) => s.stage === stage);
    if (!row) throw conflict('illegal_transition');

    const attempt = row.attempts + 1;
    const paymentId = randomUUID();
    await client.query(
      `INSERT INTO payments(id, order_id, stage, attempt, external_key, amount_cents, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [paymentId, orderId, stage, attempt, externalKey, row.amount_cents],
    );
    await client.query(
      `UPDATE order_stages SET status = 'pending', attempts = $3 WHERE order_id = $1 AND stage = $2`,
      [orderId, stage, attempt],
    );
    await advanceStateForPayment(client, loaded, stage);

    return { paymentId, attempt, amountCents: row.amount_cents };
  });
}

/** `quoted` → `deposit pending`, and `deposit confirmed` → `instalments running`. */
async function advanceStateForPayment(
  client: PoolClient,
  loaded: LoadedOrder,
  stage: StageName,
): Promise<void> {
  const next =
    stage === 'deposit' && loaded.order.state === 'quoted'
      ? 'deposit pending'
      : stage !== 'deposit' && loaded.order.state === 'deposit confirmed'
        ? 'instalments running'
        : null;
  if (!next) return;
  await client.query('UPDATE orders SET state = $2 WHERE id = $1', [loaded.order.id, next]);
}

/** Undo a claim that never reached Kill Bill, so nothing is left pending. */
async function releaseAttempt(
  orderId: string,
  stage: StageName,
  paymentId: string,
  previousState: string,
  previousAttempts: number,
): Promise<void> {
  await transact(async (client) => {
    await client.query('DELETE FROM payments WHERE id = $1', [paymentId]);
    await client.query(
      `UPDATE order_stages SET status = 'scheduled', attempts = $3 WHERE order_id = $1 AND stage = $2`,
      [orderId, stage, previousAttempts],
    );
    await client.query('UPDATE orders SET state = $2 WHERE id = $1', [orderId, previousState]);
  });
}

async function markAttemptFailed(orderId: string, stage: StageName, paymentId: string): Promise<void> {
  await transact(async (client) => {
    await client.query("UPDATE payments SET status = 'failed' WHERE id = $1", [paymentId]);
    await client.query("UPDATE order_stages SET status = 'failed' WHERE order_id = $1 AND stage = $2", [
      orderId,
      stage,
    ]);
  });
}

export interface PaymentRequest {
  user: User;
  orderId: string;
  stage: StageName;
  externalKey: string;
}

/**
 * Request one stage. Answers `202` with the stage `pending`; the stage only
 * reads `paid` once a believed notification says so.
 */
export async function requestPayment(
  request: PaymentRequest,
  markProviderCalled: () => void,
): Promise<Answer> {
  const { user, orderId, stage, externalKey } = request;

  const first = await loadOwnedOrder(user, orderId);
  guardStage(first, stage);
  await runGate(first, stage);

  const accountId = await ensureKillbillAccount(user);

  const previousState = first.order.state;
  const previousAttempts = first.stages.find((s) => s.stage === stage)?.attempts ?? 0;
  const claimed = await claimAttempt(orderId, stage, externalKey, (loaded) => guardStage(loaded, stage));

  markProviderCalled();
  try {
    const payment = await purchase(accountId, claimed.amountCents, externalKey);
    const transaction = payment.transactions.find((t) => t.transactionExternalKey === externalKey);
    await query('UPDATE payments SET killbill_payment_id = $2, killbill_transaction_id = $3 WHERE id = $1', [
      claimed.paymentId,
      payment.paymentId,
      transaction?.transactionId ?? null,
    ]);
  } catch (error) {
    if (error instanceof KillbillUnreachable) {
      await releaseAttempt(orderId, stage, claimed.paymentId, previousState, previousAttempts);
      throw paymentsPaused();
    }
    if (error instanceof KillbillRefused) {
      await markAttemptFailed(orderId, stage, claimed.paymentId);
      throw paymentRefused();
    }
    throw error;
  }

  return { status: 202, body: await readOwnedOrder(user, orderId) };
}

export async function loadOwnedOrder(user: User, orderId: string): Promise<LoadedOrder> {
  const loaded = await loadOrder(poolQueryable, orderId);
  if (!loaded || loaded.order.user_id !== user.id) throw notFound();
  return loaded;
}

export async function readOwnedOrder(user: User, orderId: string): Promise<Order> {
  return assembleOrder(await loadOwnedOrder(user, orderId));
}

export { guardStage, runGate, CLOSED_TO_PAYMENT };
export type { ApiError };
