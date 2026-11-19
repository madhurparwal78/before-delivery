import { jsonOk } from './api.js';
export const STATUS_INTERVAL_MS = 5_000;
export async function getStatus(deps, ctx) {
    const [storage, collab] = await Promise.all([deps.storage.probe(), deps.collab.probe()]);
    jsonOk(ctx, 200, {
        storage: storage ? 'ok' : 'unreachable',
        collab: collab ? 'ok' : 'unreachable',
        checked_at: new Date().toISOString(),
    });
}
export async function getHealth(deps, ctx) {
    jsonOk(ctx, 200, { status: 'ok' });
}
export const statusRoutes = (deps) => ([
    { method: 'GET', path: '/api/status', handler: (ctx) => getStatus(deps, ctx) },
    { method: 'GET', path: '/api/health', handler: (ctx) => getHealth(deps, ctx) },
]);
