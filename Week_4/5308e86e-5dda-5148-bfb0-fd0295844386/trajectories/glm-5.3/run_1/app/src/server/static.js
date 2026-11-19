import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { PUBLIC_DIR } from './config.js';

// Static assets under /css, /js, /media, /fonts and the favicon.
export function serveStatic(req, res, url) {
  const path = url.pathname;
  if (path === '/favicon.svg' || path === '/favicon.ico') {
    const p = join(PUBLIC_DIR, 'favicon.svg');
    if (existsSync(p)) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      res.end(readFileSync(p));
      return true;
    }
  }
  const allowed = ['/css/', '/js/', '/media/', '/fonts/'];
  if (!allowed.some((p) => path.startsWith(p))) return false;
  if (path.includes('..')) return false;
  const full = join(PUBLIC_DIR, path.replace(/^\//, ''));
  if (!existsSync(full) || !statSync(full).isFile()) return false;
  const ext = extname(full).toLowerCase();
  const mime = {
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.vtt': 'text/vtt; charset=utf-8',
  }[ext];
  if (!mime) return false;
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
  res.end(readFileSync(full));
  return true;
}
