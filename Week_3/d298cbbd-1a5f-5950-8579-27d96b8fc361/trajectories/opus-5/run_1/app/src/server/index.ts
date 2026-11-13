import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { applySchema, waitForDatabase } from './db.js';
import { ApiError, errorResult, matchRoute, runRoute, sendJson } from './http.js';
import { routes } from './routes.js';
import { startMailRetryLoop } from './mail.js';
import { startDailyResetTimer } from './boards.js';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

const STATIC_FILES: Record<string, string> = {
  '/app.js': 'application/javascript; charset=utf-8',
  '/styles.css': 'text/css; charset=utf-8',
};

const PAGE_PATHS = ['/', '/history', '/boards', '/race', '/settings', '/account', '/signup', '/signin', '/reset'];
const PAGE_PREFIXES = ['/race/', '/runs/', '/reset/', '/verify/'];

function isKnownPage(path: string): boolean {
  if (PAGE_PATHS.includes(path)) return true;
  return PAGE_PREFIXES.some((prefix) => path.startsWith(prefix) && path.length > prefix.length);
}

const SHELL = `<!doctype html>
<html lang="en" data-theme="sand">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Strikeproof</title>
<link rel="stylesheet" href="/styles.css">
<script src="/app.js" defer></script>
</head>
<body>
<div id="app"></div>
</body>
</html>
`;

let schemaReady = false;

async function serveStatic(path: string, res: ServerResponse): Promise<boolean> {
  const contentType = STATIC_FILES[path];
  if (contentType) {
    const file = await readFile(join(publicDir, path));
    res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-cache' });
    res.end(file);
    return true;
  }
  if (/^\/fonts\/[a-z0-9-]+\.woff2$/.test(path)) {
    const file = await readFile(join(publicDir, path));
    res.writeHead(200, {
      'content-type': 'font/woff2',
      'cache-control': 'public, max-age=604800',
    });
    res.end(file);
    return true;
  }
  return false;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/api/health') {
    sendJson(res, schemaReady ? { status: 200, body: { status: 'ok' } } : { status: 503, body: { status: 'starting' } });
    return;
  }

  for (const route of routes) {
    const params = matchRoute(route, method, path);
    if (!params) continue;
    try {
      const result = await runRoute({ route, params }, req, res, url);
      if (result !== 'handled') sendJson(res, result);
    } catch (error) {
      if (error instanceof ApiError) sendJson(res, errorResult(error));
      else {
        process.stderr.write(`request failed: ${String(error)}\n`);
        sendJson(res, { status: 500, body: { error: 'server_error' } });
      }
    }
    return;
  }

  if (path.startsWith('/api/')) {
    sendJson(res, { status: 404, body: { error: 'not_found' } });
    return;
  }

  if (method === 'GET' || method === 'HEAD') {
    if (await serveStatic(path, res)) return;
    const status = isKnownPage(path) ? 200 : 404;
    const body = SHELL;
    res.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    });
    res.end(method === 'HEAD' ? undefined : body);
    return;
  }

  sendJson(res, { status: 404, body: { error: 'not_found' } });
}

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    process.stderr.write(`unhandled: ${String(error)}\n`);
    if (!res.headersSent) sendJson(res, { status: 500, body: { error: 'server_error' } });
    else res.end();
  });
});

server.listen(config.appPublicPort, '0.0.0.0', () => {
  process.stdout.write(`strikeproof listening on ${config.appPublicPort}\n`);
});

void (async () => {
  await waitForDatabase(() => process.stderr.write('waiting for postgresql\n'));
  await applySchema();
  schemaReady = true;
  startMailRetryLoop();
  startDailyResetTimer();
})();
