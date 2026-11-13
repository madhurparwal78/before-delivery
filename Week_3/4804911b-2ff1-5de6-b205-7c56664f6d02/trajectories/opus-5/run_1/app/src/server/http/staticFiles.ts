import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setStaticHandler, type Ctx, type Reply } from './server.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

const APP_ROUTES = ['/', '/sign-in', '/stockist', '/editor'];

function publicRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../public');
}

function contentType(path: string): string {
  const dot = path.lastIndexOf('.');
  return TYPES[path.slice(dot)] ?? 'application/octet-stream';
}

function isAppRoute(path: string): boolean {
  return APP_ROUTES.includes(path) || /^\/notices\/[^/]+$/.test(path);
}

export function registerStaticFiles(): void {
  setStaticHandler(async (ctx: Ctx): Promise<Reply> => {
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
      return { status: 404, text: 'Not found' };
    }
    if (ctx.path.startsWith('/assets/')) {
      const target = normalize(join(publicRoot(), ctx.path));
      if (!target.startsWith(publicRoot())) return { status: 404, text: 'Not found' };
      try {
        const bytes = await readFile(target);
        return {
          status: 200,
          bytes,
          headers: { 'content-type': contentType(ctx.path), 'cache-control': 'no-cache' },
        };
      } catch {
        return { status: 404, text: 'Not found' };
      }
    }

    const signedIn = ctx.account;
    if (ctx.path === '/stockist' || ctx.path === '/editor') {
      if (signedIn === null) return { status: 302, location: '/sign-in' };
      const own = signedIn.role === 'editor' ? '/editor' : '/stockist';
      if (own !== ctx.path) return { status: 302, location: own };
    }
    if (ctx.path === '/sign-in' && signedIn !== null) {
      return { status: 302, location: signedIn.role === 'editor' ? '/editor' : '/stockist' };
    }

    const html = await readFile(join(publicRoot(), 'index.html'));
    const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' };
    if (ctx.path === '/stockist' || ctx.path === '/editor') headers['cache-control'] = 'no-store';
    else headers['cache-control'] = 'no-cache';
    return { status: isAppRoute(ctx.path) ? 200 : 404, bytes: html, headers };
  });
}
