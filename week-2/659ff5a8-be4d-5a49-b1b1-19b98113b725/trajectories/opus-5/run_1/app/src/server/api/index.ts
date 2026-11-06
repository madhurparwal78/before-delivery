import { pool } from '../db/pool';
import { json, publicRoute, type Route } from '../http/router';
import { eventRoutes } from './events';
import { indexTableRoutes } from './indexTables';
import { operatorRoutes } from './operator';
import { protestRoutes } from './protests';
import { publishRoutes } from './publish';
import { registrationRoutes } from './registrations';
import { rotaRoutes } from './rota';
import { runRoutes } from './runs';
import { seasonRoutes } from './season';
import { sessionRoutes } from './session';
import { standingsRoutes } from './standings';

const healthRoutes: Route[] = [
  publicRoute('GET', '/api/health', async () => {
    await pool.query('SELECT 1');
    return json(200, { status: 'ok' });
  }),
];

export const routes: Route[] = [
  ...healthRoutes,
  ...sessionRoutes,
  ...operatorRoutes,
  ...indexTableRoutes,
  ...eventRoutes,
  ...registrationRoutes,
  ...rotaRoutes,
  ...runRoutes,
  ...standingsRoutes,
  ...protestRoutes,
  ...publishRoutes,
  ...seasonRoutes,
];
