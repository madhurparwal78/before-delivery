import { readFile, stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSettings } from '../repo/settings.ts';
import { sendBytes, sendJson } from './respond.ts';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

type PageName = 'journey' | 'proposal' | 'console';

const TIME_ZONE_PLACEHOLDER = '__EARSHOT_TIME_ZONE__';
const TIME_ZONE_CACHE_MS = 10_000;

const pageCache = new Map<PageName, string>();
let timeZone = 'UTC';
let timeZoneReadAt = 0;

async function currentTimeZone(): Promise<string> {
  if (Date.now() - timeZoneReadAt < TIME_ZONE_CACHE_MS) return timeZone;
  try {
    timeZone = (await readSettings()).time_zone;
    timeZoneReadAt = Date.now();
  } catch {
    /* the shell still serves while the database is unreachable */
  }
  return timeZone;
}

async function readPage(name: PageName): Promise<Buffer> {
  let template = pageCache.get(name);
  if (template === undefined) {
    template = await readFile(join(publicDir, `${name}.html`), 'utf8');
    pageCache.set(name, template);
  }
  return Buffer.from(template.replace(TIME_ZONE_PLACEHOLDER, await currentTimeZone()), 'utf8');
}

function notFound(response: ServerResponse): void {
  sendJson(response, 404, { error: 'not_found', message: 'That page does not exist.' });
}

async function sendPage(response: ServerResponse, name: PageName, headers: Record<string, string>): Promise<void> {
  const bytes = await readPage(name);
  sendBytes(response, 200, bytes, { 'content-type': 'text/html; charset=utf-8', ...headers });
}

export async function serveStatic(response: ServerResponse, pathname: string): Promise<void> {
  if (pathname.includes('..')) {
    notFound(response);
    return;
  }
  if (pathname === '/' || pathname === '/index.html') {
    await sendPage(response, 'journey', { 'cache-control': 'no-cache' });
    return;
  }
  if (pathname === '/console' || pathname.startsWith('/console/')) {
    await sendPage(response, 'console', { 'cache-control': 'no-store' });
    return;
  }
  if (/^\/listen\/[^/]+$/.test(pathname)) {
    await sendPage(response, 'journey', { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    return;
  }
  if (/^\/p\/[^/]+$/.test(pathname)) {
    await sendPage(response, 'proposal', { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    return;
  }

  const extension = pathname.slice(pathname.lastIndexOf('.'));
  const contentType = CONTENT_TYPES[extension];
  if (contentType === undefined) {
    notFound(response);
    return;
  }
  const target = resolve(join(publicDir, normalize(pathname)));
  if (!target.startsWith(`${publicDir}/`)) {
    notFound(response);
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) {
      notFound(response);
      return;
    }
    sendBytes(response, 200, await readFile(target), {
      'content-type': contentType,
      'cache-control': extension === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
  } catch {
    notFound(response);
  }
}
