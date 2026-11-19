import { Router } from 'express';
import type { ManageResponse } from '../../shared/types';
import { serverNow } from '../clock';
import { pool, query, withTransaction } from '../db';
import {
  BOOKING_COLUMNS,
  findBookingByManageToken,
  releaseBookingTables,
  toBooking,
  type BookingRow,
} from '../domain/bookings';
import { enqueueFreedTables } from '../domain/claims';
import { loadLayout, requireUnit } from '../domain/floor';
import { refundsIfCancelledAt } from '../domain/rules';
import { errors } from '../errors';
import { asyncHandler, sendJson } from '../http';
import { readIdempotencyKey, withIdempotency } from '../idempotency';
import { publishLiveEvent } from '../services/events';
import {
  KillBillFailure,
  KillBillUnreachable,
  killBillAnswering,
  refundDeposit,
} from '../services/killbill';
import { queueCancellationEmail } from '../services/mail';
import { isoUtc } from '../time';

export const manageRouter = Router();

const DEAD_STATUSES = new Set(['cancelled_refunded', 'cancelled_retained', 'completed', 'no_show']);

manageRouter.get(
  '/manage/:token',
  asyncHandler(async (req, res) => {
    const now = serverNow();
    const layout = await loadLayout();
    const booking = await findBookingByManageToken(pool, req.params.token ?? '');
    if (!booking) throw errors.notFound();
    if (DEAD_STATUSES.has(booking.status)) throw errors.linkExpired();
    const body: ManageResponse = {
      booking: toBooking(booking, layout),
      server_now: isoUtc(now),
      refund_if_cancelled_now: refundsIfCancelledAt(new Date(booking.starts_at), now),
    };
    sendJson(res, 200, body);
  }),
);

manageRouter.post(
  '/manage/:token/cancel',
  asyncHandler(async (req, res) => {
    const key = readIdempotencyKey(req.headers['idempotency-key'] as string | undefined);
    const token = req.params.token ?? '';
    const outcome = await withIdempotency(
      key,
      'POST',
      `/api/manage/${token}/cancel`,
      req.body,
      async () => {
        const layout = await loadLayout();
        const booking = await findBookingByManageToken(pool, token);
        if (!booking) throw errors.notFound();
        if (DEAD_STATUSES.has(booking.status)) throw errors.linkExpired();
        if (booking.status !== 'booked') throw errors.invalidTransition();

        const now = serverNow();
        const startsAt = new Date(booking.starts_at);
        if (startsAt.getTime() <= now.getTime()) throw errors.slotStarted();

        const refunds = refundsIfCancelledAt(startsAt, now);
        const hasPaidDeposit = booking.deposit_state === 'paid' && booking.deposit_cents > 0;
        let refundTransactionId: string | null = null;
        if (refunds && hasPaidDeposit) {
          if (!(await killBillAnswering())) throw errors.depositsPaused();
          const paymentId = booking.killbill_payment_id;
          if (!paymentId) throw new Error(`Booking ${booking.reference} has no deposit payment`);
          try {
            refundTransactionId = await refundDeposit(
              paymentId,
              booking.reference,
              booking.deposit_cents,
            );
          } catch (error) {
            if (error instanceof KillBillUnreachable || error instanceof KillBillFailure) {
              throw errors.depositsPaused();
            }
            throw error;
          }
        }

        const unit = requireUnit(layout, booking.unit_id);
        const status = refunds ? 'cancelled_refunded' : 'cancelled_retained';
        const depositState = hasPaidDeposit ? (refunds ? 'refunded' : 'retained') : 'none';
        const updated = await withTransaction(async (client) => {
          const result = await query<BookingRow>(
            client,
            `update bookings b set status = $2, deposit_state = $3, killbill_refund_id = $4
             where b.id = $1 and b.status = 'booked'
             returning ${BOOKING_COLUMNS}`,
            [booking.id, status, depositState, refundTransactionId],
          );
          const row = result.rows[0];
          if (!row) throw errors.invalidTransition();
          await releaseBookingTables(client, booking.id);
          await enqueueFreedTables(client, booking.date, unit.tableIds);
          if (booking.email) {
            await queueCancellationEmail(client, {
              to: booking.email,
              reference: booking.reference,
              startsAt,
              depositCents: booking.deposit_cents,
              outcome: hasPaidDeposit ? (refunds ? 'refunded' : 'retained') : 'none',
            });
          }
          return row;
        });

        await publishLiveEvent({
          type: 'booking.cancelled',
          date: booking.date,
          time: booking.time,
          tableIds: unit.tableIds,
          partySize: booking.party_size,
          reference: booking.reference,
          name: booking.name,
        });
        return { status: 200, body: { booking: toBooking(updated, layout) } };
      },
    );
    sendJson(res, outcome.status, outcome.body);
  }),
);
