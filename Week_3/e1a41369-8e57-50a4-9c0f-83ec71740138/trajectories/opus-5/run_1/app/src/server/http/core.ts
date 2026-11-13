import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { JSON_BODY_LIMIT, SESSION_COOKIE } from '../config.js';
import { ApiError, fail } from './errors.js';

export const UPLOAD_READ_CAP = 2_200_000;

export interface UploadedFile {
  filename: string;
  bytes: Buffer;
}

export interface SessionUser {
  id: string;
  username: string;
}

export class Ctx {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  params: Record<string, string> = {};
  rawBody: Buffer = Buffer.alloc(0);
  bodyTooLarge = false;
  user: SessionUser | null = null;

  constructor(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams) {
    this.req = req;
    this.res = res;
    this.method = req.method ?? 'GET';
    this.path = path;
    this.query = query;
  }

  get contentType(): string {
    return (this.req.headers['content-type'] ?? '').toString();
  }

  get idempotencyKey(): string | null {
    const raw = this.req.headers['idempotency-key'];
    if (typeof raw !== 'string' || raw.length < 1 || raw.length > 100) return null;
    return raw;
  }

  requireUser(): SessionUser {
    if (!this.user) throw fail('unauthenticated');
    return this.user;
  }

  param(name: string): string {
    const value = this.params[name];
    if (value === undefined) throw fail('not_found');
    return value;
  }

  /** JSON bodies: the size limit, then the media type, then the parse. */
  json(): Record<string, unknown> {
    if (this.bodyTooLarge || this.rawBody.byteLength > JSON_BODY_LIMIT) throw fail('body_too_large');
    if (!this.contentType.toLowerCase().startsWith('application/json')) throw fail('unsupported_media_type');
    if (this.rawBody.byteLength === 0) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.rawBody.toString('utf8'));
    } catch {
      throw new ApiError(422, { errors: { body: 'Send a JSON object.' } });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ApiError(422, { errors: { body: 'Send a JSON object.' } });
    }
    return parsed as Record<string, unknown>;
  }

  async file(): Promise<UploadedFile> {
    if (!this.contentType.toLowerCase().startsWith('multipart/form-data')) throw fail('unsupported_media_type');
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': this.contentType },
      body: this.rawBody,
    });
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw fail('unsupported_media_type');
    }
    const part = form.get('file');
    if (!(part instanceof File)) throw fail('unsupported_media_type');
    return { filename: part.name, bytes: Buffer.from(await part.arrayBuffer()) };
  }

  send(status: number, body: unknown): void {
    const payload = Buffer.from(JSON.stringify(body ?? null), 'utf8');
    this.res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(payload.byteLength),
      'cache-control': 'no-store',
    });
    this.res.end(payload);
  }

  sendJsonText(status: number, text: string): void {
    const payload = Buffer.from(text, 'utf8');
    this.res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(payload.byteLength),
      'cache-control': 'no-store',
    });
    this.res.end(payload);
  }

  sendEmpty(status: number): void {
    this.res.writeHead(status, { 'cache-control': 'no-store' });
    this.res.end();
  }

  sendBytes(status: number, body: Buffer, headers: Record<string, string>): void {
    this.res.writeHead(status, {
      ...headers,
      'content-length': String(body.byteLength),
      'cache-control': 'no-store',
    });
    this.res.end(body);
  }

  cookie(value: string, maxAgeSeconds: number): void {
    this.res.setHeader(
      'set-cookie',
      `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`,
    );
  }

  clearCookie(): void {
    this.res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  sessionToken(): string | null {
    const header = this.req.headers.cookie;
    if (!header) return null;
    for (const piece of header.split(';')) {
      const [name, ...rest] = piece.trim().split('=');
      if (name === SESSION_COOKIE) return rest.join('=');
    }
    return null;
  }
}

export type Handler = (ctx: Ctx) => Promise<void> | void;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  upload: boolean;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler, upload = false): void {
    this.routes.push({ method, segments: pattern.split('/').filter(Boolean), handler, upload });
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    const parts = path.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const segment = route.segments[index] as string;
        const value = parts[index] as string;
        if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value);
        else if (segment !== value) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }
    return null;
  }

  isUploadPath(method: string, path: string): boolean {
    const found = this.match(method, path);
    return found ? found.route.upload : false;
  }
}

export async function readBody(req: IncomingMessage, cap: number): Promise<{ body: Buffer; tooLarge: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const piece = chunk as Buffer;
    total += piece.byteLength;
    if (total > cap) {
      tooLarge = true;
      continue;
    }
    chunks.push(piece);
  }
  return { body: Buffer.concat(chunks), tooLarge };
}

export function bodyCapFor(upload: boolean): number {
  return upload ? UPLOAD_READ_CAP : JSON_BODY_LIMIT + 1;
}

/** State-changing requests from another origin are refused before any other check. */
export function originAllowed(req: IncomingMessage): boolean {
  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') return true;
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true;
  const host = req.headers.host;
  if (typeof host !== 'string') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}
