import { q, q1 } from '../db.js';
import { broadcastInbox } from '../events.js';
import { requireUser, sendJson, type Router } from '../http.js';

export function registerInbox(router: Router): void {
  router.get('/api/inbox', async (ctx) => {
    const user = requireUser(ctx);
    const items = await q<{ id: string; body: string; created_at: Date; read: boolean }>(
      'SELECT id, body, created_at, read FROM inbox_items WHERE user_id = $1 ORDER BY created_at DESC, id DESC',
      [user.id],
    );
    sendJson(ctx.res, 200, {
      unread: items.filter((i) => !i.read).length,
      items: items.map((i) => ({
        id: i.id,
        text: i.body,
        created_at: i.created_at.toISOString(),
        read: i.read,
      })),
    });
  });

  router.post('/api/inbox/read', async (ctx) => {
    const user = requireUser(ctx);
    await q1('UPDATE inbox_items SET read = true WHERE user_id = $1', [user.id]);
    broadcastInbox(user.id, 0);
    sendJson(ctx.res, 200, { unread: 0 });
  });
}
