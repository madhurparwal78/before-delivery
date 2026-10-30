import type { IncomingMessage } from 'node:http';
import { baseOrigin, config } from '../config.js';
import { fail, validation } from './errors.js';

export const JSON_BODY_LIMIT = 16_384;
export const POSTCARD_BODY_LIMIT = 2_000_000;

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function normaliseOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/** The app's own origins: `<base>` and `http://` plus the request's Host header. */
export function ownOrigins(hostHeader: string | undefined): string[] {
  const origins = [baseOrigin];
  if (hostHeader) {
    const fromHost = normaliseOrigin(`http://${hostHeader}`);
    if (fromHost) origins.push(fromHost);
  }
  return origins;
}

export function refuseCrossOrigin(request: IncomingMessage): void {
  const method = request.method ?? 'GET';
  if (!STATE_CHANGING.has(method)) return;
  const origin = request.headers.origin;
  if (origin === undefined) return;
  const normalised = origin === 'null' ? null : normaliseOrigin(origin);
  if (normalised !== null && ownOrigins(request.headers.host).includes(normalised)) return;
  throw fail('cross_origin');
}

export type BodyKind = 'none' | 'json' | 'png';

export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = request.headers['content-length'];
  if (declared !== undefined && Number(declared) > limit) {
    request.resume();
    throw fail('too_large');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const part = chunk as Buffer;
    total += part.length;
    if (total > limit) {
      request.destroy();
      throw fail('too_large');
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

function mediaType(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const type = raw.split(';', 1)[0]?.trim().toLowerCase();
  return type && type.length > 0 ? type : null;
}

export function checkContentType(
  request: IncomingMessage,
  kind: BodyKind,
  bodyLength: number,
): void {
  if (kind === 'none' || bodyLength === 0) return;
  const type = mediaType(request.headers['content-type']);
  const wanted = kind === 'png' ? 'image/png' : 'application/json';
  if (type !== wanted) throw fail('unsupported_media_type');
}

/** A zero-byte body on a JSON endpoint reads as `{}`, whatever its content type. */
export function parseJsonBody(body: Buffer): unknown {
  if (body.length === 0) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw validation({ body: 'invalid' });
  }
}

export const SESSION_COOKIE = 'pm_session';
const SESSION_MAX_AGE_SECONDS = 400 * 86_400;

export function readCookie(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    if (pair.slice(0, index).trim() === name) return pair.slice(index + 1).trim();
  }
  return null;
}

export function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export const shareUrlFor = (shareToken: string): string => `${config.publicUrl}/p/${shareToken}`;
