// Serves the built frontend from dist/client, with the single-page-app fallback. Nothing outside that folder is ever read.
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendJson, sendStatic } from './http.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'client');
const INDEX = 'index.html';
const IMMUTABLE = 'public, max-age=31536000, immutable';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

async function load(relative: string): Promise<Buffer | null> {
  const file = path.resolve(ROOT, relative);
  if (!file.startsWith(ROOT + path.sep)) return null;
  return readFile(file).catch(() => null);
}

export async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  let relative: string;
  try {
    relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  const asset = relative && !relative.includes('\0') ? await load(relative) : null;
  if (asset) {
    const type = TYPES[path.extname(relative)] ?? 'application/octet-stream';
    const hashed = relative.startsWith('assets/') || /^app-[A-Z0-9]+\.(js|css)$/.test(relative);
    const caching = relative === INDEX ? 'no-store' : hashed ? IMMUTABLE : 'public, max-age=86400';
    sendStatic(res, 200, asset, { 'Content-Type': type, 'Cache-Control': caching });
    return;
  }
  if (path.extname(relative)) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  const page = await load(INDEX);
  if (!page) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  sendStatic(res, 200, page, { 'Content-Type': TYPES['.html'] ?? 'text/html', 'Cache-Control': 'no-store' });
}
