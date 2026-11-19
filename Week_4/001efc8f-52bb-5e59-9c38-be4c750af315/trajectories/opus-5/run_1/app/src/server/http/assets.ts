import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import { nowDate } from '../clock';

const PUBLIC_ROOT = path.resolve(__dirname, '..', '..', 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function assetPath(urlPath: string): string | null {
  const relative = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const resolved = path.join(PUBLIC_ROOT, relative);
  if (!resolved.startsWith(PUBLIC_ROOT + path.sep)) return null;
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return null;
  return resolved;
}

export function sendAsset(res: ServerResponse, filePath: string): void {
  const extension = path.extname(filePath);
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'cache-control': extension === '.html' ? 'no-store' : 'public, max-age=3600',
    date: nowDate().toUTCString(),
  });
  createReadStream(filePath).pipe(res);
}

export function sendShell(res: ServerResponse): void {
  const index = path.join(PUBLIC_ROOT, 'index.html');
  if (!existsSync(index)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', date: nowDate().toUTCString() });
    res.end('Not found');
    return;
  }
  sendAsset(res, index);
}
