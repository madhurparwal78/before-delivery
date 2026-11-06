import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { ServerResponse } from 'node:http';
import { fail } from '../errors';

const ROOT = resolve(__dirname, '../../public');

const SPA_PATHS = new Set(['/', '/signin', '/run', '/jobs', '/library', '/webhooks', '/finance', '/admin']);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

const SERVED_FILES = new Set(['/app.js', '/styles.css', '/favicon.png']);

function isFontPath(path: string): boolean {
  return /^\/fonts\/[a-z0-9-]+\.woff2$/.test(path);
}

/** Serves only the built browser assets; every other path is a 404. */
export async function serveStatic(path: string, res: ServerResponse): Promise<void> {
  const clean = normalize(path);
  const target = SPA_PATHS.has(clean) ? '/index.html' : clean;
  if (target !== '/index.html' && !SERVED_FILES.has(target) && !isFontPath(target)) throw fail.notFound();
  const file = join(ROOT, target);
  if (!file.startsWith(ROOT)) throw fail.notFound();
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch {
    throw fail.notFound();
  }
  const contentType = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': String(bytes.length),
    'cache-control': target === '/index.html' ? 'no-store' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  });
  res.end(bytes);
}
