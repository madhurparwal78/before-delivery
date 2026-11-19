import { db, withTransaction } from '../db.js';
import { authed, requireFound, type Ctx, type Route } from '../http/api.js';
import {
  conflict,
  notFound,
  storageUnavailable,
  validation,
  linkExpired,
} from '../http/errors.js';
import { checkName } from '../domain/names.js';
import { fileEntries, writeLedger } from '../domain/ledger.js';
import {
  PREVIEWABLE,
  serializeFile,
  serializeFolder,
  serializeLedgerEntry,
} from '../domain/serialize.js';
import { issueLink, linkHasExpired, readLink } from '../domain/links.js';
import { StorageDown, getObjectStream, storageUp } from '../services/storage.js';
import { publishFileUpdated } from '../events.js';
import { serverNow } from '../domain/clock.js';
import { SORT_KEYS, type SortKey } from '../../shared/types.js';
import { FILE_COLUMNS, fileOr404, folderOr404, requireController, requireEditorOnFile } from './helpers.js';
import type { FileRow } from '../domain/rows.js';

const ORDER_BY: Record<SortKey, string> = {
  'name-asc': 'name ASC',
  'name-desc': 'name DESC',
  'modified-desc': 'modified_at DESC',
  'modified-asc': 'modified_at ASC',
  'size-desc': 'size DESC',
  'size-asc': 'size ASC',
};

const readSort = (value: string | null): SortKey => {
  if (value === null || value === '') return 'name-asc';
  if (!SORT_KEYS.includes(value as SortKey)) throw validation({ sort: 'Choose one of the six sort orders.' });
  return value as SortKey;
};

export const fileRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/files',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const view = await ctx.view();
      const context = await ctx.serial();
      const sort = readSort(ctx.url.searchParams.get('sort'));
      const query = ctx.url.searchParams.get('q');
      const folderId = ctx.url.searchParams.get('folderId');

      if (query !== null) {
        if (query.length < 1 || query.length > 100) {
          throw validation({ q: 'Search for 1 to 100 characters.' });
        }
        const { rows } = await db.query<FileRow>(
          `SELECT ${FILE_COLUMNS} FROM files WHERE state = 'live' AND name ILIKE $1 ORDER BY ${ORDER_BY[sort]}`,
          [`%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`],
        );
        const files = rows
          .filter((row) => view.fileAccess(row) !== null)
          .map((row) => serializeFile(context, row));
        return { status: 200, body: { folders: [], files } };
      }

      if (folderId !== null && folderId !== '') {
        const folder = await folderOr404(self, folderId);
        const children = view
          .allFolders()
          .filter((row) => row.parent_id === folder.id && view.folderAccess(row.id) !== null)
          .map((row) => serializeFolder(context, row))
          .sort((a, b) => (sort === 'name-desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)));
        const { rows } = await db.query<FileRow>(
          `SELECT ${FILE_COLUMNS} FROM files WHERE folder_id = $1 AND state = 'live' ORDER BY ${ORDER_BY[sort]}`,
          [folder.id],
        );
        const files = rows
          .filter((row) => view.fileAccess(row) !== null)
          .map((row) => serializeFile(context, row));
        return { status: 200, body: { folders: children, files } };
      }

      const tops = view
        .visibleFolders()
        .filter((row) => row.parent_id === null || view.folderAccess(row.parent_id) === null)
        .map((row) => serializeFolder(context, row))
        .sort((a, b) => (sort === 'name-desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)));
      return { status: 200, body: { folders: tops, files: [] } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/files/recent',
    handler: async (ctx: Ctx) => {
      authed(ctx);
      const view = await ctx.view();
      const context = await ctx.serial();
      const { rows } = await db.query<FileRow>(
        `SELECT ${FILE_COLUMNS.split(', ')
          .map((column) => `f.${column}`)
          .join(', ')}
           FROM files f
           JOIN (SELECT file_id, max(seq) AS seq FROM ledger WHERE file_id IS NOT NULL GROUP BY file_id) l
             ON l.file_id = f.id
          WHERE f.state = 'live'
          ORDER BY l.seq DESC
          LIMIT 200`,
      );
      const files = rows
        .filter((row) => view.fileAccess(row) !== null)
        .slice(0, 50)
        .map((row) => serializeFile(context, row));
      return { status: 200, body: { files } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/files/:id',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const file = await fileOr404(self, self.params.id ?? '');
      const view = await ctx.view();
      const context = await ctx.serial();
      return {
        status: 200,
        body: { file: serializeFile(context, file), path: view.pathTo(file.folder_id) },
      };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/files/:id',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const file = await fileOr404(self, self.params.id ?? '');
      const view = await ctx.view();
      requireEditorOnFile(view, file);
      if (file.locked) throw conflict('locked');
      const name = checkName(ctx.body.name);
      if (name.error !== null) throw validation({ name: name.error });
      const updated = await withTransaction(async (tx) => {
        const { rows } = await tx.query<FileRow>(
          `UPDATE files SET name = $2, modified_at = $3 WHERE id = $1 AND locked = false
           RETURNING ${FILE_COLUMNS}`,
          [file.id, name.value, serverNow()],
        );
        const row = rows[0];
        if (row === undefined) throw conflict('locked');
        await writeLedger(tx, {
          actorId: self.person.id,
          action: 'renamed',
          fileId: file.id,
          folderId: file.folder_id,
          detail: { fileName: name.value, previousName: file.name },
        });
        return row;
      });
      await publishFileUpdated(updated);
      const context = await ctx.serial();
      return { status: 200, body: { file: serializeFile(context, updated) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/files/:id/activity',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const file = await fileOr404(self, self.params.id ?? '');
      const context = await ctx.serial();
      const rows = await fileEntries(db, file.id);
      const entries = rows
        .map((row) => serializeLedgerEntry(context, row))
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      return { status: 200, body: { entries } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/files/:id/lock',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const file = await fileOr404(self, self.params.id ?? '');
      requireController(self);
      if (file.locked) throw conflict('already_locked');
      const updated = await withTransaction(async (tx) => {
        const { rows } = await tx.query<FileRow>(
          `UPDATE files SET locked = true WHERE id = $1 AND locked = false RETURNING ${FILE_COLUMNS}`,
          [file.id],
        );
        const row = rows[0];
        if (row === undefined) throw conflict('already_locked');
        await writeLedger(tx, {
          actorId: self.person.id,
          action: 'locked',
          fileId: file.id,
          folderId: file.folder_id,
          detail: { fileName: file.name },
        });
        return row;
      });
      await publishFileUpdated(updated);
      const context = await ctx.serial();
      return { status: 200, body: { file: serializeFile(context, updated) } };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/files/:id/lock',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const file = await fileOr404(self, self.params.id ?? '');
      requireController(self);
      if (!file.locked) throw conflict('not_locked');
      const updated = await withTransaction(async (tx) => {
        const { rows } = await tx.query<FileRow>(
          `UPDATE files SET locked = false WHERE id = $1 AND locked = true RETURNING ${FILE_COLUMNS}`,
          [file.id],
        );
        const row = rows[0];
        if (row === undefined) throw conflict('not_locked');
        await writeLedger(tx, {
          actorId: self.person.id,
          action: 'unlocked',
          fileId: file.id,
          folderId: file.folder_id,
          detail: { fileName: file.name },
        });
        return row;
      });
      await publishFileUpdated(updated);
      const context = await ctx.serial();
      return { status: 200, body: { file: serializeFile(context, updated) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/files/:id/links',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const file = await fileOr404(self, self.params.id ?? '');
      const purpose = ctx.body.purpose;
      if (purpose !== 'preview' && purpose !== 'download') {
        throw validation({ purpose: 'Choose preview or download.' });
      }
      if (purpose === 'preview' && !PREVIEWABLE.has(file.content_type)) {
        throw validation({ purpose: 'No preview for this file type.' });
      }
      if (!storageUp()) throw storageUnavailable();
      const link = issueLink({ fileId: file.id, purpose, sessionId: self.sessionId });
      return {
        status: 201,
        body: { url: `/api/content/${link.token}`, expiresAt: link.expiresAt },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/content/:token',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const claims = requireFound(readLink(self.params.token ?? ''));
      if (claims.sessionId !== self.sessionId) throw notFound();
      const file = await fileOr404(self, claims.fileId);
      if (linkHasExpired(claims)) throw linkExpired();
      try {
        const object = await getObjectStream(file.id);
        ctx.res.writeHead(200, {
          'content-type': file.content_type,
          'content-length': object.size,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-disposition':
            claims.purpose === 'preview'
              ? 'inline'
              : `attachment; filename="${file.name.replace(/["\\]/g, '')}"`,
          ...(claims.purpose === 'preview' ? { 'content-security-policy': 'sandbox' } : {}),
        });
        object.stream.pipe(ctx.res);
        return null;
      } catch (error) {
        if (error instanceof StorageDown) throw storageUnavailable();
        throw error;
      }
    },
  },
];
