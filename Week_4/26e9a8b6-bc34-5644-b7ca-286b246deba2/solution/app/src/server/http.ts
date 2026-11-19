import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, bodyTooLarge, invalid, tooLong, unprocessable } from './errors';
import { codePointLength, holdsNul, jsonNestsDeeperThan } from '../shared/text';
import type { User } from '../shared/types';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  user: User | null;
  ip: string;
  json(): Promise<Record<string, unknown>>;
  raw(): Promise<Buffer>;
}

/** A non-JSON answer (a model file, an image, a page). */
export class RawBody {
  constructor(readonly bytes: Buffer, readonly type: string, readonly headers: Record<string, string> = {}, readonly status = 200) {}
}

export type Handler = (ctx: Ctx) => Promise<unknown>;

export interface Route {
  method: string;
  path: string;
  body?: 'json' | 'binary';
  /** Answer status for a successful call; the handler's return value is the JSON body (undefined sends no body). */
  status?: number;
  handler: Handler;
}

const MAX_JSON_DEPTH = 32;

/** Reads the request body once, up to `limit` bytes; the overflow is recorded and refused only when the handler asks. */
export function bodyReader(req: IncomingMessage, limit: number): () => Promise<Buffer> {
  let pending: Promise<{ bytes: Buffer; over: boolean }> | undefined;
  const read = () =>
    (pending ??= new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let over = false;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) over = true;
        else chunks.push(chunk);
      });
      req.on('end', () => resolve({ bytes: Buffer.concat(chunks), over }));
      req.on('error', reject);
    }));
  return async () => {
    const { bytes, over } = await read();
    if (over) throw bodyTooLarge(limit);
    return bytes;
  };
}

export function jsonReader(raw: () => Promise<Buffer>): () => Promise<Record<string, unknown>> {
  return async () => {
    const bytes = await raw();
    if (bytes.length === 0) return {};
    const text = bytes.toString('utf8');
    if (jsonNestsDeeperThan(text, MAX_JSON_DEPTH)) throw unprocessable('too_deep');
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw invalid('body');
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value) || holdsNul(value)) throw invalid('body');
    return value as Record<string, unknown>;
  };
}

export function sendJson(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  if (body === undefined) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), ...headers });
  res.end(payload);
}

export function respondError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, error.body, error.headers);
}

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split('/');
  const have = path.split('/');
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const piece = want[i]!;
    if (piece.startsWith(':')) params[piece.slice(1)] = decodeURIComponent(have[i]!);
    else if (piece !== have[i]) return null;
  }
  return params;
}

export const SESSION_COOKIE = 'pw_session';

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export function framingHeaders(embed: boolean): Record<string, string> {
  return { 'Content-Security-Policy': embed ? 'frame-ancestors *' : "frame-ancestors 'self'" };
}

export function requiredText(body: Record<string, unknown>, field: string, max: number, min = 1): string {
  const value = body[field];
  if (typeof value !== 'string') throw invalid(field);
  const length = codePointLength(value);
  if (length < min) throw invalid(field);
  if (length > max) throw tooLong(field, max);
  return value;
}

