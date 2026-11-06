import type { Route } from '../http/context';
import { listStations } from '../data/trains';
import { istTimestamp } from '../domain/ist';
import { errors } from '../http/errors';

export const metaRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: '/api/health',
    auth: 'optional',
    handler: async (context) => {
      if (!context.app.ready.value) throw errors.databaseNotReady();
      return { status: 200, json: { status: 'ok' } };
    },
  },
  {
    method: 'GET',
    path: '/api/clock',
    auth: 'optional',
    handler: async (context) => ({
      status: 200,
      json: {
        now: istTimestamp(context.now),
        zone: 'Asia/Kolkata',
        rate: context.app.clock.rate,
      },
    }),
  },
  {
    method: 'GET',
    path: '/api/stations',
    auth: 'optional',
    handler: async (context) => ({
      status: 200,
      json: { stations: await listStations(context.app.database) },
    }),
  },
];
