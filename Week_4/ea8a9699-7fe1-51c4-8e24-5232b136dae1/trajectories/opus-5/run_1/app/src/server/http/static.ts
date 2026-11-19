import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { ServerResponse } from 'node:http';

const clientRoot = resolve(process.cwd(), 'dist/client');

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
};

function resolveWithin(path: string): string | null {
  const candidate = resolve(join(clientRoot, normalize(path)));
  if (candidate !== clientRoot && !candidate.startsWith(clientRoot + sep)) {
    return null;
  }
  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : null;
}

export function serveStatic(path: string, response: ServerResponse): boolean {
  const file = resolveWithin(path);
  if (file === null) {
    return false;
  }
  response.writeHead(200, {
    'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': path.startsWith('/assets/') || path.startsWith('/fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(response);
  return true;
}

export function serveAppShell(response: ServerResponse): boolean {
  const file = resolveWithin('/index.html');
  if (file === null) {
    return false;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  createReadStream(file).pipe(response);
  return true;
}

export function hasExtension(path: string): boolean {
  return extname(path) !== '';
}
