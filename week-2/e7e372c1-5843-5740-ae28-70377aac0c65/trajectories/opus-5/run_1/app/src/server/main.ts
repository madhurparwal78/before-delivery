import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { loadConfig } from './config';
import { ApiError, fail } from './errors';
import {
  ApiResponse,
  RequestContext,
  errorResponse,
  headerOf,
  writeResponse,
} from './http';
import { isCrossSiteWrite } from '../domain/origin';
import { VaultUnreachable } from './s3';
import { applySchema } from './schema';
import { loadSecrets } from './secrets';
import { applySeed } from './seed';
import { startVaultProbe } from './vault';
import { processDueSessionCloses, startSessionCloseTimer } from './sessionClose';
import { startTapePlayer } from './tape';
import { loadStaticAssets, staticResponse } from './staticAssets';
import {
  getBoard,
  getCitation,
  getClock,
  getComputation,
  getHealth,
  getSessionCalendar,
} from './routes/public';
import { getExhibit } from './routes/exhibits';
import { postTick } from './routes/ticks';
import {
  deleteSession,
  getAuditTrail,
  getRestatement,
  getSession,
  listRestatements,
  patchRestatement,
  postClear,
  postRelease,
  postRestatement,
  postReturn,
  postSession,
  postSubmit,
  postWithdraw,
  putExhibit,
} from './routes/staff';
import { getTape, getTickKeyEndpoint, putClock, putTape } from './routes/operator';

type Handler = (context: RequestContext) => Promise<ApiResponse> | ApiResponse;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

function route(method: string, template: string, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = template
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { method, pattern: new RegExp(`^${pattern}$`), keys, handler };
}

const ROUTES: readonly Route[] = [
  route('GET', '/api/health', getHealth),
  route('GET', '/api/clock', getClock),
  route('GET', '/api/session-calendar', getSessionCalendar),
  route('GET', '/api/board', getBoard),
  route('GET', '/api/computations/:id', getComputation),
  route('GET', '/api/citations/:figure/:date', getCitation),
  route('GET', '/api/exhibits/:sha256', getExhibit),
  route('POST', '/api/session', postSession),
  route('GET', '/api/session', getSession),
  route('DELETE', '/api/session', deleteSession),
  route('GET', '/api/restatements', listRestatements),
  route('POST', '/api/restatements', postRestatement),
  route('GET', '/api/restatements/:id', getRestatement),
  route('PATCH', '/api/restatements/:id', patchRestatement),
  route('GET', '/api/restatements/:id/audit', getAuditTrail),
  route('PUT', '/api/restatements/:id/exhibit', putExhibit),
  route('POST', '/api/restatements/:id/submit', postSubmit),
  route('POST', '/api/restatements/:id/return', postReturn),
  route('POST', '/api/restatements/:id/clear', postClear),
  route('POST', '/api/restatements/:id/release', postRelease),
  route('POST', '/api/restatements/:id/withdraw', postWithdraw),
  route('GET', '/api/operator/tape', getTape),
  route('PUT', '/api/operator/tape', putTape),
  route('PUT', '/api/operator/clock', putClock),
  route('GET', '/api/operator/tick-key', getTickKeyEndpoint),
  route('POST', '/api/internal/ticks', postTick),
];

function matchRoute(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const candidate of ROUTES) {
    if (candidate.method !== method) continue;
    const match = candidate.pattern.exec(pathname);
    if (match === null) continue;
    const params: Record<string, string> = {};
    candidate.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1] ?? '');
    });
    return { route: candidate, params };
  }
  return null;
}

const DRAIN_LIMIT = 64 * 1024 * 1024;

/**
 * Consumes any remaining request body before an error response is written, so
 * the client receives the refusal instead of a reset connection.
 */
async function drain(request: IncomingMessage): Promise<void> {
  if (request.readableEnded || request.destroyed) return;
  let seen = 0;
  await new Promise<void>((resolve) => {
    const onData = (chunk: Buffer): void => {
      seen += chunk.length;
      if (seen > DRAIN_LIMIT) {
        request.destroy();
        resolve();
      }
    };
    request.on('data', onData);
    request.once('end', () => resolve());
    request.once('error', () => resolve());
    request.once('close', () => resolve());
  });
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = (request.method ?? 'GET').toUpperCase();
  const url = new URL(request.url ?? '/', 'http://placeholder');
  const pathname = url.pathname;
  const context: RequestContext = {
    method,
    path: pathname,
    searchParams: url.searchParams,
    headers: request.headers,
    params: {},
    request,
  };

  if (
    isCrossSiteWrite({
      method,
      origin: headerOf(context, 'origin'),
      host: headerOf(context, 'host'),
      secFetchSite: headerOf(context, 'sec-fetch-site'),
    })
  ) {
    await drain(request);
    writeResponse(response, errorResponse(fail('cross_origin')));
    return;
  }

  const matched = matchRoute(method, pathname);
  if (matched !== null) {
    context.params = matched.params;
    try {
      writeResponse(response, await matched.route.handler(context));
    } catch (failure) {
      await drain(request);
      if (failure instanceof ApiError) {
        writeResponse(response, errorResponse(failure));
      } else if (failure instanceof VaultUnreachable) {
        writeResponse(response, errorResponse(fail('vault_unavailable')));
      } else {
        writeResponse(response, errorResponse(fail('internal')));
      }
    }
    return;
  }

  if (pathname.startsWith('/api/')) {
    writeResponse(response, errorResponse(fail('not_found')));
    return;
  }

  if (method === 'GET' || method === 'HEAD') {
    const asset = staticResponse(pathname);
    if (asset !== null) {
      writeResponse(response, method === 'HEAD' ? { ...asset, bytes: Buffer.alloc(0) } : asset);
      return;
    }
  }
  writeResponse(response, errorResponse(fail('not_found')));
}

async function start(): Promise<void> {
  const config = loadConfig();
  loadStaticAssets();
  await applySchema();
  await loadSecrets();
  await applySeed();
  await processDueSessionCloses();
  startVaultProbe();
  startSessionCloseTimer();
  startTapePlayer(config.port);

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) {
        writeResponse(response, errorResponse(fail('internal')));
      } else {
        response.end();
      }
    });
  });
  server.listen(config.port, '0.0.0.0');
}

void start().catch(() => {
  process.exitCode = 1;
});
