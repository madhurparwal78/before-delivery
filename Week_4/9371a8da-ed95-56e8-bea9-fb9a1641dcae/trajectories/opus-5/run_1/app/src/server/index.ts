import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.js';
import { sweepMentionEmails } from './domain/mentions.js';
import { liveShareProjectId } from './domain/share.js';
import {
  checkOrigin,
  JSON_BODY_CAP,
  parseJsonBody,
  readBody,
  UPLOAD_BODY_CAP,
} from './http/boundary.js';
import {
  Ctx,
  loadSessionUser,
  readCookie,
  SESSION_COOKIE,
  SessionUser,
} from './http/context.js';
import { ApiError, internal, methodNotAllowed, notFound, unauthenticated } from './http/errors.js';
import { sendBytes, sendEmpty, sendError, sendJson, securityHeaders } from './http/respond.js';
import { Router } from './http/router.js';
import { exportRoutes } from './routes/exports.js';
import { fileRoutes } from './routes/files.js';
import { historyRoutes } from './routes/history.js';
import { inviteRoutes } from './routes/invites.js';
import { memberRoutes } from './routes/members.js';
import { reviewRoutes } from './routes/review.js';
import { sessionRoutes } from './routes/session.js';
import { shareRoutes } from './routes/share.js';
import { applySchemaAndSeed } from './seed.js';
import { serveAsset, servePage } from './static.js';

const router = new Router([
  ...sessionRoutes,
  ...fileRoutes,
  ...reviewRoutes,
  ...historyRoutes,
  ...exportRoutes,
  ...memberRoutes,
  ...inviteRoutes,
  ...shareRoutes,
]);

const PAGE_PATTERNS = [/^\/$/, /^\/signin$/, /^\/p\/[^/]+$/, /^\/invite\/[^/]+$/];

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const method = (request.method ?? 'GET').toUpperCase();
  const pathMatch = router.matchByPath(url.pathname);
  const cap =
    pathMatch !== null && pathMatch.routes.some((route) => route.upload === true)
      ? UPLOAD_BODY_CAP
      : JSON_BODY_CAP;
  const raw = await readBody(request, cap);

  if (url.pathname.startsWith('/api/share/') && method !== 'GET' && method !== 'HEAD') {
    throw new ApiError(405, 'read_only');
  }
  if (pathMatch === null) throw notFound();
  const route = pathMatch.routes.find((candidate) => candidate.method === method);
  if (route === undefined) throw methodNotAllowed();

  const body = route.upload === true ? {} : parseJsonBody(request, raw, route.keys.length > 0);
  checkOrigin(request);

  const sessionId = readCookie(request, SESSION_COOKIE);
  let user: SessionUser | null = null;
  if (sessionId !== null) user = await loadSessionUser(sessionId);
  if (route.anonymous !== true && user === null) throw unauthenticated();

  const ctx: Ctx = {
    request,
    response,
    method,
    url,
    params: pathMatch.params,
    raw,
    body,
    user,
    sessionId: user === null ? null : sessionId,
  };

  const reply = await route.handler(ctx);
  if (reply.bytes !== undefined) {
    sendBytes(
      response,
      reply.status,
      reply.bytes,
      reply.contentType ?? 'application/octet-stream',
      reply.headers,
    );
    return;
  }
  if (reply.body === undefined) {
    sendEmpty(response, reply.status, reply.headers);
    return;
  }
  sendJson(response, reply.status, reply.body, reply.headers);
}

async function handlePage(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const method = (request.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  if (await serveAsset(response, url.pathname)) return;
  if (PAGE_PATTERNS.some((pattern) => pattern.test(url.pathname))) {
    await servePage(response, 200);
    return;
  }
  const shared = /^\/s\/([^/]+)$/.exec(url.pathname);
  if (shared !== null) {
    const projectId = await liveShareProjectId(shared[1]).catch(() => null);
    await servePage(response, projectId === null ? 404 : 200);
    return;
  }
  sendJson(response, 404, { error: 'not_found' });
}

const server = createServer((request, response) => {
  const host = request.headers.host ?? `localhost:${config.port}`;
  let url: URL;
  try {
    url = new URL(request.url ?? '/', `http://${host}`);
  } catch {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }
  securityHeaders(response);
  const work = url.pathname.startsWith('/api/')
    ? handleApi(request, response, url)
    : handlePage(request, response, url);
  work.catch((error: unknown) => {
    if (response.headersSent) {
      response.end();
      return;
    }
    if (error instanceof ApiError) {
      sendError(response, error);
      return;
    }
    process.stderr.write(`request failed: ${String(error)}\n`);
    sendError(response, internal());
  });
});

async function connectDatabase(): Promise<void> {
  for (;;) {
    try {
      await applySchemaAndSeed();
      return;
    } catch (error) {
      process.stderr.write(`database not ready: ${String(error)}\n`);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
}

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`marginalia listening on ${config.port}\n`);
});

void connectDatabase();
setInterval(() => {
  void sweepMentionEmails().catch(() => undefined);
}, 5_000);
