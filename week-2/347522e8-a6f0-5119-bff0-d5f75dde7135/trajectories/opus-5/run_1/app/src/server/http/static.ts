/**
 * Static serving. Only the built browser assets and the screen shell are
 * served; source files, configuration, the manifest and credentials are not
 * reachable at all, because nothing outside `dist/public` is ever opened.
 */

import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { ServerResponse } from 'node:http';

const PUBLIC_ROOT = resolve(import.meta.dirname, '..', '..', '..', 'public');
const ASSET_PREFIX = '/assets/';

/** The screen routes the single-page shell answers. */
const SHELL_ROUTES = new Set(['/', '/apply', '/board', '/kitchen', '/operator', '/shift']);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

function notFound(response: ServerResponse): void {
  const payload = Buffer.from(JSON.stringify({ error: 'not_found' }), 'utf8');
  response.writeHead(404, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
  });
  response.end(payload);
}

async function sendFile(
  response: ServerResponse,
  absolutePath: string,
  cacheControl: string,
): Promise<void> {
  const body = await readFile(absolutePath);
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(absolutePath)] ?? 'application/octet-stream',
    'content-length': String(body.length),
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

export async function handleStaticRequest(
  method: string,
  pathname: string,
  response: ServerResponse,
): Promise<void> {
  if (method !== 'GET' && method !== 'HEAD') {
    notFound(response);
    return;
  }

  if (pathname.startsWith(ASSET_PREFIX)) {
    const relative = normalize(pathname.slice(1));
    const absolute = join(PUBLIC_ROOT, relative);
    if (!absolute.startsWith(`${PUBLIC_ROOT}/`)) {
      notFound(response);
      return;
    }
    try {
      const info = await stat(absolute);
      if (!info.isFile()) {
        notFound(response);
        return;
      }
    } catch {
      notFound(response);
      return;
    }
    await sendFile(response, absolute, 'public, max-age=3600');
    return;
  }

  if (SHELL_ROUTES.has(pathname) || /^\/share\/[^/]+$/.test(pathname)) {
    await sendFile(response, join(PUBLIC_ROOT, 'index.html'), 'no-store');
    return;
  }

  notFound(response);
}
