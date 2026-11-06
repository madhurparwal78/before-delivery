import { pool } from '../db/pool.js';
import type { PublicRoute, Reply } from '../http/router.js';

const health: PublicRoute = {
  method: 'GET',
  pattern: '/api/health',
  body: 'none',
  auth: false,
  handler: async (): Promise<Reply> => {
    await pool.query('SELECT 1');
    return { status: 200, body: { status: 'ok' } };
  },
};

export const healthRoutes = [health];
