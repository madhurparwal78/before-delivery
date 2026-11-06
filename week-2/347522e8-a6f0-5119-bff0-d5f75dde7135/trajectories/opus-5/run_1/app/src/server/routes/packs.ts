/**
 * Hour packs and purchases.
 *
 * A purchase is all-or-nothing: Kill Bill records the payment first, under a
 * key derived from the renter and the idempotency key, and only then are the
 * purchase, the paired ledger movement and the queued receipt saved together.
 * A purchase that failed in billing stores nothing, so its key can be retried.
 */

import { createHash } from 'node:crypto';
import { db, transaction, pgErrorCode, UNIQUE_VIOLATION } from '../db.js';
import * as errors from '../http/errors.js';
import { json, type Route, type RouteResult, type SessionContext } from '../http/router.js';
import { Validator } from '../http/validate.js';
import { balanceMinutes, lockRenterHours, recordMovement } from '../domain/ledger.js';
import { renterBillingAccountId } from '../domain/billingAccount.js';
import {
  BillingUnavailable,
  PaymentDeclined,
  isBillingReachable,
  recordPurchasePayment,
  refundPayment,
} from '../services/killbill.js';
import { queueNotification, receiptMail } from '../services/notifications.js';
import type { PackRow, RenterRow } from '../rows.js';

const ALL_ROLES = ['operator', 'shift_lead', 'renter'] as const;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const WAIT_STEP_MS = 100;
const WAIT_LIMIT_MS = 10_000;

/** Only `active` and `suspended` renters may buy hours. */
const BUYING_STATUSES = new Set(['active', 'suspended']);

interface PurchaseKeyRow {
  request_hash: string;
  state: 'in_progress' | 'completed';
  status_code: number | null;
  response_body: unknown;
}

function requestHash(packId: unknown): string {
  return createHash('sha256').update(JSON.stringify({ pack_id: packId ?? null })).digest('hex');
}

async function readKey(renterId: string, key: string): Promise<PurchaseKeyRow | null> {
  return db.maybeOne<PurchaseKeyRow>(
    `SELECT request_hash, state, status_code, response_body
       FROM purchase_keys WHERE renter_id = $1 AND key = $2`,
    [renterId, key],
  );
}

/** Step 8 of the precedence: an idempotent replay, or a key used with another body. */
async function replayOrConflict(
  renterId: string,
  key: string,
  hash: string,
): Promise<RouteResult | null> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  for (;;) {
    const stored = await readKey(renterId, key);
    if (!stored) return null;
    if (stored.request_hash !== hash) throw errors.idempotencyConflict();
    if (stored.state === 'completed' && stored.status_code !== null) {
      return json(stored.status_code, stored.response_body);
    }
    if (Date.now() >= deadline) throw errors.idempotencyConflict();
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
  }
}

async function buy(context: SessionContext): Promise<RouteResult> {
  const renterId = context.principal.renterId;
  if (renterId === null) throw errors.forbidden();
  const key = context.headers['idempotency-key'];
  const hash = requestHash(context.body['pack_id']);

  if (key !== undefined && IDEMPOTENCY_KEY.test(key)) {
    const replay = await replayOrConflict(renterId, key, hash);
    if (replay) return replay;
  }

  const renter = await db.one<RenterRow>(
    `SELECT id, user_id, business_name, contact_name, email, phone, status, killbill_account_id
       FROM renters WHERE id = $1`,
    [renterId],
  );
  if (!BUYING_STATUSES.has(renter.status)) throw errors.renterNotActive();

  const validator = new Validator(context.body);
  if (key === undefined || !IDEMPOTENCY_KEY.test(key)) {
    validator.fail(
      'idempotency_key',
      'Send an Idempotency-Key header of 1 to 64 letters, digits, hyphens or underscores.',
    );
  }
  const packId = context.body['pack_id'];
  const pack =
    typeof packId === 'string'
      ? await db.maybeOne<PackRow>(
          'SELECT id, name, hours, amount_usd::text AS amount_usd FROM packs WHERE id = $1',
          [packId],
        )
      : null;
  if (!pack) validator.fail('pack_id', 'Choose an hour pack.');
  validator.done();
  if (!pack || key === undefined) throw errors.validation({ pack_id: 'Choose an hour pack.' });

  const claimed = await db.query<{ key: string }>(
    `INSERT INTO purchase_keys (renter_id, key, request_hash, state)
     VALUES ($1, $2, $3, 'in_progress')
     ON CONFLICT DO NOTHING RETURNING key`,
    [renter.id, key, hash],
  );
  if (claimed.length === 0) {
    const replay = await replayOrConflict(renter.id, key, hash);
    if (replay) return replay;
    throw errors.idempotencyConflict();
  }

  const releaseKey = async (): Promise<void> => {
    await db.query('DELETE FROM purchase_keys WHERE renter_id = $1 AND key = $2', [
      renter.id,
      key,
    ]);
  };

  let paymentId: string;
  try {
    const accountId = await renterBillingAccountId(renter);
    paymentId = await recordPurchasePayment(
      accountId,
      pack.amount_usd,
      `purchase-${renter.id}-${key}`,
    );
  } catch (error) {
    await releaseKey();
    if (error instanceof PaymentDeclined) throw errors.paymentFailed();
    if (error instanceof BillingUnavailable) throw errors.billingUnavailable();
    throw error;
  }

  try {
    const saved = await transaction(async (tx) => {
      await lockRenterHours(tx, renter.id);
      const purchase = await tx.one<{ id: string; created_at: Date }>(
        `INSERT INTO purchases
           (renter_id, pack_id, pack_name, hours, amount_usd, killbill_payment_id, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
        [renter.id, pack.id, pack.name, pack.hours, pack.amount_usd, paymentId, key],
      );
      await recordMovement(tx, {
        renterId: renter.id,
        kind: 'pack_purchase',
        minutes: pack.hours * 60,
        purchaseId: purchase.id,
        note: pack.name,
      });
      const balance = await balanceMinutes(tx, renter.id);
      await queueNotification(
        tx,
        receiptMail({
          to: renter.email,
          packName: pack.name,
          amountUsd: pack.amount_usd,
          hours: pack.hours,
          killbillPaymentId: paymentId,
          balanceMinutes: balance,
        }),
      );
      const body = {
        purchase: {
          id: purchase.id,
          pack_id: pack.id,
          pack_name: pack.name,
          hours: pack.hours,
          amount_usd: pack.amount_usd,
          killbill_payment_id: paymentId,
          created_at: purchase.created_at.toISOString(),
        },
        balance_minutes: balance,
      };
      await tx.query(
        `UPDATE purchase_keys SET state = 'completed', status_code = 201, response_body = $3
          WHERE renter_id = $1 AND key = $2`,
        [renter.id, key, JSON.stringify(body)],
      );
      return body;
    });
    return json(201, saved);
  } catch (error) {
    // Billing accepted but the local save did not land: undo the payment.
    await refundPayment(paymentId, pack.amount_usd).catch(() => undefined);
    await releaseKey();
    if (pgErrorCode(error) === UNIQUE_VIOLATION) throw errors.idempotencyConflict();
    throw error;
  }
}

export const packRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/packs',
    auth: 'session',
    roles: [...ALL_ROLES],
    async handle() {
      const packs = await db.query<PackRow>(
        'SELECT id, name, hours, amount_usd::text AS amount_usd FROM packs ORDER BY sort_order',
      );
      return json(200, { packs, purchases_available: await isBillingReachable() });
    },
  },
  {
    method: 'POST',
    path: '/api/purchases',
    auth: 'session',
    roles: ['renter'],
    body: 'json',
    handle: buy,
  },
];
