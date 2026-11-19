import { authed, type Ctx, type Route } from '../http/api.js';
import { storageUnavailable, validation } from '../http/errors.js';
import { binFiles, binRows, purgeFile, purgeIsDue, restoreFile } from '../domain/bin.js';
import { liveCounts, serializeBinItem, serializeFile } from '../domain/serialize.js';
import { storageTotals } from '../domain/storageTotals.js';
import { StorageDown, storageUp } from '../services/storage.js';
import {
  publishBinChanged,
  publishFileCreated,
  publishFilesRemoved,
} from '../events.js';
import { fileOr404, requireController, requireStaff } from './helpers.js';
import type { FileRow } from '../domain/rows.js';

export const binRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/storage',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      requireStaff(self);
      return { status: 200, body: await storageTotals() };
    },
  },
  {
    method: 'GET',
    pattern: '/api/bin',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      requireStaff(self);
      const context = await ctx.serial();
      const rows = await binRows();
      const items = rows.map((row) =>
        serializeBinItem(context, row.bin, row.file, purgeIsDue(row.bin.purge_date)),
      );
      return { status: 200, body: { items } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/bin',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const raw = ctx.body.fileIds;
      if (!Array.isArray(raw)) throw validation({ fileIds: 'Name one to 500 files.' });
      const files: FileRow[] = [];
      for (const id of raw) {
        if (typeof id !== 'string') throw validation({ fileIds: 'Name one to 500 files.' });
        files.push(await fileOr404(self, id));
      }
      requireStaff(self);
      if (files.length < 1 || files.length > 500) {
        throw validation({ fileIds: 'Name one to 500 files.' });
      }
      const outcome = await binFiles(
        self.person.id,
        files.map((file) => file.id),
      );
      const counts = await liveCounts();
      const folderCounts: Record<string, number> = {};
      for (const file of files) folderCounts[file.folder_id] = counts.get(file.folder_id) ?? 0;
      await publishFilesRemoved(outcome.binned, folderCounts);
      return { status: 200, body: outcome };
    },
  },
  {
    method: 'POST',
    pattern: '/api/bin/:fileId/restore',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const file = await fileOr404(self, self.params.fileId ?? '', { allowBinned: true });
      requireStaff(self);
      const restored = await restoreFile(self.person.id, file.id);
      const counts = await liveCounts();
      await publishFileCreated(restored.file, {
        [restored.file.folder_id]: counts.get(restored.file.folder_id) ?? 0,
      });
      const context = await ctx.serial();
      return { status: 200, body: { file: serializeFile(context, restored.file) } };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/bin/:fileId',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const file = await fileOr404(self, self.params.fileId ?? '', { allowBinned: true });
      requireController(self);
      if (!storageUp()) throw storageUnavailable();
      try {
        const outcome = await purgeFile(self.person.id, file.id);
        const counts = await liveCounts();
        await publishFilesRemoved(
          [outcome.fileId],
          { [outcome.folderId]: counts.get(outcome.folderId) ?? 0 },
          outcome.grantHolders,
        );
        await publishBinChanged();
        return { status: 204 };
      } catch (error) {
        if (error instanceof StorageDown) throw storageUnavailable();
        throw error;
      }
    },
  },
];
