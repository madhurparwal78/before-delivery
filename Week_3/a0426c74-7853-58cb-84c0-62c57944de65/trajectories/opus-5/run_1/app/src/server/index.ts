import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, MESSAGES } from '../shared/errors.js';
import { clientSettings, config } from './config.js';
import { connectAndMigrate } from './db.js';
import { cookies, isCrossOrigin, matchRoute, sendBytes, sendError, sendJson, WRITE_METHODS, type RequestContext } from './http.js';
import { usernameForToken } from './sessions.js';
import { ensureBucket, storageHealthy } from './storage.js';
import { handleUpgrade } from './live.js';
import { startExportRunner } from './exports.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerFolderRoutes } from './routes/folders.js';
import { registerOpsRoutes } from './routes/ops.js';
import { registerSheetRoutes, startDeadlineSweeps } from './routes/sheets.js';
import { registerIssueRoutes } from './routes/issues.js';
import { registerUploadRoutes } from './routes/uploads.js';
import { registerGradingRoutes } from './routes/grading.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(here, '..', 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const PAGE_PATHS = [/^\/$/, /^\/register$/, /^\/signin$/, /^\/folders$/, /^\/drawings\/[^/]+$/, /^\/versions\/[^/]+$/, /^\/v\/[^/]+$/];

const SERVED_FILES = new Set(['/app.js', '/app.css']);

async function serveIndex(res: ServerResponse, status: number): Promise<void> {
  const html = await readFile(join(publicDir, 'index.html'), 'utf8');
  const withSettings = html.replace(
    '<!--settings-->',
    `<script id="plot-settings" type="application/json">${JSON.stringify(clientSettings())}</script>`,
  );
  const body = Buffer.from(withSettings, 'utf8');
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  const allowed = SERVED_FILES.has(pathname) || pathname.startsWith('/fonts/');
  if (!allowed) return false;
  const target = normalize(join(publicDir, pathname));
  if (!target.startsWith(publicDir)) return false;
  try {
    const body = await readFile(target);
    sendBytes(res, 200, body, CONTENT_TYPES[extname(target)] ?? 'application/octet-stream', {
      'cache-control': 'public, max-age=3600',
    });
    return true;
  } catch {
    return false;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method ?? 'GET';

  if (pathname === '/api/health') {
    const healthy = await storageHealthy();
    sendJson(res, 200, { status: healthy ? 'ok' : 'unavailable' });
    return;
  }

  if (WRITE_METHODS.includes(method) && isCrossOrigin(req)) {
    sendError(res, new ApiError('cross_origin', MESSAGES.crossOrigin));
    return;
  }

  const token = cookies(req).plot_session;
  const username = token ? await usernameForToken(token) : null;

  const found = matchRoute(method, pathname);
  if (found) {
    const context: RequestContext = { req, res, url, params: found.params, username };
    try {
      await found.handler(context);
    } catch (error) {
      if (error instanceof ApiError) {
        sendError(res, error);
        return;
      }
      process.stderr.write(`request failed: ${error instanceof Error ? error.stack : String(error)}\n`);
      sendError(res, new ApiError('invalid', MESSAGES.invalid));
    }
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendError(res, new ApiError('not_found', MESSAGES.notFound));
    return;
  }

  if (method === 'GET' && (await serveStatic(pathname, res))) return;

  if (method === 'GET' && PAGE_PATHS.some((pattern) => pattern.test(pathname))) {
    await serveIndex(res, 200);
    return;
  }

  if (method === 'GET') {
    await serveIndex(res, 404);
    return;
  }

  sendError(res, new ApiError('not_found', MESSAGES.notFound));
}

async function main(): Promise<void> {
  registerAuthRoutes();
  registerFolderRoutes();
  registerOpsRoutes();
  registerSheetRoutes();
  registerIssueRoutes();
  registerUploadRoutes();
  registerGradingRoutes();

  await connectAndMigrate();
  void ensureBucket();
  startExportRunner();
  startDeadlineSweeps();

  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) sendError(res, new ApiError('invalid', MESSAGES.invalid));
    });
  });
  server.on('upgrade', (req, socket, head) => {
    void handleUpgrade(req, socket, head);
  });
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`plotfold listening on ${config.port}\n`);
  });
}

void main();
