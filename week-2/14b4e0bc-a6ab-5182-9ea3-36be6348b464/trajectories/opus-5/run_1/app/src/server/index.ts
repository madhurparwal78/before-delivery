import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { env } from './env.ts';
import { startNotificationListener } from './events.ts';
import { Ctx, type Reply, readRequestBody } from './http/context.ts';
import { ApiError, errors } from './http/errors.ts';
import { Router } from './http/router.ts';
import { registerAdminRoutes } from './routes/admin.ts';
import { registerCertificationRoutes } from './routes/certification.ts';
import { registerEventRoutes } from './routes/events.ts';
import { registerEvidenceDownloadRoutes } from './routes/evidenceDownload.ts';
import { registerIngestionRoutes } from './routes/ingestion.ts';
import { registerReadRoutes } from './routes/reads.ts';
import { registerSessionRoutes } from './routes/session.ts';
import { registerTagRoutes } from './routes/tags.ts';
import { registerTermRoutes } from './routes/terms.ts';
import { applySchemaAndSeed } from './seed.ts';
import { startNoticeSender } from './services/mailer.ts';
import { startProbes } from './services/status.ts';
import { evidenceStore } from './services/storage.ts';

const CLIENT_ROOT = new URL('../client/', import.meta.url).pathname;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

const router = new Router();
registerSessionRoutes(router);
registerReadRoutes(router);
registerTagRoutes(router);
registerCertificationRoutes(router);
registerEvidenceDownloadRoutes(router);
registerIngestionRoutes(router);
registerTermRoutes(router);
registerAdminRoutes(router);
registerEventRoutes(router);

function sendReply(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | string[]> = { ...(reply.headers ?? {}) };
  if (reply.cookie !== undefined) headers['Set-Cookie'] = reply.cookie;
  if (reply.json !== undefined) {
    const body = Buffer.from(JSON.stringify(reply.json), 'utf8');
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['Content-Length'] = String(body.length);
    response.writeHead(reply.status, headers);
    response.end(body);
    return;
  }
  if (reply.body !== undefined) {
    headers['Content-Length'] = String(reply.body.length);
    response.writeHead(reply.status, headers);
    response.end(reply.body);
    return;
  }
  response.writeHead(reply.status, headers);
  response.end();
}

function sendError(response: ServerResponse, error: unknown): void {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError(500, 'internal_error', 'Something went wrong. Try again.');
  if (response.headersSent) {
    response.end();
    return;
  }
  sendReply(response, { status: apiError.status, json: apiError.body() });
}

function serveStatic(pathname: string, response: ServerResponse, method: string): void {
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  const candidate = relative === '' ? 'index.html' : relative;
  const filePath = join(CLIENT_ROOT, candidate);
  const servable =
    filePath.startsWith(CLIENT_ROOT) && existsSync(filePath) && statSync(filePath).isFile();
  const indexPath = join(CLIENT_ROOT, 'index.html');
  // Client routes fall back to the app shell; unknown files with an extension do not.
  const target = servable ? filePath : extname(candidate) === '' ? indexPath : null;
  if (target === null || !existsSync(target)) {
    sendReply(response, { status: 404, json: errors.notFound().body() });
    return;
  }
  const headers: Record<string, string> = {
    'Content-Type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
    'Content-Length': String(statSync(target).size),
  };
  response.writeHead(200, headers);
  if (method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(target).pipe(response);
}

const server = createServer((request, response) => {
  void (async () => {
    const method = (request.method ?? 'GET').toUpperCase();
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    try {
      const rawBody = await readRequestBody(request);
      if (!url.pathname.startsWith('/api/')) {
        if (method !== 'GET' && method !== 'HEAD') throw errors.methodNotAllowed();
        serveStatic(url.pathname, response, method);
        return;
      }
      const matched = router.match(method, url.pathname);
      if (matched === null) {
        const ctx = new Ctx(request, response, url, {}, rawBody);
        await ctx.requireActor();
        throw router.hasPath(url.pathname) ? errors.methodNotAllowed() : errors.notFound();
      }
      const ctx = new Ctx(request, response, url, matched.params, rawBody);
      const reply = await matched.handler(ctx);
      if (reply !== null) sendReply(response, reply);
    } catch (error) {
      sendError(response, error);
    }
  })();
});

async function main(): Promise<void> {
  await applySchemaAndSeed();
  await evidenceStore.ensureBucket().catch(() => undefined);
  startNotificationListener();
  startProbes();
  startNoticeSender();
  server.listen(env.port, '0.0.0.0');
}

void main();
