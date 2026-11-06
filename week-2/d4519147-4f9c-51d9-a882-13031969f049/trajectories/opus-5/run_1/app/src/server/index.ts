import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { config } from './config';
import { isDatabaseUp, queryOne, waitForDatabase, withStartupLock } from './db';
import { applySchema } from './schema';
import { applySeed } from './seed';
import { renderShell, type BootData } from './html';
import { applySecurityHeaders } from './http/headers';
import { parseCookies } from './http/request';
import { ApiRouter } from './http/router';
import { authRoutes, prepareDecoyHash } from './routes/auth';
import { diagramRoutes } from './routes/diagrams';
import { fileRoutes } from './routes/files';
import { inviteRoutes } from './routes/invites';
import { pageRoutes } from './routes/pages';
import { platformRoutes, markDatabaseReady } from './routes/platform';
import { shareRoutes } from './routes/shares';
import { diagramAccess } from './domain/access';
import { resolveSession } from './domain/sessions';
import { startQueueWorker } from './services/queue';
import { startStatusPoller } from './services/status';
import { ensureBucket } from './services/storage';
import { isValidNext, signInPathFor } from '../shared/routes';

const router = new ApiRouter();
router.add(...platformRoutes, ...authRoutes, ...diagramRoutes, ...pageRoutes, ...shareRoutes, ...inviteRoutes, ...fileRoutes);

const PUBLIC_DIR = join(__dirname, '..', 'public');

const ASSET_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

async function serveAsset(res: ServerResponse, pathname: string): Promise<boolean> {
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  if (!relative.startsWith('assets/') && !relative.startsWith('fonts/')) return false;
  const extension = extname(relative);
  const contentType = ASSET_TYPES[extension];
  if (!contentType) return false;
  try {
    const bytes = await readFile(join(PUBLIC_DIR, relative));
    applySecurityHeaders(res, 'asset');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(bytes.length));
    res.writeHead(200);
    res.end(bytes);
    return true;
  } catch {
    return false;
  }
}

function sendHtml(res: ServerResponse, status: number, boot: BootData, noReferrer = false): void {
  const rendered = renderShell(boot);
  applySecurityHeaders(res, 'html', { nonce: rendered.nonce, noReferrer });
  const payload = Buffer.from(rendered.html, 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Length', String(payload.length));
  res.writeHead(status);
  res.end(payload);
}

function redirect(res: ServerResponse, location: string): void {
  applySecurityHeaders(res, 'redirect', { noStore: true });
  res.setHeader('Location', location);
  res.writeHead(302);
  res.end();
}

async function handleDocument(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const cookies = parseCookies(req);
  const lookup = await resolveSession(cookies[config.cookieName]);
  const session = lookup.state === 'active' ? lookup.session : null;
  const boot: BootData = {
    user: session ? session.user : null,
    csrfToken: session ? session.csrfToken : null,
    notFound: null,
    firstPageId: null,
  };
  const path = url.pathname;

  if (path.startsWith('/invite/')) {
    sendHtml(res, 200, boot, true);
    return;
  }

  if (path === '/signin') {
    if (session) {
      const next = url.searchParams.get('next');
      redirect(res, isValidNext(next) ? next : '/');
      return;
    }
    sendHtml(res, 200, boot);
    return;
  }

  const diagramMatch = /^\/d\/([^/]+)(?:\/p\/([^/]+))?$/.exec(path);
  if (path === '/' || diagramMatch) {
    if (!session) {
      redirect(res, signInPathFor(`${path}${url.search}`));
      return;
    }
    if (diagramMatch) {
      const diagramId = decodeURIComponent(diagramMatch[1] ?? '');
      const pageId = diagramMatch[2] ? decodeURIComponent(diagramMatch[2]) : null;
      const access = await diagramAccess(diagramId, session.user);
      if (!access) {
        sendHtml(res, 404, { ...boot, notFound: 'diagram' });
        return;
      }
      const first = await queryOne<{ id: string }>(
        'select id from pages where diagram_id = $1 order by seq limit 1',
        [diagramId],
      );
      if (pageId) {
        const page = await queryOne<{ id: string }>('select id from pages where id = $1 and diagram_id = $2', [
          pageId,
          diagramId,
        ]).catch(() => null);
        if (!page) {
          sendHtml(res, 404, { ...boot, notFound: 'diagram' });
          return;
        }
      }
      sendHtml(res, 200, { ...boot, firstPageId: first?.id ?? null });
      return;
    }
    sendHtml(res, 200, boot);
    return;
  }

  sendHtml(res, 404, { ...boot, notFound: 'page' });
}

async function requestHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    await router.handle(req, res, url);
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (await serveAsset(res, url.pathname)) return;
    await handleDocument(req, res, url);
    return;
  }
  applySecurityHeaders(res, 'api');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not_found', message: 'We could not find that.' }));
}

async function main(): Promise<void> {
  const server = createServer((req, res) => {
    requestHandler(req, res).catch(() => {
      if (!res.headersSent) {
        applySecurityHeaders(res, 'api');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal', message: 'Something went wrong.' }));
      } else {
        res.end();
      }
    });
  });
  server.listen(config.port, '0.0.0.0');

  await waitForDatabase();
  await withStartupLock(async () => {
    await applySchema();
    await applySeed();
  });
  await prepareDecoyHash();
  if (await isDatabaseUp()) markDatabaseReady();
  await ensureBucket().catch(() => undefined);
  startStatusPoller();
  startQueueWorker();
  console.log(`scopewright listening on ${config.port}`);
}

void main();
