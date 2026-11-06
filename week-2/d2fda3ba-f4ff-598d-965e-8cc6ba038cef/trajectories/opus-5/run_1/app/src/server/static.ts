import { readFile } from 'node:fs/promises';
import { join, normalize, resolve } from 'node:path';
import { notFound } from './errors';
import type { Reply, Router } from './http';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

function contentTypeOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return CONTENT_TYPES[path.slice(dot)] ?? 'application/octet-stream';
}

/** Serves the built browser bundle and the app shell. Nothing outside the bundle is reachable. */
export function registerStaticRoutes(router: Router, publicDir: string): void {
  const root = resolve(publicDir);

  const shell = async (): Promise<Reply> => {
    const body = await readFile(join(root, 'index.html'));
    return {
      status: 200,
      body,
      contentType: 'text/html; charset=utf-8',
      headers: { 'cache-control': 'no-cache' },
    };
  };

  for (const route of ['/', '/ops', '/devices/approve/:token', '/invites/:token']) {
    router.add('GET', route, shell);
  }

  router.add('GET', '/sw.js', async () => ({
    status: 200,
    body: await readFile(join(root, 'sw.js')),
    contentType: 'text/javascript; charset=utf-8',
    headers: { 'cache-control': 'no-cache', 'service-worker-allowed': '/' },
  }));

  router.add('GET', '/assets/*', async (ctx) => {
    const requested = normalize(ctx.params['*'] ?? '');
    const path = resolve(join(root, 'assets', requested));
    if (!path.startsWith(join(root, 'assets'))) throw notFound();
    try {
      const body = await readFile(path);
      return {
        status: 200,
        body,
        contentType: contentTypeOf(path),
        headers: { 'cache-control': 'no-cache' },
      };
    } catch {
      throw notFound();
    }
  });
}
