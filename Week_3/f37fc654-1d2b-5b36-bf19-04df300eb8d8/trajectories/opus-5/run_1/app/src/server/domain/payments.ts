import { createHash, randomUUID } from 'node:crypto';
import { query } from '../db/pool.js';
import { ApiError, ValidationError, serviceDown } from '../http/errors.js';
import * as killbill from '../services/killbill.js';
import { FIELD_ERRORS } from '../../shared/copy.js';
import { isoUtc } from '../../shared/venue-time.js';
import type { PayerAccount } from './billing.js';

/** Idempotent payment attempts. Every charge is named by its idempotency key. */

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const IN_FLIGHT_WAIT_MS = 10_000;
const IN_FLIGHT_POLL_MS = 150;

export interface PaymentBody {
  nameOnCard?: unknown;
  cardNumber?: unknown;
}

export interface PaymentResponse {
  paymentId: string;
  amountCents: number;
  subtotalCents: number;
  taxCents: number;
  status: 'paid';
  killbillInvoiceId: string;
  killbillPaymentId: string;
  paidAt: string;
}

interface AttemptRow {
  id: string;
  status: 'in_flight' | 'paid' | 'failed';
  request_path: string;
  request_fingerprint: string;
  response_status: number | null;
  response_body: Record<string, unknown> | null;
}

export function fingerprintOf(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

function luhnPasses(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

export interface ValidatedCard {
  nameOnCard: string;
  lastFour: string;
}

/** Validate the payment body. Only the last four digits are ever stored. */
export function validatePaymentBody(key: string | undefined, body: PaymentBody): ValidatedCard {
  const errors: Record<string, string> = {};
  if (key === undefined || !KEY_PATTERN.test(key)) {
    errors['idempotencyKey'] = FIELD_ERRORS.idempotencyKey;
  }
  const nameOnCard = typeof body.nameOnCard === 'string' ? body.nameOnCard.trim() : '';
  if (nameOnCard.length < 1 || nameOnCard.length > 80) {
    errors['nameOnCard'] = FIELD_ERRORS.nameOnCard;
  }
  const rawNumber = typeof body.cardNumber === 'string' ? body.cardNumber.replace(/ /g, '') : '';
  if (!/^\d{13,19}$/.test(rawNumber) || !luhnPasses(rawNumber)) {
    errors['cardNumber'] = FIELD_ERRORS.cardNumber;
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { nameOnCard, lastFour: rawNumber.slice(-4) };
}

async function loadAttempt(userId: string, key: string): Promise<AttemptRow | null> {
  const result = await query<AttemptRow>(
    `SELECT id, status, request_path, request_fingerprint, response_status, response_body
       FROM payment_attempts WHERE user_id = $1 AND idempotency_key = $2`,
    [userId, key],
  );
  return result.rows[0] ?? null;
}

export interface ReplayOutcome {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Claim the attempt named by the key. Returns a stored answer for a replay, and
 * waits for the first request when the same key is still in flight.
 */
export async function claimAttempt(options: {
  userId: string;
  key: string;
  path: string;
  fingerprint: string;
  targetKind: 'milestone' | 'funder';
  targetId: string;
}): Promise<{ attemptId: string; replay: ReplayOutcome | null }> {
  const attemptId = randomUUID();
  const inserted = await query<{ id: string }>(
    `INSERT INTO payment_attempts
       (id, user_id, idempotency_key, request_path, request_fingerprint, target_kind, target_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'in_flight')
     ON CONFLICT (user_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [
      attemptId,
      options.userId,
      options.key,
      options.path,
      options.fingerprint,
      options.targetKind,
      options.targetId,
    ],
  );
  if (inserted.rows[0]) return { attemptId, replay: null };

  const deadline = Date.now() + IN_FLIGHT_WAIT_MS;
  for (;;) {
    const existing = await loadAttempt(options.userId, options.key);
    if (!existing) return { attemptId, replay: null };
    if (
      existing.request_path !== options.path ||
      existing.request_fingerprint !== options.fingerprint
    ) {
      throw new ApiError(409, 'idempotency_conflict');
    }
    if (existing.status !== 'in_flight' && existing.response_status !== null) {
      return {
        attemptId: existing.id,
        replay: { status: existing.response_status, body: existing.response_body ?? {} },
      };
    }
    if (Date.now() >= deadline) {
      return {
        attemptId: existing.id,
        replay: { status: 502, body: { error: { code: 'payment_failed' } } },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, IN_FLIGHT_POLL_MS));
  }
}

export async function storeAttemptResult(
  attemptId: string,
  status: 'paid' | 'failed',
  responseStatus: number,
  responseBody: Record<string, unknown>,
  details: { lastFour?: string; killbillPaymentId?: string | null },
): Promise<void> {
  await query(
    `UPDATE payment_attempts
        SET status = $2,
            response_status = $3,
            response_body = $4,
            card_last_four = COALESCE($5, card_last_four),
            killbill_payment_id = COALESCE($6, killbill_payment_id),
            finished_at = now()
      WHERE id = $1`,
    [
      attemptId,
      status,
      responseStatus,
      JSON.stringify(responseBody),
      details.lastFour ?? null,
      details.killbillPaymentId ?? null,
    ],
  );
}

export interface ChargeTarget {
  killbillInvoiceId: string;
  invoiceNumber: string;
  subtotalCents: number;
  taxCents: number;
  amountCents: number;
}

export interface ChargeResult {
  payment: {
    killbillPaymentId: string;
    killbillInvoiceId: string;
    invoiceNumber: string;
    amountCents: number;
    subtotalCents: number;
    taxCents: number;
    paidAt: Date;
  };
  response: PaymentResponse;
}

/**
 * Ask Kill Bill to pay the invoice's balance. A retry with the same key first
 * asks whether that payment already exists, so a charge is never made twice.
 */
export async function chargeInvoice(
  payer: PayerAccount,
  target: ChargeTarget,
  idempotencyKey: string,
): Promise<ChargeResult> {
  let result: killbill.PaymentResult | null = null;
  try {
    result = await killbill.findPaymentByKey(idempotencyKey);
    if (!result) {
      const invoice = await killbill.getInvoice(target.killbillInvoiceId);
      const balance = invoice.balanceCents > 0 ? invoice.balanceCents : target.amountCents;
      result = await killbill.payInvoice(
        payer.accountId,
        target.killbillInvoiceId,
        balance,
        idempotencyKey,
      );
    }
  } catch (error) {
    if (error instanceof killbill.BillingUnavailable) {
      throw serviceDown('killbill', 'billing_unavailable');
    }
    throw new ApiError(502, 'payment_failed', 'The payment didn\'t go through. Nothing has been charged.');
  }
  if (!result.succeeded) {
    throw new ApiError(502, 'payment_failed', 'The payment didn\'t go through. Nothing has been charged.');
  }
  const paidAt = new Date();
  const payment = {
    killbillPaymentId: result.killbillPaymentId,
    killbillInvoiceId: target.killbillInvoiceId,
    invoiceNumber: target.invoiceNumber,
    amountCents: target.amountCents,
    subtotalCents: target.subtotalCents,
    taxCents: target.taxCents,
    paidAt,
  };
  return {
    payment,
    response: {
      paymentId: result.killbillPaymentId,
      amountCents: target.amountCents,
      subtotalCents: target.subtotalCents,
      taxCents: target.taxCents,
      status: 'paid',
      killbillInvoiceId: target.killbillInvoiceId,
      killbillPaymentId: result.killbillPaymentId,
      paidAt: isoUtc(paidAt),
    },
  };
}
