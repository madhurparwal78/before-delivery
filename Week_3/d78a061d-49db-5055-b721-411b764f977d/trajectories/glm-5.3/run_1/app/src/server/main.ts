import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

import config from './config.js';
import { handleApi } from './api.js';
import { setupRealtime } from './ws.js';
import { runMigrations } from './schema.js';
import { seed } from './seed.js';
import { contextFrom } from './context.js';
import { shell, type PageKind } from './pages.js';
import { query } from './db.js';
import { partyForAccount } from './parties.js';
import { progressFor } from './progress.js';
import { storyById } from '../shared/domain.js';

const root = process.cwd();
const clientDir = join(root, 'dist', 'client');
const publicDir = join(root, 'public');

const MIME: Record<string, string> = {
  '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.html': 'text/html', '.json': 'application/json', '.glb': 'model/gltf-binary',
};

const publicPageKinds: PageKind[] = ['home', 'signup', 'signin', 'forgot-password', 'reset-password', 'verify', 'not-found'];

function serveStatic(res: http.ServerResponse, path: string): boolean {
  let base = clientDir;
  let full = join(base, path);
  if (!existsSync(full)) {
    base = publicDir;
    full = join(publicDir, path);
  }
  if (!existsSync(full) || statSync(full).isDirectory()) return false;
  const ext = extname(full);
  const type = MIME[ext] ?? 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'x-content-type-options': 'nosniff',
    'cache-control': 'public, max-age=3600',
  });
  res.end(readFileSync(full));
  return true;
}

async function pageFor(path: string, res: http.ServerResponse, ctx: Awaited<ReturnType<typeof contextFrom>>): Promise<void> {
  const locale = ctx.locale;
  const kind = pageKindFor(path);
  if (kind === 'asset') return;
  if (kind === 'not-found') {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
    res.end(shell({ locale, kind: 'not-found', signedIn: ctx.account !== null, bodyHtml: '<div id="root"></div>' }));
    return;
  }
  if (!publicPageKinds.includes(kind) && !ctx.account) {
    res.writeHead(303, { location: '/signin' });
    res.end();
    return;
  }
  if (kind === 'chapter-complete') {
    const match = path.match(/^\/stories\/([^/]+)\/chapters\/(\d+)\/complete$/);
    const storyId = match?.[1];
    const chapter = match?.[2] ? parseInt(match[2], 10) : NaN;
    const story = storyId ? storyById(storyId) : undefined;
    const visible = await chapterCompleteVisible(ctx.account?.id ?? null, story?.id ?? null, chapter);
    if (!visible) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
      res.end(shell({ locale, kind: 'not-found', signedIn: ctx.account !== null, bodyHtml: '<div id="root"></div>' }));
      return;
    }
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
  res.end(shell({ locale, kind, signedIn: ctx.account !== null, bodyHtml: '<div id="root"></div>' }));
}

async function chapterCompleteVisible(accountId: string | null, storyId: string | null, chapter: number): Promise<boolean> {
  if (!accountId || !storyId) return false;
  const story = storyById(storyId);
  if (!story) return false;
  if (story.mode === 'solo') {
    const progress = await progressFor('account', accountId, storyId);
    return progress?.completed_chapters.includes(chapter) ?? false;
  }
  const party = await partyForAccount(accountId);
  if (!party) return false;
  const progress = await progressFor('party', party.id, storyId);
  return progress?.completed_chapters.includes(chapter) ?? false;
}

function pageKindFor(path: string): PageKind | 'asset' {
  if (path === '/' || path === '') return 'home';
  if (path === '/signup') return 'signup';
  if (path === '/signin') return 'signin';
  if (path === '/forgot-password') return 'forgot-password';
  if (path.startsWith('/reset-password')) return 'reset-password';
  if (path.startsWith('/verify')) return 'verify';
  if (path === '/hangar') return 'hangar';
  if (path === '/builder' || /^\/builder\/[^/]+$/.test(path)) return 'builder';
  if (path === '/forge') return 'forge';
  if (path === '/armoury') return 'armoury';
  if (path === '/models') return 'models';
  if (path === '/stories') return 'stories';
  if (path === '/lobby') return 'lobby';
  if (/^\/party\/[^/]+$/.test(path)) return 'party-lobby';
  if (/^\/invite\/[^/]+$/.test(path)) return 'invite';
  if (/^\/play\/[^/]+$/.test(path)) return 'play';
  if (/^\/stories\/[^/]+\/chapters\/\d+\/complete$/.test(path)) return 'chapter-complete';
  if (path.startsWith('/assets/') || path.startsWith('/assets')) return 'asset';
  return 'not-found';
}

export async function start(): Promise<void> {
  // Postgres is retried every 2 seconds until it answers (DP-10).
  for (;;) {
    try {
      await query('select 1');
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  await runMigrations();
  await seed();
  const { loadRunningSessions } = await import('./world.js');
  await loadRunningSessions();
  const { startTicker } = await import('./ticker.js');
  startTicker();

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://local');
        const path = url.pathname;
        if (path.startsWith('/api/')) {
          await handleApi(req, res);
          return;
        }
        const kind = pageKindFor(path);
        if (kind === 'asset') {
          const assetPath = path.replace(/^\/assets\//, '');
          if (serveStatic(res, assetPath)) return;
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('not found');
          return;
        }
        const ctx = await contextFrom(req);
        await pageFor(path, res, ctx);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'text/plain' });
        }
        res.end('error');
      }
    })();
  });

  setupRealtime(server);

  server.listen(config.publicPort, '0.0.0.0', () => {
    console.log(`linewright listening on ${config.publicPort}`);
  });
}

void start();
