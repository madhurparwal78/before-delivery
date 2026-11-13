import type { IncomingMessage } from 'node:http';
import { pool, withTransaction } from '../db.js';
import {
  certificateNotApproved,
  certificateNotStored,
  invalidTransition,
  mailUnavailable,
  notFound,
  paymentDeclined,
  paymentsUnavailable,
  quoteExpired,
  quoteRepriced,
  storageUnavailable,
} from '../errors.js';
import { readJsonBody } from '../http.js';
import { requireIdempotencyKey, runIdempotent } from '../idempotency.js';
import { invalidateProviderStatus } from '../providerStatus.js';
import { confirmationMail } from '../mails.js';
import { accessBooking } from './access.js';
import * as killbill from '../../providers/killbill.js';
import * as storage from '../../providers/storage.js';
import { MailUnavailableError, sendMail } from '../../providers/mail.js';
import { assertTransitionRole, assertTransitionState } from '../../domain/transitions.js';
import {
  bookingUnitRows,
  buildBooking,
  effectiveState,
  findBookingRow,
  latestCertificate,
  type BookingRow,
} from '../../domain/bookings.js';
import { activeRateCardVersion, activeRates } from '../../domain/ratecards.js';
import { billableDaysFor } from '../../shared/pricing.js';
import type { Booking, PaymentStatus } from '../../shared/types.js';

const CONFIRM_ENDPOINT = 'POST /api/bookings/:ref/confirm';

/** Every Kill Bill failure outside the confirm purchase reads as an outage. */
export function asPaymentsOutage(error: unknown): never {
  if (
    error instanceof killbill.PaymentsUnreachableError ||
    error instanceof killbill.PaymentsRefusedError
  ) {
    invalidateProviderStatus();
    throw paymentsUnavailable();
  }
  throw error;
}

interface ConfirmStart {
  row: BookingRow;
  certificateKey: string;
  previousPaymentStatus: PaymentStatus;
  repriced: boolean;
}

/**
 * Takes the state, hold and certificate checks, reprices when a newer rate card
 * is in effect, and claims the single in-flight confirm slot for this booking.
 */
async function startConfirm(ref: string): Promise<ConfirmStart> {
  return withTransaction(async (client) => {
    const row = await findBookingRow(client, ref, true);
    if (row === null) throw notFound();
    const state = effectiveState(row);
    if (state === 'expired') throw quoteExpired();
    if (state !== 'quote') throw invalidTransition(ref, state);
    if (row.confirmInFlight) throw invalidTransition(ref, state);

    const certificate = await latestCertificate(client, ref);
    if (certificate === null || certificate.status !== 'approved') throw certificateNotApproved();

    const activeVersion = await activeRateCardVersion(client);
    if (activeVersion !== row.rateCardVersion) {
      const rates = await activeRates(client);
      const rate = rates.get(row.kitId);
      if (rate === undefined) throw new Error(`Rate card v${activeVersion} misses ${row.kitId}`);
      const billableDays = billableDaysFor(row.pickupDate, row.hireDays);
      const hirePriceCents = billableDays * rate.dayRateCents;
      await client.query(
        `UPDATE bookings
            SET billable_days = $2, day_rate_cents = $3, hire_price_cents = $4,
                deposit_cents = $5, total_cents = $6, rate_card_version = $7
          WHERE ref = $1`,
        [
          ref,
          billableDays,
          rate.dayRateCents,
          hirePriceCents,
          rate.depositCents,
          hirePriceCents + rate.depositCents,
          activeVersion,
        ],
      );
      const repricedRow = await findBookingRow(client, ref);
      if (repricedRow === null) throw notFound();
      return {
        row: repricedRow,
        certificateKey: certificate.storageKey,
        previousPaymentStatus: repricedRow.paymentStatus,
        repriced: true,
      };
    }

    await client.query(`UPDATE bookings SET confirm_in_flight = true WHERE ref = $1`, [ref]);
    return {
      row,
      certificateKey: certificate.storageKey,
      previousPaymentStatus: row.paymentStatus,
      repriced: false,
    };
  });
}

async function setPaymentStatus(ref: string, status: PaymentStatus): Promise<void> {
  await pool.query(`UPDATE bookings SET payment_status = $2 WHERE ref = $1`, [ref, status]);
}

export async function confirmBooking(
  req: IncomingMessage,
  ref: string,
): Promise<{ status: number; body: string }> {
  const body = await readJsonBody(req);
  const access = await accessBooking(pool, req, ref);
  assertTransitionRole('confirm', access.role);
  const key = requireIdempotencyKey(req);

  return runIdempotent(CONFIRM_ENDPOINT, key, `/api/bookings/${ref}/confirm`, body, async () => ({
    status: 200,
    body: await runConfirm(ref),
  }));
}

async function runConfirm(ref: string): Promise<Booking> {
  const start = await startConfirm(ref);
  if (start.repriced) throw quoteRepriced(await buildBooking(pool, start.row));
  try {
    if ((await lookUpCertificate(start.certificateKey)) === 'absent') {
      throw certificateNotStored();
    }

    await setPaymentStatus(ref, 'pending');

    let purchase: killbill.PurchaseResult;
    try {
      const accountId = await killbill.ensureRenterAccount(
        start.row.renterEmail,
        start.row.renterName,
      );
      purchase = await killbill.recordPurchase(
        accountId,
        ref,
        `${ref}-confirm`,
        start.row.totalCents,
      );
    } catch (error) {
      if (error instanceof killbill.PaymentsRefusedError) {
        await setPaymentStatus(ref, 'failed');
        throw paymentDeclined();
      }
      await setPaymentStatus(ref, start.previousPaymentStatus);
      if (error instanceof killbill.PaymentsUnreachableError) {
        invalidateProviderStatus();
        throw paymentsUnavailable();
      }
      throw error;
    }
    if (!purchase.succeeded) {
      await setPaymentStatus(ref, 'failed');
      throw paymentDeclined();
    }

    const units = await bookingUnitRows(pool, ref);
    const mail = confirmationMail(start.row, units);
    try {
      await sendMail(start.row.renterEmail, mail.subject, mail.body);
    } catch (error) {
      if (!(error instanceof MailUnavailableError)) throw error;
      try {
        await killbill.recordRefund(
          purchase.paymentId,
          `${ref}-confirm-rollback`,
          start.row.totalCents,
        );
      } catch (refundError) {
        asPaymentsOutage(refundError);
      }
      await setPaymentStatus(ref, 'none');
      throw mailUnavailable();
    }

    await pool.query(
      `UPDATE bookings
          SET state = 'confirmed', payment_status = 'paid', killbill_payment_id = $2,
              confirmation_mailed = true, hold_expires_at = NULL
        WHERE ref = $1`,
      [ref, purchase.paymentId],
    );
    const row = await findBookingRow(pool, ref);
    if (row === null) throw notFound();
    return buildBooking(pool, row);
  } finally {
    await pool.query(`UPDATE bookings SET confirm_in_flight = false WHERE ref = $1`, [ref]);
  }
}

async function lookUpCertificate(key: string): Promise<storage.ObjectPresence> {
  try {
    return await storage.objectPresence(key);
  } catch (error) {
    if (error instanceof storage.StorageUnavailableError) {
      invalidateProviderStatus();
      throw storageUnavailable();
    }
    throw error;
  }
}

export async function cancelBooking(req: IncomingMessage, ref: string): Promise<Booking> {
  await readJsonBody(req);
  const access = await accessBooking(pool, req, ref);
  assertTransitionRole('cancel', access.role);

  return withTransaction(async (client) => {
    const row = await findBookingRow(client, ref, true);
    if (row === null) throw notFound();
    assertTransitionState('cancel', row);
    if (row.killbillPaymentId === null) {
      throw new Error(`Confirmed booking ${ref} has no recorded payment`);
    }
    try {
      await killbill.recordRefund(row.killbillPaymentId, `${ref}-cancel`, row.totalCents);
    } catch (error) {
      asPaymentsOutage(error);
    }
    await client.query(
      `UPDATE bookings
          SET state = 'cancelled', payment_status = 'refunded', refund_cents = $2
        WHERE ref = $1`,
      [ref, row.totalCents],
    );
    const cancelled = await findBookingRow(client, ref);
    if (cancelled === null) throw notFound();
    return buildBooking(client, cancelled);
  });
}
