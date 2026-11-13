import { Router } from 'express';
import { query } from '../db/pool.js';
import { notFound } from '../http/errors.js';
import { bodyObject, pathParam, route } from '../http/handler.js';
import { requireCaller, requireRole, type Caller } from '../http/session.js';
import { installDayFor, type InstallDayRecord } from '../domain/access.js';
import { findCommission, venueOf } from '../domain/commissions.js';
import { findVenue } from '../../shared/seed.js';
import { isoUtc, isoWithVenueOffset } from '../../shared/venue-time.js';

export const crewRouter = Router();

crewRouter.get(
  '/api/crew',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    requireRole(caller, 'producer');
    const result = await query<{ id: string; name: string; email: string }>(
      `SELECT id, name, email FROM app_users WHERE 'crew' = ANY(roles) ORDER BY name`,
    );
    res.json({ crew: result.rows });
  }),
);

crewRouter.post(
  '/api/install-days/:installDayId/crew',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    requireRole(caller, 'producer');
    const day = await installDayFor(pathParam(req, 'installDayId'), caller);
    const crewUserId = String(bodyObject(req)['crewUserId'] ?? '');
    const crew = await query<{ id: string }>(
      `SELECT id FROM app_users WHERE id = $1 AND 'crew' = ANY(roles)`,
      [/^[0-9a-f-]{36}$/i.test(crewUserId) ? crewUserId : '00000000-0000-0000-0000-000000000000'],
    );
    if (!crew.rows[0]) throw notFound();

    const updated = await query<InstallDayRecord>(
      `UPDATE install_days
          SET crew_user_ids = (
            SELECT array_agg(DISTINCT member)
              FROM unnest(crew_user_ids || ARRAY[$2]::uuid[]) AS member
          )
        WHERE id = $1
        RETURNING *`,
      [day.id, crewUserId],
    );
    const row = updated.rows[0];
    if (!row) throw notFound();
    res.json(await shapeDay(row));
  }),
);

async function shapeDay(day: InstallDayRecord): Promise<Record<string, unknown>> {
  const commission = await findCommission(day.commission_id);
  const venue = commission ? venueOf(commission) : findVenue(day.venue_id);
  const client = commission
    ? await query<{ name: string }>('SELECT name FROM app_users WHERE id = $1', [
        commission.client_id,
      ])
    : null;
  const alerts = await query<{
    kind: string;
    title: string;
    send_at: Date;
    status: string;
  }>('SELECT kind, title, send_at, status FROM crew_alerts WHERE install_day_id = $1 ORDER BY send_at', [
    day.id,
  ]);
  return {
    id: day.id,
    commissionId: day.commission_id,
    commissionTitle: commission?.title ?? '',
    clientName: client?.rows[0]?.name ?? '',
    venue,
    date: day.install_date,
    startsAt: venue ? isoWithVenueOffset(day.starts_at, venue.timeZone) : isoUtc(day.starts_at),
    endsAt: venue ? isoWithVenueOffset(day.ends_at, venue.timeZone) : isoUtc(day.ends_at),
    crewUserIds: day.crew_user_ids,
    layout: commission ? commission.layout_items : [],
    confirmedAt: day.confirmed_at ? isoUtc(day.confirmed_at) : null,
    alerts: alerts.rows.map((alert) => ({
      kind: alert.kind,
      title: alert.title,
      sendAt: isoUtc(alert.send_at),
      status: alert.status,
    })),
  };
}

/** Crew get only the days they are assigned to; the producer gets all. */
async function daysFor(caller: Caller): Promise<InstallDayRecord[]> {
  if (caller.user.roles.includes('producer')) {
    const result = await query<InstallDayRecord>(
      'SELECT * FROM install_days ORDER BY install_date',
    );
    return result.rows;
  }
  if (caller.user.roles.includes('crew')) {
    const result = await query<InstallDayRecord>(
      'SELECT * FROM install_days WHERE $1 = ANY(crew_user_ids) ORDER BY install_date',
      [caller.user.id],
    );
    return result.rows;
  }
  const result = await query<InstallDayRecord>(
    `SELECT d.* FROM install_days d
       JOIN commissions c ON c.id = d.commission_id
      WHERE c.client_id = $1
      ORDER BY d.install_date`,
    [caller.user.id],
  );
  return result.rows;
}

crewRouter.get(
  '/api/install-days',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const days = await daysFor(caller);
    res.json({ installDays: await Promise.all(days.map((day) => shapeDay(day))) });
  }),
);

crewRouter.get(
  '/api/install-days/:installDayId',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const day = await installDayFor(pathParam(req, 'installDayId'), caller);
    res.json(await shapeDay(day));
  }),
);
