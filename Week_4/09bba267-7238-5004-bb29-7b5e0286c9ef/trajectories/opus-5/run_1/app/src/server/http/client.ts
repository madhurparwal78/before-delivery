import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import type { RequestContext } from './context';
import { sendText } from './respond';

const CLIENT_ROOT = join(__dirname, '..', '..', 'client');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const PAGE_PATHS: readonly RegExp[] = [
  /^\/$/,
  /^\/p\/[^/]+$/,
  /^\/tickets$/,
  /^\/offers\/[^/]+$/,
  /^\/owner$/,
  /^\/owner\/new$/,
  /^\/owner\/orders$/,
  /^\/owner\/outbox$/,
];

interface Asset {
  readonly body: Buffer;
  readonly contentType: string;
}

function collect(directory: string, assets: Map<string, Asset>): void {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      collect(full, assets);
      continue;
    }
    const extension = extname(full).toLowerCase();
    const contentType = CONTENT_TYPES[extension];
    if (contentType === undefined) continue;
    assets.set(`/${relative(CLIENT_ROOT, full).split(/[/\\]/).join('/')}`, {
      body: readFileSync(full),
      contentType,
    });
  }
}

const assets = new Map<string, Asset>();
collect(CLIENT_ROOT, assets);
const indexHtml = readFileSync(join(CLIENT_ROOT, 'index.html'));

/** Serves the built client: its assets, the app's page paths, and the not-found page elsewhere. */
export function serveClient(context: RequestContext): void {
  const pathname = context.url.pathname;
  const asset = assets.get(pathname);
  if (asset !== undefined && pathname !== '/index.html') {
    sendText(
      context.res,
      200,
      asset.contentType,
      asset.body,
      { 'cache-control': 'public, max-age=31536000, immutable' },
      context.cookies,
    );
    return;
  }
  const isPage = PAGE_PATHS.some((pattern) => pattern.test(pathname));
  sendText(
    context.res,
    isPage ? 200 : 404,
    'text/html; charset=utf-8',
    indexHtml,
    { 'cache-control': 'no-store' },
    context.cookies,
  );
}
