import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';

const CLIENT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../client',
);

const CONTENT_TYPES = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.woff2', 'font/woff2'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json'],
]);

const ASSET_PATH = /^\/(assets|fonts)\/[A-Za-z0-9._-]+$/;

const SPA_ROUTES: RegExp[] = [
  /^\/$/,
  /^\/host$/,
  /^\/host\/login$/,
  /^\/host\/signup$/,
  /^\/host\/decks\/[^/]+$/,
  /^\/host\/nights$/,
  /^\/host\/nights\/[^/]+$/,
  /^\/stage\/[^/]+$/,
  /^\/play\/[^/]+$/,
];

const cache = new Map<string, Buffer>();

async function readAsset(relative: string): Promise<Buffer | null> {
  const cached = cache.get(relative);
  if (cached) return cached;
  try {
    const bytes = await readFile(path.join(CLIENT_ROOT, relative));
    cache.set(relative, bytes);
    return bytes;
  } catch {
    return null;
  }
}

function send(res: ServerResponse, bytes: Buffer, filename: string, immutable: boolean): void {
  const type = CONTENT_TYPES.get(path.extname(filename)) ?? 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'content-length': String(bytes.byteLength),
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  res.end(bytes);
}

/** Serves the built client only: never source, config or credentials. */
export async function serveClient(pathname: string, res: ServerResponse): Promise<boolean> {
  if (ASSET_PATH.test(pathname)) {
    const bytes = await readAsset(pathname.slice(1));
    if (!bytes) return false;
    send(res, bytes, pathname, true);
    return true;
  }
  if (SPA_ROUTES.some((route) => route.test(pathname))) {
    const bytes = await readAsset('index.html');
    if (!bytes) return false;
    send(res, bytes, 'index.html', false);
    return true;
  }
  return false;
}
