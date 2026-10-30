import { LIMITS } from '../../shared/limits';
import { sendJson } from '../http/context';
import { addRoute } from '../http/pipeline';
import { serviceStatus } from '../services/status';

export function registerMetaRoutes(): void {
  addRoute({
    method: 'GET',
    pattern: '/api/health',
    auth: false,
    handler: async (ctx) => {
      sendJson(ctx.res, 200, { status: 'ok' });
    },
  });

  addRoute({
    method: 'GET',
    pattern: '/api/status',
    auth: false,
    handler: async (ctx) => {
      sendJson(ctx.res, 200, await serviceStatus());
    },
  });

  addRoute({
    method: 'GET',
    pattern: '/api/limits',
    auth: false,
    handler: async (ctx) => {
      sendJson(ctx.res, 200, { ...LIMITS });
    },
  });
}
