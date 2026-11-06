import { isoUtc } from '../domain/clubTime';
import { apiError } from '../http/errors';
import { json, memberRoute, type Route } from '../http/router';
import { eventStandings, standingsRows } from './standingsService';
import { clubOf, eventClasses, loadEvent, parseView, statusOf } from './support';

export const standingsRoutes: Route[] = [
  memberRoute('GET', '/api/events/:id/standings', async (ctx) => {
    clubOf(ctx.actor);
    const event = await loadEvent(ctx);
    const view = parseView(ctx.searchParams.get('view'));
    const classFilter = ctx.searchParams.get('class');
    if (classFilter !== null && !eventClasses(event).includes(classFilter)) {
      throw apiError.validation({ class: 'That class does not run at this event.' });
    }
    const standings = await eventStandings(event.id);
    return json(200, {
      eventId: event.id,
      status: statusOf(event, ctx.now),
      runningHeat: event.running_heat,
      view,
      updatedAt: isoUtc(ctx.now),
      rows: standingsRows(standings, view, classFilter),
    });
  }),
];
