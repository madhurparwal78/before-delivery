import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const WEB_ROOT = resolve(__dirname, '../../web');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

async function sendFile(response: ServerResponse, filePath: string, cache: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': cache,
      'x-content-type-options': 'nosniff',
    });
    createReadStream(filePath).pipe(response);
    return true;
  } catch {
    return false;
  }
}

/** Serves built assets, falling back to the app shell for every other path. */
export async function serveWeb(path: string, response: ServerResponse): Promise<void> {
  const relative = normalize(path).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  if (relative !== '' && relative !== 'index.html') {
    const candidate = join(WEB_ROOT, relative);
    if (candidate.startsWith(`${WEB_ROOT}/`)) {
      const cache = relative.startsWith('assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache';
      if (await sendFile(response, candidate, cache)) return;
    }
  }
  if (await sendFile(response, join(WEB_ROOT, 'index.html'), 'no-store')) return;
  response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('The app shell has not been built.\n');
}
