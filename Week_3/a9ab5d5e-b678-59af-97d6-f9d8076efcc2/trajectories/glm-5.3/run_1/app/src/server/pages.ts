/** Page routes and static assets: only built browser assets are served,
 *  never source, configuration or credentials. */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { Ctx, sendBytes } from './http';
import { AppDeps } from './apiTypes';

export interface PagesDeps {
  config: { appPublicUrl: string; appPublicPort: number };
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export function pagesRouter(ctx: Ctx, _deps: AppDeps, _pages: PagesDeps): void {
  const method = ctx.method();
  const path = ctx.url.pathname;
  if (method !== 'GET' && method !== 'HEAD') {
    sendProblem404(ctx);
    return;
  }
  // protected files answer the not-found page with 404
  if (path === '/run.json' || path === '/package.json' || path === '/.env'
    || path === '/tsconfig.json' || path.endsWith('.ts') || path.endsWith('.map')
    || path.startsWith('/src/') || path.startsWith('/scripts/')) {
    sendNotFoundPage(ctx);
    return;
  }
  // built assets under /assets/
  if (path.startsWith('/assets/')) {
    const safe = path.slice('/assets/'.length).replace(/\\/g, '/');
    if (safe.includes('..')) {
      sendNotFoundPage(ctx);
      return;
    }
    const file = join(process.cwd(), 'dist', 'public', 'assets', safe);
    if (existsSync(file) && statSync(file).isFile()) {
      const buf = readFileSync(file);
      const ct = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
      sendBytes(ctx, 200, ct, buf, { 'cache-control': 'public, max-age=3600' });
      return;
    }
    sendNotFoundPage(ctx);
    return;
  }
  // self-hosted fonts under /fonts/
  if (path.startsWith('/fonts/')) {
    const safe = path.slice('/fonts/'.length).replace(/\\/g, '/');
    if (safe.includes('..')) {
      sendNotFoundPage(ctx);
      return;
    }
    const file = join(process.cwd(), 'dist', 'public', 'fonts', safe);
    if (existsSync(file) && statSync(file).isFile()) {
      const buf = readFileSync(file);
      const ct = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
      sendBytes(ctx, 200, ct, buf, { 'cache-control': 'public, max-age=86400' });
      return;
    }
  }
  // page routes
  const pageRoutes = ['/', '/start', '/calendar', '/plan', '/requests', '/costs', '/records'];
  if (pageRoutes.includes(path) || path.startsWith('/join/') || path.startsWith('/share/')) {
    sendIndex(ctx);
    return;
  }
  sendNotFoundPage(ctx);
}

function sendIndex(ctx: Ctx): void {
  const file = join(process.cwd(), 'dist', 'public', 'index.html');
  if (existsSync(file)) {
    sendBytes(ctx, 200, 'text/html; charset=utf-8', readFileSync(file), { 'cache-control': 'no-store' });
  } else {
    sendProblem404(ctx);
  }
}

function sendNotFoundPage(ctx: Ctx): void {
  const file = join(process.cwd(), 'dist', 'public', '404.html');
  if (existsSync(file)) {
    sendBytes(ctx, 404, 'text/html; charset=utf-8', readFileSync(file), { 'cache-control': 'no-store' });
  } else {
    sendProblem404(ctx);
  }
}

function sendProblem404(ctx: Ctx): void {
  ctx.res.writeHead(404, { 'content-type': 'application/problem+json', 'cache-control': 'no-store' });
  ctx.res.end(JSON.stringify({
    type: 'urn:twohouse:problem:not_found',
    title: "We couldn't find that page.",
    status: 404,
    code: 'not_found',
  }));
}

