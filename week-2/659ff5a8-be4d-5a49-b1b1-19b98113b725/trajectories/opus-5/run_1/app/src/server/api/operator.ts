import { randomUUID } from 'node:crypto';
import type { OperatorClubRow } from '../../shared/api';
import { createUser, findAccountByEmail, isOperator, sessionUser } from '../auth';
import { query, queryOne } from '../db/pool';
import { isValidTimeZone } from '../domain/clubTime';
import { isoUtc } from '../domain/clubTime';
import { apiError } from '../http/errors';
import { json, operatorRoute, type Route } from '../http/router';
import { FieldErrors, checkEmail, checkString, readString } from '../http/validate';

const SLUG_PATTERN = /^[a-z][a-z0-9-]{2,30}$/;

export const operatorRoutes: Route[] = [
  operatorRoute('GET', '/api/operator/clubs', async (ctx) => {
    if (!isOperator(ctx.actor)) throw apiError.forbidden();
    const clubs = await query<{
      slug: string;
      name: string;
      time_zone: string;
      event_count: string;
      driver_count: string;
      published_count: string;
      failure_service: string | null;
      failure_event_id: string | null;
      failure_at: Date | null;
    }>(
      `SELECT c.slug, c.name, c.time_zone,
              (SELECT count(*) FROM events e WHERE e.club_id = c.id) AS event_count,
              (SELECT count(*) FROM users u
                 WHERE u.club_id = c.id
                   AND NOT (u.roles && ARRAY['chair','timing','workers']::text[])) AS driver_count,
              (SELECT count(*) FROM events e WHERE e.club_id = c.id AND e.status = 'published')
                AS published_count,
              f.service AS failure_service, f.event_id AS failure_event_id,
              f.created_at AS failure_at
         FROM clubs c
         LEFT JOIN LATERAL (
           SELECT service, event_id, created_at FROM delivery_failures d
            WHERE d.club_id = c.id ORDER BY d.created_at DESC LIMIT 1
         ) f ON true
        ORDER BY c.name`,
    );
    const rows: OperatorClubRow[] = clubs.map((club) => ({
      slug: club.slug,
      name: club.name,
      timeZone: club.time_zone,
      eventCount: Number(club.event_count),
      driverCount: Number(club.driver_count),
      publishedCount: Number(club.published_count),
      lastDeliveryFailure:
        club.failure_service && club.failure_at
          ? {
              service: club.failure_service as 'renderer' | 'storage' | 'mail',
              eventId: club.failure_event_id,
              at: isoUtc(club.failure_at),
            }
          : null,
    }));
    return json(200, { clubs: rows });
  }),

  operatorRoute('POST', '/api/operator/clubs', async (ctx) => {
    if (!isOperator(ctx.actor)) throw apiError.forbidden();
    const errors = new FieldErrors();
    const slug = readString(ctx.body, 'slug', { min: 3, max: 31, label: 'Club slug' }, errors);
    if (slug.length > 0 && !SLUG_PATTERN.test(slug)) {
      errors.add('slug', 'Club slug must be lowercase letters, digits and dashes.');
    }
    const name = readString(ctx.body, 'name', { min: 1, max: 80, label: 'Club name' }, errors);
    const timeZone = readString(ctx.body, 'timeZone', { min: 1, max: 60, label: 'Time zone' }, errors);
    if (timeZone.length > 0 && !isValidTimeZone(timeZone)) {
      errors.add('timeZone', 'Time zone must be an IANA name like America/Denver.');
    }
    const chairInput = ctx.body.chair;
    const chair = typeof chairInput === 'object' && chairInput !== null
      ? (chairInput as Record<string, unknown>)
      : {};
    const chairName = checkString(
      chair.name,
      'chair.name',
      { min: 1, max: 80, label: 'Chair name' },
      errors,
    );
    const chairEmail = checkEmail(chair.email, 'chair.email', errors);
    const chairPassword = checkString(
      chair.password,
      'chair.password',
      { min: 10, max: 200, label: 'Chair password' },
      errors,
    );
    errors.throwIfAny();

    if (await queryOne<{ id: string }>('SELECT id FROM clubs WHERE slug = $1', [slug])) {
      throw apiError.conflict('slug_taken', 'That club slug is taken.');
    }
    if (await findAccountByEmail(chairEmail)) {
      throw apiError.conflict('email_taken', 'That email already has an account.');
    }

    const clubId = randomUUID();
    await query('INSERT INTO clubs (id, slug, name, time_zone) VALUES ($1, $2, $3, $4)', [
      clubId,
      slug,
      name,
      timeZone,
    ]);
    const account = await createUser({
      clubId,
      name: chairName,
      email: chairEmail,
      password: chairPassword,
      roles: ['chair'],
    });
    return json(201, {
      club: { slug, name, timeZone },
      chair: {
        user: sessionUser({
          id: account.id,
          name: account.name,
          email: account.email,
          roles: account.roles,
          club: { id: clubId, slug, name, time_zone: timeZone },
        }),
      },
    });
  }),
];
