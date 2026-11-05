import type { Account } from '../db/accounts.js';
import { pool } from '../db/pool.js';
import {
  gatedHospitality,
  readFaq,
  readHospitality,
  readHotels,
  readSessions,
} from '../domain/content.js';
import { sweepIfDue } from '../domain/holds.js';
import { computeLedger } from '../domain/ledger.js';
import { SOLD_STATES } from '../domain/reservationState.js';
import { depositsOpen, serverNow, venueDate } from '../domain/venue.js';
import type { Route } from '../http/context.js';

async function seesAtelierHospitality(account: Account | null): Promise<boolean> {
  if (account === null) return false;
  if (account.role === 'director') return true;
  if (account.role !== 'practitioner' && account.role !== 'clinic') return false;
  const result = await pool.query<{ allowed: boolean }>(
    `select exists(
       select 1 from reservations
       where tier = 'atelier'
         and state = any($2::text[])
         and (buyer_id = $1 or attendee_account_id = $1)
     ) as allowed`,
    [account.id, SOLD_STATES],
  );
  return result.rows[0]?.allowed === true;
}

export const publicRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/benches',
    access: 'anonymous',
    handler: async (ctx) => {
      await sweepIfDue();
      const viewer = ctx.account;
      const viewerId =
        viewer !== null && (viewer.role === 'practitioner' || viewer.role === 'clinic')
          ? viewer.id
          : null;
      const ledger = await computeLedger(pool, viewerId);
      return {
        status: 200,
        body: {
          server_time: serverNow().toISOString(),
          venue_date: venueDate(),
          deposits_open: depositsOpen(),
          seats_total: ledger.seatsTotal,
          seats_remaining: ledger.seatsRemaining,
          held: ledger.held,
          sold: ledger.sold,
          tiers: {
            bench: { remaining: ledger.tiers.bench.remaining },
            atelier: {
              remaining: ledger.tiers.atelier.remaining,
              cap: ledger.tiers.atelier.cap,
              active: ledger.tiers.atelier.active,
              sold_out: ledger.tiers.atelier.soldOut,
            },
          },
          benches: ledger.benches.map((bench) => ({
            label: bench.label,
            row: bench.row,
            number: bench.number,
            tier: bench.tier,
            state: bench.state,
          })),
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/content',
    access: 'anonymous',
    handler: async (ctx) => {
      const [sessions, hospitality, hotels, faq] = await Promise.all([
        readSessions(),
        readHospitality(),
        readHotels(),
        readFaq(),
      ]);
      const revealAtelier = await seesAtelierHospitality(ctx.account);
      return {
        status: 200,
        body: {
          sessions,
          hospitality: hospitality.map((item) =>
            item.tier === 'atelier' && !revealAtelier ? gatedHospitality(item) : item,
          ),
          hotels,
          faq,
        },
      };
    },
  },
];
