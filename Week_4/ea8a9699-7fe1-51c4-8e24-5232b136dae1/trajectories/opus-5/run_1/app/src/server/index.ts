import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config.js';
import { ApiError } from './errors.js';
import { applySchema, applySeed } from './seed.js';
import { assertSameOrigin, isBlockedPath, readBody } from './http/boundary.js';
import { parseCookies, type HttpResponse } from './http/context.js';
import { Router } from './http/router.js';
import { hasExtension, serveAppShell, serveStatic } from './http/static.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerClusterRoutes } from './routes/clusters.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerReferenceRoutes } from './routes/references.js';
import { registerReviewRoutes } from './routes/review.js';
import { ensureBucket } from './services/storage.js';
import { markSeedComplete, startWorkers } from './workers.js';

const router = new Router();
registerAuthRoutes(router);
registerAdminRoutes(router);
registerReferenceRoutes(router);
registerClusterRoutes(router);
registerReviewRoutes(router);
registerPublicRoutes(router);
registerMediaRoutes(router);

function write(response: ServerResponse, result: HttpResponse): void {
  const headers: Record<string, string> = { ...result.headers };
  let payload: Buffer | undefined;
  if (result.json !== undefined) {
    payload = Buffer.from(JSON.stringify(result.json), 'utf8');
    headers['Content-Type'] = 'application/json; charset=utf-8';
  } else if (result.body !== undefined) {
    payload = Buffer.isBuffer(result.body) ? result.body : Buffer.from(result.body, 'utf8');
    if (result.contentType !== undefined) {
      headers['Content-Type'] = result.contentType;
    }
  }
  if (payload !== undefined) {
    headers['Content-Length'] = String(payload.length);
  }
  response.writeHead(result.status, headers);
  response.end(payload);
}

/** Answers an error. A request body left unread forces the connection closed so the answer lands. */
function writeError(response: ServerResponse, error: unknown, request?: IncomingMessage): void {
  const unread = request !== undefined && !request.readableEnded;
  if (unread) {
    response.on('finish', () => request.destroy());
  }
  const connection: Record<string, string> = unread ? { Connection: 'close' } : {};
  if (error instanceof ApiError) {
    write(response, { status: error.status, json: error.body, headers: { ...error.headers, ...connection } });
    return;
  }
  process.stderr.write(`${String(error)}\n`);
  write(response, {
    status: 500,
    json: { error: 'internal', message: 'Something went wrong.' },
    headers: connection,
  });
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = request.method ?? 'GET';

  if (isBlockedPath(path)) {
    write(response, { status: 404, json: { error: 'not_found', message: 'Not found.' } });
    return;
  }

  const match = router.match(method, path);
  if (match === null) {
    if (method === 'GET' && !path.startsWith('/api/') && !path.startsWith('/media/')) {
      if (serveStatic(path, response) || (!hasExtension(path) && serveAppShell(response))) {
        return;
      }
    }
    write(response, { status: 404, json: { error: 'not_found', message: 'Not found.' } });
    return;
  }

  try {
    assertSameOrigin(method, request.headers);
    const parsed = await readBody(request, match.route.bodyKind, path);
    write(
      response,
      await match.route.handler({
        method,
        url,
        params: match.params,
        headers: request.headers,
        cookies: parseCookies(request.headers.cookie),
        body: parsed.json,
        multipart: parsed.multipart,
        uploadType: parsed.uploadType,
      }),
    );
  } catch (error) {
    writeError(response, error, request);
  }
}

const schemaRetryMs = 2_000;

async function ensureSchema(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      return;
    } catch (error) {
      process.stderr.write(`Schema not applied yet: ${String(error)}\n`);
      await new Promise((settle) => setTimeout(settle, schemaRetryMs));
    }
  }
}

async function start(): Promise<void> {
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => writeError(response, error, request));
  });
  server.listen(config.port, '0.0.0.0');

  await ensureSchema();
  await ensureBucket().catch(() => undefined);
  markSeedComplete(await applySeed().catch(() => false));
  startWorkers();
}

void start();
