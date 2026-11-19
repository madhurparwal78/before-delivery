import { randomBytes } from 'node:crypto';
import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from '../config.js';
import { ApiError, errors } from './errors.js';
import { html, type Raw } from './html.js';
import { boundaryOf, parseMultipart, type MultipartForm } from './multipart.js';
import type { RateBucket } from './ratelimit.js';
import { enforceRateLimit } from './ratelimit.js';
import { htmlReply, type Reply } from './reply.js';

const JSON_LIMIT = 100_000;
const MULTIPART_LIMIT = 6_000_000;

export type Ctx = {
  readonly method: string;
  readonly url: URL;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
  readonly clientKey: string;
  readonly nonce: string;
  readonly wantsHtml: boolean;
  readonly rateHeaders: Record<string, string>;
  json(): unknown;
  form(): MultipartForm;
};

export type Handler = (ctx: Ctx) => Promise<Reply>;

export type Route = {
  readonly method: string;
  readonly pattern: string;
  readonly bucket: RateBucket | null;
  readonly handler: Handler;
  readonly page?: boolean;
};

type CompiledRoute = Route & {
  readonly segments: readonly string[];
};

const routes: CompiledRoute[] = [];

export function route(
  method: string,
  pattern: string,
  bucket: RateBucket | null,
  handler: Handler,
  options?: { readonly page?: boolean },
): void {
  routes.push({
    method,
    pattern,
    bucket,
    handler,
    page: options?.page === true,
    segments: pattern.split('/').filter((segment) => segment !== ''),
  });
}

function matchRoute(
  method: string,
  path: string,
): { readonly route: CompiledRoute; readonly params: Record<string, string> } | null {
  const parts = path.split('/').filter((segment) => segment !== '');
  let methodMismatch: CompiledRoute | null = null;
  for (const candidate of routes) {
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < parts.length; index += 1) {
      const expected = candidate.segments[index] as string;
      const actual = parts[index] as string;
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = decodeURIComponent(actual);
        continue;
      }
      if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    if (candidate.method !== method) {
      methodMismatch = candidate;
      continue;
    }
    return { route: candidate, params };
  }
  if (methodMismatch !== null) return null;
  return null;
}

function clientKeyOf(req: IncomingMessage): string {
  if (config.trustForwardedFor) {
    const forwarded = req.headers['x-forwarded-for'];
    const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (header !== undefined && header.trim() !== '') {
      return (header.split(',')[0] ?? '').trim();
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = chunk as Buffer;
    size += piece.length;
    if (size > limit) throw errors.payloadTooLarge();
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

function contentTypeOf(headers: IncomingHttpHeaders): string {
  const value = headers['content-type'];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function buildCtx(
  req: IncomingMessage,
  url: URL,
  params: Record<string, string>,
  body: Buffer,
): Ctx {
  const contentType = contentTypeOf(req.headers);
  const accept = req.headers.accept ?? '';
  return {
    method: req.method ?? 'GET',
    url,
    path: url.pathname,
    params,
    headers: req.headers,
    body,
    clientKey: clientKeyOf(req),
    nonce: randomBytes(16).toString('base64'),
    wantsHtml: accept.includes('text/html') && !accept.includes('application/json'),
    rateHeaders: {},
    json(): unknown {
      if (body.length === 0) return {};
      if (!contentType.toLowerCase().startsWith('application/json')) {
        throw errors.unsupportedMediaType();
      }
      try {
        return JSON.parse(body.toString('utf8'));
      } catch {
        throw errors.unsupportedMediaType();
      }
    },
    form(): MultipartForm {
      const boundary = contentType.toLowerCase().startsWith('multipart/form-data')
        ? boundaryOf(contentType)
        : null;
      if (boundary === null) {
        throw errors.unsupportedMediaType('Send this request as a multipart form.');
      }
      return parseMultipart(body, boundary);
    },
  };
}

export type StatusPageRenderer = (
  ctx: Ctx,
  error: ApiError,
) => Promise<Raw> | Raw;

let statusPage: StatusPageRenderer = (_ctx, error) =>
  html`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${error.message}</title></head><body><h1>${error.message}</h1></body></html>`;

export function setStatusPageRenderer(renderer: StatusPageRenderer): void {
  statusPage = renderer;
}

function securityHeaders(reply: Reply, nonce: string): Record<string, string> {
  const headers: Record<string, string> = { ...reply.headers };
  headers['X-Content-Type-Options'] = 'nosniff';
  const contentType = headers['Content-Type'] ?? '';
  if (contentType.startsWith('text/html')) {
    headers['Content-Security-Policy'] = [
      "default-src 'self'",
      "script-src 'self'",
      `style-src 'self' 'nonce-${nonce}'`,
      "font-src 'self'",
      "img-src 'self'",
      "media-src 'self'",
      "connect-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; ');
    if (headers['Referrer-Policy'] === undefined) {
      headers['Referrer-Policy'] = 'same-origin';
    }
  }
  return headers;
}

function send(res: ServerResponse, reply: Reply, nonce: string): void {
  const headers = securityHeaders(reply, nonce);
  res.writeHead(reply.status, headers);
  res.end(reply.body);
}

const STATE_CHANGING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function sameOriginOrThrow(ctx: Ctx): void {
  if (!STATE_CHANGING.has(ctx.method)) return;
  if (!ctx.path.startsWith('/api/console') && !ctx.path.startsWith('/console')) return;
  const origin = ctx.headers.origin;
  const header = Array.isArray(origin) ? origin[0] : origin;
  if (header === undefined || header === 'null') return;
  const host = ctx.headers.host ?? '';
  try {
    const parsed = new URL(header);
    if (parsed.host === host) return;
  } catch {
    throw errors.crossOrigin();
  }
  throw errors.crossOrigin();
}

export function createServer(): http.Server {
  return http.createServer((req, res) => {
    void (async () => {
      const nonce = randomBytes(16).toString('base64');
      let url: URL;
      try {
        url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'not_found', message: 'Nothing is published here.' }));
        return;
      }

      const matched = matchRoute(req.method ?? 'GET', url.pathname);
      const limit = contentTypeOf(req.headers).toLowerCase().startsWith('multipart/form-data')
        ? MULTIPART_LIMIT
        : JSON_LIMIT;

      let ctx: Ctx | null = null;
      try {
        const body = STATE_CHANGING.has(req.method ?? 'GET')
          ? await readBody(req, limit)
          : Buffer.alloc(0);
        ctx = buildCtx(req, url, matched?.params ?? {}, body);
        if (matched === null || url.pathname.includes('..')) {
          throw errors.publicNotFound();
        }
        sameOriginOrThrow(ctx);
        if (matched.route.bucket !== null && matched.route.bucket !== 'console_writes') {
          const headers = await enforceRateLimit(matched.route.bucket, ctx.clientKey);
          Object.assign(ctx.rateHeaders, headers);
        }
        const reply = await matched.route.handler(ctx);
        send(res, { ...reply, headers: { ...ctx.rateHeaders, ...reply.headers } }, ctx.nonce);
      } catch (error) {
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError(500, 'server_error', 'Something went wrong. Please try again.');
        if (!(error instanceof ApiError)) {
          process.stderr.write(`${String((error as Error).stack ?? error)}\n`);
        }
        const wantsPage =
          matched?.route.page === true || (matched === null && isPagePath(url.pathname));
        const rateHeaders = ctx?.rateHeaders ?? {};
        if (wantsPage && ctx !== null) {
          const page = await statusPage(ctx, apiError);
          send(
            res,
            htmlReply(apiError.status, page, { ...rateHeaders, ...(apiError.headers ?? {}) }),
            ctx.nonce,
          );
          return;
        }
        // A request cut short mid-body cannot share its connection with the next one.
        const unread = apiError.code === 'payload_too_large';
        res.writeHead(apiError.status, {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          ...rateHeaders,
          ...(apiError.headers ?? {}),
          ...(unread ? { Connection: 'close' } : {}),
        });
        res.end(JSON.stringify(apiError.body()), () => {
          if (unread) req.destroy();
        });
      }
    })();
  });
}

function isPagePath(path: string): boolean {
  return !path.startsWith('/api/') && !path.startsWith('/assets/') && !path.startsWith('/media/');
}
