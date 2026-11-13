import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { config } from './config';
import { copy } from './copy';
import { applySchema } from './db';
import {
  ApiError,
  MAX_BODY_BYTES,
  parseCookies,
  readBody,
  Router,
  sendJson,
  type Ctx,
} from './http';
import { attachLive } from './live';
import { registerAccountRoutes } from './routes/accounts';
import { registerChartRoutes } from './routes/charts';
import { registerGradingRoutes } from './routes/grading';
import { registerTesterRoutes } from './routes/testers';
import { registerVersionRoutes } from './routes/versions';
import { startValkey } from './valkey';

const CLIENT_DIR = join(__dirname, '..', 'client');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const router = new Router();
registerAccountRoutes(router);
registerChartRoutes(router);
registerVersionRoutes(router);
registerTesterRoutes(router);
registerGradingRoutes(router);

function serveFile(res: ServerResponse, path: string): void {
  const type = MIME[extname(path)] ?? 'application/octet-stream';
  const size = statSync(path).size;
  res.writeHead(200, {
    'content-type': type,
    'content-length': size,
    'cache-control': path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(path).pipe(res);
}

function serveClient(res: ServerResponse, pathname: string): void {
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\//, '');
  const candidate = join(CLIENT_DIR, relative);
  if (relative !== '' && candidate.startsWith(CLIENT_DIR) && existsSync(candidate) && statSync(candidate).isFile()) {
    serveFile(res, candidate);
    return;
  }
  if (extname(relative) !== '') {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found.');
    return;
  }
  const index = join(CLIENT_DIR, 'index.html');
  if (!existsSync(index)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found.');
    return;
  }
  serveFile(res, index);
}

async function handleApi(request: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = request.method ?? 'GET';
  let body: Record<string, unknown> = {};

  if (method !== 'GET' && method !== 'HEAD') {
    const raw = await readBody(request);
    if (raw === 'too_large') {
      sendJson(res, 413, { error: 'too_large' });
      return;
    }
    if (raw.length > MAX_BODY_BYTES) {
      sendJson(res, 413, { error: 'too_large' });
      return;
    }
    if (raw.length > 0) {
      const type = (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') {
        sendJson(res, 415, { error: 'unsupported_media_type' });
        return;
      }
      try {
        const parsed = JSON.parse(raw.toString('utf8'));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('not an object');
        }
        body = parsed as Record<string, unknown>;
      } catch {
        sendJson(res, 422, { error: 'invalid', field: 'body', message: copy.invalidJson });
        return;
      }
    }
  }

  const match = router.match(method, url.pathname);
  if (!match) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  const ctx: Ctx = {
    method,
    path: url.pathname,
    query: url.searchParams,
    params: match.params,
    body,
    headers: request.headers,
    cookies: parseCookies(request.headers.cookie),
    res,
  };

  try {
    const result = await match.handler(ctx);
    if (res.headersSent || res.writableEnded) return;
    if (res.statusCode === 204 || result === null) {
      res.writeHead(res.statusCode === 200 ? 204 : res.statusCode);
      res.end();
      return;
    }
    sendJson(res, res.statusCode, result);
  } catch (error) {
    if (res.headersSent || res.writableEnded) return;
    if (error instanceof ApiError) {
      sendJson(res, error.status, error.body);
      return;
    }
    process.stderr.write(`request failed: ${String(error)}\n`);
    sendJson(res, 500, { error: 'server_error' });
  }
}

const server = createServer((request, res) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    void handleApi(request, res, url);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveClient(res, url.pathname);
});

attachLive(server);

async function start(): Promise<void> {
  await applySchema();
  startValkey();
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`twinrow listening on ${config.port}\n`);
  });
}

void start();
