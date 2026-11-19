import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { decodeSegment } from './http.ts';

const ROOT = join(import.meta.dirname, 'public');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const PAGES = [/^\/$/, /^\/signup$/, /^\/signin$/, /^\/maps$/, /^\/m\/[^/]+$/, /^\/m\/[^/]+\/versions\/[^/]+$/, /^\/s\/[^/]+$/, /^\/p\/[^/]+$/];

/** The content security policy: scripts, styles, fonts, images and connections from the app's own origin only. */
const securityHeaders = (host: string | undefined): Record<string, string> => ({
  'content-security-policy': `default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' ws://${host ?? ''} wss://${host ?? ''}; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
});

async function serve(res: ServerResponse, status: number, file: string, host: string | undefined): Promise<void> {
  const body = await readFile(join(ROOT, file));
  const cache = file.startsWith('assets/') || file.startsWith('fonts/') ? 'public, max-age=3600' : 'no-cache';
  res.writeHead(status, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': cache, ...securityHeaders(host) });
  res.end(body);
}

/** Serve the built client: its assets, or the app shell for a page route. Anything else is a 404 page. */
export async function serveClient(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const host = req.headers.host;
  const clean = normalize(decodeSegment(pathname)).split(sep).join('/');
  const hidden = clean.split('/').some((part) => part.startsWith('.'));
  if (!hidden && (clean.startsWith('/assets/') || clean.startsWith('/fonts/'))) {
    try {
      await serve(res, 200, clean.slice(1), host);
      return;
    } catch {
      /* fall through to the not-found page */
    }
  }
  const known = PAGES.some((pattern) => pattern.test(clean));
  await serve(res, known ? 200 : 404, 'index.html', host);
}
