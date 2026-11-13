/** The client shell and the built assets. */
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PublicSettings } from '../shared/types';
import { config } from './config';
import { notFound, router, type Ctx, type Reply } from './http';

const CLIENT_DIR = fileURLToPath(new URL('./client/', import.meta.url));

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
};

const settings: PublicSettings = {
  autosaveMs: config.autosaveMs,
  embedPollSeconds: config.embedPollSeconds,
  particleMax: config.particleMax,
  timeZone: config.timeZone,
};

const injected = `<script id="hs-settings" type="application/json">${JSON.stringify(settings).replace(/</g, '\\u003c')}</script>`;
const shells = new Map<string, string>();

/** An HTML shell of the client build with the public settings injected. */
export async function shellPage(file: 'index.html' | 'embed.html', status = 200): Promise<Reply> {
  let html = shells.get(file);
  if (html === undefined) {
    html = (await readFile(join(CLIENT_DIR, file), 'utf8')).replace('<!--HS_PUBLIC_SETTINGS-->', injected);
    shells.set(file, html);
  }
  const headers: Record<string, string> = file === 'index.html' ? { 'Cache-Control': 'no-cache', 'Content-Security-Policy': "frame-ancestors 'none'" } : { 'Cache-Control': 'no-cache' };
  return { status, raw: html, contentType: TYPES['.html'] as string, headers };
}

async function asset(path: string): Promise<Reply | null> {
  const relative = normalize(path.slice('/assets/'.length));
  if (relative.startsWith('..') || relative.includes(`..${sep}`) || relative.includes('\u0000')) return null;
  try {
    const bytes = await readFile(join(CLIENT_DIR, 'assets', relative));
    return { status: 200, raw: bytes, contentType: TYPES[extname(relative)] ?? 'application/octet-stream', headers: { 'Cache-Control': 'no-cache' } };
  } catch {
    return null;
  }
}

const APP_ROUTES = [/^\/$/, /^\/signin$/, /^\/projects$/, /^\/projects\/[^/]+$/, /^\/invite\/[^/]+$/];

router.fallback(async (ctx: Ctx) => {
  if (ctx.path.startsWith('/assets/')) {
    return (await asset(ctx.path)) ?? notFound();
  }
  return shellPage('index.html', APP_ROUTES.some((route) => route.test(ctx.path)) ? 200 : 404);
});
