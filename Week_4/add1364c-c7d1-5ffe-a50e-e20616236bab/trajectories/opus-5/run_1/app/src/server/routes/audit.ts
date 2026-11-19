import { now } from '../clock.js';
import { invalid } from '../errors.js';
import { auditEntryJson, decodeCursor, readAuditPage } from '../audit.js';
import { isOfficeDate, officeDate } from '../officeTime.js';
import { openStream } from '../events.js';
import type { Route, StreamRoute } from '../http.js';

const DESK_STAFF = ['office_manager', 'managing_partner'] as const;

export const auditRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/audit',
    roles: DESK_STAFF,
    handler: async (ctx) => {
      const fields: Record<string, string> = {};
      const givenDay = ctx.query.get('day');
      if (givenDay !== null && !isOfficeDate(givenDay)) fields.day = 'Use a date like 2027-01-04.';
      const day = givenDay !== null && isOfficeDate(givenDay) ? givenDay : officeDate(now());

      const givenOrder = ctx.query.get('order');
      if (givenOrder !== null && givenOrder !== 'oldest' && givenOrder !== 'newest') {
        fields.order = 'Use oldest or newest.';
      }
      const order = givenOrder === 'newest' ? 'newest' : 'oldest';

      const givenLimit = ctx.query.get('limit');
      let limit = 50;
      if (givenLimit !== null) {
        const value = Number(givenLimit);
        if (!/^\d+$/.test(givenLimit) || !Number.isInteger(value) || value < 1 || value > 100) {
          fields.limit = 'Use a whole number from 1 to 100.';
        } else limit = value;
      }

      const givenCursor = ctx.query.get('after');
      const cursor = givenCursor === null ? null : decodeCursor(givenCursor);
      if (givenCursor !== null && (cursor === null || cursor.day !== day || cursor.order !== order)) {
        fields.after = 'That cursor does not belong to this day and order.';
      }
      if (Object.keys(fields).length > 0) throw invalid(fields);

      const page = await readAuditPage({ day, order, limit, after: cursor });
      return {
        status: 200,
        body: {
          office_day: day,
          order,
          entries: page.entries.map(auditEntryJson),
          next_cursor: page.nextCursor,
        },
      };
    },
  },
];

export const eventStreamRoute: StreamRoute = {
  method: 'GET',
  path: '/api/events',
  stream: (ctx, res) => openStream(ctx.caller.person.id, res),
};
