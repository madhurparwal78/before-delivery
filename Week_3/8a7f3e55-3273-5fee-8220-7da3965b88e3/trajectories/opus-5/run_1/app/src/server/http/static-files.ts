import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { join, normalize, resolve, sep } from 'node:path';

const WEB_ROOT = resolve(import.meta.dirname, '../../../web');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/vnd.microsoft.icon',
};

function extensionOf(pathname: string): string {
  const lastSlash = pathname.lastIndexOf('/');
  const name = pathname.slice(lastSlash + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

async function sendFile(res: ServerResponse, filePath: string, extension: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
      'content-length': info.size,
      'x-content-type-options': 'nosniff',
      'cache-control': extension === '.html' ? 'no-store' : 'public, max-age=3600',
    });
    await new Promise<void>((done, fail) => {
      const stream = createReadStream(filePath);
      stream.on('error', fail);
      stream.on('close', done);
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    });
    return true;
  } catch {
    return false;
  }
}

/** Only the built front end and its bundled fonts are served; anything else answers 404. */
export async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const extension = extensionOf(pathname);
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  const hidden = segments.some((segment) => segment.startsWith('.'));

  if (!hidden && extension !== '' && CONTENT_TYPES[extension] !== undefined) {
    const candidate = normalize(join(WEB_ROOT, ...segments));
    if (candidate.startsWith(WEB_ROOT + sep) && (await sendFile(res, candidate, extension))) {
      return;
    }
  }

  if (!hidden && extension === '') {
    if (await sendFile(res, join(WEB_ROOT, 'index.html'), '.html')) return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}
