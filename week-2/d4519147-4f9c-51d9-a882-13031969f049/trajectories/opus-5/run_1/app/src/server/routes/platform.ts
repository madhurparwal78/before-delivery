import type { Ctx, Reply, Route } from '../http/router';
import { platformStatus } from '../services/status';

let databaseReady = false;

export function markDatabaseReady(): void {
  databaseReady = true;
}

async function status(): Promise<Reply> {
  return { status: 200, body: await platformStatus() };
}

async function health(): Promise<Reply> {
  if (!databaseReady) return { status: 503, body: { status: 'starting' } };
  return { status: 200, body: { status: 'ok' } };
}

export const platformRoutes: Route[] = [
  { method: 'GET', pattern: '/api/status', auth: false, handler: (_ctx: Ctx) => status() },
  { method: 'GET', pattern: '/api/health', auth: false, handler: (_ctx: Ctx) => health() },
];
