/**
 * The server. Only the published routes exist, plus the built files under
 * `/assets/`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, type App } from './app.ts';
import { applySchema } from './db/schema.ts';
import { completeSeedArtifacts, seedIfEmpty } from './db/seed.ts';
import { buildRouter } from './api/routes.ts';
import { handleApi } from './http/pipeline.ts';
import { redirect, sendBytes, sendHtml, sendJson, readCookie, SESSION_COOKIE } from './http/respond.ts';
import { startBackgroundWork } from './features/tasks.ts';
import { rebuildIndex } from './features/indexing.ts';
import { honouredReturn } from './api/access.ts';
import { matchDeskScreen, renderDeskScreen } from './pages/deskPages.ts';
import {
  findCase,
  renderCase,
  renderEnquire,
  renderHome,
  renderNotFound,
  renderSignIn,
  renderSignUp,
  renderWork,
} from './pages/publicPages.ts';
import { renderClientPage, renderEndedClientPage } from './pages/clientPagePage.ts';
import { lookupClientPage } from './features/clientPageData.ts';
import type { Row } from './present.ts';

const ASSET_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const ASSET_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

const WORK_KINDS = ['leather', 'fabric', 'frame-only'];

async function serveAsset(path: string, response: ServerResponse): Promise<boolean> {
  const relative = normalize(path.slice('/assets/'.length));
  if (relative.startsWith('..') || relative.includes('\0')) return false;
  const extension = relative.slice(relative.lastIndexOf('.'));
  const contentType = ASSET_TYPES[extension];
  if (!contentType) return false;
  try {
    const bytes = await readFile(join(ASSET_ROOT, 'assets', relative));
    sendBytes(response, 200, new Uint8Array(bytes), contentType, {
      'cache-control': 'public, max-age=3600',
    });
    return true;
  } catch {
    return false;
  }
}

async function handlePage(app: App, request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const path = url.pathname;

  if (path === '/') {
    sendHtml(response, 200, renderHome());
    return;
  }
  if (path === '/work') {
    const kind = url.searchParams.get('kind');
    if (kind !== null && !WORK_KINDS.includes(kind)) {
      sendHtml(response, 404, renderNotFound());
      return;
    }
    sendHtml(response, 200, renderWork(kind));
    return;
  }
  if (path.startsWith('/work/')) {
    const item = findCase(path.slice('/work/'.length));
    if (!item) {
      sendHtml(response, 404, renderNotFound());
      return;
    }
    sendHtml(response, 200, renderCase(item));
    return;
  }
  if (path === '/enquire') {
    sendHtml(response, 200, renderEnquire());
    return;
  }
  if (path === '/sign-in') {
    sendHtml(response, 200, renderSignIn(url.searchParams.get('returnTo')));
    return;
  }
  if (path === '/sign-up') {
    sendHtml(response, 200, renderSignUp());
    return;
  }

  if (path.startsWith('/c/')) {
    const token = decodeURIComponent(path.slice('/c/'.length));
    const page = await lookupClientPage(app, token);
    if (page.kind === 'missing') {
      sendHtml(response, 404, renderNotFound());
      return;
    }
    if (page.kind === 'ended') {
      sendHtml(response, 410, renderEndedClientPage(page.language));
      return;
    }
    sendHtml(response, 200, renderClientPage(page.facts));
    return;
  }

  const desk = matchDeskScreen(path);
  if (desk) {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    const session = token
      ? await app.db.one<Row>(
          `SELECT desk_id, ends_at FROM sessions WHERE id = $1`,
          [token],
        )
      : null;
    const live = session && new Date(session.ends_at as string).getTime() > app.now();
    if (!live) {
      redirect(response, `/sign-in?returnTo=${encodeURIComponent(honouredReturn(url.pathname + url.search))}`);
      return;
    }

    let pieceTitle = '';
    let clientName = '';
    if (desk.id !== null && desk.screen.pattern.startsWith('/pieces/')) {
      const row = await app.db.one<Row>(
        `SELECT p.title FROM pieces p JOIN clients c ON c.id = p.client_id
          WHERE p.id = $1 AND p.desk_id = $2 AND c.state IN ('active','closing')`,
        [desk.id, session!.desk_id],
      );
      if (!row) {
        sendHtml(response, 404, renderNotFound());
        return;
      }
      pieceTitle = String(row.title);
    }
    if (desk.id !== null && desk.screen.pattern.startsWith('/clients/')) {
      const row = await app.db.one<Row>(
        `SELECT name FROM clients WHERE id = $1 AND desk_id = $2 AND state IN ('active','closing')`,
        [desk.id, session!.desk_id],
      );
      if (!row) {
        sendHtml(response, 404, renderNotFound());
        return;
      }
      clientName = String(row.name);
    }
    sendHtml(response, 200, renderDeskScreen(desk.screen, { pieceTitle, clientName }, desk.id));
    return;
  }

  sendHtml(response, 404, renderNotFound());
}

async function main(): Promise<void> {
  const app = createApp();
  await applySchema(app.pool);
  await seedIfEmpty(app);
  const router = buildRouter();

  // Providers may be down at start; the app serves anyway and keeps trying.
  void completeSeedArtifacts(app).catch(() => undefined);
  void rebuildIndex(app).catch(() => undefined);
  startBackgroundWork(app);

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    const run = async (): Promise<void> => {
      if (url.pathname.startsWith('/assets/')) {
        if (await serveAsset(url.pathname, response)) return;
        sendHtml(response, 404, renderNotFound());
        return;
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await handleApi(app, router, request, response, url);
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        request.resume();
        sendHtml(response, 404, renderNotFound());
        return;
      }
      await handlePage(app, request, response, url);
    };
    run().catch((error: unknown) => {
      process.stderr.write(`page failed: ${String(error)}\n`);
      if (!response.headersSent) {
        if (url.pathname.startsWith('/api/')) {
          sendJson(response, 503, {
            error: { code: 'providerUnavailable', message: 'The desk could not answer.' },
          });
        } else {
          sendHtml(response, 500, renderNotFound());
        }
      } else {
        response.end();
      }
    });
  });

  server.listen(app.config.port, '0.0.0.0', () => {
    process.stdout.write(`semenza desk on http://0.0.0.0:${app.config.port}\n`);
  });
}

await main();
