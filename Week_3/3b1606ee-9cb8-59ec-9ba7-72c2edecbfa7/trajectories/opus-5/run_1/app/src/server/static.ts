import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendError, notFound } from './http.js';

const CLIENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../client');

/** The page routes the browser app owns; everything else is a file or nothing. */
const APP_ROUTES = [
  /^\/$/,
  /^\/signup$/,
  /^\/signin$/,
  /^\/letters$/,
  /^\/letters\/[0-9a-f-]{36}$/,
  /^\/requests$/,
  /^\/contacts$/,
  /^\/settings$/,
];

const ASSET_PATH = /^\/(assets|fonts)\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.html': 'text/html; charset=utf-8',
};

function contentTypeFor(path: string): string | null {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return null;
  return CONTENT_TYPES[path.slice(dot)] ?? null;
}

async function sendFile(res: ServerResponse, path: string, cache: string): Promise<boolean> {
  const type = contentTypeFor(path);
  if (type === null) return false;
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': info.size,
      'Cache-Control': cache,
    });
    createReadStream(path).pipe(res);
    return true;
  } catch {
    return false;
  }
}

export async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  if (ASSET_PATH.test(pathname)) {
    if (await sendFile(res, join(CLIENT_ROOT, pathname), 'public, max-age=3600')) return;
    sendError(res, notFound());
    return;
  }
  if (APP_ROUTES.some((route) => route.test(pathname))) {
    if (await sendFile(res, join(CLIENT_ROOT, 'index.html'), 'no-cache')) return;
  }
  sendError(res, notFound());
}
