import { authed, withIdempotency, type Ctx, type Route } from '../http/api.js';
import { conflict, notFound, storageUnavailable, validation } from '../http/errors.js';
import { MAX_FILE_SIZE } from '../config.js';
import { checkName } from '../domain/names.js';
import { SIZE_LIMIT } from '../../shared/copy.js';
import {
  acceptPart,
  cancelUpload,
  completeUpload,
  dismissUpload,
  expectedPartSize,
  missingParts,
  partCountFor,
  setUploadState,
  startUpload,
  stepRejection,
  uploadById,
  uploadsOfPerson,
} from '../domain/uploads.js';
import { serializeFile, serializeUpload, liveCounts } from '../domain/serialize.js';
import { StorageDown, storageUp } from '../services/storage.js';
import { publishFileCreated } from '../events.js';
import { fileOr404, folderOr404, requireEditorOnFolder } from './helpers.js';
import type { UploadRow } from '../domain/rows.js';
import type { AuthedCtx } from '../http/api.js';

/** A cancelled upload, and a dismissed one, is gone as far as its owner's routes are concerned. */
const mine = async (ctx: AuthedCtx, id: string): Promise<UploadRow> => {
  const upload = await uploadById(id);
  if (upload === null || upload.person_id !== ctx.person.id || upload.state === 'cancelled') {
    throw notFound();
  }
  return upload;
};

export const uploadRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/uploads',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const view = await ctx.view();
      const folderId = ctx.body.folderId;
      if (typeof folderId !== 'string') throw notFound();
      const folder = await folderOr404(self, folderId);
      requireEditorOnFolder(view, folder.id);

      return withIdempotency(self, 'uploads', async () => {
        const name = checkName(ctx.body.name);
        const size = ctx.body.size;
        const contentType = ctx.body.contentType;
        const fields: Record<string, string> = {};
        if (name.error !== null) fields.name = name.error;
        if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > MAX_FILE_SIZE) {
          fields.size = SIZE_LIMIT;
        }
        if (typeof contentType !== 'string' || contentType.trim() === '') {
          fields.contentType = 'Send the file type.';
        }
        if (Object.keys(fields).length > 0) throw validation(fields);
        if (!storageUp()) throw storageUnavailable();

        try {
          const upload = await startUpload({
            personId: self.person.id,
            folderId: folder.id,
            name: name.value,
            size: size as number,
            contentType: contentType as string,
          });
          return { status: 201, body: { upload: serializeUpload(upload) } };
        } catch (error) {
          if (error instanceof StorageDown) throw storageUnavailable();
          throw error;
        }
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/uploads',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const uploads = await uploadsOfPerson(self.person.id);
      return { status: 200, body: { uploads: uploads.map(serializeUpload) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/uploads/:id',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const upload = await mine(self, self.params.id ?? '');
      return { status: 200, body: { upload: serializeUpload(upload) } };
    },
  },
  {
    method: 'PUT',
    pattern: '/api/uploads/:id/parts/:part',
    bodyKind: 'part',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const upload = await mine(self, self.params.id ?? '');
      const rejection = stepRejection(upload.state, 'part');
      if (rejection !== null) throw conflict(rejection);
      const partNumber = Number(self.params.part);
      const count = partCountFor(upload.size);
      if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > count) {
        throw validation({ part: `Parts are numbered 1 to ${count}.` });
      }
      if (ctx.raw.bytes.length !== expectedPartSize(upload.size, partNumber)) {
        throw validation({
          part: `Part ${partNumber} must be ${expectedPartSize(upload.size, partNumber)} bytes.`,
        });
      }
      if (!storageUp()) throw storageUnavailable();
      try {
        const updated = await acceptPart(upload, partNumber, ctx.raw.bytes);
        return { status: 200, body: { upload: serializeUpload(updated) } };
      } catch (error) {
        if (error instanceof StorageDown) throw storageUnavailable();
        throw error;
      }
    },
  },
  {
    method: 'POST',
    pattern: '/api/uploads/:id/pause',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const upload = await mine(self, self.params.id ?? '');
      const rejection = stepRejection(upload.state, 'pause');
      if (rejection !== null) throw conflict(rejection);
      const updated =
        upload.state === 'paused' ? upload : await setUploadState(upload, 'paused');
      return { status: 200, body: { upload: serializeUpload(updated) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/uploads/:id/resume',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const upload = await mine(self, self.params.id ?? '');
      const rejection = stepRejection(upload.state, 'resume');
      if (rejection !== null) throw conflict(rejection);
      const updated =
        upload.state === 'paused' ? await setUploadState(upload, 'uploading') : upload;
      return { status: 200, body: { upload: serializeUpload(updated) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/uploads/:id/complete',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const upload = await mine(self, self.params.id ?? '');
      if (upload.state === 'confirmed') {
        const file = await fileOr404(self, upload.id);
        const context = await ctx.serial();
        return { status: 200, body: { file: serializeFile(context, file) } };
      }
      const rejection = stepRejection(upload.state, 'complete');
      if (rejection !== null) throw conflict(rejection);
      const missing = missingParts(upload);
      if (missing.length > 0) throw conflict('parts_missing', { missing });
      if (!storageUp()) throw storageUnavailable();
      try {
        const file = await completeUpload(upload);
        const counts = await liveCounts();
        await publishFileCreated(file, { [file.folder_id]: counts.get(file.folder_id) ?? 0 });
        ctx.invalidate();
        const context = await ctx.serial();
        return { status: 201, body: { file: serializeFile(context, file) } };
      } catch (error) {
        if (error instanceof StorageDown) throw storageUnavailable();
        throw error;
      }
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/uploads/:id',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const upload = await mine(self, self.params.id ?? '');
      const rejection = stepRejection(upload.state, 'cancel');
      if (rejection !== null) throw conflict(rejection);
      if (upload.state === 'abandoned') await dismissUpload(upload);
      else await cancelUpload(upload);
      return { status: 204 };
    },
  },
];
