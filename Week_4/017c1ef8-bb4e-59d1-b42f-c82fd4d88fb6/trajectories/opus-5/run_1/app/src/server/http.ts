import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { businessNow } from './clock';
import { JSON_BODY_LIMIT } from './config';
import { query } from './db';
import {
  ApiError,
  crossOrigin,
  idempotencyKeyReused,
  payloadTooLarge,
  unauthenticated,
  unsupportedMediaType,
} from './errors';

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  search: URLSearchParams;
  memberId: string | null;
  body: unknown;
  rawBody: Buffer;
};

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(payloadTooLarge());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const split = part.indexOf('=');
    if (split === -1) continue;
    out[part.slice(0, split).trim()] = decodeURIComponent(part.slice(split + 1).trim());
  }
  return out;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function checkOrigin(req: IncomingMessage): void {
  if (!WRITE_METHODS.has(req.method ?? '')) return;
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return;
  const host = req.headers.host ?? '';
  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    throw crossOrigin();
  }
  if (originHost !== host) throw crossOrigin();
}

export function requireJsonContentType(req: IncomingMessage): void {
  if (!WRITE_METHODS.has(req.method ?? '')) return;
  const length = Number(req.headers['content-length'] ?? '0');
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (length === 0 && type === '') return;
  if (type !== 'application/json') throw unsupportedMediaType();
}

export function requireMember(ctx: Ctx): string {
  if (!ctx.memberId) throw unauthenticated();
  return ctx.memberId;
}

export function jsonBody(ctx: Ctx): Record<string, unknown> {
  if (ctx.rawBody.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(ctx.rawBody.toString('utf8'));
  } catch {
    throw unsupportedMediaType();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw unsupportedMediaType();
  }
  return parsed as Record<string, unknown>;
}

export { JSON_BODY_LIMIT };

const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * An Idempotency-Key replay returns its stored status and body before any state
 * check; the same key with a different body is refused.
 */
export async function withIdempotency(
  ctx: Ctx,
  memberId: string,
  route: string,
  run: () => Promise<{ status: number; body: unknown }>,
): Promise<{ status: number; body: unknown }> {
  const key = ctx.req.headers['idempotency-key'];
  if (typeof key !== 'string' || key === '') return run();
  const hash = createHash('sha256').update(ctx.rawBody).digest('hex');
  const stored = await query<{ request_hash: string; status: number; body: unknown; created_at: Date }>(
    'SELECT request_hash, status, body, created_at FROM idempotency_keys WHERE member_id = $1 AND route = $2 AND key = $3',
    [memberId, route, key],
  );
  const found = stored[0];
  if (found) {
    const fresh = businessNow().getTime() - found.created_at.getTime() < IDEMPOTENCY_WINDOW_MS;
    if (fresh) {
      if (found.request_hash !== hash) throw idempotencyKeyReused();
      return { status: found.status, body: found.body };
    }
    await query('DELETE FROM idempotency_keys WHERE member_id = $1 AND route = $2 AND key = $3', [
      memberId,
      route,
      key,
    ]);
  }
  const result = await run();
  await query(
    `INSERT INTO idempotency_keys (member_id, route, key, request_hash, status, body, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (member_id, route, key) DO NOTHING`,
    [memberId, route, key, hash, result.status, JSON.stringify(result.body), businessNow()],
  );
  return result;
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
