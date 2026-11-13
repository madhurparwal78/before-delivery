/** A tiny router on node:http with the product's one error shape and the published check order. */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiErrorBody } from '../shared/protocol';
import { MESSAGES, tooLarge } from '../shared/messages';
import { config, JSON_BODY_LIMIT, UPLOAD_BODY_LIMIT } from './config';
import { databaseReady, query } from './db';

// ------------------------------------------------------------------ errors

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly errors?: Record<string, string>,
  ) {
    super(message);
  }
}

/** The one place an API error is raised. */
export function fail(status: number, code: string, message: string, errors?: Record<string, string>): never {
  throw new HttpError(status, code, message, errors);
}

function unauthenticated(): never {
  return fail(401, 'unauthenticated', MESSAGES.unauthenticated);
}
export function notFound(): never {
  return fail(404, 'not_found', MESSAGES.notFound);
}
export function forbidden(message: string): never {
  return fail(403, 'forbidden', message);
}
export function invalid(path: string, message: string): never {
  return fail(422, 'validation', message, { [path]: message });
}
/** Storage is unreachable: uploads, imports, publishing and the seed answer 503 with their own copy. */
export function storageDown(message: string): never {
  return fail(503, 'storage_unavailable', message);
}

// ------------------------------------------------------------------ replies

export interface Reply {
  status: number;
  body?: unknown;
  raw?: Buffer | string;
  contentType?: string;
  headers?: Record<string, string>;
}

export const json = (status: number, body: unknown, headers?: Record<string, string>): Reply => ({ status, body, headers });

/** The one place an API error body is built. */
function errorReply(status: number, code: string, message: string, errors?: Record<string, string>): Reply {
  const body: ApiErrorBody = errors ? { error: code, message, errors } : { error: code, message };
  return json(status, body);
}

/** Uploaded bytes are served from the app's origin: keep them inert whatever type the uploader claimed. */
export const ASSET_HEADERS = { 'Content-Security-Policy': "sandbox; default-src 'none'", 'Content-Disposition': 'attachment' };
export const noContent = (): Reply => ({ status: 204 });

// ------------------------------------------------------------------ people and cookies

export interface Person {
  id: string;
  name: string;
  email: string;
}

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const SESSION_COOKIE = 'hs_session';

export const newToken = (): string => randomBytes(32).toString('base64url');
export const newId = (prefix: string): string => `${prefix}${randomBytes(8).toString('hex')}`;

export const sessionCookie = (token: string): string => `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
export const clearedSessionCookie = (): string => `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

export function cookieToken(header: string | undefined): string | null {
  for (const part of (header ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      const value = rest.join('=');
      return TOKEN.test(value) ? value : null;
    }
  }
  return null;
}

export async function personOfToken(token: string | null): Promise<Person | null> {
  if (token === null) return null;
  const rows = await query<Person>(
    'SELECT p.id, p.name, p.email FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.token = $1',
    [token],
  );
  return rows[0] ?? null;
}

// ------------------------------------------------------------------ bodies

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) return fail(413, 'too_large', tooLarge(limit));
  return Buffer.concat(chunks);
}

const MAX_JSON_DEPTH = 64;

/**
 * Refuses strings carrying NUL, which neither PostgreSQL text nor JSON columns can hold, and nesting deeper than
 * any document the app writes. Walks with its own stack, so hostile depth cannot overflow the call stack.
 */
function unsafeJson(value: unknown): boolean {
  const pending: [unknown, number][] = [[value, 0]];
  for (let next = pending.pop(); next; next = pending.pop()) {
    const [item, depth] = next;
    if (typeof item === 'string') {
      if (item.includes('\u0000')) return true;
    } else if (typeof item === 'object' && item !== null) {
      if (depth >= MAX_JSON_DEPTH) return true;
      if (Array.isArray(item)) {
        for (const child of item) pending.push([child, depth + 1]);
      } else {
        for (const [key, child] of Object.entries(item)) {
          if (key.includes('\u0000')) return true;
          pending.push([child, depth + 1]);
        }
      }
    }
  }
  return false;
}

interface UploadedFile {
  fileName: string;
  contentType: string;
  bytes: Buffer;
}

interface Multipart {
  fields: Record<string, string>;
  files: Record<string, UploadedFile>;
}

function parseMultipart(body: Buffer, boundary: string): Multipart {
  const result: Multipart = { fields: {}, files: {} };
  const delimiter = Buffer.from(`--${boundary}`);
  let position = body.indexOf(delimiter);
  while (position !== -1) {
    const start = position + delimiter.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    const part = body.subarray(start + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    if (split !== -1) {
      const head = part.subarray(0, split).toString('utf8');
      const content = part.subarray(split + 4);
      const disposition = /content-disposition:[^\r\n]*/i.exec(head)?.[0] ?? '';
      const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
      const fileName = /\bfilename="([^"]*)"/i.exec(disposition)?.[1];
      const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim() ?? 'application/octet-stream';
      if (name !== undefined) {
        if (name.includes('\u0000')) invalid('body', MESSAGES.invalidValue);
        if (fileName !== undefined) result.files[name] = { fileName, contentType: type, bytes: Buffer.from(content) };
        else result.fields[name] = content.toString('utf8');
      }
    }
    position = next;
  }
  return result;
}

// ------------------------------------------------------------------ context

export class Ctx {
  readonly url: URL;
  params: Record<string, string> = {};
  private personPromise: Promise<Person | null> | null = null;
  private cookie: string | undefined;

  constructor(
    readonly req: IncomingMessage,
    readonly res: ServerResponse,
  ) {
    this.url = new URL(req.url ?? '/', 'http://localhost');
    this.cookie = req.headers.cookie;
  }

  get method(): string {
    return this.req.method ?? 'GET';
  }

  get path(): string {
    return this.url.pathname;
  }

  /** A path parameter of the matched route. */
  param(name: string): string {
    return this.params[name] ?? notFound();
  }

  header(name: string): string | undefined {
    const value = this.req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  /** A query parameter; NUL inside is a validation error. */
  q(name: string): string | null {
    const value = this.url.searchParams.get(name);
    if (value !== null && unsafeJson(value)) invalid(name, MESSAGES.invalidValue);
    return value;
  }

  /** The signed-in person, or null. */
  person(): Promise<Person | null> {
    this.personPromise ??= personOfToken(cookieToken(this.cookie));
    return this.personPromise;
  }

  /** 401 unless someone is signed in. */
  async requirePerson(): Promise<Person> {
    return (await this.person()) ?? unauthenticated();
  }

  /** A JSON body: application/json only, at most 1,048,576 bytes. */
  async json(): Promise<unknown> {
    const type = (this.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (type !== 'application/json') {
      await readBody(this.req, JSON_BODY_LIMIT).catch(() => undefined);
      return fail(415, 'unsupported_media_type', MESSAGES.unsupportedMedia);
    }
    const bytes = await readBody(this.req, JSON_BODY_LIMIT);
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString('utf8'));
    } catch {
      return invalid('body', MESSAGES.invalidValue);
    }
    if (unsafeJson(value)) invalid('body', MESSAGES.invalidValue);
    return value;
  }

  /** A JSON object body. */
  async jsonObject(): Promise<Record<string, unknown>> {
    const value = await this.json();
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid('body', MESSAGES.invalidValue);
    return value as Record<string, unknown>;
  }

  /** A multipart/form-data body, at most 10,485,760 bytes. */
  async multipart(): Promise<Multipart> {
    const type = this.header('content-type') ?? '';
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
    if (!type.toLowerCase().startsWith('multipart/form-data') || !boundary) {
      await readBody(this.req, UPLOAD_BODY_LIMIT).catch(() => undefined);
      return fail(415, 'unsupported_media_type', MESSAGES.sendMultipart);
    }
    const body = await readBody(this.req, UPLOAD_BODY_LIMIT);
    return parseMultipart(body, (boundary[1] ?? boundary[2]) as string);
  }
}

// ------------------------------------------------------------------ router

type Handler = (ctx: Ctx) => Promise<Reply>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

class Router {
  private routes: Route[] = [];
  private fallbackHandler: Handler | null = null;

  route(method: string, path: string, handler: Handler): void {
    const keys: string[] = [];
    const source = path.replace(/:([A-Za-z]+)/g, (_, key: string) => {
      keys.push(key);
      return '([^/]+)';
    });
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler });
  }

  get(path: string, handler: Handler): void {
    this.route('GET', path, handler);
  }
  post(path: string, handler: Handler): void {
    this.route('POST', path, handler);
  }
  put(path: string, handler: Handler): void {
    this.route('PUT', path, handler);
  }
  patch(path: string, handler: Handler): void {
    this.route('PATCH', path, handler);
  }
  delete(path: string, handler: Handler): void {
    this.route('DELETE', path, handler);
  }

  /** Handles every GET no route matched (the client shell). */
  fallback(handler: Handler): void {
    this.fallbackHandler = handler;
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const found = route.pattern.exec(path);
      if (!found) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((key, i) => {
        try {
          params[key] = decodeURIComponent(found[i + 1] as string);
        } catch {
          params[key] = '';
        }
      });
      return { handler: route.handler, params };
    }
    return null;
  }

  get shell(): Handler | null {
    return this.fallbackHandler;
  }
}

export const router = new Router();

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Whether an Origin header names this site. The one origin rule: HTTP writes and the WebSocket upgrade both use it. */
export function isOwnOrigin(origin: string, host: string | undefined): boolean {
  const own = new Set([config.publicUrl]);
  if (host) {
    own.add(`http://${host}`);
    own.add(`https://${host}`);
  }
  return own.has(origin);
}

/** A state-changing request whose Origin names another origin is refused before any other check. */
function crossOrigin(ctx: Ctx): boolean {
  const origin = ctx.header('origin');
  return origin !== undefined && !isOwnOrigin(origin, ctx.header('host'));
}

const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };

function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | number> = { ...SECURITY_HEADERS, ...(reply.headers ?? {}) };
  let payload: Buffer | string | undefined;
  if (reply.raw !== undefined) {
    payload = reply.raw;
    headers['Content-Type'] = reply.contentType ?? 'application/octet-stream';
  } else if (reply.body !== undefined) {
    payload = JSON.stringify(reply.body);
    headers['Content-Type'] = 'application/json; charset=utf-8';
  }
  if (payload !== undefined) headers['Content-Length'] = Buffer.byteLength(payload);
  res.writeHead(reply.status, headers);
  res.end(payload);
}

const isApi = (path: string): boolean => path.startsWith('/api/');

export async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const ctx = new Ctx(req, res);
  try {
    if (!databaseReady() && (isApi(ctx.path) || ctx.path.startsWith('/embed/'))) {
      send(res, errorReply(503, 'unavailable', MESSAGES.serviceStarting));
      return;
    }
    if (STATE_CHANGING.has(ctx.method) && crossOrigin(ctx)) fail(403, 'cross_origin', MESSAGES.crossOrigin);
    const matched = router.match(ctx.method, ctx.path);
    if (matched) {
      ctx.params = matched.params;
      send(res, await matched.handler(ctx));
      return;
    }
    if (isApi(ctx.path)) return notFound();
    if (ctx.method === 'GET' && router.shell) {
      send(res, await router.shell(ctx));
      return;
    }
    notFound();
  } catch (error) {
    if (error instanceof HttpError) {
      send(res, errorReply(error.status, error.code, error.message, error.errors));
      return;
    }
    const code = (error as { code?: string }).code;
    if (code === '22021' || code === '22P05' || code === '22P02') {
      send(res, errorReply(422, 'validation', MESSAGES.invalidValue, { body: MESSAGES.invalidValue }));
      return;
    }
    console.error(error);
    send(res, errorReply(500, 'internal', MESSAGES.internalError));
  }
}
