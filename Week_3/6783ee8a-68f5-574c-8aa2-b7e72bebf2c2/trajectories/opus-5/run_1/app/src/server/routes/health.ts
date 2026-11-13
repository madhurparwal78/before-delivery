import { config } from '../config.js';
import { queryOne } from '../db.js';
import { route, sendJson, type Ctx } from '../http.js';
import { storageReachable } from '../storage.js';

let databaseReady = false;

export function markDatabaseReady(): void {
  databaseReady = true;
}

export function registerHealthRoutes(): void {
  route('GET', '/api/health', async (ctx: Ctx) => {
    if (!databaseReady) {
      sendJson(ctx, 503, { status: 'starting' });
      return;
    }
    sendJson(ctx, 200, { status: (await storageReachable()) ? 'ok' : 'unavailable' });
  });

  route('GET', '/api/config', (ctx: Ctx) => {
    sendJson(ctx, 200, config.limits);
  });

  route('GET', '/api/me', async (ctx: Ctx) => {
    const sessionId = ctx.cookies.bp_session;
    const user = sessionId
      ? await queryOne<{ id: string; email: string; display_name: string; verified: boolean }>(
          `select u.id, u.email, u.display_name, u.verified
             from sessions s join users u on u.id = s.user_id where s.id = $1`,
          [sessionId],
        )
      : null;
    sendJson(ctx, 200, { user });
  });
}
