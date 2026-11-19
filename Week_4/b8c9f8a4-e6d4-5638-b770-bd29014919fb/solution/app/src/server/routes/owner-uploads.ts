// Uploads. The original is kept exactly as submitted; the buyer's copy is derived from it. An
// upload exists for the product only once the store has confirmed both objects and their hashes.

import { one, query } from '../db/pool.js';
import { fail } from '../http/errors.js';
import { boundaryOf, parseMultipart } from '../http/multipart.js';
import { type Context } from '../http/request.js';
import { sendBytes, sendJson } from '../http/respond.js';
import type { Router } from '../http/router.js';
import { requireOwner } from '../http/session.js';
import { Fields } from '../http/validate.js';
import { readPicture, sniff, type PlateMask } from '../services/images.js';
import { getObject, keys, StorageError } from '../services/store.js';
import { storeUpload } from '../domain/uploads.js';
import { loadCar } from '../domain/state.js';

const FILE_LIMIT = 8000000;

interface Multipart {
  fields: Record<string, string>;
  file: { name: string; bytes: Buffer; contentType: string } | null;
}

function readMultipart(context: Context): Multipart {
  const type = String(context.request.headers['content-type'] ?? '');
  const body = context.body;
  const boundary = boundaryOf(type);
  if (!type.toLowerCase().startsWith('multipart/form-data') || !boundary) {
    fail(415, 'unsupported_media_type', 'Send this as multipart/form-data.');
  }
  const found: Multipart = { fields: {}, file: null };
  for (const part of parseMultipart(body, boundary)) {
    if (part.fileName === null) found.fields[part.name] = part.bytes.toString('utf8');
    else if (!found.file) found.file = { name: part.fileName, bytes: part.bytes, contentType: part.contentType };
  }
  return found;
}

function readMask(text: string | undefined, fields: Fields): PlateMask | null {
  if (text === undefined) {
    fields.add('plateMask', 'Send the plate mask, or null for no plate in shot.');
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    fields.add('plateMask', 'Send the plate mask as JSON.');
    return null;
  }
  if (parsed === null) return null;
  const mask = parsed as Record<string, unknown>;
  const numbers = ['x', 'y', 'w', 'h'].map((name) => mask[name]);
  if (numbers.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) {
    fields.add('plateMask', 'Use fractions of the upright image from 0 to 1.');
    return null;
  }
  const [x, y, w, h] = numbers as number[];
  if (x + w > 1 || y + h > 1) {
    fields.add('plateMask', 'The mask must stay inside the image.');
    return null;
  }
  return { x, y, w, h };
}

export function registerUploads(router: Router): void {
  router.post('/api/owner/cars/:id/uploads', async (context) => {
    await requireOwner(context.request);
    const car = await loadCar(context.params.id);
    if (!car) fail(404, 'not_found', 'That car file is not one of ours.');
    const form = readMultipart(context);
    const file = form.file;
    if (!file) {
      fail(422, 'validation', 'Choose a file.', { errors: { file: 'Choose a file.' } });
    }
    if (file.bytes.length > FILE_LIMIT) fail(413, 'file_too_large', 'That file is over the size limit.');

    const kind = form.fields.kind === 'invoice' ? 'invoice' : 'photo';
    const found = sniff(file.bytes);
    const allowed = kind === 'photo' ? ['jpeg', 'png'] : ['jpeg', 'png', 'pdf'];
    if (!found || !allowed.includes(found)) {
      fail(415, 'unsupported_file', 'That file type is not accepted.');
    }
    if (found !== 'pdf' && !(await readPicture(file.bytes))) {
      fail(415, 'unsupported_file', 'That file type is not accepted.');
    }

    const fields = new Fields();
    if (/[/\\]|\.\.|\0/.test(file.name) || file.name.trim().length === 0) {
      fields.add('file', 'That file name is not allowed.');
    }
    const mask = kind === 'photo' ? readMask(form.fields.plateMask, fields) : null;
    const label = kind === 'invoice' ? fields.text('label', form.fields.label, 1, 80) : null;
    fields.done();

    const contentType = found === 'pdf' ? 'application/pdf' : `image/${found === 'jpeg' ? 'jpeg' : 'png'}`;
    try {
      const stored = await storeUpload({
        carId: car.id,
        kind,
        fileName: file.name,
        bytes: file.bytes,
        contentType,
        mask,
        label,
      });
      sendJson(context.response, 201, stored);
    } catch (error) {
      if (error instanceof StorageError) fail(503, 'storage_unavailable', 'Photo storage is not answering.');
      throw error;
    }
  });

  router.get('/api/owner/cars/:id/uploads', async (context) => {
    await requireOwner(context.request);
    const car = await loadCar(context.params.id);
    if (!car) fail(404, 'not_found', 'That car file is not one of ours.');
    const rows = await query<{
      id: string; kind: string; file_name: string; sha256: string; bytes: number; content_type: string;
      derivative_sha256: string | null; location_removed: boolean; label: string | null;
    }>('SELECT * FROM upload WHERE car_id = $1 ORDER BY created_at ASC', [car.id]);
    sendJson(context.response, 200, {
      uploads: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        status: 'stored',
        fileName: row.file_name,
        sha256: row.sha256,
        bytes: row.bytes,
        contentType: row.content_type,
        derivativeSha256: row.derivative_sha256,
        locationRemoved: row.location_removed,
        label: row.label,
      })),
    });
  });

  router.get('/api/owner/uploads/:uploadId/original', async (context) => {
    const upload = await ownerUpload(context);
    const object = await fromStore(keys.original(upload.car_id, upload.id));
    sendBytes(context.response, 200, object.body, upload.content_type);
  });

  router.get('/api/owner/uploads/:uploadId/derivative', async (context) => {
    const upload = await ownerUpload(context);
    if (upload.kind !== 'photo') fail(404, 'not_found', 'Invoices have no buyer copy.');
    const object = await fromStore(keys.derivative(upload.car_id, upload.id));
    sendBytes(context.response, 200, object.body, 'image/jpeg');
  });
}

async function ownerUpload(context: Context): Promise<{ id: string; car_id: string; kind: string; content_type: string }> {
  await requireOwner(context.request);
  const id = context.params.uploadId;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) fail(404, 'not_found', 'That file is not one of ours.');
  const row = await one<{ id: string; car_id: string; kind: string; content_type: string }>(
    'SELECT id, car_id, kind, content_type FROM upload WHERE id = $1',
    [id],
  );
  if (!row) fail(404, 'not_found', 'That file is not one of ours.');
  return row;
}

export async function fromStore(key: string): Promise<{ body: Buffer; contentType: string }> {
  try {
    const object = await getObject(key);
    if (!object) fail(404, 'not_found', 'That file is not one of ours.');
    return object;
  } catch (error) {
    if (error instanceof StorageError) fail(503, 'storage_unavailable', 'Photo storage is not answering.');
    throw error;
  }
}
