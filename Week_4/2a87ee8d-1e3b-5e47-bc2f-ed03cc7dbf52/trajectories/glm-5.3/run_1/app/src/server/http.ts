/** HTTP helpers: body limits, same-origin enforcement, error responses (DP-39, DP-55). */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ERROR_MESSAGES, FIELD_MESSAGES } from './errors.js';
import type { ErrorCode } from '../domain.js';

export const JSON_BODY_LIMIT = 65536;
export const IMAGE_BODY_LIMIT = 5000000;

export class ApiError extends Error {
  status: number;
  code: ErrorCode;
  fields?: Record<string, string>;
  extra?: { limit?: number; used?: number; plan?: string };
  retryAfter?: number;
  rateHeaders?: { limit: number; remaining: number; reset: number };
  constructor(status: number, code: ErrorCode, opts: { message?: string; fields?: Record<string, string>; extra?: { limit?: number; used?: number; plan?: string }; retryAfter?: number; rateHeaders?: { limit: number; remaining: number; reset: number } } = {}) {
    super(ERROR_MESSAGES[code]);
    this.status = status;
    this.code = code;
    if (opts.message) this.message = opts.message;
    this.fields = opts.fields;
    this.extra = opts.extra;
    this.retryAfter = opts.retryAfter;
    this.rateHeaders = opts.rateHeaders;
  }
}

/** Substitute %s placeholders in a stored message template. */
export function fillMessage(message: string, ...args: (string | number)[]): string {
  let i = 0;
  return message.replace(/%s/g, () => String(args[i++]));
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  const payload = JSON.stringify(body);
  const base = {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(payload)),
    'Cache-Control': 'no-store',
    ...headers,
  };
  res.writeHead(status, base);
  res.end(payload);
}

export function sendError(res: ServerResponse, status: number, code: ErrorCode, opts: {
  message?: string; fields?: Record<string, string>; extra?: { limit?: number; used?: number; plan?: string };
  retryAfter?: number; rateHeaders?: { limit: number; remaining: number; reset: number };
} = {}): void {
  const error: Record<string, unknown> = { code, message: opts.message ?? ERROR_MESSAGES[code] };
  if (opts.fields && Object.keys(opts.fields).length > 0) error.fields = opts.fields;
  if (opts.extra) Object.assign(error, opts.extra);
  const headers: Record<string, string> = {};
  if (opts.retryAfter !== undefined) headers['Retry-After'] = String(opts.retryAfter);
  if (opts.rateHeaders) {
    headers['RateLimit-Limit'] = String(opts.rateHeaders.limit);
    headers['RateLimit-Remaining'] = String(Math.max(0, opts.rateHeaders.remaining));
    headers['RateLimit-Reset'] = String(opts.rateHeaders.reset);
  }
  sendJson(res, status, { error }, headers);
}

export function sendApiError(res: ServerResponse, err: ApiError): void {
  sendError(res, err.status, err.code, {
    message: err.message, fields: err.fields, extra: err.extra,
    retryAfter: err.retryAfter, rateHeaders: err.rateHeaders,
  });
}

export function readBody(req: IncomingMessage, limit: number): Promise<{ ok: true; buf: Buffer } | { ok: false; tooLarge: boolean; badType: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (r: { ok: true; buf: Buffer } | { ok: false; tooLarge: boolean; badType: boolean }): void => {
      if (!done) { done = true; resolve(r); }
    };
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        chunks.length = 0;
        req.removeAllListeners('data');
        finish({ ok: false, tooLarge: true, badType: false });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => finish({ ok: true, buf: Buffer.concat(chunks) }));
    req.on('error', () => finish({ ok: false, tooLarge: false, badType: false }));
  });
}

/** Same-origin check for state-changing requests (DP-39). */
export function isCrossOrigin(req: IncomingMessage, publicBaseUrl: string): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin.length === 0) return false;
  try {
    const o = new URL(origin);
    const host = req.headers.host;
    if (o.host !== host) return true;
    void publicBaseUrl;
    return false;
  } catch {
    return false;
  }
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

export function unknownKeyFields(paths: string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const p of paths) fields[p] = FIELD_MESSAGES.unknownKey;
  return fields;
}
