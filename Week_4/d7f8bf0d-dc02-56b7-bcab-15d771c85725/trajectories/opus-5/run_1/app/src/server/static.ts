import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../client');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Only the built frontend is served; nothing outside it can be reached. */
export async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const candidate = resolve(join(CLIENT_ROOT, relative));
  const extension = extname(candidate).toLowerCase();

  if (candidate.startsWith(CLIENT_ROOT) && extension !== '') {
    try {
      const info = await stat(candidate);
      if (info.isFile()) {
        res.writeHead(200, {
          'Content-Type': TYPES[extension] ?? 'application/octet-stream',
          'Content-Length': info.size,
          'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=3600',
        });
        createReadStream(candidate).pipe(res);
        return;
      }
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
  }

  const index = join(CLIENT_ROOT, 'index.html');
  try {
    const info = await stat(index);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
    });
    createReadStream(index).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}
