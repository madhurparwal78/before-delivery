import type { IncomingMessage, ServerResponse } from 'node:http';
import { messageForCode, messageForField } from './errors.js';
import { isLocale } from '../shared/domain.js';

export class ApiError extends Error {
  code: string;
  status: number;
  fields?: Record<string, string>;
  retryAfter?: number | undefined;

  constructor(status: number, code: string, opts: { fields?: Record<string, string[]>; retryAfter?: number } = {}) {
    super(code);
    this.status = status;
    this.code = code;
    if (opts.fields) {
      this.fields = {};
      for (const [field, codes] of Object.entries(opts.fields)) {
        this.fields[field] = codes[0] ?? 'invalid_field';
      }
    }
    this.retryAfter = opts.retryAfter;
  }
}

export function notFound(): ApiError {
  return new ApiError(404, 'not_found');
}

export function unauthenticated(): ApiError {
  return new ApiError(401, 'unauthenticated');
}

export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

export function errorBody(err: ApiError, locale: string): Record<string, unknown> {
  const loc = isLocale(locale) ? locale : 'en';
  const params = err.code === 'rate_limited' && err.retryAfter !== undefined ? { seconds: err.retryAfter } : {};
  const error: Record<string, unknown> = { code: err.code, message: messageForCode(err.code, loc, params) };
  const body: Record<string, unknown> = { error };
  if (err.fields) {
    const localised: Record<string, string> = {};
    for (const [field, code] of Object.entries(err.fields)) {
      localised[field] = code === 'invalid_field' ? messageForField(field, loc) : messageForCode(code, loc);
    }
    (error as Record<string, unknown>).fields = localised;
  }
  return body;
}

export function sendError(res: ServerResponse, err: ApiError, locale: string): void {
  const headers: Record<string, string | string[]> = {};
  if (err.retryAfter !== undefined) headers['retry-after'] = String(err.retryAfter);
  json(res, err.status, errorBody(err, locale), headers);
}

export async function readJsonBody(req: IncomingMessage, limit = 1_000_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new ApiError(413, 'body_too_large');
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(422, 'invalid_json', { fields: { body: ['invalid_field'] } });
  }
}
