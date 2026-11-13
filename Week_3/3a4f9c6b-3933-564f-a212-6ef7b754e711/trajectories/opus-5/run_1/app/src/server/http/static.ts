import { readFile, readdir } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

/** The only client routes the server answers. Anything else is unknown. */
const CLIENT_ROUTES: RegExp[] = [
  /^\/sign-in$/,
  /^\/projects\/[^/]+$/,
  /^\/projects\/[^/]+\/windows$/,
  /^\/approvals\/[^/]+$/,
];

const assets = new Map<string, Buffer>();

export async function loadAssets(): Promise<void> {
  const names = await readdir(PUBLIC_DIR);
  for (const name of names) {
    if (!(extname(name) in CONTENT_TYPES)) continue;
    assets.set(`/${name}`, await readFile(new URL(name, `file://${PUBLIC_DIR}`)));
  }
}

function send(
  res: ServerResponse,
  status: number,
  body: Buffer,
  headers: Record<string, string>,
): void {
  res.writeHead(status, { ...headers, 'content-length': String(body.length) });
  res.end(body);
}

const NOT_FOUND = Buffer.from('Not found\n', 'utf8');

export async function serveClient(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 404, NOT_FOUND, { 'content-type': 'text/plain; charset=utf-8' });
    return;
  }

  if (url.pathname === '/') {
    res.writeHead(302, { location: '/sign-in', 'content-length': '0' });
    res.end();
    return;
  }

  const asset = assets.get(url.pathname);
  if (asset) {
    const extension = extname(url.pathname);
    const type = CONTENT_TYPES[extension] ?? 'application/octet-stream';
    // Only the fonts are content-stable; the markup, script and stylesheet are not hashed.
    const cache = extension === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-store';
    send(res, 200, asset, { 'content-type': type, 'cache-control': cache });
    return;
  }

  if (CLIENT_ROUTES.some((route) => route.test(url.pathname))) {
    const shell = assets.get('/index.html');
    if (shell) {
      send(res, 200, shell, { 'content-type': CONTENT_TYPES['.html'] as string, 'cache-control': 'no-store' });
      return;
    }
  }

  send(res, 404, NOT_FOUND, { 'content-type': 'text/plain; charset=utf-8' });
}
