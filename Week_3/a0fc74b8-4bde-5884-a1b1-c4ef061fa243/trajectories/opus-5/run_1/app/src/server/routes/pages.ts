import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { callerOf } from '../auth.ts';
import { redirect, sendBytes, sendJson, type Ctx, type HttpApp } from '../http/server.ts';

const PUBLIC_DIR = new URL('../public/', import.meta.url).pathname;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
};

const shell = async (): Promise<Buffer> => readFile(join(PUBLIC_DIR, 'index.html'));

const serveAsset = async (ctx: Ctx, relative: string): Promise<boolean> => {
  const safe = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '');
  if (safe.startsWith('..') || safe.includes(`..${sep}`)) return false;
  const extension = extname(safe);
  const mime = MIME[extension];
  if (mime === undefined) return false;
  if (extension === '.map') return false;
  let bytes: Buffer;
  try {
    bytes = await readFile(join(PUBLIC_DIR, 'assets', safe));
  } catch {
    return false;
  }
  sendBytes(ctx.res, 200, mime, bytes, {
    'cache-control': 'public, max-age=3600',
  });
  return true;
};

/** Signed-out visits to an app page come back here after sign-in. */
const signInRedirect = (ctx: Ctx): void => {
  const next = `${ctx.url.pathname}${ctx.url.search}`;
  redirect(ctx.res, `/sign-in?next=${encodeURIComponent(next)}`);
};

const PUBLIC_PATHS = new Set(['/sign-in']);

const isSignerPath = (pathname: string): boolean => /^\/sign\/[^/]+$/.test(pathname);

const looksLikeFile = (pathname: string): boolean => {
  const last = pathname.split('/').pop() ?? '';
  return last.includes('.');
};

export const registerPageRoutes = (app: HttpApp): void => {
  app.on('GET', '/api/health', async (ctx) => {
    sendJson(ctx.res, 200, { status: 'ok' });
  });

  app.otherwise(async (ctx) => {
    if (ctx.req.method !== 'GET' && ctx.req.method !== 'HEAD') {
      sendJson(ctx.res, 404, { error: 'not_found' });
      return;
    }
    const pathname = ctx.url.pathname;
    if (pathname.startsWith('/api/')) {
      sendJson(ctx.res, 404, { error: 'not_found' });
      return;
    }
    if (pathname.startsWith('/assets/')) {
      if (await serveAsset(ctx, pathname.slice('/assets/'.length))) return;
      sendJson(ctx.res, 404, { error: 'not_found' });
      return;
    }
    if (looksLikeFile(pathname)) {
      sendJson(ctx.res, 404, { error: 'not_found' });
      return;
    }
    if (PUBLIC_PATHS.has(pathname) || isSignerPath(pathname)) {
      sendBytes(ctx.res, 200, 'text/html; charset=utf-8', await shell(), {
        'cache-control': 'no-store',
      });
      return;
    }
    const caller = await callerOf(ctx);
    if (!caller) {
      signInRedirect(ctx);
      return;
    }
    sendBytes(ctx.res, 200, 'text/html; charset=utf-8', await shell(), {
      'cache-control': 'no-store',
    });
  });
};
