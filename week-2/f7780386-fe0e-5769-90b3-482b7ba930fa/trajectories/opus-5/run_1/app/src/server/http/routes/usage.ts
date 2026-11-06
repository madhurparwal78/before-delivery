import { dailyUsage, monthlyUsageCsv } from '../../domain/usage.js';
import { route, type Route } from '../router.js';
import { queryDate, queryString } from '../validate.js';
import { validationFailed } from '../errors.js';

export const usageRoutes: Route[] = [
  route({
    method: 'GET',
    path: '/usage',
    roles: ['operator'],
    handle: async (ctx) => {
      const date = queryDate(ctx.req.query['date'], 'date', ctx.today);
      return {
        status: 200,
        body: await dailyUsage(ctx.app.db, date, ctx.app.config.timeZone),
      };
    },
  }),

  route({
    method: 'GET',
    path: '/exports/usage.csv',
    roles: ['operator'],
    handle: async (ctx) => {
      const month = queryString(ctx.req.query['month']);
      if (month === null || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw validationFailed({ month: 'invalid' });
      }
      const csv = await monthlyUsageCsv(ctx.app.db, month);
      return {
        status: 200,
        buffer: Buffer.from(csv, 'utf8'),
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="passboard-usage-${month}.csv"`,
          'Cache-Control': 'no-store',
        },
      };
    },
  }),
];
