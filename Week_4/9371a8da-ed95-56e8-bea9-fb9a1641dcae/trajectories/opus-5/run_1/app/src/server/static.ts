import { readFile } from 'node:fs/promises';
import { ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

/** Only the built assets are served. */
const ALLOWED = ['/app.js', '/app.css'];

export async function serveAsset(
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const isFont = pathname.startsWith('/fonts/') && pathname.endsWith('.woff2');
  if (!ALLOWED.includes(pathname) && !isFont) return false;
  const resolved = normalize(join(publicDir, pathname));
  if (!resolved.startsWith(publicDir)) return false;
  let bytes: Buffer;
  try {
    bytes = await readFile(resolved);
  } catch {
    return false;
  }
  response.statusCode = 200;
  response.setHeader('Content-Type', TYPES[extname(resolved)] ?? 'application/octet-stream');
  response.setHeader('Content-Length', bytes.length);
  response.setHeader('Cache-Control', 'no-store');
  response.end(bytes);
  return true;
}

let page: Buffer | null = null;

export async function servePage(response: ServerResponse, status: number): Promise<void> {
  if (page === null) page = await readFile(join(publicDir, 'index.html'));
  response.statusCode = status;
  response.setHeader('Content-Type', TYPES['.html']);
  response.setHeader('Content-Length', page.length);
  response.setHeader('Cache-Control', 'no-store');
  response.end(page);
}
