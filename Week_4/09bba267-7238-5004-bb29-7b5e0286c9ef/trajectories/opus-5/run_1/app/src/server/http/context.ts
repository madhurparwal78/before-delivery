import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { query } from '../db';
import { type ApiResponse, error } from './respond';

export const MAX_BODY_BYTES = 16_384;
const BUYER_COOKIE = 'seatwise_buyer';
const OWNER_COOKIE = 'seatwise_owner';
const BUYER_PATTERN = /^[0-9a-f]{32}$/;

export interface RequestContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly url: URL;
  readonly body: unknown;
  readonly buyerId: string;
  readonly ownerSignedIn: boolean;
  readonly idempotencyKey: string | undefined;
  readonly cookies: string[];
  params: Record<string, string>;
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    jar.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return jar;
}

function cookieHeader(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearedCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function ownerCookie(token: string): string {
  return cookieHeader(OWNER_COOKIE, token, 60 * 60 * 24);
}

export const OWNER_COOKIE_NAME = OWNER_COOKIE;

export type BodyResult =
  { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly response: ApiResponse };

async function readBody(req: IncomingMessage): Promise<BodyResult> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
      break;
    }
    chunks.push(buffer);
  }
  if (tooLarge) {
    req.resume();
    return { ok: false, response: error(413, 'payload_too_large') };
  }
  if (size === 0) return { ok: true, body: undefined };
  const contentType = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') return { ok: false, response: error(415, 'unsupported_media_type') };
  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown };
  } catch {
    return { ok: false, response: error(400, 'bad_json') };
  }
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export type ContextResult =
  | { readonly ok: true; readonly context: RequestContext }
  | { readonly ok: false; readonly response: ApiResponse; readonly cookies: string[] };

export async function buildContext(req: IncomingMessage, res: ServerResponse): Promise<ContextResult> {
  const jar = parseCookies(req.headers.cookie);
  const existing = jar.get(BUYER_COOKIE);
  const cookies: string[] = [];
  let buyerId: string;
  if (existing !== undefined && BUYER_PATTERN.test(existing)) {
    buyerId = existing;
  } else {
    buyerId = randomBytes(16).toString('hex');
    cookies.push(cookieHeader(BUYER_COOKIE, buyerId, 60 * 60 * 24 * 365));
  }

  if (!sameOrigin(req)) return { ok: false, response: error(403, 'cross_origin'), cookies };

  const body = await readBody(req);
  if (!body.ok) return { ok: false, response: body.response, cookies };

  const ownerToken = jar.get(OWNER_COOKIE);
  let ownerSignedIn = false;
  if (ownerToken !== undefined && /^[0-9a-f]{32}$/.test(ownerToken)) {
    const sessions = await query<{ token: string }>(`select token from owner_sessions where token = $1`, [
      ownerToken,
    ]);
    ownerSignedIn = sessions.length > 0;
  }

  const rawKey = req.headers['idempotency-key'];
  return {
    ok: true,
    context: {
      req,
      res,
      method: req.method ?? 'GET',
      url: new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`),
      body: body.body,
      buyerId,
      ownerSignedIn,
      idempotencyKey: typeof rawKey === 'string' ? rawKey : undefined,
      cookies,
      params: {},
    },
  };
}
