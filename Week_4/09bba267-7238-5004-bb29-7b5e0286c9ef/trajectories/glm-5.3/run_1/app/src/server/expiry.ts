import type { Pool } from 'pg';
import type { Mailer } from './mailer';
import { freeSeat } from './seats';

export type ExpirySweeperDeps = {
  db: Pool;
  mailer: Mailer;
  offerSeconds: number;
};

/**
 * Ends expired holds and offers on the server clock. Runs on an interval and on demand
 * before any read that depends on seat states, so expiry is decided only here.
 */
export async function sweepExpiries(deps: ExpirySweeperDeps): Promise<void> {
  const now = new Date();
  const client = await deps.db.connect();
  try {
    await client.query('BEGIN');
    const expiredHolds = await client.query<{ performance_id: string; buyer_id: string; expires_at: Date }>(
      `SELECT performance_id, buyer_id, expires_at FROM holds WHERE expires_at <= now() FOR UPDATE SKIP LOCKED`,
    );
    for (const hold of expiredHolds.rows) {
      const seats = await client.query<{ seat_id: string; tier_id: string | null }>(
        `SELECT seat_id, tier_id FROM seats WHERE performance_id = $1 AND state = 'held' AND hold_token = $2 FOR UPDATE`,
        [hold.performance_id, hold.buyer_id],
      );
      const performance = await client.query<{ starts_at: Date }>('SELECT starts_at FROM performances WHERE id = $1', [
        hold.performance_id,
      ]);
      const salesOpen = performance.rows[0] ? performance.rows[0].starts_at.getTime() > now.getTime() : false;
      for (const seat of seats.rows) {
        await freeSeat(client, {
          performanceId: hold.performance_id,
          seatId: seat.seat_id,
          salesOpen,
          offerSeconds: deps.offerSeconds,
          now,
          mailer: deps.mailer,
        });
      }
      await client.query('DELETE FROM holds WHERE performance_id = $1 AND buyer_id = $2', [
        hold.performance_id,
        hold.buyer_id,
      ]);
    }

    const expiredOffers = await client.query<{
      token: string;
      performance_id: string;
      tier_id: string;
      entry_id: string;
      seat_id: string;
    }>(
      `SELECT token, performance_id, tier_id, entry_id, seat_id FROM offers
       WHERE status = 'open' AND expires_at <= now() FOR UPDATE SKIP LOCKED`,
    );
    for (const offer of expiredOffers.rows) {
      await client.query(`UPDATE offers SET status = 'expired' WHERE token = $1`, [offer.token]);
      await client.query(`UPDATE waitlist_entries SET status = 'expired' WHERE id = $1 AND status = 'offered'`, [offer.entry_id]);
      const performance = await client.query<{ starts_at: Date }>('SELECT starts_at FROM performances WHERE id = $1', [
        offer.performance_id,
      ]);
      const salesOpen = performance.rows[0] ? performance.rows[0].starts_at.getTime() > now.getTime() : false;
      await client.query(`UPDATE seats SET state = 'held', hold_token = 'sweeper' WHERE performance_id = $1 AND seat_id = $2 AND state = 'offered'`, [
        offer.performance_id,
        offer.seat_id,
      ]);
      const seat = await client.query<{ state: string }>('SELECT state FROM seats WHERE performance_id = $1 AND seat_id = $2', [
        offer.performance_id,
        offer.seat_id,
      ]);
      if (seat.rows[0]?.state === 'held') {
        await freeSeat(client, {
          performanceId: offer.performance_id,
          seatId: offer.seat_id,
          salesOpen,
          offerSeconds: deps.offerSeconds,
          now,
          mailer: deps.mailer,
        });
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function startSweeper(deps: ExpirySweeperDeps): void {
  const tick = async () => {
    try {
      await sweepExpiries(deps);
    } catch {
      /* the next tick retries */
    }
  };
  void tick();
  const timer = setInterval(tick, 1000);
  timer.unref();
}
