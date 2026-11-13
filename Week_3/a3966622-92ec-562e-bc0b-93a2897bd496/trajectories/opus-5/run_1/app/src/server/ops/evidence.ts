import { createHash } from 'node:crypto';
import { DEFECT_CODES } from '../../domain/defects.ts';
import { ladderReportAllowed, refusalAllowed } from '../../domain/moves.ts';
import { formatInstantSeconds } from '../../domain/porttime.ts';
import type { App } from '../app.ts';
import { recordBillingEvent } from '../charges.ts';
import { ApiError, conflict, forbidden, invalid, notFound } from '../errors.ts';
import { ladderNotice, type NoticeFactory } from '../notices.ts';
import type { LadderReportRecord, MoveRecord, UserRecord, VesselRecord } from '../store/types.ts';
import { canReadMove, isAssignedPilot, reportView } from '../views.ts';
import type { ActionResult } from './moves.ts';
import { asRecord } from './validate.ts';

export const PHOTO_LIMIT_BYTES = 5_000_000;
export const CARD_LIMIT_BYTES = 10_000_000;

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function unsupportedType(): ApiError {
  return new ApiError(415, 'unsupported_media_type', 'Unsupported content type');
}

export function contentMismatch(): ApiError {
  return new ApiError(415, 'unsupported_media_type', 'File content does not match its type');
}

export function storageUnavailable(): ApiError {
  return new ApiError(503, 'storage_unavailable', 'Evidence store unreachable');
}

export function payloadTooLarge(): ApiError {
  return new ApiError(413, 'payload_too_large', 'That file is larger than the limit');
}

/** A photo body must start with the signature of its declared type. */
function signatureMatches(contentType: string, body: Buffer): boolean {
  switch (contentType) {
    case 'image/jpeg':
      return body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
    case 'image/png':
      return body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return (
        body.length >= 12 &&
        body.subarray(0, 4).toString('ascii') === 'RIFF' &&
        body.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    default:
      return false;
  }
}

/** The size limit answers before the declared type, and before the body is read in full. */
export function storagePhotoLimits(contentLength: string | undefined): void {
  if (Number(contentLength ?? '0') > PHOTO_LIMIT_BYTES) throw payloadTooLarge();
}

export function declaredPhotoType(header: string | undefined): string {
  const declared = (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!PHOTO_TYPES.includes(declared)) throw unsupportedType();
  return declared;
}

export function declaredPdfType(header: string | undefined): string {
  const declared = (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (declared !== 'application/pdf') throw unsupportedType();
  return declared;
}

export async function storePhoto(
  app: App,
  user: UserRecord,
  move: MoveRecord,
  contentType: string,
  body: Buffer,
): Promise<ActionResult> {
  if (user.role !== 'dispatcher' && !isAssignedPilot(user, move)) throw forbidden();
  if (body.length === 0) throw invalid({ body: 'The photo body is empty' });
  if (!signatureMatches(contentType, body)) throw contentMismatch();
  const photoId = app.store.mutate(() => app.store.nextId('photo', 'PHO'));
  const key = `ladder-photos/${photoId}`;
  const sha256 = createHash('sha256').update(body).digest('hex');
  try {
    await app.objectStore.put(key, body, contentType);
  } catch {
    throw storageUnavailable();
  }
  app.store.mutate((state) => {
    state.photos.push({
      id: photoId,
      move_ref: move.ref,
      agency_code: move.agency_code,
      uploaded_by: user.id,
      sha256,
      size_bytes: body.length,
      content_type: contentType,
      key,
    });
  });
  return {
    status: 201,
    json: { photo_id: photoId, sha256, size_bytes: body.length, key },
  };
}

export async function storePilotCard(
  app: App,
  user: UserRecord,
  vessel: VesselRecord,
  body: Buffer,
): Promise<ActionResult> {
  if (user.role !== 'dispatcher' && user.role !== 'agent') throw forbidden();
  if (body.length === 0) throw invalid({ body: 'The pilot card body is empty' });
  if (body.subarray(0, 5).toString('ascii') !== '%PDF-') throw contentMismatch();
  const cardId = app.store.mutate(() => app.store.nextId('card', 'PC'));
  const key = `pilot-cards/${vessel.id}/${cardId}.pdf`;
  const sha256 = createHash('sha256').update(body).digest('hex');
  try {
    await app.objectStore.put(key, body, 'application/pdf');
  } catch {
    throw storageUnavailable();
  }
  app.store.mutate((state) => {
    state.pilot_cards.push({
      card_id: cardId,
      vessel_id: vessel.id,
      sha256,
      size_bytes: body.length,
      key,
      uploaded_at: formatInstantSeconds(Date.now()),
    });
  });
  return { status: 201, json: { card_id: cardId, sha256, size_bytes: body.length, key } };
}

export function canReadPhoto(app: App, user: UserRecord, photoId: string): boolean {
  const state = app.store.read();
  const photo = state.photos.find((entry) => entry.id === photoId);
  if (photo === undefined) return false;
  if (photo.uploaded_by === user.id) return true;
  const claiming = state.ladder_reports.filter((report) => report.photo_ids.includes(photoId));
  return claiming.some((report) => {
    const move = state.moves.find((entry) => entry.ref === report.move_ref);
    return move !== undefined && canReadMove(user, move);
  });
}

export function fileLadderReport(
  app: App,
  user: UserRecord,
  move: MoveRecord,
  body: unknown,
): ActionResult {
  if (user.role !== 'dispatcher' && !isAssignedPilot(user, move)) throw forbidden();
  const now = Date.now();
  const state = app.store.read();
  const fields = asRecord(body);
  if (!ladderReportAllowed(move.status)) {
    throw conflict('illegal_transition', 'A ladder report is filed from the ladder');
  }
  const compliant = fields.compliant;
  if (typeof compliant !== 'boolean') {
    throw invalid({ compliant: 'Record the ladder as compliant or non-compliant' });
  }
  const rawDefects = fields.defects ?? [];
  if (!Array.isArray(rawDefects) || rawDefects.some((code) => typeof code !== 'string')) {
    throw invalid({ defects: 'Defect codes are required' });
  }
  const defects = rawDefects as string[];
  const unknown = defects.find((code) => !DEFECT_CODES.includes(code));
  if (unknown !== undefined) throw invalid({ defects: `${unknown} is not a defect code` });
  const refuse = fields.refuse_boarding === true;
  const location = fields.location ?? 'deck';
  if (location !== 'deck' && location !== 'pilot_boat') {
    throw invalid({ location: 'Filed from the deck or the pilot boat' });
  }
  const note = typeof fields.note === 'string' ? fields.note : '';
  const rawPhotos = fields.photo_ids ?? [];
  if (!Array.isArray(rawPhotos) || rawPhotos.some((id) => typeof id !== 'string')) {
    throw invalid({ photo_ids: 'Photo ids are required' });
  }
  const photoIds = rawPhotos as string[];
  for (const photoId of photoIds) {
    const photo = state.photos.find((entry) => entry.id === photoId);
    if (photo === undefined || photo.move_ref !== move.ref) throw notFound();
  }
  if (!compliant && defects.length === 0) {
    throw invalid({ defects: 'A non-compliant ladder needs at least one defect' });
  }
  if (compliant && defects.length > 0) {
    throw invalid({ defects: 'A compliant ladder records no defects' });
  }
  if (compliant && refuse) {
    throw invalid({ refuse_boarding: 'Boarding is refused only on a non-compliant ladder' });
  }
  if (refuse && !refusalAllowed(move.status)) {
    throw invalid({ refuse_boarding: 'Boarding is refused while the pilot is away' });
  }

  const report = app.store.mutate((): LadderReportRecord => {
    const record: LadderReportRecord = {
      id: app.store.nextId('report', 'LR'),
      move_ref: move.ref,
      compliant,
      defects: [...defects],
      refused: refuse,
      location,
      note,
      photo_ids: [...photoIds],
      filed_by: user.name,
      filed_at: formatInstantSeconds(now),
    };
    state.ladder_reports.push(record);
    move.ladder_report_ids.push(record.id);
    const factory: NoticeFactory = {
      state,
      move,
      now,
      nextId: (counter, prefix) => app.store.nextId(counter, prefix),
    };
    if (refuse) {
      move.status = 'Refused at ladder';
      if (move.duty !== null) move.duty = { ...move.duty, end_at: formatInstantSeconds(now) };
      move.pilot_id = null;
      move.version += 1;
      move.history.push({ at: formatInstantSeconds(now), status: move.status, by: user.name });
      recordBillingEvent({
        state,
        move,
        kind: 'Refused at ladder',
        now,
        detentionUnitSeconds: app.config.detentionUnitSeconds,
        nextId: (counter, prefix) => app.store.nextId(counter, prefix),
      });
    }
    if (!compliant) {
      const checksums = record.photo_ids.map(
        (id) => state.photos.find((entry) => entry.id === id)?.sha256 ?? '',
      );
      ladderNotice(factory, record, checksums);
    }
    return record;
  });
  void app.steps.runPending();
  return { status: 201, json: reportView(app.store.read(), report) };
}
