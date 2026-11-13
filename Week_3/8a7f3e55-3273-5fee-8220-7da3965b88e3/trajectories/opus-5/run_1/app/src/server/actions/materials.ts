import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SessionUser } from '../../shared/api.js';
import { withTransaction } from '../db/pool.js';
import {
  MAX_FILES_PER_BOOKING,
  UPLOAD_LIMIT_BYTES,
  prepAccessGraceMinutes,
  prepLinkTtlSeconds,
} from '../domain/agency.js';
import { detectFileKind } from '../domain/file-kind.js';
import { displayNameFromUpload } from '../domain/prep-names.js';
import { addMinutes, agencyIso } from '../domain/time.js';
import { apiError, FIELD_MESSAGES, invalidTransition, validationError } from '../http/errors.js';
import type { FilePart } from '../http/multipart.js';
import { deleteObject, putObject, StorageUnavailable } from '../services/s3.js';
import { loadBooking, type BookingRecord, type MaterialRecord } from '../store/bookings.js';
import { query, queryOne } from '../db/pool.js';
import { lockBooking } from './common.js';

export async function uploadMaterial(
  bookingId: string,
  part: FilePart | undefined,
): Promise<MaterialRecord> {
  if (!part || part.bytes.length === 0) {
    throw validationError({ file: FIELD_MESSAGES.file_missing });
  }
  if (part.bytes.length > UPLOAD_LIMIT_BYTES) throw apiError('payload_too_large');
  const kind = detectFileKind(part.bytes);
  if (kind === null) throw apiError('unsupported_type');

  const name = displayNameFromUpload(part.fileName);
  const sha256 = createHash('sha256').update(part.bytes).digest('hex');

  return withTransaction(async (client) => {
    const booking = await lockBooking(client, bookingId);
    if (!booking) throw apiError('not_found');
    if (booking.materials.length >= MAX_FILES_PER_BOOKING) {
      throw validationError({ file: FIELD_MESSAGES.file_booking_full });
    }
    if (['cancelled', 'cancelled_late', 'completed'].includes(booking.status)) {
      throw invalidTransition(booking.status);
    }
    const id = randomUUID();
    const objectKey = `prep/${bookingId}/${randomBytes(16).toString('hex')}`;
    try {
      await putObject(objectKey, part.bytes, kind);
    } catch (cause) {
      if (cause instanceof StorageUnavailable) throw apiError('storage_unavailable');
      throw cause;
    }
    try {
      const inserted = await client.query<MaterialRecord>(
        `INSERT INTO materials (id, booking_id, name, size_bytes, content_type, sha256, object_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, size_bytes, content_type, sha256, object_key, uploaded_at`,
        [id, bookingId, name, part.bytes.length, kind, sha256, objectKey],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error('Material record was not written');
      return row;
    } catch (cause) {
      await deleteObject(objectKey);
      throw cause;
    }
  });
}

function assignmentEnd(booking: BookingRecord): Date {
  return booking.completed_at ?? addMinutes(booking.start_at, booking.duration_minutes);
}

/** Prep access follows the seat: it ends on release, on cancellation and after the grace period. */
export function prepAccessOpen(
  booking: BookingRecord,
  interpreterId: string,
  now: Date,
): boolean {
  if (!booking.seats.some((seat) => seat.holder?.id === interpreterId)) return false;
  if (booking.status === 'cancelled' || booking.status === 'cancelled_late') return false;
  const until = addMinutes(assignmentEnd(booking), prepAccessGraceMinutes());
  return now.getTime() <= until.getTime();
}

export interface PrepLink {
  url: string;
  expires_at: string;
}

export async function issuePrepLink(
  actor: SessionUser,
  booking: BookingRecord,
  materialId: string,
  now: Date,
): Promise<PrepLink> {
  const material = booking.materials.find((entry) => entry.id === materialId);
  if (!material) throw apiError('not_found');
  if (!prepAccessOpen(booking, actor.id, now)) throw apiError('access_ended');
  const token = randomBytes(24).toString('hex');
  const expiresAt = new Date(now.getTime() + prepLinkTtlSeconds() * 1000);
  await query(
    'INSERT INTO prep_links (token, material_id, booking_id, interpreter_id, expires_at) VALUES ($1, $2, $3, $4, $5)',
    [token, materialId, booking.id, actor.id, expiresAt],
  );
  return { url: `/api/prep/${token}`, expires_at: agencyIso(expiresAt) };
}

export interface ResolvedLink {
  material: MaterialRecord;
  expiresAt: Date;
}

export async function resolvePrepLink(
  actor: SessionUser,
  token: string,
  now: Date,
): Promise<ResolvedLink> {
  const row = await queryOne<{
    material_id: string;
    booking_id: string;
    interpreter_id: string;
    expires_at: string;
  }>(
    'SELECT material_id, booking_id, interpreter_id, expires_at FROM prep_links WHERE token = $1',
    [token],
  );
  if (!row || row.interpreter_id !== actor.id) throw apiError('not_found');
  const booking = await loadBooking(row.booking_id);
  if (!booking) throw apiError('not_found');
  const material = booking.materials.find((entry) => entry.id === row.material_id);
  if (!material) throw apiError('not_found');
  if (!prepAccessOpen(booking, actor.id, now)) throw apiError('access_ended');
  const expiresAt = new Date(row.expires_at);
  if (now.getTime() > expiresAt.getTime()) throw apiError('link_expired');
  return { material, expiresAt };
}
