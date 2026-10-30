import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function isHidden(requestPath: string): boolean {
  return requestPath.split('/').some((segment) => segment.startsWith('.'));
}

async function fileAt(candidate: string): Promise<string | null> {
  if (!candidate.startsWith(CLIENT_ROOT + path.sep) && candidate !== CLIENT_ROOT) return null;
  try {
    const info = await stat(candidate);
    return info.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

export async function serveStatic(requestPath: string, res: ServerResponse): Promise<boolean> {
  if (isHidden(requestPath)) return false;
  const relative = decodeURIComponent(requestPath).replace(/^\/+/, '');
  const direct = relative === '' ? null : await fileAt(path.resolve(CLIENT_ROOT, relative));
  const target = direct ?? (path.extname(relative) === '' ? await fileAt(path.join(CLIENT_ROOT, 'index.html')) : null);
  if (!target) return false;

  const extension = path.extname(target).toLowerCase();
  const immutable = target !== path.join(CLIENT_ROOT, 'index.html') && relative.startsWith('assets/');
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(target);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });
  return true;
}
