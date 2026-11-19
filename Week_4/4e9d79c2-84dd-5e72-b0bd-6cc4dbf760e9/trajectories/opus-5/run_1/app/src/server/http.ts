import { IncomingMessage, ServerResponse } from 'node:http';
import {
  AppError,
  MAX_JSON_DEPTH,
  MAX_QUERY_LENGTH,
  bodyTooLarge,
  foreignOrigin,
  invalid,
  malformedJson,
  unsupportedMediaType,
} from './errors.js';
import { copy } from './copy.js';

export const SESSION_COOKIE = 'wayticket';

export type Desk = { id: string; name: string; email: string };

export class Ctx {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly method: string;
  readonly url: URL;
  readonly path: string;
  params: Record<string, string> = {};
  desk: Desk | null = null;
  sessionId: string | null = null;
  sessionWasEnded = false;
  private bodyBuffer: Buffer | null = null;

  constructor(request: IncomingMessage, response: ServerResponse) {
    this.request = request;
    this.response = response;
    this.method = (request.method ?? 'GET').toUpperCase();
    this.url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    this.path = decodeURIComponent(this.url.pathname);
  }

  header(name: string): string | undefined {
    const value = this.request.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  cookie(name: string): string | null {
    const raw = this.header('cookie');
    if (!raw) return null;
    for (const part of raw.split(';')) {
      const [key, ...rest] = part.trim().split('=');
      if (key === name) return rest.join('=');
    }
    return null;
  }

  queryValue(name: string): string | null {
    return this.url.searchParams.get(name);
  }

  /** Any `q` is capped at 200 characters inclusive. */
  cappedQuery(name: string): string | null {
    const value = this.url.searchParams.get(name);
    if (value === null) return null;
    if ([...value].length > MAX_QUERY_LENGTH) throw invalid(copy.searchTooLong, { [name]: copy.searchTooLong });
    return value;
  }

  isRefresh(): boolean {
    return this.header('x-wayticket-refresh') === '1';
  }

  send(status: number, body: Buffer | string, headers: Record<string, string> = {}): void {
    const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    this.response.writeHead(status, { 'content-length': String(payload.length), ...headers });
    this.response.end(payload);
  }

  json(status: number, body: unknown, headers: Record<string, string> = {}): void {
    this.send(status, JSON.stringify(body), { 'content-type': 'application/json; charset=utf-8', ...headers });
  }

  html(status: number, body: string, headers: Record<string, string> = {}): void {
    this.send(status, body, { 'content-type': 'text/html; charset=utf-8', ...headers });
  }

  redirect(status: number, location: string, headers: Record<string, string> = {}): void {
    this.send(status, '', { location, ...headers });
  }

  setCookie(value: string): void {
    this.response.setHeader('set-cookie', `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax`);
  }

  clearCookie(): void {
    this.response.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  /** Reads the body, refusing anything over the limit before it is parsed. */
  async body(limit: number): Promise<Buffer> {
    if (this.bodyBuffer) return this.bodyBuffer;
    const declared = Number(this.header('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > limit) {
      await this.drain();
      throw bodyTooLarge();
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of this.request) {
      const piece = chunk as Buffer;
      size += piece.length;
      if (size > limit) {
        await this.drain();
        throw bodyTooLarge();
      }
      chunks.push(piece);
    }
    this.bodyBuffer = Buffer.concat(chunks);
    return this.bodyBuffer;
  }

  private async drain(): Promise<void> {
    this.request.resume();
    await new Promise<void>((done) => {
      this.request.on('end', () => done());
      this.request.on('error', () => done());
      this.request.on('close', () => done());
      setTimeout(done, 50);
    });
  }
}

function jsonDepth(value: unknown, depth = 1): number {
  if (depth > MAX_JSON_DEPTH + 1) return depth;
  if (Array.isArray(value)) {
    let deepest = depth;
    for (const item of value) deepest = Math.max(deepest, jsonDepth(item, depth + 1));
    return deepest;
  }
  if (value !== null && typeof value === 'object') {
    let deepest = depth;
    for (const item of Object.values(value)) deepest = Math.max(deepest, jsonDepth(item, depth + 1));
    return deepest;
  }
  return depth;
}

export function isJsonContentType(ctx: Ctx): boolean {
  const type = (ctx.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return type === 'application/json';
}

export function hasContentType(ctx: Ctx, wanted: string): boolean {
  const type = (ctx.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return type === wanted;
}

/** Content type, then malformed JSON, then the nesting cap. */
export function parseJson(raw: Buffer, ctx: Ctx): Record<string, unknown> {
  if (!isJsonContentType(ctx)) throw unsupportedMediaType();
  const text = raw.toString('utf8');
  let value: unknown;
  try {
    value = text.trim() === '' ? {} : JSON.parse(text);
  } catch {
    throw malformedJson();
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw malformedJson();
  if (jsonDepth(value) > MAX_JSON_DEPTH) throw invalid('That request has too many levels.');
  return value as Record<string, unknown>;
}

/** Tries to read a JSON body without deciding the ladder, for the rate limit's look at `email`. */
export function peekJson(raw: Buffer, ctx: Ctx): Record<string, unknown> | null {
  if (!isJsonContentType(ctx)) return null;
  try {
    const value: unknown = JSON.parse(raw.toString('utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    if (jsonDepth(value) > MAX_JSON_DEPTH) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function checkOrigin(ctx: Ctx): void {
  if (!STATE_CHANGING.has(ctx.method)) return;
  const origin = ctx.header('origin');
  if (!origin) return;
  const host = ctx.header('host');
  try {
    const sent = new URL(origin);
    if (sent.host !== host) throw foreignOrigin();
  } catch (trouble) {
    if (trouble instanceof AppError) throw trouble;
    throw foreignOrigin();
  }
}

export function sendError(ctx: Ctx, trouble: unknown): void {
  const known =
    trouble instanceof AppError
      ? trouble
      : new AppError(500, 'somethingWentWrong', 'Something went wrong. Try again.');
  if (!(trouble instanceof AppError)) {
    console.error('unexpected trouble', trouble);
  }
  ctx.json(known.status, known.body(), known.headers ?? {});
}
