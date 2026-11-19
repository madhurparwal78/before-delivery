import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { one, query } from './db.js';
import { errors } from './errors.js';
import { fieldMessages } from '../shared/fields.js';

let cachedSecret: Buffer | null = null;

/** The cursor signing secret lives in Postgres so every instance signs and accepts the same cursors. */
async function cursorSecret(): Promise<Buffer> {
  if (cachedSecret !== null) {
    return cachedSecret;
  }
  await query(
    'insert into app_secrets (name, value) values ($1, $2) on conflict (name) do nothing',
    ['cursor_key', randomBytes(32).toString('base64')],
  );
  const row = await one<{ value: string }>('select value from app_secrets where name = $1', ['cursor_key']);
  if (row === null) {
    throw errors.notFound();
  }
  cachedSecret = Buffer.from(row.value, 'base64');
  return cachedSecret;
}

export type CursorSurface = 'references' | 'feed';

export interface CursorPayload {
  at: string;
  id: string;
}

function sign(secret: Buffer, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest().subarray(0, 16);
}

export async function encodeCursor(
  surface: CursorSurface,
  scope: string,
  payload: CursorPayload,
): Promise<string> {
  const secret = await cursorSecret();
  const data = JSON.stringify(payload);
  const body = Buffer.from(data, 'utf8').toString('base64url');
  const signature = sign(secret, `${surface}|${scope}|${data}`).toString('base64url');
  return `${body}.${signature}`;
}

/** A cursor is bound to the surface and workspace that issued it; anything else is invalid. */
export async function decodeCursor(
  surface: CursorSurface,
  scope: string,
  cursor: string,
): Promise<CursorPayload> {
  const invalid = errors.validation({ cursor: fieldMessages.cursor });
  const [body, signature] = cursor.split('.');
  if (body === undefined || signature === undefined) {
    throw invalid;
  }
  let data: string;
  let payload: CursorPayload;
  try {
    data = Buffer.from(body, 'base64url').toString('utf8');
    payload = JSON.parse(data) as CursorPayload;
  } catch {
    throw invalid;
  }
  if (typeof payload.at !== 'string' || typeof payload.id !== 'string') {
    throw invalid;
  }
  const secret = await cursorSecret();
  const expected = sign(secret, `${surface}|${scope}|${data}`);
  const provided = Buffer.from(signature, 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw invalid;
  }
  return payload;
}
