import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locale } from '../shared/types.js';
import { config, LIMITS } from './config.js';
import { applySchemaAndSeed, } from './db/seed.js';
import { waitForDatabase } from './db/pool.js';
import { parseCookies } from './http/cookies.js';
import { COOKIE, RequestContext, resolveLocale } from './http/context.js';
import { ApiError, errors } from './http/errors.js';
import { apiRouter } from './routes/index.js';
import { loadCustomer, loadStaff } from './routes/sessions.js';
import { purgeExpiredIdempotencyRecords } from './http/idempotency.js';
import { pageStatus, renderShell } from './pages.js';
import { startBillingMonitor } from './services/billing-status.js';
import { startOutbox } from './services/outbox.js';
import { startSubscriptionBilling } from './services/subscription-billing.js';

const publicDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function ownOrigin(request: IncomingMessage): string {
  return `http://${request.headers.host ?? ''}`;
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > LIMITS.maxBodyBytes) throw errors.payloadTooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string>,
  cookies: readonly string[],
): void {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const out: Record<string, string | string[]> = { ...headers };
  if (payload !== '') {
    out['Content-Type'] = 'application/json; charset=utf-8';
    out['Content-Length'] = String(Buffer.byteLength(payload));
  }
  out['Cache-Control'] = 'no-store';
  out['X-Content-Type-Options'] = 'nosniff';
  if (cookies.length > 0) out['Set-Cookie'] = [...cookies];
  response.writeHead(status, out);
  response.end(payload);
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(html)),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(html);
}

function sendPlain(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(text)),
  });
  response.end(text);
}

async function serveAsset(path: string, response: ServerResponse): Promise<boolean> {
  const relative = normalize(path.slice('/assets/'.length));
  if (relative.startsWith('..') || relative.includes('\0')) return false;
  const extension = relative.slice(relative.lastIndexOf('.'));
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) return false;
  try {
    const file = await readFile(join(publicDir, relative));
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(file.length),
      'Cache-Control': extension === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    response.end(file);
    return true;
  } catch {
    return false;
  }
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  rawBody: Buffer,
): Promise<void> {
  const cookies = parseCookies(request.headers.cookie);
  const locale = resolveLocale(cookies.get(COOKIE.locale), request.headers['accept-language']);
  let ctx: RequestContext | null = null;
  try {
    const method = request.method ?? 'GET';
    if (MUTATING.has(method)) {
      const hasBody = rawBody.length > 0;
      const contentType = (request.headers['content-type'] ?? '').split(';')[0]?.trim();
      if (hasBody && contentType !== 'application/json') throw errors.unsupportedMediaType();
      const origin = request.headers.origin;
      if (origin !== undefined && origin !== ownOrigin(request)) throw errors.crossOrigin();
    }
    let body: unknown;
    if (rawBody.length > 0) {
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        body = null;
      }
    }
    ctx = new RequestContext({
      method,
      path: url.pathname,
      query: url.searchParams,
      headers: request.headers,
      cookies,
      body,
    });
    const match = apiRouter.resolve(ctx);
    ctx.params = match.params;
    if (match.route.auth === 'customer') {
      ctx.customer = await loadCustomer(ctx);
      if (!ctx.customer) throw errors.unauthenticated();
    } else if (match.route.auth === 'staff') {
      ctx.staff = await loadStaff(ctx);
      if (!ctx.staff) throw errors.unauthenticated();
    } else {
      ctx.customer = await loadCustomer(ctx);
      ctx.staff = await loadStaff(ctx);
    }
    const result = await match.route.handler(ctx);
    sendJson(response, result.status, result.body, result.headers ?? {}, ctx.responseCookies);
  } catch (error) {
    const apiError = error instanceof ApiError ? error : null;
    if (!apiError) process.stderr.write(`unhandled: ${String(error)}\n`);
    const resolved = apiError ?? new ApiError(500, 'internal_error', {
      'en-CA': 'Something went wrong. Try again.',
      'fr-CA': "Une erreur s'est produite. Réessayez.",
    });
    sendJson(
      response,
      resolved.status,
      resolved.body(ctx?.locale ?? locale),
      resolved.headers,
      ctx?.responseCookies ?? [],
    );
  }
}

async function handlePage(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  locale: Locale,
): Promise<void> {
  const lastSegment = url.pathname.split('/').pop() ?? '';
  if (lastSegment.includes('.')) {
    sendPlain(response, 404, 'Not found');
    return;
  }
  const cookies = parseCookies(request.headers.cookie);
  const ctx = new RequestContext({
    method: request.method ?? 'GET',
    path: url.pathname,
    query: url.searchParams,
    headers: request.headers,
    cookies,
    body: undefined,
  });
  const customer = await loadCustomer(ctx).catch(() => null);
  const status = await pageStatus(url.pathname, customer);
  sendHtml(response, status, renderShell(locale, status));
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    try {
      if (url.pathname === '/api/health') {
        sendJson(response, 200, { status: 'ok' }, {}, []);
        return;
      }
      if (url.pathname.startsWith('/assets/')) {
        if (await serveAsset(url.pathname, response)) return;
        sendPlain(response, 404, 'Not found');
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        const rawBody = await readRequestBody(request);
        await handleApi(request, response, url, rawBody);
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendPlain(response, 405, 'Method not allowed');
        return;
      }
      const cookies = parseCookies(request.headers.cookie);
      const locale = resolveLocale(cookies.get(COOKIE.locale), request.headers['accept-language']);
      await handlePage(request, response, url, locale);
    } catch (error) {
      if (error instanceof ApiError) {
        const cookies = parseCookies(request.headers.cookie);
        const locale = resolveLocale(cookies.get(COOKIE.locale), request.headers['accept-language']);
        sendJson(response, error.status, error.body(locale), error.headers, []);
        return;
      }
      process.stderr.write(`request failed: ${String(error)}\n`);
      if (!response.headersSent) sendPlain(response, 500, 'Server error');
    }
  })();
});

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`loafline listening on ${config.port}\n`);
});

void (async () => {
  await waitForDatabase();
  await applySchemaAndSeed();
  startBillingMonitor();
  startOutbox();
  startSubscriptionBilling();
  setInterval(() => void purgeExpiredIdempotencyRecords(LIMITS.idempotencySeconds), 60_000);
})();
