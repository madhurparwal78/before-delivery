import type { Config } from './config.js';
import { healthyDatabase } from './db.js';

// HTTP kernel: same-origin enforcement, body limits, one error shape.
// The Kill Bill callback carries no browser origin and is exempt.

export const MAX_BODY_BYTES = 65536;

export class HttpError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(String(body['error'] ?? status));
  }
}

export function errorBody(code: string): Record<string, unknown> {
  return { error: code };
}

export function validationBody(errors: Record<string, string>): Record<string, unknown> {
  return { errors };
}

export interface RequestCtx {
  method: string;
  path: string;
  url: URL;
  body: unknown;
  rawBody: Buffer | null;
  headers: Record<string, string | undefined>;
  cookies: Record<string, string>;
}

export type Handler = (ctx: RequestCtx) => Promise<{ status: number; body: Record<string, unknown> | unknown[] | null }>;

export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

export async function readBody(req: Request): Promise<{ body: unknown; raw: Buffer | null; tooLarge: boolean }> {
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) return { body: null, raw: null, tooLarge: true };
  const reader = req.body?.getReader();
  if (!reader) return { body: null, raw: null, tooLarge: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let tooLarge = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      tooLarge = true;
      break;
    }
    chunks.push(value);
  }
  if (tooLarge) return { body: null, raw: null, tooLarge: true };
  const raw = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const text = raw.toString('utf8');
  if (!text) return { body: null, raw, tooLarge: false };
  try {
    return { body: JSON.parse(text), raw, tooLarge: false };
  } catch {
    return { body: null, raw, tooLarge: false };
  }
}

// Same-origin check: a state-changing request whose Origin differs from the
// Host answers 403 cross_origin.
export function crossOriginBlocked(method: string, url: URL, headers: Record<string, string | undefined>): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  const origin = headers['origin'];
  if (!origin) return false;
  if (url.pathname.startsWith('/api/killbill/notifications/')) return false;
  try {
    const originUrl = new URL(origin);
    const host = headers['host'];
    if (host && originUrl.host === host) return false;
    return true;
  } catch {
    return true;
  }
}

export async function databaseDown(config: Config): Promise<boolean> {
  return !(await healthyDatabase(config));
}
