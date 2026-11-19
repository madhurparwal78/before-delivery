import { nowIso } from '../clock.js';
import { publicConfig } from '../config.js';
import { dbReady, q } from '../db.js';
import { addClient, sendEvent } from '../events.js';
import { extractState } from '../domain/extract.js';
import { requireUser, sendJson, type Router } from '../http.js';
import { storageHealthy } from '../storage.js';

let lastCheck = 0;
let lastHealthy = true;

async function storageOk(): Promise<boolean> {
  const stamp = Date.now();
  if (stamp - lastCheck < 1000) return lastHealthy;
  lastCheck = stamp;
  lastHealthy = await storageHealthy();
  return lastHealthy;
}

export function registerPlatform(router: Router): void {
  router.get('/api/health', async (ctx) => {
    if (!dbReady()) {
      sendJson(ctx.res, 503, { status: 'starting' });
      return;
    }
    const ok = await storageOk();
    sendJson(ctx.res, 200, { status: ok ? 'ok' : 'unavailable' });
  });

  router.get('/api/config', (ctx) => {
    sendJson(ctx.res, 200, publicConfig);
  });

  router.get('/api/time', (ctx) => {
    sendJson(ctx.res, 200, { server_now: nowIso() });
  });

  router.get('/api/events', async (ctx) => {
    const user = requireUser(ctx);
    ctx.res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    const client = addClient(user.id, ctx.res);
    sendEvent(client, 'clock', { server_now: nowIso() });
    const sources = await q<{ id: string }>(
      `SELECT s.id FROM sources s JOIN members m ON m.project_id = s.project_id WHERE m.user_id = $1`,
      [user.id],
    );
    for (const source of sources) {
      const state = await extractState(source.id);
      sendEvent(client, 'extract', {
        source: source.id,
        state: state.state,
        stale: state.stale,
        last_success_at: state.last_success_at,
        last_failure_at: state.last_failure_at,
        next_run_at: state.next_run_at,
      });
    }
    const unread = await q<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM inbox_items WHERE user_id = $1 AND read = false',
      [user.id],
    );
    sendEvent(client, 'inbox', { unread: Number(unread[0]?.count ?? '0') });
  });
}
