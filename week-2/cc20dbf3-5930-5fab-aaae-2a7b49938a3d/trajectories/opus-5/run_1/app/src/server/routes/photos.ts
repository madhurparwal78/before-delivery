import { randomUUID } from 'node:crypto';
import {
  effectiveLoanStatus,
  LOAN_STATUS_WORDS,
  photoStageFor,
  type StoredLoanStatus,
} from '../../domain/states.js';
import { FIELD_COPY } from '../../shared/errors.js';
import { PHOTO_BYTE_LIMIT, PHOTOS_PER_STAGE } from '../config.js';
import type { AppContext } from '../core/context.js';
import { presentPhoto } from '../core/present.js';
import { findPhoto, toPhoto } from '../core/records.js';
import { inTransaction } from '../db/pool.js';
import { fail, failTransition, failValidation } from '../http/apiError.js';
import type { HandlerResult } from '../http/context.js';
import { detectPhotoType } from '../http/photoType.js';
import { sessionRoute, type Route } from '../http/routes.js';
import { photoKey, PhotoStorageUnavailable } from '../services/objectStore.js';
import { resolveLoan } from './shared.js';

export function photoRoutes(app: AppContext): Route[] {
  return [
    sessionRoute({
      method: 'POST',
      pattern: '/api/loans/:loanId/photos',
      body: 'multipart',
      roles: ['volunteer', 'founder'],
      resolve: (context) => resolveLoan(app, context),
      handle: async (context, resolved): Promise<HandlerResult> => {
        const file = context.files.find((candidate) => candidate.field === 'photo');
        if (file === undefined || file.bytes.length === 0) {
          throw failValidation({ photo: FIELD_COPY.required });
        }
        const detected = detectPhotoType(file.bytes);
        if (detected === null) throw fail('unsupported_photo');
        if (file.bytes.length > PHOTO_BYTE_LIMIT) throw fail('photo_too_large');

        const photoId = randomUUID();
        let storedKey: string | null = null;
        try {
          const photo = await inTransaction(app.pool, async (client) => {
            const locked = await client.query<{ status: string; due_at: Date }>(
              `select status, due_at from loan where id = $1 for no key update`,
              [resolved.id],
            );
            const row = locked.rows[0];
            if (row === undefined) throw fail('not_found');
            const status = effectiveLoanStatus(
              row.status as StoredLoanStatus,
              row.due_at,
              context.now,
            );
            const stage = photoStageFor(status);
            if (stage === null) throw failTransition('loan', LOAN_STATUS_WORDS[status]);

            const counted = await client.query<{ taken: string }>(
              `select count(*)::text as taken from photo where loan_id = $1 and stage = $2`,
              [resolved.id, stage],
            );
            const taken = Number(counted.rows[0]?.taken ?? '0');
            if (taken >= PHOTOS_PER_STAGE) throw fail('photo_limit');

            const inserted = await client.query<{
              id: string;
              loan_id: string;
              stage: string;
              content_type: string;
              size_bytes: number;
              extension: string;
              seq: number;
            }>(
              `insert into photo (id, loan_id, stage, content_type, size_bytes, extension, seq, created_at)
               values ($1, $2, $3, $4, $5, $6, $7, now())
               returning id, loan_id, stage, content_type, size_bytes, extension, seq`,
              [
                photoId,
                resolved.id,
                stage,
                detected.contentType,
                file.bytes.length,
                detected.extension,
                taken + 1,
              ],
            );
            const record = inserted.rows[0];
            if (record === undefined) throw fail('not_found');

            const key = photoKey(resolved.id, stage, photoId, detected.extension);
            await app.objectStore.put(key, file.bytes, detected.contentType);
            storedKey = key;
            return toPhoto(record);
          });
          return { kind: 'json', status: 201, value: { photo: presentPhoto(photo) } };
        } catch (error) {
          if (storedKey !== null) await app.objectStore.remove(storedKey);
          if (error instanceof PhotoStorageUnavailable) {
            app.probes.notePhotoStorageDown();
            throw fail('photo_storage_unavailable');
          }
          throw error;
        }
      },
    }),

    sessionRoute({
      method: 'GET',
      pattern: '/api/loans/:loanId/photos/:photoId',
      resolve: (context) => resolveLoan(app, context),
      handle: async (context, resolved): Promise<HandlerResult> => {
        const photo = await findPhoto(app.pool, context.params['photoId'] ?? '');
        if (photo === null || photo.loanId !== resolved.id) throw fail('not_found');
        try {
          const bytes = await app.objectStore.get(
            photoKey(photo.loanId, photo.stage, photo.id, photo.extension),
          );
          return {
            kind: 'bytes',
            status: 200,
            bytes,
            headers: {
              'content-type': photo.contentType,
              'content-disposition': 'inline',
              'x-content-type-options': 'nosniff',
              'cache-control': 'private, no-store',
            },
          };
        } catch (error) {
          if (error instanceof PhotoStorageUnavailable) {
            app.probes.notePhotoStorageDown();
            throw fail('photo_storage_unavailable');
          }
          throw error;
        }
      },
    }),
  ];
}
