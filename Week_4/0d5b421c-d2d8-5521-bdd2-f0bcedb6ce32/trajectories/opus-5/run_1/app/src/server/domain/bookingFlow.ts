import type { Booking } from '../../shared/types';
import { config } from '../config';
import { query, withTransaction } from '../db';
import { errors } from '../errors';
import {
  KillBillFailure,
  KillBillUnreachable,
  chargeDeposit,
  killBillAnswering,
  refundDeposit,
} from '../services/killbill';
import { publishLiveEvent } from '../services/events';
import { queueConfirmationEmail } from '../services/mail';
import { releaseSlots } from '../services/valkey';
import { loadLayout, type Unit } from './floor';
import { insertBooking, isTableConflict, toBooking } from './bookings';
import { newToken } from './rules';

export interface BookingDraft {
  source: 'online' | 'waitlist';
  date: string;
  time: string;
  startsAt: Date;
  windowStart: Date;
  windowEnd: Date;
  partySize: number;
  unit: Unit;
  depositCents: number;
  reference: string;
  name: string;
  email: string;
  phone: string | null;
  /** The hold or offer the booking comes from, and the Valkey claims it owns. */
  owner: {
    kind: 'hold' | 'offer';
    id: string;
    entryId?: string;
    claimKeys: string[];
  };
}

export interface CommittedBooking {
  booking: Booking;
  manageUrl: string;
}

async function takeDeposit(
  draft: BookingDraft,
): Promise<{ paymentId: string; transactionId: string } | null> {
  if (draft.depositCents <= 0) return null;
  if (!(await killBillAnswering())) throw errors.depositsPaused();
  try {
    return await chargeDeposit(draft.email, draft.name, draft.reference, draft.depositCents);
  } catch (error) {
    if (error instanceof KillBillUnreachable) throw errors.depositsPaused();
    if (error instanceof KillBillFailure) throw errors.paymentFailed();
    throw error;
  }
}

/**
 * Takes the deposit, writes the booking, closes its hold or offer and queues the confirmation
 * email in one commit. Shared by confirming a hold and claiming an offer.
 */
export async function commitBooking(draft: BookingDraft): Promise<CommittedBooking> {
  const layout = await loadLayout();
  const charge = await takeDeposit(draft);
  const manageToken = newToken();

  let committed;
  try {
    committed = await withTransaction(async (client) => {
      const owner = draft.owner;
      if (owner.kind === 'hold') {
        const locked = await query<{ status: string }>(
          client,
          'select status from holds where hold_id = $1 for update',
          [owner.id],
        );
        const hold = locked.rows[0];
        if (!hold) throw errors.notFound();
        // The confirm was judged live before the deposit was taken, so it completes even if the
        // hold's own expiry has since passed.
        if (hold.status !== 'live' && hold.status !== 'expired') throw errors.holdClosed();
      } else {
        const locked = await query<{ status: string }>(
          client,
          'select status from offers where offer_id = $1 for update',
          [owner.id],
        );
        const offer = locked.rows[0];
        if (!offer) throw errors.notFound();
        if (offer.status === 'claimed') throw errors.offerClaimed();
        if (offer.status !== 'offered') throw errors.offerExpired();
      }

      const row = await insertBooking(client, {
        reference: draft.reference,
        status: 'booked',
        source: draft.source,
        date: draft.date,
        time: draft.time,
        startsAt: draft.startsAt,
        windowStart: draft.windowStart,
        windowEnd: draft.windowEnd,
        partySize: draft.partySize,
        unitId: draft.unit.unitId,
        pairId: draft.unit.isPair ? draft.unit.unitId : null,
        roomId: draft.unit.roomId,
        tableIds: draft.unit.tableIds,
        name: draft.name,
        email: draft.email,
        phone: draft.phone,
        depositCents: draft.depositCents,
        depositState: draft.depositCents > 0 ? 'paid' : 'none',
        manageToken,
        killbillPaymentId: charge?.paymentId ?? null,
        killbillTransactionId: charge?.transactionId ?? null,
      });

      if (owner.kind === 'hold') {
        await query(client, "update holds set status = 'confirmed' where hold_id = $1", [owner.id]);
      } else {
        await query(client, "update offers set status = 'claimed' where offer_id = $1", [owner.id]);
        if (owner.entryId) {
          await query(
            client,
            "update waitlist_entries set status = 'claimed' where entry_id = $1",
            [owner.entryId],
          );
        }
      }

      const room = layout.roomById.get(draft.unit.roomId);
      await queueConfirmationEmail(client, {
        to: draft.email,
        reference: draft.reference,
        startsAt: draft.startsAt,
        partySize: draft.partySize,
        tableLabel: draft.unit.unitId,
        room: room ? room.name : draft.unit.roomId,
        manageToken,
        depositCents: draft.depositCents,
      });

      return row;
    });
  } catch (error) {
    if (charge) {
      await refundDeposit(charge.paymentId, draft.reference, draft.depositCents).catch(
        () => undefined,
      );
    }
    if (isTableConflict(error)) throw errors.tableTaken();
    throw error;
  }

  await releaseSlots(draft.owner.claimKeys, draft.owner.id).catch(() => undefined);
  await publishLiveEvent({
    type: draft.owner.kind === 'hold' ? 'booking.created' : 'offer.claimed',
    date: draft.date,
    time: draft.time,
    tableIds: draft.unit.tableIds,
    partySize: draft.partySize,
    reference: draft.reference,
    name: draft.name,
  });
  if (draft.owner.kind === 'offer') {
    await publishLiveEvent({
      type: 'booking.created',
      date: draft.date,
      time: draft.time,
      tableIds: draft.unit.tableIds,
      partySize: draft.partySize,
      reference: draft.reference,
      name: draft.name,
    });
  }

  return {
    booking: toBooking(committed, layout),
    manageUrl: `${config.publicUrl}/manage/${manageToken}`,
  };
}
