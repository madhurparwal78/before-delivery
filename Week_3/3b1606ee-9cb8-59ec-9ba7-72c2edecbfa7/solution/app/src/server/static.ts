import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, sendError } from './http.js';

const root = resolve(fileURLToPath(new URL('../client/', import.meta.url)));
const PAGES = /^\/(signup|signin|letters(\/[0-9a-f-]{36})?|requests|contacts|settings)?$/;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

function send(res: ServerResponse, file: string, cache: string): void {
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': statSync(file).size, 'Cache-Control': cache, ...SECURITY });
  createReadStream(file).pipe(res);
}

/** Serves only the built client: its pages, hashed assets and fonts. Everything else is the 404 of an unknown path. */
export function serveClient(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, new ApiError(404, 'not_found'));
  if (PAGES.test(pathname)) return send(res, join(root, 'index.html'), 'no-cache');
  const file = resolve(join(root, pathname));
  const dotted = pathname.split('/').some((part) => part.startsWith('.'));
  if (!file.startsWith(root + sep) || dotted || !existsSync(file) || !statSync(file).isFile()) {
    return sendError(res, new ApiError(404, 'not_found'));
  }
  send(res, file, pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=86400');
}
