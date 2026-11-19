import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { connectWithRetry, createSchema, markReady } from './db.js';
import { insertSeedData } from './seed.js';
import {
  assertSameOrigin,
  buildContext,
  send,
  sendApiError,
  toApiError,
  type Ctx,
} from './http.js';
import { matchRoute } from './routes/index.js';
import { resolvePage, renderShell, PUBLIC_PAGES, type Page } from './pages.js';
import { handleUpgrade, startHub } from './realtime/hub.js';
import { releaseSessions, startEngine, sessionRecord } from './sessions/engine.js';
import { startReadyCheckTimer } from './domain/party.js';
import { partyIdOf, loadParty } from './domain/party.js';
import { readProgress } from './domain/progress.js';
import { resumeValidations } from './routes/models.js';
import { clearStaleConnections } from './presence.js';
import { startBus } from './realtime/bus.js';
import type { MessageKey } from '../shared/i18n/index.js';
import { UUID_RE } from '../shared/constants.js';
import { errors } from './errors.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveAsset(ctx: Ctx): Promise<boolean> {
  const relative = normalize(ctx.url.pathname.replace(/^\/assets\//, ''));
  if (relative.startsWith('..')) return false;
  const extension = extname(relative);
  const contentType = CONTENT_TYPES[extension];
  if (contentType === undefined) return false;
  try {
    const body = await readFile(join(publicDir, 'assets', relative));
    ctx.res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(body.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=3600',
    });
    ctx.res.end(body);
    return true;
  } catch {
    return false;
  }
}

async function maySeeChapterComplete(
  accountId: string,
  storyId: string,
  chapter: number,
): Promise<boolean> {
  const solo = await readProgress({ kind: 'solo', accountId }, storyId);
  if (solo.completed_chapters.includes(chapter)) return true;
  const partyId = await partyIdOf(accountId);
  if (partyId === null) return false;
  const party = await loadParty(partyId);
  if (party === null || party.story_id !== storyId) return false;
  return party.progress.completed_chapters.includes(chapter);
}

function sendHtml(ctx: Ctx, status: number, html: string): void {
  const body = Buffer.from(html, 'utf8');
  const headers: Record<string, string | string[]> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': String(body.length),
    'X-Content-Type-Options': 'nosniff',
  };
  if (ctx.setCookies.length > 0) headers['Set-Cookie'] = ctx.setCookies;
  ctx.res.writeHead(status, headers);
  ctx.res.end(body);
}

async function storyTitleKeyForPlay(sessionId: string): Promise<MessageKey | undefined> {
  const record = await sessionRecord(sessionId);
  if (record === null) return undefined;
  return `story.${record.story_id}` as MessageKey;
}

async function handlePage(ctx: Ctx, page: Page | null): Promise<void> {
  if (page === null) {
    sendHtml(
      ctx,
      404,
      renderShell({ locale: ctx.locale, page: { name: 'notFound' }, signedIn: ctx.account !== null }),
    );
    return;
  }

  if (ctx.account === null && !PUBLIC_PAGES.includes(page.name)) {
    ctx.res.writeHead(303, { Location: '/signin', 'X-Content-Type-Options': 'nosniff' });
    ctx.res.end();
    return;
  }

  if (page.name === 'chapterComplete' && ctx.account !== null) {
    const allowed = await maySeeChapterComplete(ctx.account.id, page.storyId, page.chapter);
    if (!allowed) {
      sendHtml(
        ctx,
        404,
        renderShell({
          locale: ctx.locale,
          page: { name: 'notFound' },
          signedIn: true,
        }),
      );
      return;
    }
  }

  const storyTitleKey =
    page.name === 'play' ? await storyTitleKeyForPlay(page.sessionId) : undefined;
  sendHtml(
    ctx,
    200,
    renderShell({ locale: ctx.locale, page, storyTitleKey, signedIn: ctx.account !== null }),
  );
}

async function handleRequest(ctx: Ctx): Promise<void> {
  if (ctx.url.pathname.startsWith('/assets/')) {
    if (await serveAsset(ctx)) return;
    await handlePage(ctx, null);
    return;
  }

  if (ctx.url.pathname.startsWith('/api/')) {
    const matched = matchRoute(ctx.method, ctx.url.pathname);
    if (matched === null) throw errors.notFound();
    // An ID that is not a UUID can name no record: 401 when signed out, otherwise 404.
    const ids = Object.entries(matched.params).filter(([name]) => name === 'id' || name === 'accountId');
    if (ids.some(([, value]) => !UUID_RE.test(value))) {
      throw ctx.account === null ? errors.unauthenticated() : errors.notFound();
    }
    ctx.params = matched.params;
    assertSameOrigin(ctx.req);
    const reply = await matched.route.handler(ctx);
    send(ctx, reply);
    return;
  }

  if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
    await handlePage(ctx, null);
    return;
  }
  await handlePage(ctx, resolvePage(ctx.url.pathname));
}

const server = createServer((req, res) => {
  void (async () => {
    let ctx: Ctx | null = null;
    try {
      ctx = await buildContext(req, res);
      await handleRequest(ctx);
    } catch (error) {
      if (ctx === null) {
        const body = errors.internal().body('en');
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(body));
        return;
      }
      if (!ctx.res.headersSent) sendApiError(ctx, toApiError(error));
    }
  })();
});

server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/api/realtime') !== true) {
    socket.destroy();
    return;
  }
  handleUpgrade(req, socket, head).catch(() => {
    socket.destroy();
  });
});

/** A startup step that fails (a lock conflict with a running copy) is tried again. */
async function retry(step: () => Promise<void>): Promise<void> {
  for (;;) {
    try {
      await step();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

async function main(): Promise<void> {
  server.listen(config.port, '0.0.0.0');
  await connectWithRetry();
  await retry(createSchema);
  await retry(insertSeedData);
  await retry(clearStaleConnections);
  await retry(startBus);
  startHub();
  startEngine();
  startReadyCheckTimer();
  await retry(resumeValidations);
  markReady();
}

// A stopping copy hands its running sessions back before it exits.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    releaseSessions()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });
}

void main();
