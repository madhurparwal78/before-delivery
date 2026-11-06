import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseCookies, readBody, sendJson, type Req, type Router } from './http.js';
import { isApiFail, sendJsonError, serviceUnavailable, notFound, forbidden } from './errors.js';
import { dbUp } from './db.js';
import { S3Error, sendS3Error } from './s3-support.js';

const JSON_BODY_LIMIT = 65_536;
const RESERVED_NAMES = new Set(['share-links', 'team', 'access-keys', 'usage', 'webhooks', 'deliveries', 'security']);

/** The single request entry point. Reads the body once and dispatches. */
export async function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
  routes: { json: Router; s3: Router; pages: Router; links: Router; assets: Router },
  pageFor: (path: string) => string,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const rawPath = url.pathname;
  const method = (req.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(' ') : String(v ?? '');
  const request: Req = { method, url: req.url ?? '/', headers, rawBody: null, query: url.searchParams, rawPath, path: rawPath, params: {} };

  try {
    if (rawPath === '/api/health' && (method === 'GET' || method === 'HEAD')) {
      sendJson(res, 200, { status: 'ok' });
      return;
    }
    if (rawPath === '/' || rawPath === '' || rawPath === '/signin' || rawPath === '/account' || rawPath.startsWith('/console') || rawPath.startsWith('/ops') || rawPath.startsWith('/invite/')) {
      const handler = routes.pages.match(method, rawPath);
      if (handler) {
        request.params = handler.params;
        await handler.handler(request, res);
        return;
      }
      if (method === 'GET' || method === 'HEAD') { sendPage(res, pageFor(rawPath)); return; }
    }
    if (rawPath.startsWith('/l/')) {
      const handler = routes.links.match(method, rawPath);
      if (handler) { request.params = handler.params; await handler.handler(request, res); return; }
      sendJsonError(res, notFound().err);
      return;
    }
    if (rawPath.startsWith('/assets/') || rawPath.startsWith('/fonts/')) {
      const handler = routes.assets.match('GET', rawPath);
      if (handler) { request.params = handler.params; await handler.handler(request, res); return; }
      sendJsonError(res, notFound().err);
      return;
    }
    if (rawPath.startsWith('/api/')) {
      const handler = routes.json.match(method, rawPath);
      if (!handler) { sendJsonError(res, notFound().err); return; }
      request.params = handler.params;
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const got = headers['x-requested-with'] ?? '';
        if (got !== 'farshore') { sendJsonError(res, forbidden('Missing X-Requested-With header.').err); return; }
      }
      const declared = parseInt(headers['content-length'] ?? '0', 10);
      if (Number.isFinite(declared) && declared > JSON_BODY_LIMIT) { sendJsonError(res, { status: 413, code: 'payload_too_large', message: 'The request body is too large.' }); return; }
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || (declared > 0 && method !== 'GET')) {
        const body = await readBody(req);
        if (body.length > JSON_BODY_LIMIT) { sendJsonError(res, { status: 413, code: 'payload_too_large', message: 'The request body is too large.' }); return; }
        request.rawBody = body;
      }
      await handler.handler(request, res);
      return;
    }
    if (rawPath.startsWith('/s3/') || rawPath === '/s3') {
      const handler = routes.s3.match(method, rawPath);
      if (!handler) { sendJsonError(res, notFound().err); return; }
      request.params = handler.params;
      request.rawBody = await readBody(req);
      await handler.handler(request, res);
      return;
    }
    // Unknown paths answer 404 with the console shell or JSON.
    if (wantsJson(headers)) { sendJsonError(res, notFound().err); return; }
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Not found</title><h1>Not found</h1>');
  } catch (e) {
    if (res.headersSent) { res.destroy(); return; }
    if (isApiFail(e)) { sendJsonError(res, e.err); return; }
    if (e instanceof S3Error) {
      sendS3Error(res, e.s3status, e.s3code, e.message, rawPath, 'req', e.s3extra ?? {});
      return;
    }
    console.error('[farshore] unhandled error on', req.method, rawPath, e);
    const up = await dbUp();
    if (!up) { sendJsonError(res, serviceUnavailable().err); return; }
    if (wantsJson(headers) || rawPath.startsWith('/api/') || rawPath.startsWith('/s3/') || rawPath.startsWith('/l/')) {
      sendJsonError(res, { status: 500, code: 'internal_error', message: 'Something went wrong.' });
      return;
    }
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Error</title><h1>Something went wrong</h1>');
  }
}

export function wantsJson(headers: Record<string, string>): boolean {
  const accept = headers['accept'] ?? '';
  return accept.includes('application/json') || accept.includes('*/*');
}

export function sendPage(res: ServerResponse, html: string | null): void {
  if (html === null) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Not found</title><h1>Not found</h1>');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
  res.end(html);
}

export { RESERVED_NAMES, parseCookies };
