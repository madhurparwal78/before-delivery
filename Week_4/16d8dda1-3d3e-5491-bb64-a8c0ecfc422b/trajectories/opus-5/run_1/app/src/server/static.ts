import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ServerResponse } from 'node:http';
import { config } from './config.js';
import { errors } from './http.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

const assets: Record<string, string> = {
  '/assets/app.js': 'text/javascript; charset=utf-8',
  '/assets/app.css': 'text/css; charset=utf-8'
};

const cache = new Map<string, Buffer>();

async function read(name: string): Promise<Buffer> {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const bytes = await readFile(join(publicDir, name));
  cache.set(name, bytes);
  return bytes;
}

export function isAsset(path: string): boolean {
  return Object.hasOwn(assets, path);
}

/** Only the built page and its two assets are served; everything else is not there. */
export async function serveAsset(res: ServerResponse, path: string): Promise<void> {
  const contentType = assets[path];
  if (contentType === undefined) throw errors.notFound();
  const bytes = await read(path.slice(1));
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': bytes.byteLength,
    'cache-control': 'no-cache',
    'x-slatehall-instance': config.instanceName
  });
  res.end(bytes);
}

export async function servePage(res: ServerResponse, status = 200): Promise<void> {
  const bytes = await read('index.html');
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': bytes.byteLength,
    'cache-control': 'no-store',
    'x-slatehall-instance': config.instanceName
  });
  res.end(bytes);
}

const pagePattern =
  /^\/(?:$|sign-in$|sign-up$|classes(?:\/[^/]+(?:\/room)?)?$|lessons\/[^/]+$|join$|sessions\/[^/]+(?:\/summary)?$|review\/[^/]+$)/;

export function isPagePath(path: string): boolean {
  return pagePattern.test(path);
}
