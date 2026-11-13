import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.js';
import { typistForToken, type Typist } from './accounts.js';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const SESSION_COOKIE = 'sp_session';

export interface RequestContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly url: URL;
  readonly params: Record<string, string>;
  readonly rawBody: Buffer;
  readonly typist: Typist | null;
  readonly sessionToken: string | null;
  body<T>(): T;
}

export interface JsonResult {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
  /** A stored response body, answered byte for byte. */
  readonly raw?: string;
}

export type Handler = (context: RequestContext) => Promise<JsonResult | 'handled'>;

export interface Route {
  readonly method: string;
  readonly pattern: string;
  readonly handler: Handler;
  readonly auth?: 'required' | 'verified';
  readonly skipBodyChecks?: boolean;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export function matchRoute(route: Route, method: string, path: string): Record<string, string> | null {
  if (route.method !== method) return null;
  const expected = route.pattern.split('/');
  const actual = path.split('/');
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < expected.length; i += 1) {
    const part = expected[i] as string;
    const value = actual[i] as string;
    if (part.startsWith(':')) {
      if (value === '') return null;
      params[part.slice(1)] = decodeURIComponent(value);
    } else if (part !== value) {
      return null;
    }
  }
  return params;
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size <= limit + 1) chunks.push(buffer);
    else {
      chunks.push(buffer.subarray(0, Math.max(0, limit + 1 - (size - buffer.length))));
      break;
    }
  }
  return Buffer.concat(chunks);
}

function isJsonContentType(header: string | undefined): boolean {
  if (header === undefined || header === '') return true;
  return header.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return true;
  const host = req.headers.host ?? '';
  try {
    const parsed = new URL(origin);
    return parsed.host === host;
  } catch {
    return false;
  }
}

export interface Dispatch {
  readonly route: Route;
  readonly params: Record<string, string>;
}

export async function runRoute(
  dispatch: Dispatch,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<JsonResult | 'handled'> {
  const { route, params } = dispatch;
  const stateChanging = req.method !== 'GET' && req.method !== 'HEAD';
  if (stateChanging && !sameOrigin(req)) throw new ApiError(403, 'cross_origin');

  const rawBody = await readBody(req, config.maxBodyBytes);
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies[SESSION_COOKIE] ?? null;
  const typist = sessionToken ? await typistForToken(sessionToken) : null;

  if (route.auth && !typist) throw new ApiError(401, 'unauthenticated');
  if (route.auth === 'verified' && typist && !typist.verified) {
    throw new ApiError(403, 'email_unverified');
  }

  let parsed: unknown = null;
  if (stateChanging && !route.skipBodyChecks) {
    if (!isJsonContentType(req.headers['content-type'])) {
      throw new ApiError(415, 'unsupported_media_type');
    }
    if (rawBody.length > config.maxBodyBytes) {
      throw new ApiError(413, 'body_too_large', { limit: config.maxBodyBytes });
    }
    if (rawBody.length === 0) parsed = {};
    else {
      try {
        parsed = JSON.parse(rawBody.toString('utf8'));
      } catch {
        throw new ApiError(400, 'invalid_json');
      }
    }
  }

  const context: RequestContext = {
    req,
    res,
    url,
    params,
    rawBody,
    typist,
    sessionToken,
    body<T>(): T {
      return parsed as T;
    },
  };
  return route.handler(context);
}

export function sendJson(res: ServerResponse, result: JsonResult): void {
  if (result.status === 204) {
    res.writeHead(204, { ...(result.headers ?? {}) });
    res.end();
    return;
  }
  const payload = result.raw ?? JSON.stringify(result.body ?? null);
  res.writeHead(result.status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...(result.headers ?? {}),
  });
  res.end(payload);
}

export function errorResult(error: ApiError): JsonResult {
  return { status: error.status, body: { error: error.code, ...error.extra } };
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
