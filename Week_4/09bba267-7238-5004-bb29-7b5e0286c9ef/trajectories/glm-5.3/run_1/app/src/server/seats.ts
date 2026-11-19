import type { Pool, PoolClient } from 'pg';
import type { Mailer } from './mailer';
import { seatLabel, compareSeatIds } from './hall';
import { venueLabel, venueOfferExpiry } from './venue-time';
import { newToken } from './http';
import { formatCents, seatFeeCents, ORDER_FEE_CENTS } from './money';

export type SeatChangeKind =
  | 'hold'
  | 'release'
  | 'expiry'
  | 'purchase'
  | 'declined'
  | 'unavailable'
  | 'exchange-old'
  | 'exchange-new-hold'
  | 'exchange-new-sold'
  | 'refund'
  | 'offer-out'
  | 'offer-pass'
  | 'offer-back'
  | 'sales-closed';

export type FreeSeatDecision = 'offered' | 'on_sale';

export type OfferedSeat = { seatId: string; entryId: string; token: string; expiresAt: Date; email: string };

/**
 * Releases, expiries, refunds and exchanges free seats. A freed seat goes to the earliest
 * waiting waitlist entry when its tier has one and sales are open, otherwise back on sale.
 */
export async function freeSeat(
  client: PoolClient,
  args: {
    performanceId: string;
    seatId: string;
    salesOpen: boolean;
    offerSeconds: number;
    now: Date;
    mailer: Mailer;
    skipEntryId?: string;
  },
): Promise<FreeSeatDecision> {
  const seat = await client.query<{ tier_id: string | null; state: string }>(
    'SELECT tier_id, state FROM seats WHERE performance_id = $1 AND seat_id = $2 FOR UPDATE',
    [args.performanceId, args.seatId],
  );
  if (!seat.rows[0] || !seat.rows[0].tier_id || seat.rows[0].state === 'not_on_sale') return 'on_sale';

  if (args.salesOpen) {
    const waiting = await earliestWaitingEntry(client, args.performanceId, seat.rows[0].tier_id);
    if (waiting) {
      const expiresAt = new Date(args.now.getTime() + args.offerSeconds * 1000);
      const token = newToken('of');
      await client.query(
        `INSERT INTO offers (token, performance_id, tier_id, entry_id, seat_id, status, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'open', $6, $7)`,
        [token, args.performanceId, seat.rows[0].tier_id, waiting.id, args.seatId, args.now, expiresAt],
      );
      await client.query(`UPDATE waitlist_entries SET status = 'offered' WHERE id = $1`, [waiting.id]);
      await client.query(`UPDATE seats SET state = 'offered', hold_token = NULL WHERE performance_id = $1 AND seat_id = $2`, [
        args.performanceId,
        args.seatId,
      ]);
      await queueOfferEmail(client, args.mailer, {
        to: waiting.email,
        token,
        seatId: args.seatId,
        performanceId: args.performanceId,
        expiresAt,
      });
      return 'offered';
    }
  }
  await client.query(`UPDATE seats SET state = 'on_sale', hold_token = NULL WHERE performance_id = $1 AND seat_id = $2`, [
    args.performanceId,
    args.seatId,
  ]);
  return 'on_sale';
}

export async function earliestWaitingEntry(
  client: PoolClient | Pool,
  performanceId: string,
  tierId: string,
): Promise<{ id: string; email: string } | null> {
  const result = await client.query<{ id: string; email: string }>(
    `SELECT id, email FROM waitlist_entries
     WHERE performance_id = $1 AND tier_id = $2 AND status = 'waiting'
     ORDER BY joined_at ASC, id ASC LIMIT 1`,
    [performanceId, tierId],
  );
  return result.rows[0] ?? null;
}

export async function nextWaitingEntryAfter(
  client: PoolClient | Pool,
  performanceId: string,
  tierId: string,
): Promise<{ id: string; email: string } | null> {
  return earliestWaitingEntry(client, performanceId, tierId);
}

export async function queueOfferEmail(
  client: PoolClient,
  mailer: Mailer,
  offer: { to: string; token: string; seatId: string; performanceId: string; expiresAt: Date },
): Promise<void> {
  const performance = await client.query<{ title: string; starts_at: Date }>(
    'SELECT title, starts_at FROM performances WHERE id = $1',
    [offer.performanceId],
  );
  const row = performance.rows[0];
  if (!row) return;
  const tierRow = await client.query<{ face_cents: number }>(
    `SELECT t.face_cents FROM seats s JOIN tiers t ON t.performance_id = s.performance_id AND t.id = s.tier_id
     WHERE s.performance_id = $1 AND s.seat_id = $2`,
    [offer.performanceId, offer.seatId],
  );
  const face = tierRow.rows[0]?.face_cents ?? 0;
  const total = face + seatFeeCents(face) + ORDER_FEE_CENTS;
  const subject = `A seat is offered to you: ${row.title}`;
  const body = [
    seatLabel(offer.seatId),
    `${row.title} ${venueLabel(row.starts_at)}`,
    `Total ${formatCents(total)}`,
    `Accept by ${venueOfferExpiry(offer.expiresAt)}`,
    `${process.env.APP_PUBLIC_URL ?? ''}/offers/${offer.token}`,
  ].join('\n');
  await mailer.record(client, { to: offer.to, kind: 'offer', subject, body });
}

export function sortedSeatIds(ids: string[]): string[] {
  return [...ids].sort(compareSeatIds);
}
