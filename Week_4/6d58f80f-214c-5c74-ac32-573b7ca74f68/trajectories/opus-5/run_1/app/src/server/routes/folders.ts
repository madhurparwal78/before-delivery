import { db, newId } from '../db.js';
import { authed, type Ctx, type Route } from '../http/api.js';
import { forbidden, validation } from '../http/errors.js';
import { checkName } from '../domain/names.js';
import { writeLedger } from '../domain/ledger.js';
import { withTransaction } from '../db.js';
import { folderEntries } from '../domain/ledger.js';
import { serializeFolder, serializeLedgerEntry } from '../domain/serialize.js';
import { publishFolderCreated } from '../events.js';
import { folderOr404 } from './helpers.js';
import type { FolderRow } from '../domain/rows.js';

export const folderRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/folders',
    handler: async (ctx: Ctx) => {
      authed(ctx);
      const view = await ctx.view();
      const context = await ctx.serial();
      const folders = view
        .visibleFolders()
        .map((folder) => serializeFolder(context, folder))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { status: 200, body: { folders } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/folders/:id',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const folder = await folderOr404(self, self.params.id ?? '');
      const view = await ctx.view();
      const context = await ctx.serial();
      return {
        status: 200,
        body: { folder: serializeFolder(context, folder), path: view.pathTo(folder.id) },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/folders',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const view = await ctx.view();
      const parentIdRaw = ctx.body.parentId;
      let parent: FolderRow | null = null;
      if (parentIdRaw !== null && parentIdRaw !== undefined) {
        if (typeof parentIdRaw !== 'string') throw forbidden();
        parent = await folderOr404(self, parentIdRaw);
        if (view.folderAccess(parent.id) !== 'editor') throw forbidden();
      } else if (!view.isStaff) {
        throw forbidden();
      }
      const name = checkName(ctx.body.name);
      if (name.error !== null) throw validation({ name: name.error });

      const folder = await withTransaction(async (tx) => {
        const { rows } = await tx.query<FolderRow>(
          `INSERT INTO folders (id, name, parent_id, owner_id) VALUES ($1,$2,$3,$4)
           RETURNING id, name, parent_id, owner_id`,
          [newId(), name.value, parent?.id ?? null, parent === null ? self.person.id : null],
        );
        const created = rows[0];
        if (created === undefined) throw new Error('folder insert returned nothing');
        await writeLedger(tx, {
          actorId: self.person.id,
          action: 'folder_created',
          folderId: created.id,
          detail: { folderName: created.name },
        });
        return created;
      });
      await publishFolderCreated(folder);
      ctx.invalidate();
      const context = await ctx.serial();
      return { status: 201, body: { folder: serializeFolder(context, folder) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/folders/:id/activity',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const folder = await folderOr404(self, self.params.id ?? '');
      const context = await ctx.serial();
      const rows = await folderEntries(db, folder.id);
      const entries = rows
        .map((row) => serializeLedgerEntry(context, row))
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      return { status: 200, body: { entries } };
    },
  },
];
