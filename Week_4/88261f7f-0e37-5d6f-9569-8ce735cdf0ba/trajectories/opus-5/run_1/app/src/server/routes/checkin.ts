import Busboy from 'busboy';
import { IncomingMessage } from 'node:http';
import { pool, withTransaction } from '../db';
import { config } from '../config';
import { notices } from '../../shared/notices';
import { contentTypeFor, sniffImageKind, stripImageMetadata } from '../domain/images';
import { errorTexts, failure, invalid, outageTexts, validationTexts } from '../http/errors';
import { Router } from '../http/router';
import { endLink, resolveToken } from '../repo/checkinLinks';
import { loadRoom } from '../repo/hotels';
import { roomForNight, segmentsOf } from '../repo/stays';
import { headObject, idPhotoObjectKey, putObject } from '../services/fileStore';
import { ProviderDownError } from '../services/providers';
import { publishStayChange } from './changes';

const FORM_OVERHEAD_BYTES = 65536;

function deadLink(): never {
  throw failure(404, errorTexts.deadLink);
}

interface UploadedPhoto {
  body: Buffer;
  tooLarge: boolean;
}

/** Reads the one `photo` part, holding no more than the published limit plus form overhead. */
function readPhoto(req: IncomingMessage): Promise<UploadedPhoto> {
  return new Promise((resolve, reject) => {
    const limit = config.idPhotoMaxBytes;
    const busboy = Busboy({
      headers: req.headers,
      limits: { files: 1, fields: 8, fieldSize: 4096, fileSize: limit + 1 },
    });
    const chunks: Buffer[] = [];
    let received = 0;
    let tooLarge = false;
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve({ body: Buffer.concat(chunks), tooLarge });
    };

    let requestBytes = 0;
    req.on('data', (chunk: Buffer) => {
      requestBytes += chunk.length;
      if (requestBytes > limit + FORM_OVERHEAD_BYTES && !tooLarge) {
        tooLarge = true;
        chunks.length = 0;
        req.unpipe(busboy);
        req.resume();
        finish();
      }
    });

    busboy.on('file', (_name, stream) => {
      stream.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > limit) {
          tooLarge = true;
          chunks.length = 0;
          return;
        }
        chunks.push(chunk);
      });
      stream.on('limit', () => {
        tooLarge = true;
      });
      stream.on('end', () => undefined);
    });
    busboy.on('close', finish);
    busboy.on('finish', finish);
    busboy.on('error', (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    req.pipe(busboy);
  });
}

export function registerCheckinRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/checkin/:token',
    access: 'public',
    bodyMode: 'none',
    handler: async (ctx) => {
      const link = await resolveToken(pool, ctx.params.token);
      if (!link) deadLink();
      const segments = await segmentsOf(pool, link.stay.id);
      const room = segments.length > 0 ? await loadRoom(pool, link.hotel.id, segments[0].roomId) : null;
      return {
        status: 200,
        json: {
          hotelName: link.hotel.name,
          arrival: link.stay.arrival,
          departure: link.stay.departure,
          roomType: room ? room.type : '',
          photo: link.stay.idPhoto,
        },
      };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/checkin/:token/photo',
    access: 'public',
    bodyMode: 'multipart',
    handler: async (ctx) => {
      const link = await resolveToken(pool, ctx.params.token);
      if (!link) deadLink();
      const uploaded = await readPhoto(ctx.req);
      if (uploaded.tooLarge) throw failure(413, errorTexts.photoTooLarge);
      const kind = sniffImageKind(uploaded.body);
      if (kind === null) throw failure(415, errorTexts.photoWrongType);
      const stripped = stripImageMetadata(uploaded.body, kind);
      const objectKey = idPhotoObjectKey(link.hotel.id, link.stay.id);
      try {
        await putObject(objectKey, stripped, contentTypeFor(kind));
        if (!(await headObject(objectKey))) {
          throw new ProviderDownError('minio', 'object missing after upload');
        }
      } catch (error) {
        if (error instanceof ProviderDownError) throw failure(503, outageTexts.photoFileStore);
        throw error;
      }
      await withTransaction(async (db) => {
        await db.query("update stays set id_photo = 'received' where id = $1", [link.stay.id]);
        await publishStayChange(db, link.hotel, {
          type: 'checkin',
          stayId: link.stay.id,
          notice: null,
        });
      });
      return { status: 200, json: { photo: 'received' } };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/checkin/:token/complete',
    access: 'public',
    bodyMode: 'json',
    handler: async (ctx) => {
      const link = await resolveToken(pool, ctx.params.token);
      if (!link) deadLink();
      if (link.stay.idPhoto !== 'received') {
        throw failure(409, errorTexts.uploadPhotoFirst);
      }
      const fullName = typeof ctx.body.fullName === 'string' ? ctx.body.fullName.trim() : '';
      if (fullName === '') throw invalid({ fullName: validationTexts.fullName });
      const phone = typeof ctx.body.phone === 'string' ? ctx.body.phone.trim() : '';
      const segments = await segmentsOf(pool, link.stay.id);
      const segment = roomForNight(segments, link.stay.arrival) ?? segments[0];
      await withTransaction(async (db) => {
        await db.query(
          `update stays set checked_in_online = true, online_full_name = $2, online_phone = $3,
                            version = version + 1
            where id = $1`,
          [link.stay.id, fullName, phone],
        );
        await endLink(db, link.stay.id);
        await publishStayChange(db, link.hotel, {
          type: 'checkin',
          stayId: link.stay.id,
          notice: notices.onlineCheckInCompleted(segment ? segment.roomNumber : ''),
          roomIds: segment ? [segment.roomId] : [],
        });
      });
      return { status: 200, json: { completed: true } };
    },
  });
}
