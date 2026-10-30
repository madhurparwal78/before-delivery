import { query } from '../../db/pool.js';
import type { Route } from '../router.js';

export const healthRoutes: Route[] = [
  {
    kind: 'public',
    method: 'GET',
    path: '/api/health',
    body: 'none',
    async handler() {
      await query('select 1 as ok');
      return { status: 200, json: { status: 'ok' } };
    },
  },
];
