import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ServerResponse } from 'node:http';

const PUBLIC_DIR = join(__dirname, '..', '..', 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

/**
 * Only the built frontend assets are ever served. Anything outside this map,
 * including source, credentials and manifests, is not found.
 */
const ASSETS: readonly string[] = [
  '/app.js',
  '/styles.css',
  '/fonts/tilt-warp-latin.woff2',
  '/fonts/plus-jakarta-sans-latin.woff2',
  '/fonts/plus-jakarta-sans-latin-ext.woff2',
];

const cache = new Map<string, Buffer>();

function read(path: string): Buffer {
  let bytes = cache.get(path);
  if (!bytes) {
    bytes = readFileSync(join(PUBLIC_DIR, path.slice(1)));
    cache.set(path, bytes);
  }
  return bytes;
}

export function isAsset(path: string): boolean {
  return ASSETS.includes(path);
}

export function sendAsset(res: ServerResponse, path: string): void {
  const bytes = read(path);
  const extension = path.slice(path.lastIndexOf('.'));
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'content-length': bytes.length,
    'cache-control': path === '/app.js' || path === '/styles.css' ? 'no-cache' : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  });
  res.end(bytes);
}

export function indexHtml(): Buffer {
  return read('/index.html');
}

export function sendPage(res: ServerResponse, status: number): void {
  const bytes = indexHtml();
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': bytes.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(bytes);
}
