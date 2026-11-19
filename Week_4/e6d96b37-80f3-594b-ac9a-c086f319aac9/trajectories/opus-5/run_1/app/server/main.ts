import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { app } from './config.ts';
import { ApiError, notFound } from './http/errors.ts';
import { Router, gradingKeyValid, type RouteRequest } from './http/router.ts';
import { sendJson } from './http/request.ts';
import { pageHtml, serveAsset } from './http/assets.ts';
import { resolveSession } from './session.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerReadRoutes } from './routes/reads.ts';
import { registerStockRoutes } from './routes/stock.ts';
import { registerExchangeRoutes } from './routes/exchange.ts';
import { registerDisputeRoutes } from './routes/disputes.ts';
import { registerGradingRoutes } from './routes/grading.ts';
import { startBackground } from './background.ts';

const router = new Router();
registerAuthRoutes(router);
registerReadRoutes(router);
registerStockRoutes(router);
registerExchangeRoutes(router);
registerDisputeRoutes(router);
registerGradingRoutes(router);

/** Pages the built frontend owns. Everything else is not found. */
function isPagePath(pathname: string): boolean {
  if (pathname === '/' || pathname === '/help' || pathname === '/help/evidence') return true;
  if (pathname === '/help/keyboard') return true;
  const parts = pathname.split('/').filter((part) => part !== '');
  return parts[0] === 'desk' && parts.length >= 2 && parts.length <= 3;
}

function sendPage(response: ServerResponse): void {
  const body = Buffer.from(pageHtml(), 'utf8');
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function sendError(response: ServerResponse, error: ApiError): void {
  const headers: Record<string, string> = {};
  if (error.allow) headers['allow'] = error.allow.join(', ');
  if (error.retryAfterSeconds !== undefined) {
    headers['retry-after'] = String(error.retryAfterSeconds);
  }
  sendJson(response, error.status, error.body(), headers);
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', app.publicUrl);
  const pathname = url.pathname;

  // Health answers whenever the HTTP server runs, whatever else is down.
  if (pathname === '/api/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (pathname.startsWith('/static/')) {
    const served = await serveAsset(pathname.slice('/static/'.length), response);
    if (served) return;
    sendError(response, notFound());
    return;
  }

  const isApi =
    pathname.startsWith('/api/') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/__grade') ||
    pathname.startsWith('/evidence/');

  if (!isApi) {
    if (isPagePath(pathname)) {
      sendPage(response);
      return;
    }
    sendError(response, notFound());
    return;
  }

  // The caller's role decides which routes exist at all, so a hidden route
  // never reveals itself through another status.
  let session = null;
  try {
    session = await resolveSession(request);
  } catch {
    // An unreachable Postgres leaves the caller anonymous; the route itself
    // answers with the published outage behaviour.
    session = null;
  }

  const resolved = router.resolve(pathname, request.method ?? 'GET', {
    role: session?.role ?? null,
    gradingKeyValid: gradingKeyValid(request),
  });

  const context: RouteRequest = {
    request,
    response,
    url,
    params: resolved.params,
    session,
  };
  await resolved.handler(context);
}

const server = createServer((request, response) => {
  handle(request, response).catch((error: unknown) => {
    if (response.headersSent) {
      response.end();
      return;
    }
    if (error instanceof ApiError) {
      sendError(response, error);
      return;
    }
    process.stderr.write(`unhandled: ${String(error)}\n`);
    sendJson(response, 503, {
      error: 'service_unavailable',
      message: 'Service unavailable. Your changes are still here.',
    });
  });
});

// A closed stream must release its database work at once.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;
server.requestTimeout = 0;

server.listen(app.port, '0.0.0.0', () => {
  process.stdout.write(`flan listening on 0.0.0.0:${app.port}\n`);
  startBackground();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
