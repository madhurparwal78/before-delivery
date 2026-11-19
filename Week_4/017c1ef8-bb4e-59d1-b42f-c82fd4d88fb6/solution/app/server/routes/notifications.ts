import type { FastifyInstance } from 'fastify';
import { memberOf } from '../auth.js';
import { pool, transaction } from '../db.js';
import { markNotificationsSeen, notificationList } from '../domain/notifications.js';

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/notifications', async (request) => notificationList(pool, memberOf(request)));

  app.post('/api/notifications/seen', async (request) => {
    await transaction((tx) => markNotificationsSeen(tx, memberOf(request).id));
    return { unread_count: 0 };
  });
}
