/** Request reading and response writing: body limits, cookies and the Date header. */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { now } from '../clock';
import { config } from '../config';
import { ApiError } from '../errors';
import { FIELD_MESSAGES } from '../../shared/errors';

export const JSON_BODY_LIMIT = 16384;
export const PHOTO_BODY_LIMIT = 5000000;

export const SESSION_COOKIE = 'hw_session';

export interface Wire {
  request: IncomingMessage;
  response: ServerResponse;
  method: string;
  url: URL;
  pathname: string;
}

export function makeWire(request: IncomingMessage, response: ServerResponse): Wire {
  const host = request.headers.host ?? `127.0.0.1:${config.port}`;
  const url = new URL(request.url ?? '/', `http://${host}`);
  return {
    request,
    response,
    method: (request.method ?? 'GET').toUpperCase(),
    url,
    pathname: decodeURIComponent(url.pathname),
  };
}

function setBaseHeaders(response: ServerResponse): void {
  response.setHeader('Date', now().toUTCString());
}

export function sendJson(wire: Wire, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  setBaseHeaders(wire.response);
  wire.response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...headers,
  });
  wire.response.end(wire.method === 'HEAD' ? undefined : text);
}

export function sendEmpty(wire: Wire, status: number, headers: Record<string, string> = {}): void {
  setBaseHeaders(wire.response);
  wire.response.writeHead(status, headers);
  wire.response.end();
}

export function sendText(
  wire: Wire,
  status: number,
  body: string | Buffer,
  contentType: string,
  headers: Record<string, string> = {},
): void {
  setBaseHeaders(wire.response);
  wire.response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  wire.response.end(wire.method === 'HEAD' ? undefined : body);
}

export function sendApiError(wire: Wire, error: ApiError): void {
  const headers: Record<string, string> = {};
  if (error.retryAfterSeconds !== undefined) headers['Retry-After'] = String(error.retryAfterSeconds);
  sendJson(wire, error.status, error.body(), headers);
}

export function prepareMediaResponse(wire: Wire, head: { size: number; contentType: string; etag: string }): void {
  setBaseHeaders(wire.response);
  wire.response.writeHead(200, {
    'Content-Type': head.contentType,
    'Content-Length': head.size,
    ETag: `"${head.etag}"`,
    'Cache-Control': 'private, max-age=60',
  });
}

export function cookies(wire: Wire): Map<string, string> {
  const jar = new Map<string, string>();
  const header = wire.request.headers.cookie;
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    jar.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return jar;
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionSeconds}`;
}

export function clearedSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function clientAddress(wire: Wire): string {
  const forwarded = wire.request.headers['x-forwarded-for'];
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (header) {
    const first = header.split(',')[0]?.trim();
    if (first) return first;
  }
  return wire.request.socket.remoteAddress ?? 'unknown';
}

/** Reads the body, refusing anything over the limit before any session check. */
export async function readBody(wire: Wire, limit: number): Promise<Buffer> {
  const declared = wire.request.headers['content-length'];
  if (declared !== undefined && Number(declared) > limit) {
    wire.request.resume();
    throw new ApiError('too_large');
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of wire.request) {
    const buffer = chunk as Buffer;
    length += buffer.length;
    if (length > limit) {
      wire.request.destroy();
      throw new ApiError('too_large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export interface JsonBody {
  raw: string;
  value: Record<string, unknown>;
}

/** JSON bodies must be `application/json`; an absent body reads as `{}`. */
export async function readJsonBody(wire: Wire): Promise<JsonBody> {
  const body = await readBody(wire, JSON_BODY_LIMIT);
  if (body.length === 0) return { raw: '', value: {} };
  const contentType = (wire.request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new ApiError('unsupported_type');
  const raw = body.toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError('unsupported_type');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ApiError('unsupported_type');
  return { raw, value: parsed as Record<string, unknown> };
}

/** Writes are refused when they come from another origin. */
export function assertSameOrigin(wire: Wire): void {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(wire.method)) return;
  const origin = wire.request.headers.origin;
  if (!origin) return;
  const host = wire.request.headers.host ?? '';
  const allowed = new Set([`http://${host}`, `https://${host}`]);
  if (config.publicUrl) allowed.add(config.publicUrl.replace(/\/$/, ''));
  if (!allowed.has(origin.replace(/\/$/, ''))) throw new ApiError('cross_origin');
}

const MAX_SAFE = 9007199254740991;

/**
 * Finds a top-level field's raw JSON token, so integer fields can be judged on
 * the request text before anything is parsed as a number.
 */
export function rawFieldToken(raw: string, field: string): string | null {
  let depth = 0;
  let index = 0;
  let pendingKey: string | null = null;
  while (index < raw.length) {
    const character = raw[index];
    if (character === '"') {
      let end = index + 1;
      while (end < raw.length) {
        if (raw[end] === '\\') {
          end += 2;
          continue;
        }
        if (raw[end] === '"') break;
        end += 1;
      }
      const text = raw.slice(index + 1, end);
      index = end + 1;
      while (index < raw.length && /\s/.test(raw[index])) index += 1;
      if (depth === 1 && raw[index] === ':') {
        pendingKey = text;
        index += 1;
        while (index < raw.length && /\s/.test(raw[index])) index += 1;
        const start = index;
        let valueDepth = 0;
        while (index < raw.length) {
          const value = raw[index];
          if (value === '"') {
            index += 1;
            while (index < raw.length && raw[index] !== '"') index += raw[index] === '\\' ? 2 : 1;
          } else if (value === '{' || value === '[') {
            valueDepth += 1;
          } else if (value === '}' || value === ']') {
            if (valueDepth === 0) break;
            valueDepth -= 1;
          } else if (value === ',' && valueDepth === 0) {
            break;
          }
          index += 1;
        }
        if (pendingKey === field) return raw.slice(start, index).trim();
      }
      continue;
    }
    if (character === '{' || character === '[') depth += 1;
    if (character === '}' || character === ']') depth -= 1;
    index += 1;
  }
  return null;
}

export interface IntegerFieldRules {
  field: string;
  message: string;
  min: number;
  max?: number;
}

/** Accepts only a plain JSON integer literal inside the safe-integer range. */
export function readIntegerField(body: JsonBody, rules: IntegerFieldRules): number {
  const token = rawFieldToken(body.raw, rules.field);
  const fail = (): never => {
    throw new ApiError('invalid', { fields: { [rules.field]: rules.message } });
  };
  if (token === null || !/^[0-9]+$/.test(token)) return fail();
  const value = Number(token);
  if (!Number.isSafeInteger(value) || value > MAX_SAFE) return fail();
  if (value < rules.min || (rules.max !== undefined && value > rules.max)) return fail();
  return value;
}

export function readIdempotencyKey(wire: Wire): string | null {
  const header = wire.request.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) return null;
  return value;
}

export function assertIdempotencyKeyShape(key: string): void {
  if (key.length < 1 || key.length > 100 || !/^[\x21-\x7e]+$/.test(key)) {
    throw new ApiError('invalid', { fields: { idempotencyKey: FIELD_MESSAGES.idempotencyKey } });
  }
}
