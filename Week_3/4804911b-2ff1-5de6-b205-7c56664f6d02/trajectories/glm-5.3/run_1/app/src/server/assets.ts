import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
};

let cacheRoot: string | null = null;
function root(): string {
  if (!cacheRoot) {
    // dist/server/assets.js -> dist/client/assets
    cacheRoot = join(__dirname, '..', 'client', 'assets');
  }
  return cacheRoot;
}

/** Static assets: fonts, icons and the client script, all from the app's own origin. */
export function serveAsset(path: string, res: ServerResponse): boolean {
  const rel = path.replace(/^\/assets\//, '');
  if (rel.includes('..') || rel.includes('/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return true;
  }
  const file = join(root(), rel);
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return true;
  }
  const bytes = readFileSync(file);
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Length': bytes.length,
    'Cache-Control': 'public, max-age=86400',
  });
  res.end(bytes);
  return true;
}
