import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { ApiError } from './errors.js';
import { JSON_BODY_LIMIT, UPLOAD_BODY_LIMIT, readBody } from './body.js';
import { RouteContext, type RouteResult } from './context.js';
import { matchRoute, type Route } from './router.js';
import { asset, indexHtml, isAppRoute } from './assets.js';
import { actorForSession, sessionRoutes, SESSION_COOKIE } from '../routes/session.js';
import { requestRoutes } from '../routes/requests.js';
import { seatRoutes } from '../routes/seats.js';
import { credentialRoutes } from '../routes/credentials.js';
import { cancellationRoutes } from '../routes/cancellation.js';
import { billingRoutes } from '../routes/billing.js';

const ROUTES: readonly Route[] = [
  ...sessionRoutes,
  ...requestRoutes,
  ...seatRoutes,
  ...credentialRoutes,
  ...cancellationRoutes,
  ...billingRoutes,
];

const UPLOAD_PATH = '/api/me/credentials';
const HEALTH_PATH = '/api/health';

function sessionIdFrom(cookieHeader: string | undefined): string | null {
  if (cookieHeader === undefined) return null;
  const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(cookieHeader);
  return match === null ? null : (match[1] as string);
}

function send(response: ServerResponse, result: RouteResult, cookies: readonly string[]): void {
  const headers: Record<string, string | string[]> = {};
  if (cookies.length > 0) headers['set-cookie'] = [...cookies];
  switch (result.kind) {
    case 'json':
      headers['content-type'] = 'application/json; charset=utf-8';
      response.writeHead(result.status, headers);
      response.end(JSON.stringify(result.body));
      return;
    case 'empty':
      response.writeHead(result.status, headers);
      response.end();
      return;
    case 'text':
      headers['content-type'] = result.contentType;
      for (const [name, value] of Object.entries(result.headers ?? {})) headers[name] = value;
      response.writeHead(result.status, headers);
      response.end(result.body);
      return;
  }
}

function sendApiError(response: ServerResponse, error: ApiError): void {
  send(response, { kind: 'json', status: error.status, body: error.body() }, []);
}

function sendNotFoundPage(response: ServerResponse): void {
  const html = indexHtml();
  if (html === null) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(404, { 'content-type': html.contentType });
  response.end(html.body);
}

async function handleApi(
  incoming: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const method = incoming.method ?? 'GET';
  // Health answers before any dependency is touched, including the session lookup.
  if (method === 'GET' && url.pathname === HEALTH_PATH) {
    incoming.resume();
    send(response, { kind: 'json', status: 200, body: { status: 'ok' } }, []);
    return;
  }
  const limit = url.pathname === UPLOAD_PATH ? UPLOAD_BODY_LIMIT : JSON_BODY_LIMIT;

  let raw: Buffer;
  try {
    raw = await readBody(incoming, limit);
  } catch (error) {
    if (error instanceof ApiError) {
      const body = JSON.stringify(error.body());
      response.writeHead(error.status, {
        'content-type': 'application/json; charset=utf-8',
        connection: 'close',
      });
      response.end(body, () => incoming.destroy());
    } else {
      response.destroy();
    }
    return;
  }

  const match = matchRoute(ROUTES, method, url.pathname);
  if (match === null || match === 'method') {
    sendApiError(response, new ApiError('not_found'));
    return;
  }

  const actor = await actorForSession(sessionIdFrom(incoming.headers.cookie) ?? '');
  const ctx = new RouteContext({
    method,
    url,
    params: match.params,
    headers: incoming.headers,
    raw,
    actor,
  });

  try {
    send(response, await match.handler(ctx), ctx.cookies);
  } catch (error) {
    if (error instanceof ApiError) sendApiError(response, error);
    else {
      send(
        response,
        { kind: 'json', status: 500, body: { error: { code: 'internal', message: 'Server error.' } } },
        [],
      );
    }
  }
}

function serveStatic(response: ServerResponse, pathname: string): void {
  const found = asset(pathname);
  if (found !== null && pathname !== '/index.html') {
    response.writeHead(200, {
      'content-type': found.contentType,
      'cache-control': found.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    response.end(found.body);
    return;
  }
  if (isAppRoute(pathname)) {
    const html = indexHtml();
    if (html !== null) {
      response.writeHead(200, { 'content-type': html.contentType, 'cache-control': 'no-cache' });
      response.end(html.body);
      return;
    }
  }
  sendNotFoundPage(response);
}

export function createHttpServer(): Server {
  return createServer((incoming, response) => {
    const url = new URL(incoming.url ?? '/', `http://${incoming.headers.host ?? 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      void handleApi(incoming, response, url);
      return;
    }
    incoming.resume();
    serveStatic(response, url.pathname);
  });
}
