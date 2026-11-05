import { createHash, randomUUID } from 'node:crypto';
import busboy from 'busboy';
import { PHOTO_TYPES, signedInUser, type Ctx, type Route } from '../http/router';
import * as errors from '../http/errors';
import { createPhoto, findPhoto, photoViewerIds } from '../repo/photos';
import { readPhoto, storePhoto } from '../services/storage';

interface UploadedFile {
  bytes: Buffer;
  contentType: string;
}

function parseUpload(ctx: Ctx): Promise<UploadedFile | 'no_file' | 'bad_type'> {
  const contentType = ctx.req.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return Promise.resolve('bad_type');
  }
  return new Promise((resolve) => {
    const parser = busboy({ headers: { 'content-type': contentType } });
    let found: UploadedFile | null = null;
    let rejected = false;
    parser.on('file', (name, stream, info) => {
      if (name !== 'photo' || found) {
        stream.resume();
        return;
      }
      if (!PHOTO_TYPES.includes(info.mimeType)) {
        rejected = true;
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        found = { bytes: Buffer.concat(chunks), contentType: info.mimeType };
      });
    });
    parser.on('close', () => resolve(rejected ? 'bad_type' : (found ?? 'no_file')));
    parser.on('error', () => resolve('no_file'));
    parser.end(ctx.rawBody);
  });
}

export const photoRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/photos',
    roles: ['member', 'tech', 'owner'],
    body: 'multipart',
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const upload = await parseUpload(ctx);
      if (upload === 'bad_type') throw errors.unsupportedType();
      if (upload === 'no_file') {
        throw errors.unprocessable({ photo: 'Attach one photo file named photo' });
      }
      const photoId = randomUUID();
      const stored = await storePhoto(photoId, upload.bytes, upload.contentType);
      const sha256 = createHash('sha256').update(upload.bytes).digest('hex');
      const row = await createPhoto({
        id: photoId,
        uploaderId: user.id,
        contentType: upload.contentType,
        bytes: stored.bytes,
        sha256,
      });
      return {
        status: 201,
        body: {
          photo_id: row.id,
          content_type: row.content_type,
          bytes: row.bytes,
          sha256: row.sha256,
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/photos/:photo_id',
    roles: 'signed-in',
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const photo = await findPhoto(ctx.params.photo_id);
      if (!photo) throw errors.notFound();
      const maySee =
        user.role !== 'member' ||
        photo.uploader_id === user.id ||
        (await photoViewerIds(photo.id)).includes(user.id);
      if (!maySee) throw errors.notFound();
      const object = await readPhoto(photo.id);
      return {
        status: 200,
        raw: { bytes: object.bytes, contentType: photo.content_type },
      };
    },
  },
];
