import { tierOfBench, type Tier } from '../../shared/benches.js';
import { config } from '../config.js';
import { newId } from '../db/ids.js';
import { pool, withLedgerLock } from '../db/pool.js';
import { loadReservationsByIds, serializeReservation } from '../db/reservations.js';
import {
  offerFreedBenches,
  practitionerAlreadyEngaged,
  sweepIfDue,
  sweepLedger,
  waitlistPosition,
} from '../domain/holds.js';
import { computeLedger, tierHasHoldableBench } from '../domain/ledger.js';
import { PRICES } from '../../shared/prices.js';
import { serverNow } from '../domain/venue.js';
import type { Route } from '../http/context.js';
import { conflict, notFound } from '../http/errors.js';
import { fieldError } from './helpers.js';

interface OfferRow {
  id: string;
  entry_id: string;
  account_id: string;
  bench: string;
  tier: Tier;
  state: string;
  expires_at: Date;
}

export const waitlistRoutes: readonly Route[] = [
  {
    method: 'POST',
    pattern: '/api/waitlist',
    access: ['practitioner'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const body = ctx.json();
      await sweepIfDue();

      if (await practitionerAlreadyEngaged(pool, account.id)) {
        throw conflict('already_reserved', 'This account already holds or attends a seat.');
      }
      const tier = body['tier'];
      if (tier !== 'bench' && tier !== 'atelier') {
        fieldError('tier', 'Choose the Bench or Atelier waitlist.');
      }

      const entryId = newId('wl');
      const outcome = await withLedgerLock(async (client) => {
        await sweepLedger(client);
        const ledger = await computeLedger(client, account.id);
        if (tierHasHoldableBench(ledger, tier as Tier)) return 'available' as const;
        await client.query(
          `insert into waitlist_entries (id, account_id, tier, state) values ($1, $2, $3, 'waitlisted')`,
          [entryId, account.id, tier],
        );
        return await waitlistPosition(client, entryId);
      });
      if (outcome === 'available') {
        throw conflict('benches_available', 'That tier still has a bench you can hold.');
      }
      if (outcome === null) throw notFound();
      return { status: 201, body: { tier: outcome.tier, position: outcome.position } };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/waitlist',
    access: ['practitioner', 'clinic'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      await pool.query(
        `delete from waitlist_entries where account_id = $1 and state = 'waitlisted'`,
        [account.id],
      );
      return { status: 204, body: null };
    },
  },
  {
    method: 'POST',
    pattern: '/api/offers/:id/accept',
    access: ['practitioner', 'clinic'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const id = ctx.param('id');
      await sweepIfDue();

      const outcome = await withLedgerLock(async (client) => {
        await sweepLedger(client);
        const found = await client.query<OfferRow>(
          'select * from offers where id = $1 for update',
          [id],
        );
        const offer = found.rows[0];
        if (offer === undefined || offer.account_id !== account.id) return 'not_found' as const;
        if (offer.state !== 'offered' || offer.expires_at.getTime() <= Date.now()) {
          return 'lapsed' as const;
        }
        const reservationId = newId('res');
        const tier = tierOfBench(offer.bench);
        await client.query(
          `insert into reservations (
             id, bench, tier, state, buyer_id, price_cents,
             hold_expires_at, hold_duration_seconds,
             assignee_name, assignee_email, assignee_email_lower, assignee_accepted, attendee_account_id)
           values ($1, $2, $3, 'held', $4, $5,
             now() + make_interval(secs => $6::int), $6, $7, $8, lower($8), $9, $10)`,
          [
            reservationId,
            offer.bench,
            tier,
            account.id,
            PRICES[tier].fullCents,
            config.holdSeconds,
            account.role === 'practitioner' ? account.name : null,
            account.role === 'practitioner' ? account.email : null,
            account.role === 'practitioner',
            account.role === 'practitioner' ? account.id : null,
          ],
        );
        await client.query(`update offers set state = 'accepted' where id = $1`, [id]);
        await client.query(`update waitlist_entries set state = 'held' where id = $1`, [
          offer.entry_id,
        ]);
        const ledger = await computeLedger(client, account.id);
        return { reservationId, ledger };
      });

      if (outcome === 'not_found') throw notFound();
      if (outcome === 'lapsed') {
        throw conflict('offer_lapsed', 'This offer has passed to the next person.');
      }

      const at = serverNow();
      const details = await loadReservationsByIds(pool, [outcome.reservationId]);
      return {
        status: 201,
        body: {
          reservations: details.map((row) => serializeReservation(row, at)),
          seats_remaining: outcome.ledger.seatsRemaining,
          server_time: at.toISOString(),
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/offers/:id/decline',
    access: ['practitioner', 'clinic'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const id = ctx.param('id');
      await sweepIfDue();

      const outcome = await withLedgerLock(async (client) => {
        await sweepLedger(client);
        const found = await client.query<OfferRow>(
          'select * from offers where id = $1 for update',
          [id],
        );
        const offer = found.rows[0];
        if (offer === undefined || offer.account_id !== account.id) return 'not_found' as const;
        if (offer.state !== 'offered') return 'lapsed' as const;
        await client.query(`update offers set state = 'declined' where id = $1`, [id]);
        await client.query(`update waitlist_entries set state = 'offer_lapsed' where id = $1`, [
          offer.entry_id,
        ]);
        await offerFreedBenches(client, [{ bench: offer.bench, tier: offer.tier }]);
        return { bench: offer.bench, tier: offer.tier };
      });

      if (outcome === 'not_found') throw notFound();
      if (outcome === 'lapsed') {
        throw conflict('offer_lapsed', 'This offer has already passed on.');
      }
      return {
        status: 200,
        body: {
          offer: { id, bench: outcome.bench, tier: outcome.tier, state: 'declined' },
        },
      };
    },
  },
];
