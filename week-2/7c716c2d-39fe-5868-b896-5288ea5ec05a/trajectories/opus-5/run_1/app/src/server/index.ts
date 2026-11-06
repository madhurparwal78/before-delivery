import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actorFromToken, touchPresence } from './access.js';
import { config } from './config.js';
import { ApiError } from './errors.js';
import { startEventPump } from './events.js';
import {
  cookies,
  HANDLED,
  isJsonContentType,
  isMultipartContentType,
  JSON_BODY_LIMIT,
  parseJsonBody,
  readBody,
  sameOrigin,
  send,
  UPLOAD_BODY_LIMIT,
  type Reply,
} from './http.js';
import { startJobs } from './jobs.js';
import { attachmentRoutes } from './routes/attachments.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import { chatRoutes } from './routes/chat.js';
import { docRoutes } from './routes/docs.js';
import { issueRoutes } from './routes/issues.js';
import { officeRoutes } from './routes/office.js';
import { peopleRoutes } from './routes/people.js';
import { streamRoutes } from './routes/stream.js';
import { workspaceRoutes } from './routes/workspace.js';
import { matchRoute, type Ctx, type Route } from './router.js';
import { applySchemaAndSeed, schemaReady } from './schema.js';
import { ensureCatalog } from './services/killbill.js';
import { startStatusProbe } from './services/status.js';
import { ensureBucket } from './services/storage.js';

const routes: Route[] = [
  ...workspaceRoutes,
  ...authRoutes,
  ...streamRoutes,
  ...issueRoutes,
  ...chatRoutes,
  ...docRoutes,
  ...attachmentRoutes,
  ...officeRoutes,
  ...peopleRoutes,
  ...billingRoutes,
];

const publicDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');

const moduleSegments = new Set(['issues', 'cycle', 'chat', 'docs', 'office', 'settings', 'account']);
const publicPaths = new Set(['', 'sign-in', 'create-account', 'invitations', 'welcome']);

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

const stateChanging = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function serveFile(path: string, response: ServerResponse, method: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    const type = contentTypes[extname(path)] ?? 'application/octet-stream';
    const immutable = extname(path) === '.woff2';
    response.writeHead(200, {
      'Content-Type': type,
      'Content-Length': String(info.size),
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (method === 'HEAD') {
      response.end();
      return true;
    }
    response.end(await readFile(path));
    return true;
  } catch {
    return false;
  }
}

function notFoundPage(response: ServerResponse): void {
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end('Not found');
}

async function serveStatic(pathname: string, response: ServerResponse, method: string): Promise<void> {
  const segments = normalize(pathname).split('/').filter((part) => part !== '');
  const first = segments[0] ?? '';
  if (segments.length > 0 && !first.includes('..')) {
    const asset = join(publicDir, ...segments);
    if (asset.startsWith(publicDir) && (await serveFile(asset, response, method))) return;
  }
  if (segments.length === 0 || moduleSegments.has(first) || publicPaths.has(first)) {
    if (await serveFile(join(publicDir, 'index.html'), response, method)) return;
  }
  notFoundPage(response);
}

async function dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (!url.pathname.startsWith('/api/')) {
    if (method === 'GET' || method === 'HEAD') await serveStatic(url.pathname, response, method);
    else notFoundPage(response);
    return;
  }

  const match = matchRoute(routes, method, url.pathname);
  if (match === undefined) {
    send(response, { status: 404, body: new ApiError('not_found').body() });
    return;
  }
  const { route, params } = match;

  let rawBody: Buffer = Buffer.alloc(0);
  let body: Record<string, unknown> = {};
  const hasPayload =
    request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0';
  const chunked = request.headers['transfer-encoding'] !== undefined;

  if (route.body === 'json') {
    if (request.headers['content-type'] !== undefined && !isJsonContentType(request)) {
      throw new ApiError('unsupported_media_type');
    }
    if (hasPayload || chunked) {
      rawBody = await readBody(request, JSON_BODY_LIMIT);
      body = parseJsonBody(rawBody);
    }
  } else if (route.body === 'multipart') {
    if (!isMultipartContentType(request)) throw new ApiError('unsupported_media_type');
    rawBody = await readBody(request, UPLOAD_BODY_LIMIT);
  }

  if (stateChanging.has(method) && !sameOrigin(request)) throw new ApiError('cross_origin');

  const token = cookies(request).tr_session;
  const header = request.headers['last-event-id'];
  const ctx: Ctx = {
    method,
    url,
    params,
    body,
    rawBody,
    request,
    response,
    idempotencyKey: headerValue(request, 'idempotency-key'),
    lastEventId: typeof header === 'string' ? header : url.searchParams.get('last_event_id') ?? undefined,
    sessionToken: token,
    resolveActor: async () => {
      if (!schemaReady()) return null;
      try {
        return (await actorFromToken(token)) ?? null;
      } catch {
        return null;
      }
    },
  };

  let reply: Reply | typeof HANDLED;
  if (route.kind === 'public') {
    reply = await route.handler(ctx);
  } else {
    if (!schemaReady()) throw new ApiError('database_unavailable');
    const actor = await actorFromToken(token);
    if (actor === undefined) throw new ApiError('unauthenticated');
    await touchPresence(actor);
    reply = await route.handler({ ...ctx, actor });
  }
  if (reply !== HANDLED) send(response, reply);
}

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  if (typeof value === 'string') return value;
  return Array.isArray(value) ? value[0] : undefined;
}

const server = createServer((request, response) => {
  dispatch(request, response).catch((error: unknown) => {
    if (response.headersSent) {
      response.end();
      return;
    }
    if (error instanceof ApiError) {
      const closing = error.code === 'too_large';
      send(response, {
        status: error.status,
        body: error.body(),
        headers: closing ? { Connection: 'close' } : {},
      });
      if (closing) request.destroy();
      return;
    }
    process.stderr.write(`request failed: ${String(error)}\n`);
    send(response, {
      status: 500,
      body: { error: { code: 'internal', message: 'Something went wrong.' } },
    });
  });
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;
server.requestTimeout = 0;

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`tallyroom serving on ${config.port}\n`);
});

/** Dependencies may be down at boot; each is retried until it answers. */
async function prepare(): Promise<void> {
  for (;;) {
    try {
      if (!schemaReady()) await applySchemaAndSeed();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  void retry(ensureBucket);
  void retry(ensureCatalog);
}

async function retry(step: () => Promise<void>): Promise<void> {
  for (;;) {
    try {
      await step();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

void prepare();
startEventPump();
startStatusProbe();
startJobs();
