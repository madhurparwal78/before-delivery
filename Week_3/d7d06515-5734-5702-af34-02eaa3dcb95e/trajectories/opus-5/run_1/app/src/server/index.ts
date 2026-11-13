import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { config } from './config';
import { applySchema } from './db';
import { startHealthProbes } from './health';
import {
  errorReply,
  RawReply,
  Reply,
  RequestContext,
  Router,
  sameOrigin,
  STREAMING,
} from './http';
import { registerAccountRoutes } from './routes/accounts';
import { registerDrawingRoutes } from './routes/drawings';
import { registerExportRoutes } from './routes/exports';
import { registerFileRoutes } from './routes/files';
import { registerGradingRoutes } from './routes/grading';
import { registerShareRoutes } from './routes/shares';
import { registerTraceRoutes } from './routes/traces';

const router = new Router();
registerGradingRoutes(router);
registerAccountRoutes(router);
registerFileRoutes(router);
registerDrawingRoutes(router);
registerTraceRoutes(router);
registerShareRoutes(router);
registerExportRoutes(router);

const publicDir = path.join(__dirname, 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

/** Only the built frontend, its bundled fonts, the API and download streams are served. */
async function serveStatic(pathname: string, response: http.ServerResponse): Promise<void> {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(publicDir, relative);
  if (!resolved.startsWith(`${publicDir}${path.sep}`) && resolved !== publicDir) {
    await sendIndex(response);
    return;
  }
  try {
    const info = await stat(resolved);
    if (!info.isFile()) {
      await sendIndex(response);
      return;
    }
    const body = await readFile(resolved);
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[path.extname(resolved)] ?? 'application/octet-stream',
      'cache-control': path.extname(resolved) === '.html' ? 'no-store' : 'public, max-age=3600',
    });
    response.end(body);
  } catch {
    await sendIndex(response);
  }
}

async function sendIndex(response: http.ServerResponse): Promise<void> {
  const body = await readFile(path.join(publicDir, 'index.html'));
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(body);
}

function writeReply(response: http.ServerResponse, reply: Reply | RawReply): void {
  if (reply instanceof RawReply) {
    response.writeHead(reply.status, { ...reply.headers, 'content-length': reply.body.byteLength });
    response.end(reply.body);
    return;
  }
  if (reply.body === null) {
    response.writeHead(reply.status, reply.headers);
    response.end();
    return;
  }
  const body = Buffer.from(JSON.stringify(reply.body), 'utf8');
  response.writeHead(reply.status, {
    ...reply.headers,
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.byteLength,
  });
  response.end(body);
}

const server = http.createServer((request, response) => {
  void (async () => {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (!url.pathname.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') {
        writeReply(response, new Reply(404, { error: 'not_found' }));
        return;
      }
      await serveStatic(url.pathname, response);
      return;
    }
    const matched = router.match(method, url.pathname);
    if (matched === null) {
      writeReply(response, new Reply(404, { error: 'not_found' }));
      return;
    }
    const context = new RequestContext(request, response, url, matched.params);
    if (!sameOrigin(context)) {
      writeReply(response, new Reply(403, { error: 'forbidden' }));
      return;
    }
    try {
      const result = await matched.handler(context);
      if (result === STREAMING) return;
      writeReply(response, result);
    } catch (error) {
      writeReply(response, errorReply(error));
    }
  })().catch((error: unknown) => {
    process.stderr.write(`request failed: ${String(error)}\n`);
    if (!response.headersSent) {
      writeReply(response, new Reply(500, { error: 'bad_request' }));
    }
  });
});

async function start(): Promise<void> {
  let attempt = 0;
  while (true) {
    try {
      await applySchema();
      break;
    } catch (error) {
      attempt += 1;
      process.stderr.write(`schema not ready (attempt ${attempt}): ${String(error)}\n`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  startHealthProbes();
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`corbel draft listening on ${config.port}\n`);
  });
}

void start();

