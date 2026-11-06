import { config, limits } from '../config.js';
import { now } from '../clock.js';
import { query, queryOne, withClient, withTransaction, type Db } from '../db.js';
import { empty, json, route, type Ctx } from '../http.js';
import { newId } from '../util.js';
import { log } from '../log.js';
import {
  ApiError,
  ValidationError,
  conflict,
  fieldMessages,
  gone,
  notFound,
} from '../errors.js';
import { isHoof, isPhase, type Hoof, type Phase } from '../domain/marks.js';
import { prepareStoredImage, signatureOf, UnsupportedImage } from '../services/images.js';
import {
  deleteObject,
  getObject,
  objectKeys,
  putObject,
  StorageUnavailable,
} from '../services/storage.js';
import { verifyPhotoPath } from '../services/signing.js';
import { appendEvent, horseChannel } from '../stream.js';
import { practice } from '../domain/practice.js';
import { formatInstant } from '../domain/time.js';
import { loadVisit, photoJson, visibleVisit } from './visits.js';
import { vetLinkServesPhoto } from './vetlinks.js';

/**
 * Hoof photo uploads, whole or in resumable chunks. Stored plus reserved bytes on one
 * visit never exceed the quota, and a session continues on any instance from the
 * offset kept in Postgres.
 */
const STAFF = ['farrier', 'apprentice'] as const;

interface MultipartField {
  name: string;
  filename: string | null;
  value: Buffer;
}

function parseMultipart(raw: Buffer, contentType: string): MultipartField[] {
  const boundaryMatch = /boundary="?([^";]+)"?/i.exec(contentType);
  if (boundaryMatch === null) throw new ValidationError({ file: fieldMessages.required });
  const boundary = Buffer.from(`--${boundaryMatch[1] as string}`);
  const fields: MultipartField[] = [];
  let index = raw.indexOf(boundary);
  while (index !== -1) {
    const start = index + boundary.length;
    if (raw.subarray(start, start + 2).toString() === '--') break;
    const headerEnd = raw.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headers = raw.subarray(start, headerEnd).toString('utf8');
    const next = raw.indexOf(boundary, headerEnd);
    if (next === -1) break;
    const value = raw.subarray(headerEnd + 4, next - 2);
    const nameMatch = /name="([^"]*)"/i.exec(headers);
    const fileMatch = /filename="([^"]*)"/i.exec(headers);
    if (nameMatch !== null) {
      fields.push({
        name: nameMatch[1] as string,
        filename: fileMatch === null ? null : (fileMatch[1] as string),
        value,
      });
    }
    index = next;
  }
  return fields;
}

interface UploadSessionRow {
  id: string;
  visit_id: string;
  hoof: Hoof;
  phase: Phase;
  size_bytes: number;
  chunk_bytes: number;
  upload_offset: number;
  chunk_count: number;
  expires_at: Date;
  ended_reason: string | null;
  reserved_bytes: number;
}

async function loadSession(db: Db, id: string, lock = false): Promise<UploadSessionRow | null> {
  return await queryOne<UploadSessionRow>(
    db,
    `SELECT id, visit_id, hoof, phase, size_bytes, chunk_bytes, upload_offset, chunk_count,
            expires_at, ended_reason, reserved_bytes
     FROM upload_sessions WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [id],
  );
}

function sessionJson(session: UploadSessionRow, timeZone: string): Record<string, unknown> {
  return {
    id: session.id,
    hoof: session.hoof,
    phase: session.phase,
    size_bytes: session.size_bytes,
    chunk_bytes: session.chunk_bytes,
    offset: session.upload_offset,
    expires_at: formatInstant(session.expires_at, timeZone),
  };
}

/** Stored plus reserved bytes on a visit, read under the visit's lock. */
async function usedBytes(db: Db, visitId: string, at: Date): Promise<number> {
  const row = await queryOne<{ stored: number; reserved: number }>(
    db,
    `SELECT COALESCE((SELECT SUM(stored_bytes) FROM photos WHERE visit_id = $1 AND deleted_at IS NULL),0)::int AS stored,
            COALESCE((SELECT SUM(reserved_bytes) FROM upload_sessions
                      WHERE visit_id = $1 AND ended_reason IS NULL AND expires_at > $2),0)::int AS reserved`,
    [visitId, at],
  );
  return (row?.stored ?? 0) + (row?.reserved ?? 0);
}

/** Closing a visit ends its live sessions and releases their reservations at once. */
export async function endUploadSessionsForVisit(db: Db, visitId: string): Promise<string[]> {
  const rows = await query<{ id: string; chunk_count: number }>(
    db,
    `UPDATE upload_sessions SET ended_reason = 'visit_closed', reserved_bytes = 0
     WHERE visit_id = $1 AND ended_reason IS NULL
     RETURNING id, chunk_count`,
    [visitId],
  );
  return rows.map((row) => row.id);
}

/** Chunk objects of ended sessions are removed within 10 seconds of the close response. */
export async function removeUploadChunks(sessionIds: readonly string[]): Promise<void> {
  for (const sessionId of sessionIds) {
    const session = await withClient((db) => loadSession(db, sessionId));
    if (session === null) continue;
    for (let index = 0; index < session.chunk_count; index += 1) {
      await deleteObject(objectKeys.uploadChunk(sessionId, index)).catch((error: unknown) => {
        log.error('chunk_delete_failed', { detail: String(error) });
      });
    }
  }
}

async function storePhoto(
  db: Db,
  visitId: string,
  hoof: Hoof,
  phase: Phase,
  bytes: Buffer,
  at: Date,
): Promise<string> {
  const prepared = await prepareStoredImage(bytes);
  const photoId = newId();
  const key = objectKeys.photo(visitId, hoof, phase, photoId, prepared.extension);
  await putObject(key, prepared.bytes, prepared.contentType);
  await query(
    db,
    `INSERT INTO photos (id, visit_id, hoof, phase, content_type, extension, width, height,
                         stored_bytes, object_key, thumbnail_status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11)`,
    [
      photoId,
      visitId,
      hoof,
      phase,
      prepared.contentType,
      prepared.extension,
      prepared.width,
      prepared.height,
      prepared.bytes.length,
      key,
      at,
    ],
  );
  await query(
    db,
    `INSERT INTO jobs (id, kind, status, payload, max_attempts, run_at, dedupe_key, created_at, updated_at)
     VALUES ($1,'thumbnail','queued',$2::jsonb,$3,$4,$5,$4,$4)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [newId(), JSON.stringify({ photo_id: photoId }), config.jobMaxAttempts, at, `thumbnail:${photoId}`],
  );
  return photoId;
}

function mapStorageError(error: unknown): never {
  if (error instanceof StorageUnavailable) throw new ApiError(503, 'storage_unavailable');
  if (error instanceof UnsupportedImage) throw new ApiError(415, 'unsupported_image');
  throw error;
}

export function registerUploadRoutes(): void {
  route({
    method: 'POST',
    path: '/api/visits/:id/photos',
    roles: STAFF,
    bodyKind: 'multipart',
    rate: 'upload',
    handler: async (ctx: Ctx) => {
      const visitId = ctx.params.id as string;
      await withClient((db) => visibleVisit(db, ctx.caller, visitId));
      const fields = parseMultipart(ctx.raw, ctx.header('content-type') ?? '');
      const file = fields.find((field) => field.name === 'file');
      const hoofRaw = fields.find((field) => field.name === 'hoof')?.value.toString('utf8').trim();
      const phaseRaw = fields.find((field) => field.name === 'phase')?.value.toString('utf8').trim();

      // Judged from the request itself, these come before the route's conflicts.
      if (file === undefined) throw new ValidationError({ file: fieldMessages.required });
      if (file.value.length > limits.photoBytes) throw new ApiError(413, 'photo_too_large');
      if (signatureOf(file.value) === null) throw new ApiError(415, 'unsupported_image');

      const body = await withTransaction(async (db) => {
        const at = now();
        const visit = await loadVisit(db, visitId, true);
        if (visit === null) throw notFound();
        if (visit.status !== 'open') throw conflict('visit_closed');
        if (!isHoof(hoofRaw) || !isPhase(phaseRaw)) {
          throw new ValidationError({
            ...(isHoof(hoofRaw) ? {} : { hoof: fieldMessages.required }),
            ...(isPhase(phaseRaw) ? {} : { phase: fieldMessages.required }),
          });
        }
        const existing = await queryOne<{ id: string }>(
          db,
          'SELECT id FROM photos WHERE visit_id = $1 AND hoof = $2 AND phase = $3 AND deleted_at IS NULL',
          [visitId, hoofRaw, phaseRaw],
        );
        if (existing !== null) throw conflict('photo_exists');

        const used = await usedBytes(db, visitId, at);
        const remaining = config.visitPhotoQuotaBytes - used;
        if (file.value.length > remaining) {
          throw conflict('visit_quota_exceeded', { remaining_bytes: Math.max(0, remaining) });
        }

        const photoId = await storePhoto(db, visitId, hoofRaw, phaseRaw, file.value, at).catch(
          mapStorageError,
        );
        const photo = await queryOne<Parameters<typeof photoJson>[1]>(
          db,
          `SELECT id, visit_id, hoof, phase, content_type, width, height, thumbnail_status, thumbnail_key
           FROM photos WHERE id = $1`,
          [photoId],
        );
        if (photo === null) throw new Error('photo vanished');
        return await photoJson(db, photo);
      });
      return json(201, body);
    },
  });

  route({
    method: 'POST',
    path: '/api/visits/:id/uploads',
    roles: STAFF,
    bodyKind: 'json',
    rate: 'upload',
    handler: async (ctx: Ctx) => {
      const visitId = ctx.params.id as string;
      await withClient((db) => visibleVisit(db, ctx.caller, visitId));
      const input = ctx.body<{ hoof?: unknown; phase?: unknown; size_bytes?: unknown }>();
      const sizeBytes = typeof input.size_bytes === 'number' ? input.size_bytes : Number(input.size_bytes);
      if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
        if (Number.isInteger(sizeBytes) && sizeBytes > limits.photoBytes) {
          throw new ApiError(413, 'photo_too_large');
        }
        throw new ValidationError({ size_bytes: fieldMessages.range(1, limits.photoBytes) });
      }
      if (sizeBytes > limits.photoBytes) throw new ApiError(413, 'photo_too_large');

      const body = await withTransaction(async (db) => {
        const at = now();
        const { timeZone } = await practice(db);
        const visit = await loadVisit(db, visitId, true);
        if (visit === null) throw notFound();
        if (visit.status !== 'open') throw conflict('visit_closed');
        if (!isHoof(input.hoof) || !isPhase(input.phase)) {
          throw new ValidationError({
            ...(isHoof(input.hoof) ? {} : { hoof: fieldMessages.required }),
            ...(isPhase(input.phase) ? {} : { phase: fieldMessages.required }),
          });
        }
        const existing = await queryOne<{ id: string }>(
          db,
          'SELECT id FROM photos WHERE visit_id = $1 AND hoof = $2 AND phase = $3 AND deleted_at IS NULL',
          [visitId, input.hoof, input.phase],
        );
        if (existing !== null) throw conflict('photo_exists');

        const used = await usedBytes(db, visitId, at);
        const remaining = config.visitPhotoQuotaBytes - used;
        if (sizeBytes > remaining) {
          throw conflict('visit_quota_exceeded', { remaining_bytes: Math.max(0, remaining) });
        }

        const id = newId();
        const expiresAt = new Date(at.getTime() + config.uploadSessionSeconds * 1000);
        await query(
          db,
          `INSERT INTO upload_sessions (id, visit_id, hoof, phase, size_bytes, chunk_bytes,
                                        expires_at, reserved_bytes, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$5,$8)`,
          [id, visitId, input.hoof, input.phase, sizeBytes, config.uploadChunkBytes, expiresAt, at],
        );
        const session = await loadSession(db, id);
        if (session === null) throw new Error('upload session vanished');
        return {
          id: session.id,
          chunk_bytes: session.chunk_bytes,
          offset: 0,
          expires_at: formatInstant(session.expires_at, timeZone),
        };
      });
      return json(201, body);
    },
  });

  route({
    method: 'GET',
    path: '/api/visits/:id/uploads',
    roles: STAFF,
    handler: async (ctx: Ctx) => {
      const rows = await withClient(async (db) => {
        const visit = await visibleVisit(db, ctx.caller, ctx.params.id as string);
        const { timeZone } = await practice(db);
        const sessions = await query<UploadSessionRow>(
          db,
          `SELECT id, visit_id, hoof, phase, size_bytes, chunk_bytes, upload_offset, chunk_count,
                  expires_at, ended_reason, reserved_bytes
           FROM upload_sessions WHERE visit_id = $1 AND ended_reason IS NULL AND expires_at > $2
           ORDER BY created_at`,
          [visit.id, now()],
        );
        return sessions.map((session) => sessionJson(session, timeZone));
      });
      return json(200, rows);
    },
  });

  route({
    method: 'GET',
    path: '/api/uploads/:id',
    roles: STAFF,
    handler: async (ctx: Ctx) => {
      const body = await withClient(async (db) => {
        const session = await loadSession(db, ctx.params.id as string);
        if (session === null) throw notFound();
        await visibleVisit(db, ctx.caller, session.visit_id);
        if (session.ended_reason === 'visit_closed') throw conflict('visit_closed');
        if (now().getTime() >= session.expires_at.getTime()) throw gone('upload_expired');
        if (session.ended_reason !== null) throw notFound();
        const { timeZone } = await practice(db);
        return sessionJson(session, timeZone);
      });
      return json(200, body);
    },
  });

  route({
    method: 'PATCH',
    path: '/api/uploads/:id',
    roles: STAFF,
    bodyKind: 'octet',
    rate: 'upload',
    handler: async (ctx: Ctx) => {
      const sessionId = ctx.params.id as string;
      const located = await withClient(async (db) => {
        const session = await loadSession(db, sessionId);
        if (session === null) throw notFound();
        await visibleVisit(db, ctx.caller, session.visit_id);
        return session;
      });

      const offsetHeader = ctx.header('upload-offset');
      const givenOffset = offsetHeader === null ? Number.NaN : Number(offsetHeader);

      // The order is fixed: visit_closed, then offset_mismatch, then upload_expired.
      if (located.ended_reason === 'visit_closed') throw conflict('visit_closed');
      if (located.ended_reason !== null) throw notFound();
      if (!Number.isInteger(givenOffset) || givenOffset !== located.upload_offset) {
        throw conflict('offset_mismatch', { offset: located.upload_offset });
      }
      if (now().getTime() >= located.expires_at.getTime()) throw gone('upload_expired');

      const remaining = located.size_bytes - located.upload_offset;
      const expected = Math.min(located.chunk_bytes, remaining);
      if (ctx.raw.length !== expected) {
        throw new ValidationError({ chunk: fieldMessages.chunkLength(located.chunk_bytes) });
      }

      const chunkIndex = located.chunk_count;
      await putObject(
        objectKeys.uploadChunk(sessionId, chunkIndex),
        ctx.raw,
        'application/octet-stream',
      ).catch(mapStorageError);

      const advanced = await withTransaction(async (db) => {
        const session = await loadSession(db, sessionId, true);
        if (session === null) throw notFound();
        if (session.ended_reason === 'visit_closed') throw conflict('visit_closed');
        // Of two PATCHes at one offset, exactly one advances.
        if (session.upload_offset !== located.upload_offset) {
          throw conflict('offset_mismatch', { offset: session.upload_offset });
        }
        const nextOffset = session.upload_offset + ctx.raw.length;
        await query(
          db,
          'UPDATE upload_sessions SET upload_offset = $2, chunk_count = chunk_count + 1 WHERE id = $1',
          [sessionId, nextOffset],
        );
        return { nextOffset, chunkCount: session.chunk_count + 1, session };
      });

      if (advanced.nextOffset < located.size_bytes) {
        return json(200, { offset: advanced.nextOffset });
      }

      // The last chunk landed: assemble, validate and store one photo.
      const parts: Buffer[] = [];
      for (let index = 0; index < advanced.chunkCount; index += 1) {
        const part = await getObject(objectKeys.uploadChunk(sessionId, index)).catch(mapStorageError);
        if (part !== null) parts.push(part);
      }
      const assembled = Buffer.concat(parts);

      try {
        const body = await withTransaction(async (db) => {
          const at = now();
          const session = await loadSession(db, sessionId, true);
          if (session === null) throw notFound();
          const visit = await loadVisit(db, session.visit_id, true);
          if (visit === null) throw notFound();
          if (visit.status !== 'open') throw conflict('visit_closed');
          if (signatureOf(assembled) === null) throw new ApiError(415, 'unsupported_image');

          const photoId = await storePhoto(
            db,
            session.visit_id,
            session.hoof,
            session.phase,
            assembled,
            at,
          ).catch(mapStorageError);
          await query(
            db,
            `UPDATE upload_sessions SET ended_reason = 'completed', reserved_bytes = 0 WHERE id = $1`,
            [sessionId],
          );
          const photo = await queryOne<Parameters<typeof photoJson>[1]>(
            db,
            `SELECT id, visit_id, hoof, phase, content_type, width, height, thumbnail_status, thumbnail_key
             FROM photos WHERE id = $1`,
            [photoId],
          );
          if (photo === null) throw new Error('photo vanished');
          return await photoJson(db, photo);
        });
        void removeUploadChunks([sessionId]);
        return json(201, body);
      } catch (error) {
        // A refusal deletes the chunks and releases the reservation.
        await withTransaction((db) =>
          query(
            db,
            `UPDATE upload_sessions SET ended_reason = 'refused', reserved_bytes = 0 WHERE id = $1`,
            [sessionId],
          ),
        );
        void removeUploadChunks([sessionId]);
        throw error;
      }
    },
  });

  route({
    method: 'DELETE',
    path: '/api/uploads/:id',
    roles: STAFF,
    handler: async (ctx: Ctx) => {
      const sessionId = ctx.params.id as string;
      await withTransaction(async (db) => {
        const session = await loadSession(db, sessionId, true);
        if (session === null) throw notFound();
        await visibleVisit(db, ctx.caller, session.visit_id);
        if (session.ended_reason === 'visit_closed') throw conflict('visit_closed');
        if (session.ended_reason !== null) throw notFound();
        await query(
          db,
          `UPDATE upload_sessions SET ended_reason = 'deleted', reserved_bytes = 0 WHERE id = $1`,
          [sessionId],
        );
      });
      void removeUploadChunks([sessionId]);
      return empty(204);
    },
  });

  route({
    method: 'GET',
    path: '/api/photos/:id',
    roles: ['farrier', 'apprentice', 'owner'],
    tokenAccess: 'read_only',
    handler: async (ctx: Ctx) => {
      const body = await withClient(async (db) => {
        const photo = await queryOne<
          Parameters<typeof photoJson>[1] & { visit_id: string }
        >(
          db,
          `SELECT id, visit_id, hoof, phase, content_type, width, height, thumbnail_status, thumbnail_key
           FROM photos WHERE id = $1 AND deleted_at IS NULL`,
          [ctx.params.id as string],
        );
        if (photo === null) throw notFound();
        await visibleVisit(db, ctx.caller, photo.visit_id);
        return await photoJson(db, photo);
      });
      return json(200, body);
    },
  });

  route({
    method: 'DELETE',
    path: '/api/photos/:id',
    roles: STAFF,
    handler: async (ctx: Ctx) => {
      const photoId = ctx.params.id as string;
      const removed = await withTransaction(async (db) => {
        const at = now();
        const photo = await queryOne<{
          id: string;
          visit_id: string;
          hoof: Hoof;
          phase: Phase;
          object_key: string;
          thumbnail_key: string | null;
        }>(
          db,
          `SELECT id, visit_id, hoof, phase, object_key, thumbnail_key
           FROM photos WHERE id = $1 AND deleted_at IS NULL`,
          [photoId],
        );
        if (photo === null) throw notFound();
        const visit = await loadVisit(db, photo.visit_id, true);
        if (visit === null) throw notFound();
        if (visit.status !== 'open') throw conflict('visit_closed');

        await query(db, 'UPDATE photos SET deleted_at = $2, stored_bytes = 0 WHERE id = $1', [photoId, at]);

        // Deleting an after photo deletes that hoof's marks and history.
        if (photo.phase === 'after') {
          await query(db, 'DELETE FROM hoof_marks WHERE visit_id = $1 AND hoof = $2', [
            photo.visit_id,
            photo.hoof,
          ]);
          await appendEvent(
            db,
            horseChannel(visit.horse_id, 'staff'),
            'marks_saved',
            { visit_id: visit.id, hoof: photo.hoof, version: null },
            at,
          );
        }
        return photo;
      });

      await deleteObject(removed.object_key).catch((error: unknown) => {
        log.error('photo_delete_failed', { detail: String(error) });
      });
      await deleteObject(objectKeys.thumbnail(removed.visit_id, removed.hoof, removed.phase, removed.id)).catch(
        () => undefined,
      );
      return empty(204);
    },
  });

  const media = (thumbnail: boolean, path: string): void => {
    route({
      method: 'GET',
      path,
      openToVets: true,
      handler: async (ctx: Ctx) => {
        const photoId = ctx.params.id as string;
        const result = await withClient(async (db) => {
          const check = await verifyPhotoPath(db, photoId, thumbnail, ctx.url.searchParams);
          if (check.kind === 'invalid') throw new ApiError(403, 'url_invalid');
          const photo = await queryOne<{
            id: string;
            visit_id: string;
            hoof: Hoof;
            phase: Phase;
            content_type: string;
            object_key: string;
          }>(
            db,
            `SELECT id, visit_id, hoof, phase, content_type, object_key
             FROM photos WHERE id = $1 AND deleted_at IS NULL`,
            [photoId],
          );
          if (photo === null) throw notFound();
          // A vet path verifies only while its link is live and the photo belongs to the
          // link's current pair.
          if (check.vetLinkId !== null) {
            const serves = await vetLinkServesPhoto(db, check.vetLinkId, photo.visit_id, photo.phase);
            if (!serves) throw new ApiError(403, 'url_invalid');
          }
          return photo;
        });

        const key = thumbnail
          ? objectKeys.thumbnail(result.visit_id, result.hoof, result.phase, result.id)
          : result.object_key;
        const bytes = await getObject(key).catch(mapStorageError);
        if (bytes === null) throw notFound();
        return {
          kind: 'bytes' as const,
          status: 200,
          body: bytes,
          contentType: thumbnail ? 'image/jpeg' : result.content_type,
          headers: { 'cache-control': 'private, max-age=60' },
        };
      },
    });
  };

  media(false, '/media/:id');
  media(true, '/media/:id/thumb');
}

