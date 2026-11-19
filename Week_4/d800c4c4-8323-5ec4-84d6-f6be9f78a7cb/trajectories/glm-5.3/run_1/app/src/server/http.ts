// HTTP plumbing: same-origin enforcement, body limits, content type, JSON parsing.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, COPY, sendJson, tooLarge, photoTooLarge } from './errors';

export const JSON_BODY_LIMIT = 100_000;
export const MULTIPART_BODY_LIMIT = 5_100_000;
export const PHOTO_LIMIT = 5_000_000;

export interface RequestBody {
  raw: Buffer;
  contentType: string;
}

export function ownOrigin(req: IncomingMessage): string {
  const host = req.headers.host ?? '';
  return `http://${host}`;
}

/** A cross-site write: Origin header present and differing from the own origin. */
export function isCrossSiteWrite(req: IncomingMessage): boolean {
  if (req.method === undefined || req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return false;
  const origin = req.headers.origin;
  if (origin === undefined || origin === '') return false;
  const host = req.headers.host ?? '';
  try {
    const parsed = new URL(origin);
    // Compare host+port, allowing http/https scheme either way.
    return parsed.host !== host;
  } catch {
    return true;
  }
}

/** Read the body up to the limit; over the limit answers 413 with the matching copy. */
export function readBody(req: IncomingMessage, limit: number, photo: boolean): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? '0');
    if (Number.isFinite(declared) && declared > limit) {
      reject(photo ? photoTooLarge() : tooLarge());
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(photo ? photoTooLarge() : tooLarge());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(err));
  });
}

/** Whether the request carries a body. */
export function hasBody(req: IncomingMessage): boolean {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (declared > 0) return true;
  const transfer = (req.headers['transfer-encoding'] ?? '').toLowerCase();
  return transfer.includes('chunked');
}

/** JSON endpoints answer 415 for any content type other than application/json. */
export function checkJsonContentType(req: IncomingMessage): void {
  if (!hasBody(req)) return;
  const contentType = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (contentType !== 'application/json') throw sendJson();
}

export function checkMultipartContentType(req: IncomingMessage): void {
  if (!hasBody(req)) return;
  const contentType = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (contentType !== 'multipart/form-data') throw sendJson();
}

export function parseJson<T>(raw: Buffer): T | null {
  if (raw.length === 0) return null;
  const text = raw.toString('utf8');
  if (!text.startsWith('{') && !text.startsWith('[')) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Parse a whole-number id from a path segment. */
export function wholeId(segment: string | undefined): number | null {
  if (segment === undefined || segment === '') return null;
  if (!/^\d+$/.test(segment)) return null;
  const value = Number(segment);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export interface QueryParams {
  get(name: string): string | undefined;
}

export function parseQuery(url: string): URLSearchParams {
  const queryStart = url.indexOf('?');
  return new URLSearchParams(queryStart === -1 ? '' : url.slice(queryStart + 1));
}

export function sendJsonResponse(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.length),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof ApiError) {
    sendJsonResponse(res, err.status, err.body());
    return;
  }
  sendJsonResponse(res, 500, { error: 'Something went wrong.' });
}

/** Extract ids that are whole numbers from a JSON body, used by the precedence's "look inside the body" step. */
export function bodyIdsWithinLimit(raw: Buffer, limit: number): boolean {
  return raw.length <= limit;
}

export { COPY };
