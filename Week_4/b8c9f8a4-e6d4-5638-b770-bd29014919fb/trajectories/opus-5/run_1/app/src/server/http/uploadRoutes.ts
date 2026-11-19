import type { Request, Response } from 'express';
import { ERRORS } from '../../shared/copy';
import { listingClosed, notFound, refuse, validationFailure } from '../domain/errors';
import { acceptsCarChanges } from '../domain/listing';
import { FILE_LIMIT_BYTES, type PlateMask } from '../services/images';
import { listUploads, storeUpload } from '../services/uploads';
import { findCarRow } from '../repo/cars';
import { parseMultipart } from './multipart';

const refuseMask = (): never => {
  throw validationFailure({ plateMask: ERRORS.maskMissing });
};

/** Mask values are fractions of the upright image, with x + w and y + h at most 1. */
const readPlateMask = (raw: string | undefined): PlateMask | null => {
  if (raw === undefined) refuseMask();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw as string) as unknown;
  } catch {
    return refuseMask();
  }
  if (parsed === null) return null;
  if (typeof parsed !== 'object' || Array.isArray(parsed)) refuseMask();

  const record = parsed as Record<string, unknown>;
  const numbers: Record<string, number> = {};
  for (const key of ['x', 'y', 'w', 'h']) {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) refuseMask();
    numbers[key] = value as number;
  }
  if (numbers.x + numbers.w > 1 || numbers.y + numbers.h > 1 || numbers.w === 0 || numbers.h === 0) refuseMask();
  return { x: numbers.x, y: numbers.y, w: numbers.w, h: numbers.h };
};

export const uploadRoute = async (request: Request, response: Response): Promise<void> => {
  const car = await findCarRow(String(request.params.id));
  if (car === null) throw notFound();

  const parsed = await parseMultipart(request);
  if (parsed.file === null) throw validationFailure({ file: 'Choose a file' });
  if (parsed.file.bytes.length > FILE_LIMIT_BYTES) {
    throw refuse(413, 'file_too_large', 'This file is over the size limit');
  }

  const kind = parsed.fields.get('kind');
  if (kind !== 'photo' && kind !== 'invoice') throw validationFailure({ kind: 'Choose photo or invoice' });
  if (!acceptsCarChanges(car.listing_status)) throw listingClosed();

  const mask = kind === 'photo' ? readPlateMask(parsed.fields.get('plateMask')) : null;
  let label: string | null = null;
  if (kind === 'invoice') {
    const value = parsed.fields.get('label');
    if (value === undefined || value.length < 1 || value.length > 80) {
      throw validationFailure({ label: 'Enter between 1 and 80 characters' });
    }
    label = value;
  }

  response.status(201).json(
    await storeUpload({
      carId: car.id,
      kind,
      fileName: parsed.file.fileName,
      bytes: parsed.file.bytes,
      mask,
      label,
    }),
  );
};

export const uploadsListRoute = async (request: Request, response: Response): Promise<void> => {
  const car = await findCarRow(String(request.params.id));
  if (car === null) throw notFound();
  response.json({ uploads: await listUploads(car.id) });
};
