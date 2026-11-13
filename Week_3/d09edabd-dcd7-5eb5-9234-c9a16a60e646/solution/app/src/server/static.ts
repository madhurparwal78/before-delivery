import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notFound } from './errors.js';
import { refuse, safeDecode } from './http.js';

const ROOT = fileURLToPath(new URL('../../public', import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

const missing = (res: ServerResponse): void => refuse(res, notFound());

/** Serves the built frontend only: assets by path, the app shell for any route without a file extension. */
export async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return missing(res);
  const relative = path.normalize(safeDecode(pathname)).replace(/^([/\\])+/, '');
  const target = path.join(ROOT, relative);
  const insideRoot = target.startsWith(ROOT + path.sep);
  const asset = insideRoot ? await stat(target).catch(() => null) : null;
  if (asset?.isFile()) {
    const immutable = relative.startsWith('assets/');
    res.writeHead(200, { 'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream', 'content-length': asset.size, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(target).pipe(res);
    return;
  }
  if (path.extname(pathname) !== '') return missing(res);
  const shell = path.join(ROOT, 'index.html');
  const info = await stat(shell).catch(() => null);
  if (!info) return missing(res);
  res.writeHead(200, { 'content-type': TYPES['.html']!, 'content-length': info.size, 'cache-control': 'no-cache' });
  if (req.method === 'HEAD') return void res.end();
  createReadStream(shell).pipe(res);
}
