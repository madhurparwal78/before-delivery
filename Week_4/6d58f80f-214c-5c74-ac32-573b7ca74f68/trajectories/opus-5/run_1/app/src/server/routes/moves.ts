import { authed, withIdempotency, type Ctx, type Route } from '../http/api.js';
import { notFound, validation } from '../http/errors.js';
import { performMove, type MoveRequestItem } from '../domain/moves.js';
import { personRef } from '../domain/serialize.js';
import { publishMoved } from '../events.js';
import { fileOr404, folderOr404, requireEditorOnFolder } from './helpers.js';

export const moveRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/moves',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const view = await ctx.view();
      const toFolderId = ctx.body.toFolderId;
      if (typeof toFolderId !== 'string') throw notFound();
      const destination = await folderOr404(self, toFolderId);

      const raw = ctx.body.items;
      if (!Array.isArray(raw)) throw validation({ items: 'Send one to 500 items.' });
      const items: MoveRequestItem[] = [];
      for (const entry of raw) {
        if (entry === null || typeof entry !== 'object') throw notFound();
        const candidate = entry as { fileId?: unknown; fromFolderId?: unknown };
        if (typeof candidate.fileId !== 'string' || typeof candidate.fromFolderId !== 'string') {
          throw notFound();
        }
        await fileOr404(self, candidate.fileId);
        await folderOr404(self, candidate.fromFolderId);
        items.push({ fileId: candidate.fileId, fromFolderId: candidate.fromFolderId });
      }

      if (!view.isStaff) {
        requireEditorOnFolder(view, destination.id);
        for (const item of items) requireEditorOnFolder(view, item.fromFolderId);
      }

      return withIdempotency(self, 'moves', async () => {
        if (items.length < 1 || items.length > 500) {
          throw validation({ items: 'Send one to 500 items.' });
        }
        if (new Set(items.map((item) => item.fileId)).size !== items.length) {
          throw validation({ items: 'Name each file once.' });
        }

        const outcome = await performMove(view, self.person, destination.id, items);
        const context = await ctx.serial();
        const result = {
          ...outcome.result,
          lostTo: outcome.result.lostTo.map((lost) => ({
            ...lost,
            by: personRef(context, lost.by.id === '' ? null : lost.by.id),
          })),
        };
        await publishMoved(
          { id: self.person.id, name: self.person.name },
          destination.id,
          outcome.movedFiles,
          outcome.result.folderCounts,
        );
        return { status: 200, body: result };
      });
    },
  },
];
