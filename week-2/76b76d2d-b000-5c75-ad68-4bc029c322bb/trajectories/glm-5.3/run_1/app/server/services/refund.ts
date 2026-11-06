import { DateTime } from 'luxon';
import { query, withTransaction } from './database';
import type { KillBillClient } from './killbill';
import { KillBillError } from './killbill';
import type { OutboxService } from './outbox';
import type { Config } from '../config';
import { ApiError } from '../http/errors';
import { refundDeadline, type Locale } from '../domain/model';
import { refundEmail, emailText, emailHtml } from '../mail/templates';
import { nextMovementId } from './finance';

export interface BookingRecord {
  ref: string;
  state: string;
  account_id: number | null;
  guest_email: string | null;
  locale: string;
  screening_id: string;
  paid_cents: number;
  credit_applied_cents: number;
  kb_account_id: string | null;
  kb_payment_id: string | null;
  kb_invoice_id: string | null;
}

export async function bookingByRef(ref: string): Promise<BookingRecord | null> {
  const res = await query<BookingRecord>(
    `SELECT ref, state, account_id, guest_email, locale, screening_id, paid_cents,
            credit_applied_cents, kb_account_id::text AS kb_account_id, kb_payment_id, kb_invoice_id
     FROM bookings WHERE upper(ref) = upper($1)`,
    [ref],
  );
  return res.rows[0] ?? null;
}

export async function accountNumberForBooking(booking: BookingRecord): Promise<string | null> {
  if (booking.account_id === null) return null;
  const res = await query<{ number: string }>('SELECT number FROM accounts WHERE id = $1', [booking.account_id]);
  return res.rows[0]?.number ?? null;
}

export interface RefundDeps {
  cfg: Config;
  kb: KillBillClient;
  outbox: OutboxService;
}

export interface RefundOutcome {
  refund: {
    booking_ref: string;
    refunded_cents: number;
    recredited_cents: number;
    currency: 'CAD';
    state: 'refunded';
  };
  audit_id: number;
}

async function kbSafe<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof KillBillError) throw new ApiError('billing_unavailable');
    throw new ApiError('billing_unavailable');
  }
}

export function refundReasonText(reason: 'self' | 'box-office' | { seasonTitle: string }): string {
  if (reason === 'self') return 'Requested by you';
  if (reason === 'box-office') return 'Issued by the box office';
  return `Season withdrawn: ${reason.seasonTitle}`;
}

/**
 * The one refund rule: allowed only strictly before showtime − 2 hours; the
 * card portion goes back to the Kill Bill payment, the credit portion back to
 * the account credit through a reversal pair. Money already moved in Kill
 * Bill is not moved twice, so a retried request finishes the rest.
 */
export async function refundBooking(
  deps: RefundDeps,
  input: {
    ref: string;
    reason: 'self' | 'box-office' | { seasonTitle: string };
    actor: string;
    startsAt: DateTime;
  },
): Promise<RefundOutcome> {
  const { kb, outbox } = deps;
  const booking = await bookingByRef(input.ref);
  if (!booking) throw new ApiError('not_found');

  if (booking.state === 'held' || booking.state === 'expired') throw new ApiError('booking_not_paid');
  if (booking.state === 'refunded') throw new ApiError('already_refunded');
  if (booking.state === 'checked-in') throw new ApiError('booking_checked_in');
  if (booking.state !== 'paid') throw new ApiError('booking_not_paid');

  // The one refund cutoff: strictly before showtime - 2 hours.
  if (DateTime.now() >= refundDeadline(input.startsAt)) {
    throw new ApiError('refund_window_closed');
  }

  const refunded = booking.paid_cents;
  const recredited = booking.credit_applied_cents;
  const reasonText = refundReasonText(input.reason);
  const locale = (booking.locale === 'fr' ? 'fr' : 'en') as Locale;

  let auditId = 0;
  await withTransaction(async (client) => {
    const lock = await client.query<{ state: string }>(
      'SELECT state FROM bookings WHERE ref=$1 FOR UPDATE',
      [booking.ref],
    );
    if (lock.rows[0].state !== 'paid') {
      throw new ApiError('already_refunded');
    }

    if (refunded > 0 && booking.kb_payment_id) {
      const already = await kbSafe(kb.paymentRefundedCents(booking.kb_payment_id));
      const remaining = refunded - already;
      if (remaining > 0) {
        await kbSafe(kb.refundPayment(booking.kb_payment_id, remaining));
      }
    }
    if (recredited > 0 && booking.kb_account_id) {
      const marker = `${booking.ref} RECREDIT`;
      if (!(await kbSafe(kb.hasCreditDescription(booking.kb_account_id, marker)))) {
        await kbSafe(kb.createCredit(booking.kb_account_id, marker, recredited));
      }
    }
    // The refund restores the invoice balance; voiding releases it and any
    // account credit the restored balance would otherwise consume.
    if (booking.kb_invoice_id) {
      await kb.voidInvoice(booking.kb_invoice_id).catch(() => undefined);
    }

    await client.query(`UPDATE bookings SET state='refunded', refunded_at=now() WHERE ref=$1`, [booking.ref]);
    await client.query(
      `INSERT INTO booking_refunds (booking_ref, refunded_cents, recredited_cents, reason, actor)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (booking_ref) DO NOTHING`,
      [booking.ref, refunded, recredited, reasonText, input.actor],
    );
    await client.query(`UPDATE tickets SET status='refunded' WHERE booking_ref=$1`, [booking.ref]);
    await client.query(`DELETE FROM seat_claims WHERE booking_ref=$1`, [booking.ref]);
    await client.query(`UPDATE guest_links SET active=false WHERE booking_ref=$1`, [booking.ref]);

    const accountNumber = await accountNumberForBooking(booking);
    if (recredited > 0 && accountNumber) {
      // The paired reversal: member-credit +Z and credit-redeemed −Z.
      const movementId = await nextMovementId(client);
      await client.query(
        `INSERT INTO credit_ledger (movement_id, account_number, ledger_account, amount_cents, kind, reference)
         VALUES ($1,$2,'member-credit',$3,'reversal',$4)`,
        [movementId, accountNumber, recredited, booking.ref],
      );
      await client.query(
        `INSERT INTO credit_ledger (movement_id, account_number, ledger_account, amount_cents, kind, reference)
         VALUES ($1,$2,'credit-redeemed',$3,'reversal',$4)`,
        [movementId, accountNumber, -recredited, booking.ref],
      );
    }

    const email = refundEmail(locale, booking.ref, refunded, recredited, input.reason);
    const toEmail = booking.guest_email ?? (await bookingAccountEmail(booking));
    outbox.enqueueInTx(client, {
      messageKey: `booking-refunded:${booking.ref}`,
      kind: 'booking-refunded',
      to: toEmail ?? '',
      subject: email.subject,
      bodyText: emailText(email.lines),
      html: emailHtml(email.lines),
      locale,
    });

    const audit = await client.query<{ id: number }>(
      `INSERT INTO audit_log (actor, action, target, amount_cents, reason)
       VALUES ($1,'refund',$2,$3,$4) RETURNING id`,
      [input.actor, booking.ref, refunded + recredited, reasonText],
    );
    auditId = audit.rows[0].id;
  });

  return {
    refund: {
      booking_ref: booking.ref,
      refunded_cents: refunded,
      recredited_cents: recredited,
      currency: 'CAD',
      state: 'refunded',
    },
    audit_id: auditId,
  };
}

async function bookingAccountEmail(booking: BookingRecord): Promise<string | null> {
  if (booking.account_id === null) return null;
  const res = await query<{ email: string }>('SELECT email FROM accounts WHERE id = $1', [booking.account_id]);
  return res.rows[0]?.email ?? null;
}
