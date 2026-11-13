/** Request plumbing: parsing, cookies, origin, session, role and the error precedence. */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ACCESS_COOKIE, PENDING_COOKIE } from '../config.js';
import { ApiError, forbidden, notFound, signedOut } from './errors.js';
import { enforceRateLimit, type RateBucket } from './ratelimit.js';
import { resolveAccess, type SessionAccount } from '../sessions.js';
import { one } from '../db.js';
import type { Role } from '../../shared/types.js';

export const JSON_BODY_LIMIT = 65_536;
export const MULTIPART_BODY_LIMIT = 5_300_000;

export type UploadedFile = { filename: string; bytes: Buffer };

export type PendingSignin = {
  id: string;
  purpose: 'signin' | 'signup';
  identifier: string;
  accountId: string | null;
};

export type Ctx = {
  method: string;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
  rawBody: Buffer;
  file: UploadedFile | null;
  cookies: Record<string, string>;
  account: SessionAccount | null;
  pending: PendingSignin | null;
  ip: string;
  setCookie: (name: string, value: string, maxAgeSeconds: number) => void;
  clearCookie: (name: string) => void;
  responseHeaders: Record<string, string>;
};

export type Reply =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'empty'; status: number }
  | { kind: 'pdf'; body: Buffer; filename: string };

export const json = (body: unknown, status = 200): Reply => ({ kind: 'json', status, body });
export const empty = (status = 204): Reply => ({ kind: 'empty', status });
export const pdf = (body: Buffer, filename: string): Reply => ({ kind: 'pdf', body, filename });

export type RouteAuth = 'public' | 'pending' | 'shopper' | 'seller' | 'support' | 'signed_in';

export type Route = {
  method: string;
  pattern: string;
  auth: RouteAuth;
  rate?: RateBucket;
  upload?: boolean;
  exactKeys?: boolean;
  handler: (ctx: Ctx) => Promise<Reply>;
};

const routes: Route[] = [];

export function route(
  method: string,
  pattern: string,
  auth: RouteAuth,
  handler: (ctx: Ctx) => Promise<Reply>,
  options: { rate?: RateBucket; upload?: boolean; exactKeys?: boolean } = {},
): void {
  routes.push({ method, pattern, auth, handler, ...options });
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index];
    const actual = pathParts[index];
    if (expected.startsWith(':')) {
      if (actual === '') return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer | 'too_large'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    request.on('data', (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > limit) {
        aborted = true;
        chunks.length = 0;
        resolve('too_large');
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks));
    });
    request.on('error', (error) => {
      if (!aborted) reject(error);
    });
  });
}

function parseMultipart(body: Buffer, contentType: string): UploadedFile | null {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (boundaryMatch === null) return null;
  const boundary = `--${boundaryMatch[1] ?? boundaryMatch[2]}`;
  const separator = Buffer.from(`\r\n${boundary}`);
  const start = body.indexOf(Buffer.from(`${boundary}\r\n`));
  if (start < 0) return null;
  let cursor = start + boundary.length + 2;
  for (;;) {
    const next = body.indexOf(separator, cursor);
    if (next < 0) return null;
    const part = body.subarray(cursor, next);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) return null;
    const headers = part.subarray(0, headerEnd).toString('latin1');
    const disposition = /name="([^"]*)"(?:;\s*filename="([^"]*)")?/.exec(headers);
    if (disposition !== null && disposition[1] === 'file') {
      return {
        filename: disposition[2] ?? '',
        bytes: Buffer.from(part.subarray(headerEnd + 4)),
      };
    }
    cursor = next + separator.length + 2;
    if (cursor >= body.length) return null;
  }
}

function originAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined || origin === '' || origin === 'null') return true;
  const host = request.headers.host;
  if (host === undefined) return false;
  return origin === `http://${host}` || origin === `https://${host}`;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function loadPending(pendingId: string): Promise<PendingSignin | null> {
  const row = await one<{
    id: string;
    purpose: 'signin' | 'signup';
    identifier: string;
    account_id: string | null;
  }>(
    `SELECT id, purpose, identifier, account_id FROM auth_codes
      WHERE id = $1 AND consumed = false AND purpose IN ('signin','signup')`,
    [pendingId],
  );
  if (row === null) return null;
  return {
    id: row.id,
    purpose: row.purpose,
    identifier: row.identifier,
    accountId: row.account_id,
  };
}

function roleAllowed(auth: RouteAuth, role: Role): boolean {
  switch (auth) {
    case 'shopper':
      return role === 'shopper';
    case 'seller':
      return role === 'seller';
    case 'support':
      return role === 'support';
    case 'signed_in':
      return true;
    default:
      return true;
  }
}

export type DispatchResult = {
  status: number;
  headers: Record<string, string>;
  body: Buffer | null;
  cookies: string[];
};

function cookieHeader(name: string, value: string, maxAgeSeconds: number): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSeconds <= 0) {
    parts.push('Max-Age=0');
    parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  } else {
    parts.push(`Max-Age=${maxAgeSeconds}`);
  }
  return parts.join('; ');
}

export async function dispatchApi(
  request: IncomingMessage,
  url: URL,
  clientIp: string,
): Promise<DispatchResult | null> {
  const method = request.method ?? 'GET';
  const path = url.pathname;
  let matched: { route: Route; params: Record<string, string> } | null = null;
  let pathExists = false;
  for (const candidate of routes) {
    const params = matchPattern(candidate.pattern, path);
    if (params === null) continue;
    pathExists = true;
    if (candidate.method === method) {
      matched = { route: candidate, params };
      break;
    }
  }

  const cookies: string[] = [];
  const responseHeaders: Record<string, string> = {};
  const ctx: Ctx = {
    method,
    url,
    params: matched?.params ?? {},
    query: url.searchParams,
    headers: request.headers,
    body: {},
    rawBody: Buffer.alloc(0),
    file: null,
    cookies: parseCookies(request.headers.cookie),
    account: null,
    pending: null,
    ip: clientIp,
    setCookie: (name, value, maxAgeSeconds) =>
      cookies.push(cookieHeader(name, value, maxAgeSeconds)),
    clearCookie: (name) => cookies.push(cookieHeader(name, '', 0)),
    responseHeaders,
  };

  const finish = (reply: Reply): DispatchResult => {
    if (reply.kind === 'empty') {
      return { status: reply.status, headers: responseHeaders, body: null, cookies };
    }
    if (reply.kind === 'pdf') {
      return {
        status: 200,
        headers: {
          ...responseHeaders,
          'content-type': 'application/pdf',
          'content-disposition': `inline; filename="${reply.filename}"`,
        },
        body: reply.body,
        cookies,
      };
    }
    let body = reply.body;
    if (
      ctx.account !== null &&
      reply.status < 400 &&
      matched?.route.exactKeys !== true &&
      body !== null &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      !('server_time' in (body as Record<string, unknown>))
    ) {
      body = { ...(body as Record<string, unknown>), server_time: new Date().toISOString() };
    }
    return {
      status: reply.status,
      headers: { ...responseHeaders, 'content-type': 'application/json; charset=utf-8' },
      body: Buffer.from(JSON.stringify(body)),
      cookies,
    };
  };

  const fail = (error: ApiError): DispatchResult => {
    const headers: Record<string, string> = {
      ...responseHeaders,
      'content-type': 'application/json; charset=utf-8',
    };
    const body = error.body();
    if (body.retry_after !== undefined) headers['retry-after'] = String(body.retry_after);
    return { status: error.status, headers, body: Buffer.from(JSON.stringify(body)), cookies };
  };

  try {
    const isUpload = matched?.route.upload === true;
    if (STATE_CHANGING.has(method) || isUpload) {
      const limit = isUpload ? MULTIPART_BODY_LIMIT : JSON_BODY_LIMIT;
      const raw = await readBody(request, limit);
      if (raw === 'too_large') throw new ApiError(413, 'too_large');
      ctx.rawBody = raw;
      if (!originAllowed(request) && STATE_CHANGING.has(method)) {
        throw new ApiError(403, 'cross_site_request');
      }
      const contentType = request.headers['content-type'] ?? '';
      if (isUpload && contentType.startsWith('multipart/form-data')) {
        ctx.file = parseMultipart(raw, contentType);
      } else if (raw.length > 0) {
        try {
          const parsed: unknown = JSON.parse(raw.toString('utf8'));
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            ctx.body = parsed as Record<string, unknown>;
          }
        } catch {
          ctx.body = {};
        }
      }
    } else if (!originAllowed(request) && STATE_CHANGING.has(method)) {
      throw new ApiError(403, 'cross_site_request');
    }

    const accessCookie = ctx.cookies[ACCESS_COOKIE];
    if (accessCookie !== undefined) {
      ctx.account = await resolveAccess(accessCookie);
    }
    const pendingCookie = ctx.cookies[PENDING_COOKIE];
    if (pendingCookie !== undefined && ctx.account === null) {
      ctx.pending = await loadPending(pendingCookie);
    }

    if (matched === null) {
      if (pathExists && path.startsWith('/api/shared/')) {
        throw new ApiError(405, 'read_only');
      }
      throw notFound();
    }

    const { route: active } = matched;
    if (active.rate !== undefined) {
      const key = ctx.account === null ? `ip:${clientIp}` : `account:${ctx.account.accountId}`;
      await enforceRateLimit(active.rate, key);
    }

    if (active.auth === 'pending') {
      if (ctx.pending === null) throw signedOut();
    } else if (active.auth !== 'public') {
      if (ctx.account === null) throw signedOut();
      if (!roleAllowed(active.auth, ctx.account.role)) throw forbidden();
    }

    return finish(await active.handler(ctx));
  } catch (error) {
    if (error instanceof ApiError) return fail(error);
    process.stderr.write(`api error ${method} ${path}: ${String(error)}\n`);
    return fail(new ApiError(500, 'not_found'));
  }
}

export function sendResult(response: ServerResponse, result: DispatchResult): void {
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
  if (result.cookies.length > 0) response.setHeader('set-cookie', result.cookies);
  response.statusCode = result.status;
  if (result.body === null) {
    response.end();
    return;
  }
  response.setHeader('content-length', String(result.body.length));
  response.end(result.body);
}
