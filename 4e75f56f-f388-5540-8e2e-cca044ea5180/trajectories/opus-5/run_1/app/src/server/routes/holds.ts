import { isBenchLabel } from '../../shared/benches.js';
import { pool, withLedgerLock } from '../db/pool.js';
import {
  loadReservation,
  loadReservationsByIds,
  serializeReservation,
} from '../db/reservations.js';
import {
  claimBenches,
  clinicHasLiveGroupHold,
  practitionerAlreadyEngaged,
  releaseReservations,
  sweepIfDue,
  sweepLedger,
} from '../domain/holds.js';
import { computeLedger } from '../domain/ledger.js';
import { canTransition } from '../domain/reservationState.js';
import { serverNow } from '../domain/venue.js';
import type { Route } from '../http/context.js';
import { conflict, invalidTransition, notFound } from '../http/errors.js';
import { fieldError, isAttendee, isBuyer, isRegistrar } from './helpers.js';
import { loadGroupRow, serializeGroup } from './serialize.js';

function readBenches(body: Record<string, unknown>, limit: number): string[] {
  const value = body['benches'];
  if (!Array.isArray(value) || value.length === 0) {
    fieldError('benches', 'Choose at least one bench.');
  }
  if (value.length > limit) {
    fieldError('benches', `Choose at most ${limit} ${limit === 1 ? 'bench' : 'benches'}.`);
  }
  if (new Set(value).size !== value.length) {
    fieldError('benches', 'Each bench may appear only once.');
  }
  for (const label of value) {
    if (!isBenchLabel(label)) fieldError('benches', 'Use bench labels from A1 to D6.');
  }
  return value as string[];
}

export const holdRoutes: readonly Route[] = [
  {
    method: 'POST',
    pattern: '/api/holds',
    access: ['practitioner', 'clinic'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const body = ctx.json();
      await sweepIfDue();

      if (account.role === 'practitioner') {
        if (await practitionerAlreadyEngaged(pool, account.id)) {
          throw conflict('already_reserved', 'This account already holds or attends a seat.');
        }
      } else if (await clinicHasLiveGroupHold(pool, account.id)) {
        throw conflict('hold_limit', 'This clinic already has a live group hold.');
      }

      const benches = readBenches(body, account.role === 'clinic' ? 6 : 1);
      const outcome = await withLedgerLock(async (client) => {
        await sweepLedger(client);
        return claimBenches(client, account, benches, { asGroup: account.role === 'clinic' });
      });

      if ('code' in outcome) {
        throw conflict(
          outcome.code,
          outcome.code === 'bench_taken'
            ? 'That bench is no longer open.'
            : 'Every Atelier place is taken.',
          { waitlist: { tier: outcome.tier, open: outcome.open } },
        );
      }

      const at = serverNow();
      const details = await loadReservationsByIds(
        pool,
        outcome.reservations.map((reservation) => reservation.id),
      );
      return {
        status: 201,
        body: {
          reservations: details.map((row) => serializeReservation(row, at)),
          group_id: outcome.groupId,
          seats_remaining: outcome.ledger.seatsRemaining,
          server_time: at.toISOString(),
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/reservations/:id/release',
    access: ['practitioner', 'clinic'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const id = ctx.param('id');
      const result = await withLedgerLock(async (client) => {
        await sweepLedger(client);
        const reservation = await loadReservation(client, id);
        if (reservation === null || !isBuyer(reservation, account)) return 'not_found' as const;
        if (!canTransition(reservation.state, 'released')) return 'invalid' as const;
        await releaseReservations(client, [reservation]);
        if (reservation.group_id !== null) {
          await client.query(
            `update groups set state = 'released'
             where id = $1 and state = 'held'
               and not exists (select 1 from reservations where group_id = $1 and state = 'held')`,
            [reservation.group_id],
          );
        }
        const ledger = await computeLedger(client, account.id);
        return { ledger };
      });
      if (result === 'not_found') throw notFound();
      if (result === 'invalid') throw invalidTransition();

      const at = serverNow();
      const reservation = await loadReservation(pool, id);
      if (reservation === null) throw notFound();
      return {
        status: 200,
        body: {
          reservation: serializeReservation(reservation, at),
          seats_remaining: result.ledger.seatsRemaining,
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/groups/:id/release',
    access: ['practitioner', 'clinic'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const id = ctx.param('id');
      const result = await withLedgerLock(async (client) => {
        await sweepLedger(client);
        const group = await client.query<{ id: string; buyer_id: string; state: string }>(
          'select id, buyer_id, state from groups where id = $1',
          [id],
        );
        const row = group.rows[0];
        if (row === undefined || row.buyer_id !== account.id) return 'not_found' as const;
        const held = await client.query<{ id: string; bench: string; tier: 'bench' | 'atelier' }>(
          `select id, bench, tier from reservations where group_id = $1 and state = 'held'`,
          [id],
        );
        if (held.rows.length === 0) return 'invalid' as const;
        await releaseReservations(client, held.rows);
        await client.query(`update groups set state = 'released' where id = $1`, [id]);
        const ledger = await computeLedger(client, account.id);
        return { ledger };
      });
      if (result === 'not_found') throw notFound();
      if (result === 'invalid') throw invalidTransition();

      const at = serverNow();
      const group = await loadGroupRow(pool, id);
      if (group === null) throw notFound();
      return {
        status: 200,
        body: {
          group: await serializeGroup(pool, group, at),
          seats_remaining: result.ledger.seatsRemaining,
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/reservations/:id',
    access: ['practitioner', 'clinic', 'registrar'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      await sweepIfDue();
      const reservation = await loadReservation(pool, ctx.param('id'));
      if (reservation === null) throw notFound();
      const maySee =
        isRegistrar(account) || isBuyer(reservation, account) || isAttendee(reservation, account);
      if (!maySee) throw notFound();
      const at = serverNow();
      return {
        status: 200,
        body: {
          reservation: serializeReservation(reservation, at),
          server_time: at.toISOString(),
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/groups/:id',
    access: ['practitioner', 'clinic', 'registrar'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      await sweepIfDue();
      const group = await pool.query<{ id: string; state: string; buyer_id: string }>(
        'select id, state, buyer_id from groups where id = $1',
        [ctx.param('id')],
      );
      const row = group.rows[0];
      if (row === undefined) throw notFound();
      if (!isRegistrar(account) && row.buyer_id !== account.id) throw notFound();
      return {
        status: 200,
        body: { group: await serializeGroup(pool, row, serverNow()) },
      };
    },
  },
];
