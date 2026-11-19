import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { applySchema } from './db/schema.js';
import { applySeed } from './db/seed.js';
import { waitForDatabase } from './db/pool.js';
import { dispatch, errorResponse, type ApiResponse } from './http/router.js';
import { routes } from './api/routes.js';
import { SESSION_COOKIE, loadSession } from './api/session.js';
import { startReceiptRetries } from './api/receipts.js';
import { ensureBucket } from './services/storage.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

const ASSETS: Record<string, string> = {
  '/app.js': 'text/javascript; charset=utf-8',
  '/app.css': 'text/css; charset=utf-8',
  '/sw.js': 'text/javascript; charset=utf-8',
};

const SCREEN_PATHS = ['/', '/signin', '/logbook', '/coach'];
const SCREEN_PREFIXES = ['/enroll/', '/enrollments/'];

function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

function isScreenPath(pathname: string): boolean {
  if (SCREEN_PATHS.includes(pathname)) return true;
  return SCREEN_PREFIXES.some(
    (prefix) => pathname.startsWith(prefix) && pathname.slice(prefix.length).length > 0,
  );
}

function sendApi(response: http.ServerResponse, result: ApiResponse): void {
  const headers: Record<string, string> = { ...(result.headers ?? {}) };
  headers['Cache-Control'] = 'no-store';
  if (result.setSession !== undefined) {
    headers['Set-Cookie'] = `${SESSION_COOKIE}=${result.setSession}; Path=/; HttpOnly; SameSite=Lax`;
  }
  if (result.clearSession === true) {
    headers['Set-Cookie'] = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }
  if (result.bytes !== undefined) {
    headers['Content-Length'] = String(result.bytes.length);
    response.writeHead(result.status, headers);
    response.end(result.bytes);
    return;
  }
  if (result.json === undefined) {
    response.writeHead(result.status, headers);
    response.end();
    return;
  }
  const body = Buffer.from(JSON.stringify(result.json), 'utf8');
  headers['Content-Type'] = 'application/json; charset=utf-8';
  headers['Content-Length'] = String(body.length);
  response.writeHead(result.status, headers);
  response.end(body);
}

async function sendShell(response: http.ServerResponse, status: number): Promise<void> {
  const shell = await readFile(path.join(publicDir, 'index.html'));
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': String(shell.length),
    'Cache-Control': 'no-store',
  });
  response.end(shell);
}

async function sendAsset(
  response: http.ServerResponse,
  file: string,
  contentType: string,
): Promise<boolean> {
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch {
    return false;
  }
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': String(bytes.length),
    'Cache-Control': 'public, max-age=3600',
  });
  response.end(bytes);
  return true;
}

async function handle(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  const host = request.headers.host ?? `127.0.0.1:${config.port}`;
  const url = new URL(request.url ?? '/', `http://${host}`);
  const token = readCookie(request.headers.cookie, SESSION_COOKIE);

  if (url.pathname.startsWith('/api/')) {
    try {
      sendApi(response, await dispatch({ routes, loadSession }, request, url, token));
    } catch (error) {
      const result = errorResponse(error);
      if (result.status === 500) console.error(error);
      sendApi(response, result);
    }
    return;
  }

  if (request.method !== 'GET') {
    await sendShell(response, 404);
    return;
  }

  const assetType = ASSETS[url.pathname];
  if (assetType !== undefined) {
    if (await sendAsset(response, path.join(publicDir, url.pathname.slice(1)), assetType)) return;
    await sendShell(response, 404);
    return;
  }

  const fontMatch = /^\/fonts\/([a-z0-9-]+\.woff2)$/.exec(url.pathname);
  if (fontMatch !== null) {
    const name = fontMatch[1] ?? '';
    if (await sendAsset(response, path.join(publicDir, 'fonts', name), 'font/woff2')) return;
    await sendShell(response, 404);
    return;
  }

  if (!isScreenPath(url.pathname)) {
    await sendShell(response, 404);
    return;
  }

  if (url.pathname === '/logbook' || url.pathname === '/coach') {
    const session = token === null ? null : await loadSession(token);
    const wanted = url.pathname === '/logbook' ? 'dreamer' : 'coach';
    if (session === null) {
      const next = encodeURIComponent(`${url.pathname}${url.search}`);
      response.writeHead(302, { Location: `/signin?next=${next}`, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    if (session.role !== wanted) {
      response.writeHead(302, {
        Location: session.role === 'dreamer' ? '/logbook' : '/coach',
        'Cache-Control': 'no-store',
      });
      response.end();
      return;
    }
  }

  await sendShell(response, 200);
}

async function main(): Promise<void> {
  await waitForDatabase(60_000);
  await applySchema();
  await applySeed();
  await ensureBucket();
  startReceiptRetries();

  const server = http.createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      console.error(error);
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end();
    });
  });
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Lanternfish listening on ${config.port}`);
  });
}

void main();
