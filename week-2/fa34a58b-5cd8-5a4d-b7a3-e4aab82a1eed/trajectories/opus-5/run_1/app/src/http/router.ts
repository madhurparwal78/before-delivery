import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApi, type ApiRequestContext, type ApiResult } from './api';
import { ApiError, apiError } from './errors';
import { isSameOrigin } from './origin';
import { PAGE_ROUTES, renderPage } from './pages';
import { handleSim } from './sim';
import { readStaticAsset } from './static';

const MAX_JSON_BYTES = 65_536;
const MAX_CLIP_BYTES = 20_000_000;
const JSON_TYPE = 'application/json';
const OCTET_TYPE = 'application/octet-stream';

export interface Readiness {
  ready: () => boolean;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(text);
}

function sendError(
  request: IncomingMessage,
  response: ServerResponse,
  error: ApiError,
): void {
  // The body may still be arriving when a request is refused, so the socket is closed with it.
  if (!request.readableEnded) response.setHeader('connection', 'close');
  sendJson(response, error.status, error.toBody());
}

function isClipBytesPath(method: string, segments: string[]): boolean {
  return (
    method === 'PUT' &&
    segments.length === 4 &&
    segments[0] === 'sim' &&
    segments[1] === 'clips' &&
    segments[3] === 'bytes'
  );
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const part = chunk as Buffer;
    total += part.length;
    if (total > limit) {
      request.pause();
      throw apiError.tooLarge();
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

function contentTypeOf(request: IncomingMessage): string {
  const raw = request.headers['content-type'];
  if (raw === undefined) return '';
  return (raw.split(';')[0] ?? '').trim().toLowerCase();
}

async function runApi(
  request: IncomingMessage,
  segments: string[],
): Promise<ApiResult> {
  const method = request.method ?? 'GET';
  const expectsBody = method === 'POST' || method === 'PUT';
  const clipBytes = isClipBytesPath(method, segments);

  let rawBody = Buffer.alloc(0);
  let body: unknown = {};

  if (expectsBody) {
    rawBody = await readBody(request, clipBytes ? MAX_CLIP_BYTES : MAX_JSON_BYTES);
    const contentType = contentTypeOf(request);
    if (contentType !== (clipBytes ? OCTET_TYPE : JSON_TYPE)) {
      throw apiError.unsupportedMediaType();
    }
    if (!clipBytes) {
      try {
        body = rawBody.length === 0 ? {} : JSON.parse(rawBody.toString('utf8'));
      } catch {
        throw apiError.badJson();
      }
    }
  }

  const url = new URL(request.url ?? '/', 'http://localhost');
  const rawKey = request.headers['idempotency-key'];
  const context: ApiRequestContext = {
    method,
    segments,
    search: url.searchParams,
    body,
    rawBody,
    idempotencyKey: Array.isArray(rawKey) ? rawKey[0] : rawKey,
  };

  return segments[0] === 'sim' ? await handleSim(context) : await handleApi(context);
}

export function createRouter(readiness: Readiness) {
  return async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    try {
      if (pathname === '/api/health') {
        if (readiness.ready()) {
          sendJson(response, 200, { status: 'ok' });
        } else {
          sendJson(response, 503, { status: 'starting' });
        }
        return;
      }

      if ((method === 'POST' || method === 'PUT') && !isSameOrigin(request)) {
        throw apiError.forbiddenOrigin();
      }

      if (pathname === '/api' || pathname.startsWith('/api/')) {
        const segments = pathname.split('/').filter((part) => part.length > 0).slice(1);
        const result = await runApi(request, segments);
        if (result.kind === 'binary') {
          response.writeHead(result.status, {
            'content-type': result.contentType,
            'content-length': result.body.length,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          response.end(result.body);
          return;
        }
        sendJson(response, result.status, result.body);
        return;
      }

      if (method === 'GET' || method === 'HEAD') {
        if (pathname === '/') {
          response.writeHead(302, { location: '/plan' });
          response.end();
          return;
        }

        const page = PAGE_ROUTES[pathname];
        if (page) {
          const html = renderPage(page);
          response.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'content-length': Buffer.byteLength(html),
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          response.end(method === 'HEAD' ? undefined : html);
          return;
        }

        const asset = await readStaticAsset(pathname);
        if (asset) {
          response.writeHead(200, {
            'content-type': asset.contentType,
            'content-length': asset.body.length,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          response.end(method === 'HEAD' ? undefined : asset.body);
          return;
        }
      }

      throw apiError.notFound();
    } catch (error) {
      if (error instanceof ApiError) {
        sendError(request, response, error);
        return;
      }
      process.stderr.write(`Request failed: ${String(error)}\n`);
      sendJson(response, 500, {
        error: { code: 'not_found', message: 'Nothing here by that name.' },
      });
    }
  };
}
