import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Reply } from './router.js';

const CLIENT_ROOT = fileURLToPath(new URL('../../client/', import.meta.url));

/** The client renders one of these paths; everything else is not served. */
const APP_PATHS = ['/', '/requests', '/board', '/offers', '/my-seats', '/billing', '/org'];

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

async function readAsset(relative: string): Promise<Reply | null> {
  const target = join(CLIENT_ROOT, normalize(relative));
  if (!target.startsWith(CLIENT_ROOT)) return null;
  try {
    const info = await stat(target);
    if (!info.isFile()) return null;
  } catch {
    return null;
  }
  const body = await readFile(target);
  const type = CONTENT_TYPES[extname(target)] ?? 'application/octet-stream';
  const cacheable = relative.startsWith('assets/') || relative.startsWith('fonts/');
  return {
    status: 200,
    body,
    contentType: type,
    headers: cacheable
      ? { 'Cache-Control': 'public, max-age=31536000, immutable' }
      : { 'Cache-Control': 'no-cache' },
  };
}

/** Serves the built client: its own paths, its assets and its fonts, nothing else. */
export async function serveClient(pathname: string): Promise<Reply | null> {
  if (APP_PATHS.includes(pathname)) return readAsset('index.html');
  if (pathname.startsWith('/assets/') || pathname.startsWith('/fonts/')) {
    return readAsset(pathname.slice(1));
  }
  return null;
}
