import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { config } from './config';
import { ApiError, errors, parseCookies, sendHtml, sendJson } from './http';
import { Router } from './router';
import { mePayload, registerCoreRoutes } from './api-core';
import { registerEditRoutes } from './api-edit';
import { registerPublishRoutes } from './api-publish';
import { connectWithRetry, databaseReady } from './db';
import { loadClock } from './clock';
import { personForSession } from './access';
import { appPage, embedMissingPage, embedPage } from './pages';
import { ensureBucket } from './storage';
import { startOutboxWorker } from './mail';
import { handleUpgrade, setLiveHandlers } from './ws';
import { projectRow, roleOf, purgeExpired } from './repo';
import { liveVersion } from './publish';
import { MSG } from '../shared/messages';

const router = new Router();
registerCoreRoutes(router);
registerEditRoutes(router);
registerPublishRoutes(router);

const PUBLIC_DIR = join(__dirname, 'public');
const APP_ROUTES = ['/', '/signin', '/projects', '/invite', '/projects/'];

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.map': 'application/json',
};

async function serveStatic(pathname: string): Promise<{ body: Buffer; type: string } | null> {
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\//, '');
  if (relative === '' || relative.includes('..')) return null;
  const extension = extname(relative);
  if (!MIME[extension]) return null;
  try {
    const body = await readFile(join(PUBLIC_DIR, relative));
    return { body, type: MIME[extension] };
  } catch {
    return null;
  }
}

function isAppRoute(pathname: string): boolean {
  if (APP_ROUTES.includes(pathname)) return true;
  return pathname.startsWith('/projects/') || pathname.startsWith('/invite/');
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const server = createServer((request, response) => {
  void (async () => {
    const host = request.headers.host ?? `127.0.0.1:${config.port}`;
    const url = new URL(request.url ?? '/', `http://${host}`);
    try {
      const origin = request.headers.origin;
      if (
        STATE_CHANGING.has(request.method ?? 'GET') &&
        typeof origin === 'string' &&
        origin !== `http://${host}` &&
        origin !== `https://${host}`
      ) {
        throw errors.crossOrigin();
      }
      if (url.pathname.startsWith('/api/') && url.pathname !== '/api/health' && !databaseReady()) {
        throw errors.storageUnavailable('The database is unavailable.');
      }

      const cookies = parseCookies(request);
      const sessionId = cookies.hs_session ?? null;
      const person = databaseReady() ? await personForSession(sessionId) : null;

      const matched = router.match(request.method ?? 'GET', url.pathname);
      if (matched) {
        await matched.handler({
          request,
          response,
          url,
          params: matched.params,
          person,
          sessionId,
        });
        return;
      }

      if (url.pathname.startsWith('/embed/')) {
        const projectId = decodeURIComponent(url.pathname.slice('/embed/'.length));
        await purgeExpired();
        const row = await projectRow(projectId);
        const live = row && row.status === 'active' ? await liveVersion(projectId) : null;
        if (!live) {
          sendHtml(response, 404, embedMissingPage());
          return;
        }
        sendHtml(response, 200, embedPage(projectId));
        return;
      }

      const asset = await serveStatic(url.pathname);
      if (asset) {
        response.writeHead(200, {
          'content-type': asset.type,
          'content-length': asset.body.byteLength,
          'cache-control': 'no-store',
        });
        response.end(asset.body);
        return;
      }

      if (url.pathname.startsWith('/api/')) throw errors.notFound();

      const me = person ? ((await mePayload(person)) as unknown as Record<string, unknown>) : null;
      if (isAppRoute(url.pathname)) {
        sendHtml(response, 200, appPage(me as never));
        return;
      }

      sendHtml(response, 404, appPage(me as never));
    } catch (error) {
      if (error instanceof ApiError) {
        if (url.pathname.startsWith('/api/')) {
          sendJson(response, error.status, error.body());
          return;
        }
        sendHtml(response, error.status, error.status === 404 ? appPage() : appPage());
        return;
      }
      process.stderr.write(`Request failed: ${(error as Error).stack ?? String(error)}\n`);
      if (!response.headersSent) {
        sendJson(response, 500, { error: 'server_error', message: MSG.notFound });
      } else {
        response.end();
      }
    }
  })();
});

server.on('upgrade', (request, socket) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  handleUpgrade(request, socket);
});

setLiveHandlers({
  onSubscribe: async (sessionIdFromClient, projectId) => {
    const person = await personForSession(sessionIdFromClient);
    if (!person) return null;
    const role = await roleOf(projectId, person.id);
    if (!role) return null;
    return { personId: person.id, personName: person.name };
  },
});

/** The server answers at once; unreachable services are retried in the background. */
function start(): void {
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Halation Studio listening on ${config.port}\n`);
  });
  void connectWithRetry().then(async () => {
    await loadClock();
    startOutboxWorker();
  });
  const retryBucket = setInterval(() => {
    ensureBucket().catch(() => undefined);
  }, 5000);
  retryBucket.unref();
  ensureBucket().catch(() => undefined);
}

start();
