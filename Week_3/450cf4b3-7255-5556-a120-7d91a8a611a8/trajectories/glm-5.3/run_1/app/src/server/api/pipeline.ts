import { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, messages, Ctx } from './errors.js';
import { Deps, getSession, inReadTx } from '../store.js';

const JSON_LIMIT = 65_536;
const UPLOAD_LIMIT = 6_000_000;

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export function setSecurityHeaders(res: ServerResponse, fileRoute = false): void {
  if (fileRoute) return;
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
}

export function noStore(res: ServerResponse): void {
  res.setHeader('Cache-Control', 'no-store');
}

// The cross-site rule: state changes need the app's own origin, and the door
// list and report refuse a foreign Origin even as reads.
export function checkOrigin(req: IncomingMessage, url: URL): void {
  const method = req.method ?? 'GET';
  const origin = req.headers.origin;
  const secFetchSite = req.headers['sec-fetch-site'];
  const ownOrigin = `${url.protocol}//${req.headers.host ?? url.host}`;
  const isWrite = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
  const sensitiveRead = method === 'GET'
    && (url.pathname === '/api/door' || url.pathname === '/api/reports/daily');
  if (isWrite || sensitiveRead) {
    if (origin !== undefined) {
      if (origin === 'null' || origin !== ownOrigin) {
        throw new ApiError(403, 'cross_origin', messages.crossOrigin);
      }
    } else if (typeof secFetchSite === 'string' && secFetchSite !== 'same-origin') {
      throw new ApiError(403, 'cross_origin', messages.crossOrigin);
    }
  }
}

export function cookieToken(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'sh_session') return rest.join('=');
  }
  return null;
}

export async function readBody(req: IncomingMessage, upload: boolean): Promise<{ raw: Uint8Array; json: unknown }> {
  const limit = upload ? UPLOAD_LIMIT : JSON_LIMIT;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new ApiError(413, 'payload_too_large', messages.payloadTooLarge);
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks);
  return { raw: new Uint8Array(raw), json: null };
}

export function parseJsonBody(raw: Uint8Array | undefined, contentType: string | undefined, required: boolean): unknown {
  if (raw === undefined || raw.length === 0) {
    if (required) throw new ApiError(400, 'malformed_body', messages.malformedBody);
    return {};
  }
  const type = (contentType ?? '').split(';')[0].trim();
  if (type !== '' && type !== 'application/json') {
    throw new ApiError(415, 'unsupported_media_type', messages.unsupportedMedia);
  }
  try {
    return JSON.parse(Buffer.from(raw).toString('utf8'));
  } catch {
    throw new ApiError(400, 'malformed_body', messages.malformedBody);
  }
}

// Load the caller's session for a request, if any.
export async function loadSession(deps: Deps, token: string | null): Promise<Ctx['role'] extends never ? never : { role: Ctx['role']; userId: string; tenantId: string | null; confirmedAt: number | null; displayName: string } | null> {
  if (token === null) return null;
  return inReadTx(deps, async (tx) => {
    const session = await getSession(tx, token);
    if (session === null) return null;
    let tenantId: string | null = null;
    if (session.user.role === 'tenant') {
      const r = await tx.query<{ id: string }>('SELECT id FROM tenants WHERE user_id=$1', [session.user.id]);
      tenantId = r.rows[0]?.id ?? null;
    }
    return {
      role: session.user.role,
      userId: session.user.id,
      tenantId,
      confirmedAt: session.confirmedAt,
      displayName: session.user.display_name,
    };
  });
}

export type Session = NonNullable<Awaited<ReturnType<typeof loadSession>>>;

export function idempotencyKey(req: IncomingMessage): string | null {
  const raw = req.headers['idempotency-key'];
  if (raw === undefined) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value.length < 1 || value.length > 100) return null;
  for (const ch of value) {
    if (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) > 0x7E) return null;
  }
  return value;
}
