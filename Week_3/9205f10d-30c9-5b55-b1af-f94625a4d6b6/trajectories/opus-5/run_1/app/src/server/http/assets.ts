import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Asset {
  body: Buffer;
  contentType: string;
  immutable: boolean;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Only these paths render the single-page app; everything else outside /api is a 404. */
const APP_ROUTES: readonly RegExp[] = [
  /^\/$/,
  /^\/signin$/,
  /^\/board$/,
  /^\/credentials$/,
  /^\/open-seats$/,
  /^\/assignments$/,
  /^\/profile$/,
  /^\/requests$/,
  /^\/requests\/new$/,
  /^\/requests\/[^/]+$/,
  /^\/requests\/[^/]+\/edit$/,
  /^\/jobs\/[^/]+$/,
  /^\/billing$/,
  /^\/invoices$/,
];

export function isAppRoute(pathname: string): boolean {
  return APP_ROUTES.some((pattern) => pattern.test(pathname));
}

const assets = new Map<string, Asset>();

async function collect(directory: string, prefix: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolute = join(directory, entry.name);
    const route = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await collect(absolute, route);
      continue;
    }
    assets.set(route, {
      body: await readFile(absolute),
      contentType: CONTENT_TYPES[extname(entry.name)] ?? 'application/octet-stream',
      immutable: route.startsWith('/assets/'),
    });
  }
}

export async function loadAssets(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  await collect(join(here, '..', '..', 'web'), '');
}

export function asset(pathname: string): Asset | null {
  return assets.get(pathname) ?? null;
}

export function indexHtml(): Asset | null {
  return assets.get('/index.html') ?? null;
}
