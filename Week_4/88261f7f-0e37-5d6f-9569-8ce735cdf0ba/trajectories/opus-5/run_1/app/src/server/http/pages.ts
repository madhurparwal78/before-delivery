import { readFile } from 'node:fs/promises';
import { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { pool } from '../db';
import { AppRoute, homeRouteFor } from '../domain/roles';
import { loadSession, parseCookies, SESSION_COOKIE } from './session';

const PUBLIC_DIR = join(__dirname, '..', '..', 'public');

/** The only files the server ever reads from disk for a browser. */
const STATIC_FILES: Record<string, string> = {
  '/app.js': 'application/javascript; charset=utf-8',
  '/app.css': 'text/css; charset=utf-8',
  '/favicon.svg': 'image/svg+xml',
};

const cache = new Map<string, Buffer>();

async function readPublic(name: string): Promise<Buffer> {
  const cached = cache.get(name);
  if (cached) return cached;
  const contents = await readFile(join(PUBLIC_DIR, name));
  cache.set(name, contents);
  return contents;
}

export async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  const contentType = STATIC_FILES[pathname];
  if (!contentType) return false;
  const contents = await readPublic(pathname.slice(1));
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': String(contents.length),
    'x-content-type-options': 'nosniff',
  });
  res.end(contents);
  return true;
}

const APP_ROUTES: AppRoute[] = ['/desk', '/board', '/guests', '/rates', '/reports'];

async function sendShell(res: ServerResponse): Promise<void> {
  const contents = await readPublic('index.html');
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(contents.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(contents);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { location, 'cache-control': 'no-store' });
  res.end();
}

/** Serves the one page shell, sending a signed-out visitor to sign-in and vice versa. */
export async function servePage(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const pathname = url.pathname;
  const isAppRoute = (APP_ROUTES as string[]).includes(pathname);
  const isCheckin = /^\/checkin\/[^/]+$/.test(pathname);
  if (pathname !== '/' && !isAppRoute && !isCheckin) return false;

  if (isCheckin) {
    await sendShell(res);
    return true;
  }

  const cookies = parseCookies(req.headers.cookie);
  const user = await loadSession(pool, cookies[SESSION_COOKIE]);

  if (pathname === '/') {
    if (user) {
      redirect(res, homeRouteFor(user.role));
      return true;
    }
    await sendShell(res);
    return true;
  }

  if (!user) {
    redirect(res, '/');
    return true;
  }
  await sendShell(res);
  return true;
}
