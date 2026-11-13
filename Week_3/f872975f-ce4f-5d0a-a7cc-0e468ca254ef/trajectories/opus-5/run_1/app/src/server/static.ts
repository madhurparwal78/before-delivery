import { createReadStream, existsSync, statSync } from 'node:fs';
import { ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';

const PUBLIC_DIR = join(__dirname, '..', 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

const APP_ROUTES = ['/', '/sign-in', '/account', '/yard', '/owner'];
const APP_PREFIXES = ['/boards/', '/tickets/'];

function isAppRoute(pathname: string): boolean {
  if (APP_ROUTES.includes(pathname)) return true;
  return APP_PREFIXES.some((prefix) => pathname.startsWith(prefix) && pathname.length > prefix.length);
}

function sendPlain(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' });
  response.end(text);
}

/** Serves only the built client assets; everything else answers 404. */
export function serveStatic(method: string, pathname: string, response: ServerResponse): void {
  if (method !== 'GET' && method !== 'HEAD') {
    sendPlain(response, 404, 'Not found');
    return;
  }
  const extension = extname(pathname);
  if (extension !== '') {
    const relative = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
    const file = join(PUBLIC_DIR, relative);
    if (!file.startsWith(PUBLIC_DIR) || !existsSync(file) || !statSync(file).isFile() || MIME[extension] === undefined) {
      sendPlain(response, 404, 'Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': MIME[extension],
      'cache-control': extension === '.woff2' ? 'public, max-age=604800' : 'no-cache',
      'x-content-type-options': 'nosniff'
    });
    if (method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(file).pipe(response);
    return;
  }

  const index = join(PUBLIC_DIR, 'index.html');
  if (!existsSync(index)) {
    sendPlain(response, 404, 'Not found');
    return;
  }
  response.writeHead(isAppRoute(pathname) ? 200 : 404, {
    'content-type': MIME['.html'] ?? 'text/html',
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff'
  });
  if (method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(index).pipe(response);
}
