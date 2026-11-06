import { REFUND_CUTOFF_SECONDS } from '../../shared/domain.ts';
import { one, transaction } from '../db/pool.ts';
import { ApiError } from '../http/errors.ts';
import { writeAudit } from '../repo/audit.ts';
import { writeMovement } from '../repo/credit.ts';
import type { BookingRow } from '../repo/bookings.ts';
import { addAccountCredit, refundPayment } from '../killbill/client.ts';
import { enqueueMail } from '../mail/outbox.ts';
import { refundEmail, type RefundReason } from '../mail/templates.ts';

export type RefundOutcome = {
  booking_ref: string;
  refunded_cents: number;
  recredited_cents: number;
  currency: 'CAD';
  state: 'refunded';
  audit_id: number;
};

/** The one refund-cutoff rule: allowed only strictly before showtime minus two hours. */
export function refundWindowOpen(startsAt: Date, now: Date): boolean {
  return now.getTime() < startsAt.getTime() - REFUND_CUTOFF_SECONDS * 1000;
}

export function assertRefundable(booking: BookingRow): void {
  if (booking.state === 'refunded') throw new ApiError('already_refunded');
  if (booking.state === 'checked-in') throw new ApiError('booking_checked_in');
  if (booking.state !== 'paid') throw new ApiError('booking_not_paid');
}

export async function refundBooking(input: {
  booking: BookingRow;
  now: Date;
  actor: string;
  reason: RefundReason;
  auditReason: string;
  enforceWindow: boolean;
}): Promise<RefundOutcome> {
  const booking = input.booking;
  assertRefundable(booking);
  if (input.enforceWindow && !refundWindowOpen(booking.starts_at, input.now)) {
    throw new ApiError('refund_window_closed');
  }

  const refunded = booking.paid_cents;
  const recredited = booking.credit_applied_cents;
  const patron =
    booking.account_id === null
      ? null
      : await one<{ number: string | null; kb_account_id: string | null }>(
          'select number, kb_account_id from accounts where id = $1',
          [booking.account_id],
        );

  return transaction(async (tx) => {
    const locked = await tx.one<{ state: string }>('select state from bookings where id = $1 for update', [
      booking.id,
    ]);
    if (locked === null) throw new ApiError('not_found');
    if (locked.state === 'refunded') throw new ApiError('already_refunded');
    if (locked.state === 'checked-in') throw new ApiError('booking_checked_in');
    if (locked.state !== 'paid') throw new ApiError('booking_not_paid');
    if (refunded > 0 && booking.kb_payment_id !== null) await refundPayment(booking.kb_payment_id, refunded);
    if (recredited > 0 && patron?.kb_account_id != null) {
      await addAccountCredit(patron.kb_account_id, recredited, `${booking.ref} RECREDIT`);
    }
    const updated = await tx.query<{ id: number }>(
      `update bookings set state='refunded', refunded_at=now(), refunded_cents=$2, recredited_cents=$3,
         guest_token=null where id=$1 and state='paid' returning id`,
      [booking.id, refunded, recredited],
    );
    if (updated.length === 0) throw new ApiError('already_refunded');
    await tx.query("update tickets set status='refunded' where booking_id=$1", [booking.id]);
    await tx.query('delete from seat_claims where booking_id = $1', [booking.id]);
    if (recredited > 0 && patron?.number != null) {
      await writeMovement(tx, {
        accountNumber: patron.number,
        kind: 'reversal',
        amountCents: recredited,
        reference: booking.ref,
      });
    }
    await enqueueMail(
      tx,
      refundEmail({
        ref: booking.ref,
        email: booking.email,
        locale: booking.locale,
        refunded_cents: refunded,
        recredited_cents: recredited,
        reason: input.reason,
      }),
    );
    const auditId = await writeAudit(tx, {
      actor: input.actor,
      action: 'refund',
      target: booking.ref,
      amountCents: refunded,
      reason: input.auditReason,
    });
    return {
      booking_ref: booking.ref,
      refunded_cents: refunded,
      recredited_cents: recredited,
      currency: 'CAD' as const,
      state: 'refunded' as const,
      audit_id: auditId,
    };
  });
}
