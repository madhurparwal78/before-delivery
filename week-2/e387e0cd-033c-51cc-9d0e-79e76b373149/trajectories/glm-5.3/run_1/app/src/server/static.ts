import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';

const staticDir = join(dirname(fileURLToPath(import.meta.url)), 'static');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

// Known page routes serve the app shell with 200; an unknown path answers the
// not-found page with status 404 and a withdrawn listing answers 410.
const PAGE_ROUTES: RegExp[] = [
  /^\/$/,
  /^\/sign-in$/,
  /^\/jurisdictions\/[A-Z]{2}$/,
  /^\/r\/[A-Za-z0-9_-]+$/,
  /^\/w\/(neris|kallang)\/(cases|review|messages|counterparties|import|rules|reports\/daily|months|files|partner-keys|members|listing)(\/[A-Za-z0-9_-]+)*\/?$/,
];

export type ListingState = 'listed' | 'withdrawn' | 'unknown';

export async function servePage(res: ServerResponse, pathname: string, listingState: ListingState = 'listed'): Promise<void> {
  if (pathname.startsWith('/assets/')) {
    try {
      const relative = pathname.slice('/assets/'.length).replace(/\.\./g, '');
      const file = await readFile(join(staticDir, relative));
      const ext = pathname.slice(pathname.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
      res.end(file);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
    return;
  }
  if (pathname.startsWith('/client-main.mjs')) {
    try {
      const file = await readFile(join(staticDir, 'client-main.mjs'));
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(file);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
    return;
  }
  const file = await readFile(join(staticDir, 'index.html'));
  let status = 200;
  if (pathname.startsWith('/exchanges/')) {
    status = listingState === 'withdrawn' ? 410 : listingState === 'unknown' ? 404 : 200;
  } else if (!PAGE_ROUTES.some((re) => re.test(pathname))) {
    status = 404;
  }
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(file);
}
