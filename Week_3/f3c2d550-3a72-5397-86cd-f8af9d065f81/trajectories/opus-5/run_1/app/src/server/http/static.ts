import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Only the built browser assets are served. Everything else is unknown. */

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  return CONTENT_TYPES[path.slice(dot)] ?? 'application/octet-stream';
}

/** A screen address, as opposed to a request for a file. */
export function isScreenPath(pathname: string): boolean {
  if (pathname.startsWith('/assets/') || pathname.startsWith('/api/')) return false;
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  return !lastSegment.includes('.');
}

async function resolveFile(pathname: string): Promise<string | null> {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  if (relative.split(/[/\\]/).includes('..')) return null;
  const candidate = join(publicRoot, relative);
  if (!candidate.startsWith(publicRoot.endsWith(sep) ? publicRoot : publicRoot + sep)) {
    return null;
  }
  const found = await stat(candidate).catch(() => null);
  return found?.isFile() ? candidate : null;
}

export async function serveStatic(
  pathname: string,
  response: ServerResponse,
): Promise<boolean> {
  const file = await resolveFile(isScreenPath(pathname) ? '/index.html' : pathname);
  if (!file) return false;
  const immutable = pathname.startsWith('/assets/');
  response.writeHead(200, {
    'content-type': contentTypeFor(file),
    'cache-control': immutable ? 'public, max-age=3600' : 'no-store',
  });
  createReadStream(file).pipe(response);
  return true;
}
