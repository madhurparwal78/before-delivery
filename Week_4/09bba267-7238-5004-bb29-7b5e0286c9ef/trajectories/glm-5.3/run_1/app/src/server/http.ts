import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const BODY_LIMIT = 16384;

export type RequestScope = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  cookies: Record<string, string>;
  rawBody: Buffer;
  bodyJson: unknown;
  buyerId: string | null;
  buyerCookieWasFresh: boolean;
  ownerAuthed: boolean;
  setBuyerCookie: boolean;
  state: Map<string, unknown>;
};

export type Handler = (scope: RequestScope) => Promise<void>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(payload);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function newBuyerId(): string {
  return randomBytes(16).toString('hex');
}

export function newToken(prefix: string): string {
  return `${prefix}-${randomBytes(18).toString('hex')}`;
}

export function newOrderNumber(): string {
  return `SW${randomBytes(6).toString('hex').toUpperCase()}`;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function buyerCookieHeader(id: string): string {
  return `seatwise_buyer=${id}; HttpOnly; SameSite=Lax; Path=/`;
}

export function ownerCookieHeader(id: string): string {
  return `seatwise_owner=${id}; HttpOnly; SameSite=Lax; Path=/`;
}

export function nowInstant(): Date {
  return new Date();
}

export function buyerFromScope(scope: RequestScope): string {
  if (scope.buyerId) return scope.buyerId;
  const id = newBuyerId();
  scope.buyerId = id;
  scope.setBuyerCookie = true;
  return id;
}

export async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  return new Promise((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new HttpError(413, 'payload_too_large'));
        req.removeAllListeners('data');
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export type PoolOfDb = Pool;
