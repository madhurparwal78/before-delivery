import type { InboxItem } from '../../shared/model.ts';
import { newId } from '../db/ids.ts';
import type { App } from '../http/app.ts';
import { json } from '../http/reply.ts';

const inboxSchema = [
  `CREATE TABLE IF NOT EXISTS inbox_items (
     id text PRIMARY KEY,
     seq bigserial,
     user_id text NOT NULL REFERENCES users(id),
     text text NOT NULL,
     created_at timestamptz NOT NULL,
     read boolean NOT NULL DEFAULT false
   )`,
  `CREATE INDEX IF NOT EXISTS inbox_items_user ON inbox_items (user_id, seq DESC)`,
];

const unreadOf = async (app: App, userId: string): Promise<number> =>
  Number((await app.db.row<{ n: string }>(`SELECT count(*) AS n FROM inbox_items WHERE user_id = $1 AND NOT read`, [userId]))?.n ?? 0);

/** Adds an item to the user's inbox and tells their open streams the new unread count. */
export async function addInboxItem(app: App, userId: string, text: string): Promise<void> {
  await app.db.exec(`INSERT INTO inbox_items (id, user_id, text, created_at) VALUES ($1, $2, $3, $4)`, [
    newId(),
    userId,
    text,
    app.clock.iso(),
  ]);
  await app.events.inbox(userId);
}

export function mountInbox(app: App): void {
  app.schema(inboxSchema);
  app.events.countUnread = (userId) => unreadOf(app, userId);

  app.route({
    method: 'GET',
    path: '/api/inbox',
    handler: async (ctx) => {
      const rows = await app.db.rows<{ id: string; text: string; created_at: Date; read: boolean }>(
        `SELECT id, text, created_at, read FROM inbox_items WHERE user_id = $1 ORDER BY seq DESC`,
        [ctx.user.id],
      );
      const items: InboxItem[] = rows.map((row) => ({
        id: row.id,
        text: row.text,
        created_at: row.created_at.toISOString(),
        read: row.read,
      }));
      return json(200, { unread: items.filter((item) => !item.read).length, items });
    },
  });

  app.route({
    method: 'POST',
    path: '/api/inbox/read',
    handler: async (ctx) => {
      await app.db.exec(`UPDATE inbox_items SET read = true WHERE user_id = $1 AND NOT read`, [ctx.user.id]);
      await app.events.inbox(ctx.user.id);
      return json(200, { unread: 0 });
    },
  });
}
