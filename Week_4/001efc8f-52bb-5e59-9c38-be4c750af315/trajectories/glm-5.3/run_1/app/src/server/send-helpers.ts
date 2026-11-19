import type { FastifyRequest } from 'fastify';
import { ApiError, fieldCopy } from './errors';
import type { Db } from './db';
import { acceptedFields } from './routes-session';
import { photoValidationError, readPhotoHeader, type PhotoFormat } from './photos';
import { MAX_PHOTOS, MAX_PHOTO_BYTES, MAX_PHOTO_PIXELS } from '../shared/terms';

export interface SendPayload {
  client_message_id: string;
  text: string;
  thread_root_id: string | null;
  quoted_message_id: string | null;
  files: { name: string; buffer: Buffer }[];
}

const SEND_ACCEPTED = ['client_message_id', 'text', 'thread_root_id', 'quoted_message_id'];

interface UploadedPart {
  fieldname: string;
  filename: string;
  data: Buffer;
}

/** The accepted-field list for sends, in one place. */
export async function parseSendBody(request: FastifyRequest): Promise<{ payload: SendPayload; unaccepted: string[] }> {
  const contentType = request.headers['content-type'] ?? '';
  if (contentType.startsWith('multipart/form-data')) {
    const parts = request.body as unknown as UploadedPart[];
    const payload: SendPayload = { client_message_id: '', text: '', thread_root_id: null, quoted_message_id: null, files: [] };
    const unaccepted: string[] = [];
    for (const part of parts ?? []) {
      if (part.fieldname === 'file') {
        payload.files.push({ name: part.filename, buffer: part.data });
        continue;
      }
      if (!SEND_ACCEPTED.includes(part.fieldname)) {
        if (!unaccepted.includes(part.fieldname)) unaccepted.push(part.fieldname);
        continue;
      }
      const value = part.data.toString('utf8');
      if (part.fieldname === 'text') payload.text = value;
      else if (part.fieldname === 'client_message_id') payload.client_message_id = value;
      else if (part.fieldname === 'thread_root_id') payload.thread_root_id = value === '' ? null : value;
      else if (part.fieldname === 'quoted_message_id') payload.quoted_message_id = value === '' ? null : value;
    }
    return { payload, unaccepted };
  }
  const body = (request.body as Record<string, unknown> | null) ?? {};
  const unaccepted = acceptedFields(body, SEND_ACCEPTED);
  const payload: SendPayload = {
    client_message_id: typeof body.client_message_id === 'string' ? body.client_message_id : '',
    text: typeof body.text === 'string' ? body.text : '',
    thread_root_id: typeof body.thread_root_id === 'string' && body.thread_root_id !== '' ? body.thread_root_id : null,
    quoted_message_id: typeof body.quoted_message_id === 'string' && body.quoted_message_id !== '' ? body.quoted_message_id : null,
    files: [],
  };
  return { payload, unaccepted };
}

export function storedFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? '';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  const cut = cleaned.slice(0, 100);
  return cut === '' ? 'photo' : cut;
}

export interface CheckedPhoto {
  name: string;
  buffer: Buffer;
  format: PhotoFormat;
}

/**
 * The photo acceptance checks and their order (DP-15): type, size, pixels —
 * all from the header, before any oversized decode. Count first for `file` parts.
 */
export function checkPhotos(files: { name: string; buffer: Buffer }[]): CheckedPhoto[] | ApiError {
  if (files.length > MAX_PHOTOS) return photoValidationError('', 'tooMany');
  const out: CheckedPhoto[] = [];
  for (const file of files) {
    const name = storedFileName(file.name);
    const header = readPhotoHeader(file.buffer);
    if (!header) return photoValidationError(name, 'type');
    if (file.buffer.length > MAX_PHOTO_BYTES) return photoValidationError(name, 'size');
    if (header.width * header.height > MAX_PHOTO_PIXELS) return photoValidationError(name, 'pixels');
    out.push({ name, buffer: file.buffer, format: header.format });
  }
  return out;
}

export async function decodePhotos(photos: CheckedPhoto[]): Promise<ApiError | undefined> {
  for (const photo of photos) {
    try {
      const { decodeCheck } = await import('./photos');
      const ok = await decodeCheck(photo.buffer);
      if (!ok) return photoValidationError(photo.name, 'type');
    } catch {
      return photoValidationError(photo.name, 'type');
    }
  }
  return undefined;
}

/** The send-rate count and its wait (DP-62). Decided only here. */
export async function rateLimitInfo(db: Db, authorId: string, now: Date): Promise<{ count: number; waitSeconds: number }> {
  const res = await db.pool.query(
    `SELECT sent_at FROM messages
      WHERE author_id = $1 AND deleted = false AND sent_at > $2
      ORDER BY sent_at ASC`,
    [authorId, new Date(now.getTime() - 60000)],
  );
  const rows = res.rows as { sent_at: Date }[];
  const count = rows.length;
  if (count < 20) return { count, waitSeconds: 0 };
  const oldest = rows[0].sent_at;
  const wait = Math.ceil((oldest.getTime() + 60000 - now.getTime()) / 1000);
  return { count, waitSeconds: Math.max(1, wait) };
}
