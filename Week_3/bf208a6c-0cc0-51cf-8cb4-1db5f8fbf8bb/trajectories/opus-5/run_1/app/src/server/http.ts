import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, bodyTooLarge, crossOrigin } from './errors';
import { jsonBodyLimit, multipartBodyLimit } from './env';
import { SESSION_COOKIE, UNLOCK_COOKIE, readSessionValue, readUnlockValue, type Unlocks } from './session';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

const parseCookies = (header: string | undefined): Record<string, string> => {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    cookies[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return cookies;
};

export interface UploadPart {
  fileName: string;
  bytes: Buffer;
}

export interface MultipartBody {
  fields: Record<string, string>;
  file: UploadPart | null;
}

export class Ctx {
  readonly url: URL;
  readonly method: string;
  readonly cookies: Record<string, string>;
  readonly userId: string | null;
  readonly unlocks: Unlocks;
  params: Record<string, string> = {};
  private readonly cookieLines: string[] = [];

  constructor(
    readonly req: IncomingMessage,
    readonly res: ServerResponse,
  ) {
    this.method = req.method ?? 'GET';
    this.url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    this.cookies = parseCookies(req.headers.cookie);
    this.userId = readSessionValue(this.cookies[SESSION_COOKIE]);
    this.unlocks = readUnlockValue(this.cookies[UNLOCK_COOKIE]);
  }

  get isWrite(): boolean {
    return WRITE_METHODS.has(this.method);
  }

  checkOrigin(): void {
    const origin = this.req.headers.origin;
    if (!this.isWrite || origin === undefined || origin === 'null') return;
    const host = this.req.headers.host ?? '';
    if (new URL(origin).host !== host) throw crossOrigin();
  }

  setCookie(name: string, value: string, maxAge: number | null): void {
    const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
    if (maxAge !== null) parts.push(`Max-Age=${maxAge}`);
    this.cookieLines.push(parts.join('; '));
  }

  clearCookie(name: string): void {
    this.cookieLines.push(`${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  private headers(extra: Record<string, string>): Record<string, string | string[]> {
    const headers: Record<string, string | string[]> = { ...extra };
    if (this.cookieLines.length > 0) headers['Set-Cookie'] = this.cookieLines;
    return headers;
  }

  async rawBody(limit: number): Promise<Buffer> {
    const declared = Number(this.req.headers['content-length'] ?? '0');
    if (Number.isFinite(declared) && declared > limit) throw bodyTooLarge();
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of this.req) {
      const buffer = chunk as Buffer;
      total += buffer.length;
      if (total > limit) throw bodyTooLarge();
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  }

  async json<T = Record<string, unknown>>(): Promise<T> {
    const raw = await this.rawBody(jsonBodyLimit);
    if (raw.length === 0) return {} as T;
    return JSON.parse(raw.toString('utf8')) as T;
  }

  async multipart(): Promise<MultipartBody> {
    const type = this.req.headers['content-type'] ?? '';
    const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
    if (!match) throw new ApiError(415, { error: 'unsupported_type' });
    const boundary = `--${match[1] ?? match[2]}`;
    const raw = await this.rawBody(multipartBodyLimit);
    return parseMultipart(raw, boundary);
  }

  sendJson(status: number, body: unknown): void {
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    this.res.writeHead(
      status,
      this.headers({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(payload.length) }),
    );
    this.res.end(payload);
  }

  sendEmpty(status: number): void {
    this.res.writeHead(status, this.headers({}));
    this.res.end();
  }

  send(status: number, headers: Record<string, string>, body: Buffer): void {
    this.res.writeHead(status, this.headers({ ...headers, 'Content-Length': String(body.length) }));
    this.res.end(body);
  }
}

const parseMultipart = (raw: Buffer, boundary: string): MultipartBody => {
  const fields: Record<string, string> = {};
  let file: UploadPart | null = null;
  const marker = Buffer.from(`\r\n${boundary}`, 'utf8');
  const body = Buffer.concat([Buffer.from('\r\n', 'utf8'), raw]);
  let cursor = body.indexOf(marker);
  while (cursor >= 0) {
    const partStart = cursor + marker.length;
    if (body.slice(partStart, partStart + 2).toString() === '--') break;
    const headerEnd = body.indexOf('\r\n\r\n', partStart);
    if (headerEnd < 0) break;
    const headerText = body.slice(partStart + 2, headerEnd).toString('utf8');
    const next = body.indexOf(marker, headerEnd);
    if (next < 0) break;
    const content = body.slice(headerEnd + 4, next);
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const fileMatch = /filename="([^"]*)"/i.exec(headerText);
    const name = nameMatch ? nameMatch[1] : '';
    if (fileMatch !== undefined && fileMatch !== null) {
      if (content.length > 0 || fileMatch[1] !== '') file = { fileName: fileMatch[1], bytes: content };
    } else if (name !== '') {
      fields[name] = content.toString('utf8');
    }
    cursor = next;
  }
  return { fields, file };
};

export type Handler = (ctx: Ctx) => Promise<void> | void;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, segments: pattern.split('/').filter((part) => part !== ''), handler });
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = path.split('/').filter((part) => part !== '');
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const segment = route.segments[index];
        const value = parts[index];
        if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value);
        else if (segment !== value) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }
}
