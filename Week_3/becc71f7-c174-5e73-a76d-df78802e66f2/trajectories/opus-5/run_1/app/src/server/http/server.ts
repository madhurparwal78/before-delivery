import { createServer as createNodeServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { RequestContext, type ApiResponse, type AppContext } from './context.js';
import { ApiError, payloadTooLarge } from './errors.js';
import { Router, requireAccess, requireContentType } from './router.js';
import { SESSION_COOKIE, authenticate, parseCookies } from './sessions.js';
import { renderShell } from './shell.js';
import { matchScreenRoute } from '../../shared/routes.js';
import { StorageUnavailable } from '../services/storage.js';
import { MailUnavailable } from '../services/mail.js';

const ASSET_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

/** Reads the body, stopping at its limit so an oversized body is answered as JSON. */
async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) {
    request.resume();
    throw payloadTooLarge('That request body is over its size limit.');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) {
      request.resume();
      throw payloadTooLarge('That request body is over its size limit.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function writeResponse(response: ServerResponse, api: ApiResponse): void {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...(api.headers ?? {}),
  };
  if (api.kind === 'json') {
    const text = JSON.stringify(api.body);
    response.writeHead(api.status, {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
    });
    response.end(text);
    return;
  }
  if (api.kind === 'empty') {
    response.writeHead(api.status, headers);
    response.end();
    return;
  }
  response.writeHead(api.status, {
    ...headers,
    'Content-Type': api.contentType,
    'Content-Length': api.body.length,
  });
  response.end(api.body);
}

function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof StorageUnavailable) {
    return new ApiError(503, 'storage_unavailable', 'Storage is unreachable right now.');
  }
  if (error instanceof MailUnavailable) {
    return new ApiError(503, 'mail_unavailable', 'Mail is unreachable right now.');
  }
  console.error('unhandled request failure', error);
  return new ApiError(500, 'internal_error', 'Something went wrong.');
}

export function createHttpServer(app: AppContext, router: Router, publicDir: string) {
  const shellFor = (status: number): ApiResponse => ({
    kind: 'bytes',
    status,
    body: Buffer.from(renderShell(), 'utf8'),
    contentType: 'text/html; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
  });

  async function handleApi(
    request: IncomingMessage,
    url: URL,
    method: string,
  ): Promise<ApiResponse> {
    const match = router.match(method, url.pathname);
    const { route } = match;

    const body = await readBody(request, route.bodyLimit);

    const cookies = parseCookies(request.headers.cookie);
    const ctx = new RequestContext(app, method, url, request.headers, body, cookies, app.now());
    Object.assign(ctx.params, match.params);

    if (route.earlyLimit !== null) await route.earlyLimit(ctx);

    if (route.access === 'public') {
      ctx.member = await authenticate(app.db, cookies[SESSION_COOKIE], ctx.now).catch(() => null);
    } else {
      ctx.member = await authenticate(app.db, cookies[SESSION_COOKIE], ctx.now);
    }

    const resolved = route.resolve === null ? undefined : await route.resolve(ctx);

    requireAccess(ctx, route.access);
    if (route.lateLimit !== null) await route.lateLimit(ctx);
    requireContentType(ctx, route.expects);

    return route.handle(ctx, resolved);
  }

  async function handleAsset(pathname: string): Promise<ApiResponse | null> {
    const extension = extname(pathname);
    const contentType = ASSET_TYPES[extension];
    if (contentType === undefined) return null;
    const relative = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^[/\\]+/, '');
    const file = join(publicDir, relative);
    if (!file.startsWith(publicDir)) return null;
    const found = await stat(file).catch(() => null);
    if (found === null || !found.isFile()) return null;
    return {
      kind: 'bytes',
      status: 200,
      body: await readFile(file),
      contentType,
      headers: {
        'Cache-Control': extension === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
      },
    };
  }

  return createNodeServer((request, response) => {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    const run = async (): Promise<ApiResponse> => {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        return handleApi(request, url, method);
      }
      if (method !== 'GET' && method !== 'HEAD') {
        return shellFor(404);
      }
      const asset = await handleAsset(url.pathname);
      if (asset !== null) return asset;
      return shellFor(matchScreenRoute(url.pathname) === null ? 404 : 200);
    };

    run()
      .then((api) => writeResponse(response, api))
      .catch((error: unknown) => {
        const failure = asApiError(error);
        writeResponse(response, {
          kind: 'json',
          status: failure.status,
          body: failure.body(),
          headers: failure.headers,
        });
      });
  });
}
