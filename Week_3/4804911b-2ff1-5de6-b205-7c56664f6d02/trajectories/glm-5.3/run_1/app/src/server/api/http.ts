import type { IncomingMessage, ServerResponse } from 'node:http';

/** Every API error is produced in the one published error shape. */
export interface ApiError {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

export function apiError(status: number, code: string, message: string, extra?: Record<string, unknown>, headers?: Record<string, string>): ApiError {
  return { status, body: { error: code, message, ...extra }, headers };
}

export function validationError(fields: Record<string, string>, message = 'Some fields need attention.'): ApiError {
  return apiError(422, 'validation', message, { fields });
}

export class BodyLimitError extends Error {}

export async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  let overLimit = false;
  await new Promise<void>((resolve, reject) => {
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        overLimit = true;
        // keep draining so the connection closes cleanly
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve());
    req.on('error', reject);
  });
  if (overLimit) throw new BodyLimitError();
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('bad_json');
  }
}

export async function readRaw(req: IncomingMessage, maxBytes: number): Promise<{ bytes: Buffer; overLimit: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let overLimit = false;
  await new Promise<void>((resolve, reject) => {
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        overLimit = true;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve());
    req.on('error', reject);
  });
  return { bytes: Buffer.concat(chunks), overLimit };
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
    ...headers,
  });
  res.end(text);
}

/** Per-client limits: a client is the connection's source address; forwarded headers are ignored. */
export class RateLimiter {
  private windows = new Map<string, number[]>();

  constructor(private limit: number, private windowMs: number) {}

  private prune(now: number): void {
    for (const [key, times] of this.windows) {
      const kept = times.filter((t) => now - t < this.windowMs);
      if (kept.length === 0) this.windows.delete(key);
      else this.windows.set(key, kept);
    }
  }

  /** Counts a hit and returns the retry-after seconds when refused. */
  hit(key: string, now = Date.now()): number | null {
    this.prune(now);
    const times = this.windows.get(key) ?? [];
    if (times.length >= this.limit) {
      const oldest = Math.min(...times);
      const retryAfter = Math.ceil((this.windowMs - (now - oldest)) / 1000);
      return Math.max(1, Math.min(60, retryAfter));
    }
    times.push(now);
    this.windows.set(key, times);
    return null;
  }

  /** Returns the retry-after seconds when the limit would be exceeded, without counting a hit. */
  peek(key: string, now = Date.now()): number | null {
    const times = this.windows.get(key) ?? [];
    if (times.length < this.limit) return null;
    const oldest = Math.min(...times);
    const retryAfter = Math.ceil((this.windowMs - (now - oldest)) / 1000);
    return Math.max(1, Math.min(60, retryAfter));
  }
}

export function clientKey(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}

/** Deep-equality used by the preview: the preview's blocking error equals the real one. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as Record<string, unknown>).sort();
    const kb = Object.keys(b as Record<string, unknown>).sort();
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!kb.includes(k)) return false;
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
    }
    return true;
  }
  return false;
}
