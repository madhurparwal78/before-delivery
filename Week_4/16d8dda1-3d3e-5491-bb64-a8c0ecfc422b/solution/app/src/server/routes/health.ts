import { reply, type Route } from '../http';
import { storageIsUp } from '../objects';
import { isUp } from '../live/valkey';

export const healthRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/health',
    handler: async () => reply(200, { status: isUp() && (await storageIsUp()) ? 'ok' : 'unavailable' }),
  },
];
