import type { Module } from '../http/app.ts';
import { stream } from '../http/reply.ts';
import type { ExtractRow } from '../extracts/state.ts';
import { extractEvent } from '../extracts/state.ts';
import { frame } from './hub.ts';

export const mountEvents: Module = (app) => {
  app.route({
    method: 'GET',
    path: '/api/events',
    handler: (ctx) =>
      stream((_req, res) => {
        app.events.open(ctx.user.id, res, async () => {
          const extracts = await app.db.rows<ExtractRow>(
            `SELECT e.* FROM extracts e
               JOIN sources s ON s.id = e.source_id
               JOIN project_members m ON m.project_id = s.project_id
              WHERE m.user_id = $1 ORDER BY s.created_at, s.id`,
            [ctx.user.id],
          );
          return [
            frame('clock', { server_now: app.clock.iso() }),
            ...extracts.map((row) => frame('extract', extractEvent(app, row))),
            frame('inbox', { unread: await app.events.countUnread(ctx.user.id) }),
          ];
        });
      }),
  });
};
