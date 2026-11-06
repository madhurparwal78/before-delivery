import { pool, withTransaction } from '../db/pool.js';
import { loadReservation, serializeReservation } from '../db/reservations.js';
import { canTransition } from '../domain/reservationState.js';
import { serverNow, openCheckinDay, venueDate } from '../domain/venue.js';
import type { Route } from '../http/context.js';
import { conflict, invalidTransition, notFound, validation } from '../http/errors.js';

interface MatchRow {
  reservation_id: string;
  attendee_name: string;
  bench: string;
  day1: boolean;
  day2: boolean;
}

export const checkinRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/checkin',
    access: ['frontdesk'],
    handler: async (ctx) => {
      const query = (ctx.query.get('q') ?? '').trim();
      if (query.length < 2) {
        throw validation({ q: 'Type at least two characters.' });
      }
      const matches = await pool.query<MatchRow>(
        `select r.id as reservation_id, r.assignee_name as attendee_name, r.bench,
           exists(select 1 from checkins c where c.reservation_id = r.id and c.day = 1) as day1,
           exists(select 1 from checkins c where c.reservation_id = r.id and c.day = 2) as day2
         from reservations r
         where r.assignee_name is not null
           and r.state <> 'released'
           and r.assignee_name ilike '%' || $1 || '%'
         order by r.assignee_name
         limit 10`,
        [query],
      );
      return {
        status: 200,
        body: {
          q: query,
          venue_date: venueDate(),
          open_day: openCheckinDay(),
          results: matches.rows,
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/checkin',
    access: ['frontdesk'],
    handler: async (ctx) => {
      const body = ctx.json();
      const reservationId = body['reservation_id'];
      if (typeof reservationId !== 'string') {
        throw validation({ reservation_id: 'Choose an attendee to check in.' });
      }
      const reservation = await loadReservation(pool, reservationId);
      if (reservation === null) throw notFound();

      const day = body['day'];
      const openDay = openCheckinDay();
      if (day !== 1 && day !== 2) {
        if (openDay === null) {
          throw conflict('checkin_closed', 'Check-in is closed today.');
        }
        throw validation({ day: 'Choose day 1 or day 2.' });
      }
      if (openDay !== day) {
        throw conflict('checkin_closed', 'Check-in is closed today.');
      }
      if (!reservation.assignee_accepted) {
        throw conflict('no_attendee', 'This seat has no accepted attendee.');
      }
      if ((day === 1 && reservation.day1) || (day === 2 && reservation.day2)) {
        throw conflict('already_checked_in', 'This attendee is already checked in for that day.');
      }
      if (reservation.state === 'deposit_paid') {
        throw conflict('balance_due', 'This seat still owes a balance.');
      }
      if (day === 2 && reservation.state === 'paid_in_full') {
        throw conflict('not_checked_in_day1', 'This attendee has no day 1 check-in.');
      }
      const target = day === 1 ? 'checked_in_day1' : 'checked_in_day2';
      if (!canTransition(reservation.state, target)) throw invalidTransition();

      await withTransaction(async (client) => {
        await client.query(
          'insert into checkins (reservation_id, day) values ($1, $2) on conflict do nothing',
          [reservationId, day],
        );
        await client.query('update reservations set state = $2 where id = $1', [
          reservationId,
          target,
        ]);
      });

      const refreshed = await loadReservation(pool, reservationId);
      if (refreshed === null) throw notFound();
      return { status: 201, body: { reservation: serializeReservation(refreshed, serverNow()) } };
    },
  },
];
