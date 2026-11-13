// The router and the request boundary: origin, body limits, content type, caller and the one error shape.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolveCaller, type Caller } from './access.ts';
import { config } from './config.ts';

export class HttpError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error ?? 'validation'));
    this.status = status;
    this.body = body;
  }
}

/** `{"errors":{field:message}}` with status 422. */
export function validation(errors: Record<string, string>): HttpError {
  return new HttpError(422, { errors });
}

export interface UploadedFile { name: string; bytes: Buffer }

export interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  /** The signed-in account or the share-link holder; null when the request carries neither (or the route is anonymous). */
  caller: Caller | null;
  /** The JSON object body (empty object when the request has none). Already read and size-checked. */
  json(): Promise<Record<string, unknown>>;
  /** The `file` part of a multipart upload, already read and size-checked against UPLOAD_MAX_BYTES. */
  file(): Promise<UploadedFile>;
}

/** JSON reply, or the bytes of a download. A handler that streams through `ctx.res` itself returns nothing. */
export type Reply =
  | { status: number; body?: unknown; headers?: Record<string, string> }
  | { status: number; bytes: Buffer; contentType: string; headers?: Record<string, string> };

export type Handler = (ctx: Context) => Promise<Reply | void>;

interface RouteOptions {
  /** Skips caller resolution: the route works without a session or link. */
  anonymous?: boolean;
}

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  anonymous: boolean;
}

const routes: Route[] = [];
const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE']);
const FORM_OVERHEAD_BYTES = 65536;
const DRAIN_CEILING_BYTES = 64 * 1024 * 1024;

export function registerRoute(method: string, pattern: string, handler: Handler, options: RouteOptions = {}): void {
  routes.push({ method, segments: pattern.split('/').filter(Boolean), handler, anonymous: options.anonymous === true });
}

function match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  const parts = pathname.split('/').filter(Boolean);
  let best: { route: Route; params: Record<string, string>; literals: number } | null = null;
  for (const route of routes) {
    if (route.method !== method || route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let literals = 0;
    const fits = route.segments.every((segment, i) => {
      const part = parts[i] ?? '';
      if (!segment.startsWith(':')) {
        if (segment !== part) return false;
        literals += 1;
        return true;
      }
      try {
        const value = decodeURIComponent(part);
        if (value.includes('\0')) return false;
        params[segment.slice(1)] = value;
        return true;
      } catch {
        return false;
      }
    });
    if (fits && (!best || literals > best.literals)) best = { route, params, literals };
  }
  return best;
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export function sendStatic(res: ServerResponse, status: number, bytes: Buffer, headers: Record<string, string>): void {
  res.writeHead(status, { 'Content-Length': bytes.length, ...headers });
  res.end(bytes);
}

/** Reads the whole body, but keeps only up to `limit` bytes: a larger body is drained so the client still gets its answer. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > DRAIN_CEILING_BYTES) req.destroy();
      else if (received <= limit) chunks.push(chunk);
    });
    req.on('end', () => resolve(received > limit ? null : Buffer.concat(chunks)));
    req.on('error', reject);
    req.on('close', () => resolve(null));
  });
}

function boundaryOf(contentType: string): string | null {
  const found = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return found ? (found[1] ?? found[2] ?? null) : null;
}

/** Finds the `file` part of a multipart/form-data body. */
function filePart(body: Buffer, boundary: string): UploadedFile | null {
  const delimiter = Buffer.from(`--${boundary}`);
  let at = body.indexOf(delimiter);
  while (at >= 0) {
    const headStart = at + delimiter.length;
    if (body.subarray(headStart, headStart + 2).toString() === '--') return null;
    const headEnd = body.indexOf('\r\n\r\n', headStart);
    if (headEnd < 0) return null;
    const head = body.subarray(headStart, headEnd).toString('utf8');
    const next = body.indexOf(Buffer.from(`\r\n--${boundary}`), headEnd + 4);
    if (next < 0) return null;
    if (/name="file"/i.test(head)) {
      const filename = /filename="([^"]*)"/i.exec(head)?.[1] ?? '';
      return { name: filename.split(/[\\/]/).pop() ?? '', bytes: body.subarray(headEnd + 4, next) };
    }
    at = body.indexOf(delimiter, next);
  }
  return null;
}

const badRequest = (): HttpError => new HttpError(400, { error: 'bad_request' });

interface ParsedBody { json: Record<string, unknown>; file: UploadedFile | null }

async function parseBody(req: IncomingMessage): Promise<ParsedBody> {
  const contentType = (req.headers['content-type'] ?? '').toLowerCase();
  const multipart = contentType.startsWith('multipart/form-data');
  const limit = multipart ? config.uploadMaxBytes + FORM_OVERHEAD_BYTES : config.jsonMaxBytes;
  const body = await readBody(req, limit);
  if (body === null) {
    throw multipart ? new HttpError(413, { error: 'file_too_large', limit_bytes: config.uploadMaxBytes }) : new HttpError(413, { error: 'body_too_large' });
  }
  if (body.length === 0) return { json: {}, file: null };
  if (multipart) {
    const boundary = boundaryOf(req.headers['content-type'] ?? '');
    const file = boundary ? filePart(body, boundary) : null;
    if (!file) throw badRequest();
    if (file.bytes.length > config.uploadMaxBytes) throw new HttpError(413, { error: 'file_too_large', limit_bytes: config.uploadMaxBytes });
    return { json: {}, file };
  }
  if (!contentType.startsWith('application/json')) throw badRequest();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw badRequest();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw badRequest();
  return { json: parsed as Record<string, unknown>, file: null };
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function reply(res: ServerResponse, result: Reply): void {
  if ('bytes' in result) {
    res.writeHead(result.status, {
      'Content-Type': result.contentType,
      'Content-Length': result.bytes.length,
      'Cache-Control': 'no-store',
      ...result.headers,
    });
    res.end(result.bytes);
  } else if (result.body === undefined) {
    res.writeHead(result.status, { 'Cache-Control': 'no-store', ...result.headers });
    res.end();
  } else {
    sendJson(res, result.status, result.body, result.headers);
  }
}

/** Serves one /api request. Errors leave in the published shape; anything unexpected is a logged 500. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  try {
    const method = req.method ?? 'GET';
    const found = match(method, url.pathname);
    if (!found) throw new HttpError(404, { error: 'not_found' });
    if (WRITE_METHODS.has(method)) {
      if (!sameOrigin(req)) throw new HttpError(403, { error: 'forbidden' });
    }
    const parsed: ParsedBody = WRITE_METHODS.has(method) ? await parseBody(req) : { json: {}, file: null };
    const caller = found.route.anonymous ? null : await resolveCaller(req);
    const ctx: Context = {
      req,
      res,
      params: found.params,
      query: url.searchParams,
      caller,
      json: async () => parsed.json,
      file: async () => {
        if (!parsed.file) throw badRequest();
        return parsed.file;
      },
    };
    const result = await found.route.handler(ctx);
    if (result && !res.headersSent) reply(res, result);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof HttpError) {
      sendJson(res, error.status, error.body);
      return;
    }
    process.stdout.write(`request failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    sendJson(res, 500, { error: 'internal_error' });
  }
}
