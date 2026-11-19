import { jsonOk } from './api.js';
import type { ApiDeps, RouteSpec } from './api.js';
import type { RequestCtx } from '../router.js';

export const STATUS_INTERVAL_MS = 5_000;

export async function getStatus (deps: ApiDeps, ctx: RequestCtx): Promise<void> {
  const [storage, collab] = await Promise.all([deps.storage.probe(), deps.collab.probe()]);
  jsonOk(ctx, 200, {
    storage: storage ? 'ok' : 'unreachable',
    collab: collab ? 'ok' : 'unreachable',
    checked_at: new Date().toISOString(),
  });
}

export async function getHealth (deps: ApiDeps, ctx: RequestCtx): Promise<void> {
  jsonOk(ctx, 200, { status: 'ok' });
}

export const statusRoutes = (deps: ApiDeps): RouteSpec[] => ([
  { method: 'GET', path: '/api/status', handler: (ctx) => getStatus(deps, ctx) },
  { method: 'GET', path: '/api/health', handler: (ctx) => getHealth(deps, ctx) },
]);
