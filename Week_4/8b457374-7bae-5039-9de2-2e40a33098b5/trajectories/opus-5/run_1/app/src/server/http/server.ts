import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pool } from '../data/db.js';
import { findPersonByKey } from '../data/people.js';
import { ApiError } from './errors.js';
import {
  IMAGE_BODY_LIMIT,
  JSON_BODY_LIMIT,
  imageContentType,
  parseJsonBody,
  readBearerKey,
  readRawBody,
  type RequestContext,
  type Route,
  type RouteResult,
  type Router,
} from './router.js';
import { readAsset, SHELL_HTML, type Asset } from './assets.js';

/** The page paths the browser app owns; everything else is not a page. */
const PAGE_PATTERNS: readonly RegExp[] = [
  /^\/$/,
  /^\/campaigns\/[^/]+$/,
  /^\/studio$/,
  /^\/studio\/campaigns\/[^/]+$/,
  /^\/pledges$/,
  /^\/fix\/[^/]+$/,
];

const FILE_LIKE = /\.[a-z0-9]+$/i;

/**
 * Paths that are never a page: the project's own directories, and the filesystem roots
 * a traversal attempt normalises to.
 */
const NEVER_A_PAGE: ReadonlySet<string> = new Set([
  'src',
  'dist',
  'node_modules',
  'public',
  'logs',
  'etc',
  'proc',
  'sys',
  'var',
  'usr',
  'bin',
  'root',
  'home',
  'tmp',
]);

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  const payload = Buffer.from(html, 'utf8');
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

function sendAsset(response: ServerResponse, asset: Asset): void {
  response.writeHead(200, {
    'content-type': asset.contentType,
    'content-length': asset.body.length,
    'cache-control': 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  });
  response.end(asset.body);
}

async function buildContext(
  request: IncomingMessage,
  url: URL,
  route: Route,
  params: Record<string, string>,
): Promise<RequestContext> {
  const limit = route.body === 'image' ? IMAGE_BODY_LIMIT : JSON_BODY_LIMIT;
  const raw = await readRawBody(request, limit);

  let body: Record<string, unknown> = {};
  if (route.body === 'json') {
    body = parseJsonBody(raw, request.headers);
  } else if (route.body === 'image') {
    imageContentType(request.headers);
  }

  let person = null;
  const key = readBearerKey(request.headers);
  if (route.auth !== 'none') {
    if (key !== null) {
      person = await findPersonByKey(pool, key);
      if (person === null) throw new ApiError(401, 'unauthenticated');
    }
    if (person === null && route.auth === 'required') {
      throw new ApiError(401, 'unauthenticated');
    }
  }

  return {
    method: request.method ?? 'GET',
    url,
    params,
    headers: request.headers,
    body,
    raw,
    person,
  };
}

function sendResult(response: ServerResponse, result: RouteResult): void {
  if (result.kind === 'json') {
    sendJson(response, result.status, result.body);
    return;
  }
  if (result.kind === 'empty') {
    response.writeHead(result.status, { 'content-length': 0 });
    response.end();
    return;
  }
  const headers: Record<string, string | number> = {
    'content-type': result.contentType,
    'content-length': result.body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (result.filename !== undefined) {
    headers['content-disposition'] = `attachment; filename="${result.filename}"`;
  }
  response.writeHead(result.status, headers);
  response.end(result.body);
}

export function startServer(router: Router, port: number): Promise<void> {
  const server = createServer((request, response) => {
    void handle(router, request, response);
  });
  server.requestTimeout = 60_000;
  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => resolve());
  });
}

async function handle(
  router: Router,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  const firstSegment = pathname.split('/')[1] ?? '';
  if (
    pathname.includes('..') ||
    firstSegment.startsWith('.') ||
    NEVER_A_PAGE.has(firstSegment)
  ) {
    request.resume();
    sendJson(response, 404, { error: 'not_found' });
    return;
  }

  if (pathname.startsWith('/api/')) {
    const matched = router.match(request.method ?? 'GET', pathname);
    if (matched === null) {
      request.resume();
      sendJson(response, 404, { error: 'not_found' });
      return;
    }
    try {
      const ctx = await buildContext(request, url, matched.route, matched.params);
      sendResult(response, await matched.route.handle(ctx));
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(response, error.status, error.toBody());
        return;
      }
      process.stderr.write(`request failed: ${String(error)}\n`);
      sendJson(response, 500, { error: 'server_error' });
    }
    return;
  }

  request.resume();
  const asset = readAsset(pathname);
  if (asset !== null) {
    sendAsset(response, asset);
    return;
  }
  if (PAGE_PATTERNS.some((pattern) => pattern.test(pathname))) {
    sendHtml(response, 200, SHELL_HTML);
    return;
  }
  if (FILE_LIKE.test(pathname)) {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }
  sendHtml(response, 404, SHELL_HTML);
}
