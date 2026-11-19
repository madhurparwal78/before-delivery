// Storing a file: the original exactly as submitted, the buyer's copy derived from it, both
// confirmed by the store before any record of the upload exists.

import { createHash, randomUUID } from 'node:crypto';
import { query } from '../db/pool.js';
import { hasLocation, makeDerivative, type PlateMask } from '../services/images.js';
import { deleteObject, keys, putObject } from '../services/store.js';

interface StoredUpload {
  id: string;
  kind: 'photo' | 'invoice';
  status: 'stored';
  fileName: string;
  sha256: string;
  bytes: number;
  contentType: string;
  derivativeSha256: string | null;
  locationRemoved: boolean;
  label: string | null;
}

export async function storeUpload(input: {
  carId: string;
  kind: 'photo' | 'invoice';
  fileName: string;
  bytes: Buffer;
  contentType: string;
  mask: PlateMask | null;
  label: string | null;
  /** Seeded rows pass a stable id; every real upload gets a fresh one. */
  id?: string;
}): Promise<StoredUpload> {
  const id = input.id ?? randomUUID();
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  let derivativeSha256: string | null = null;
  let storedOriginal = false;
  try {
    await putObject(keys.original(input.carId, id), input.bytes, input.contentType);
    storedOriginal = true;
    if (input.kind === 'photo') {
      const derivative = await makeDerivative(input.bytes, input.mask);
      derivativeSha256 = createHash('sha256').update(derivative).digest('hex');
      await putObject(keys.derivative(input.carId, id), derivative, 'image/jpeg');
    }
  } catch (error) {
    if (storedOriginal) await deleteObject(keys.original(input.carId, id)).catch(() => undefined);
    throw error;
  }
  const locationRemoved = input.kind === 'photo' && hasLocation(input.bytes);
  await query(
    `INSERT INTO upload (id, car_id, kind, file_name, sha256, bytes, content_type, derivative_sha256,
       location_removed, label) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, input.carId, input.kind, input.fileName, sha256, input.bytes.length, input.contentType,
      derivativeSha256, locationRemoved, input.label],
  );
  return {
    id,
    kind: input.kind,
    status: 'stored',
    fileName: input.fileName,
    sha256,
    bytes: input.bytes.length,
    contentType: input.contentType,
    derivativeSha256,
    locationRemoved,
    label: input.label,
  };
}
