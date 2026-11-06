// Serves only the built client files and the index document.
import { readdirSync, readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from './errors';

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
};

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  'Referrer-Policy': 'same-origin',
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const files = new Map<string, { body: Buffer; type: string }>();

function collect(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else {
      const ext = entry.name.slice(entry.name.lastIndexOf('.'));
      const type = TYPES[ext];
      if (type) files.set('/' + relative(root, full).split('\\').join('/'), { body: readFileSync(full), type });
    }
  }
}
collect(root);
const index = files.get('/index.html');

export function serveStatic(pathname: string, res: ServerResponse): void {
  const last = pathname.split('/').pop() ?? '';
  const file = last.includes('.') ? files.get(pathname) : index;
  if (!file || (last.includes('.') && pathname === '/index.html')) {
    const failure = new ApiError('not_found');
    const payload = JSON.stringify(failure.body());
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(payload);
    return;
  }
  const cache = file === index ? 'no-store' : pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': file.type, 'Cache-Control': cache, 'Content-Length': file.body.length });
  res.end(file.body);
}
