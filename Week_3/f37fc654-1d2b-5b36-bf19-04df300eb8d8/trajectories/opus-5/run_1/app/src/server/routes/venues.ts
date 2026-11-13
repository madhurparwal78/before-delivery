import { Router } from 'express';
import { ValidationError, notFound } from '../http/errors.js';
import { pathParam, queryString, route } from '../http/handler.js';
import { resolveCaller } from '../http/session.js';
import { venueDays } from '../domain/holds.js';
import { findCommission } from '../domain/commissions.js';
import { FIELD_ERRORS } from '../../shared/copy.js';
import { VENUES, findVenue } from '../../shared/seed.js';
import { daysBetween, isoWithVenueOffset, parseDate } from '../../shared/venue-time.js';

export const venuesRouter = Router();

const MAX_SPAN_DAYS = 62;

/** Venue search needs no sign-in: it feeds the brief's venue field. */
venuesRouter.get(
  '/api/venues',
  route(async (req, res) => {
    const q = (queryString(req, 'q') ?? '').trim().toLowerCase();
    if (q === '') {
      res.json({ venues: [] });
      return;
    }
    const matches = VENUES.filter((venue) =>
      [venue.name, venue.address, venue.city].some((field) =>
        field.toLowerCase().includes(q),
      ),
    )
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8);
    res.json({ venues: matches });
  }),
);

venuesRouter.get(
  '/api/venues/:venueId/days',
  route(async (req, res) => {
    const venue = findVenue(pathParam(req, 'venueId'));
    if (!venue) throw notFound();
    const from = queryString(req, 'from') ?? '';
    const to = queryString(req, 'to') ?? '';
    if (!parseDate(from) || !parseDate(to)) {
      throw new ValidationError({ to: FIELD_ERRORS.daysSpan });
    }
    if (daysBetween(from, to) + 1 > MAX_SPAN_DAYS || daysBetween(from, to) < 0) {
      throw new ValidationError({ to: FIELD_ERRORS.daysSpan });
    }

    const caller = await resolveCaller(req).catch(() => null);
    let commissionId: string | null = null;
    const forCommission = queryString(req, 'commissionId');
    if (caller && forCommission) {
      const commission = await findCommission(forCommission);
      if (
        commission &&
        (commission.client_id === caller.user.id || caller.user.roles.includes('producer'))
      ) {
        commissionId = commission.id;
      }
    }

    const days = await venueDays(venue, from, to, commissionId);
    res.json({
      days: days.map((day) => ({
        date: day.date,
        status: day.status,
        startsAt: isoWithVenueOffset(day.startsAt, venue.timeZone),
        endsAt: isoWithVenueOffset(day.endsAt, venue.timeZone),
      })),
    });
  }),
);
