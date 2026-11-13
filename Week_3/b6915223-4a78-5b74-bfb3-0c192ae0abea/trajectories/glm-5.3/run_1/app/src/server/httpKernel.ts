import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_REQUEST_BYTES } from '../shared/domain';
import { ApiError, crossOrigin, payloadTooLarge, unauthenticated, unsupportedMediaType } from './errors';
import type { ManagerRow } from './sessions';
import { findSession } from './sessions';
import type * as pg from 'pg';

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  pathname: string;
  query: URLSearchParams;
  body: unknown;
  rawBody: string;
  origin: string | null;
  cookies: Map<string, string>;
  manager: ManagerRow | null;
}

export const SESSION_COOKIE = 'elevens_session';

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (header === undefined) return cookies;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    cookies.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return cookies;
}

export function serializeSessionCookie(value: string | null): string {
  if (value === null) return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax`;
}

export async function readBody(req: IncomingMessage): Promise<{ raw: string; parsed: unknown }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) {
      throw payloadTooLarge();
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw === '') return { raw: '', parsed: undefined };
  try {
    return { raw, parsed: JSON.parse(raw) as unknown };
  } catch {
    throw new ApiError(400, 'validation', 'Send a JSON body.', { fields: { body: 'Send a JSON body.' } });
  }
}

export async function buildContext(
  req: IncomingMessage,
  res: ServerResponse,
  pool: pg.Pool,
  publicOrigin: URL,
): Promise<RequestContext> {
  const url = new URL(req.url ?? '/', publicOrigin);
  const method = req.method ?? 'GET';
  const isWrite = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  const origin = req.headers.origin ?? null;
  if (isWrite && origin !== null && origin !== publicOrigin.origin) {
    throw crossOrigin();
  }
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies.get(SESSION_COOKIE) ?? '';
  let manager: ManagerRow | null = null;
  if (sessionId !== '') {
    const client = await pool.connect();
    try {
      manager = await findSession(client, sessionId);
    } finally {
      client.release();
    }
  }
  let body: unknown = undefined;
  let raw = '';
  if (isWrite) {
    const contentType = req.headers['content-type'] ?? '';
    if (contentType !== '' && !contentType.toLowerCase().startsWith('application/json')) {
      throw unsupportedMediaType();
    }
    const parsed = await readBody(req);
    body = parsed.parsed;
    raw = parsed.raw;
  }
  return {
    req,
    res,
    method,
    pathname: url.pathname,
    query: url.searchParams,
    body,
    rawBody: raw,
    origin,
    cookies,
    manager,
  };
}

export async function requireManager(ctx: RequestContext): Promise<ManagerRow> {
  if (ctx.manager === null) throw unauthenticated();
  return ctx.manager;
}
