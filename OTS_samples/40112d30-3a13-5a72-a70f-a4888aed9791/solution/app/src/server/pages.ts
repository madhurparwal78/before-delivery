import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.ts';
import { accessFor, loadFormBySlug } from './forms.ts';
import { decodeSegment, parseCookies, storable } from './http.ts';
import { SESSION_COOKIE, userForSession } from './auth.ts';

// The browser client is one HTML shell and two built assets; the server decides the status (never 403) and the
// client draws the screen (brief: Server boundary).

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const OWNER_FORM = new RegExp(`^/forms/(${UUID})(?:/(edit|summary|responses|editions)|/responses/${UUID}|/editions/\\d+)$`);
const OPEN_PATHS = [/^\/$/, /^\/signin$/, /^\/signup$/, /^\/r\/[^/]+$/, /^\/invite\/[^/]+$/];
const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2',
};
const FONT = '/assets/fonts/work-sans-latin-wght-normal.woff2';

function shell(screen: 'app' | 'notfound'): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="nf-screen" content="${screen}">
<title>Nightform</title>
<link rel="preload" href="${FONT}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/app.css">
<script src="/assets/app.js" defer></script>
</head>
<body>
<div id="announcer" role="status" aria-live="polite"></div>
<div id="alert" role="alert"></div>
<div id="root"></div>
</body>
</html>
`;
}

function html(res: ServerResponse, status: number, screen: 'app' | 'notfound', headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(shell(screen));
}

async function permitted(req: IncomingMessage, pathname: string): Promise<boolean | 'signin'> {
  if (OPEN_PATHS.some((p) => p.test(pathname))) return true;
  const user = await userForSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  if (pathname === '/forms') return user ? true : 'signin';
  const owner = OWNER_FORM.exec(pathname);
  if (owner) {
    if (!user) return false;
    const access = await accessFor(pool, user.id, owner[1] ?? '');
    return Boolean(access) && !(access?.role === 'editor' && access.form.state === 'closed');
  }
  const fill = /^\/f\/([^/]+)$/.exec(pathname);
  if (fill) {
    const form = await loadFormBySlug(pool, decodeSegment(fill[1] ?? '') ?? '');
    return Boolean(form && form.live_edition !== null);
  }
  return false;
}

const assets = new Map<string, { body: Buffer; type: string; tag: string }>();

async function asset(name: string): Promise<{ body: Buffer; type: string; tag: string } | null> {
  const known = assets.get(name);
  if (known) return known;
  if (!/^[\w./-]+$/.test(name) || name.includes('..')) return null;
  try {
    const body = await readFile(path.join(PUBLIC_DIR, name));
    const entry = { body, type: CONTENT_TYPES[path.extname(name)] ?? 'application/octet-stream', tag: `"${createHash('sha1').update(body).digest('hex')}"` };
    assets.set(name, entry);
    return entry;
  } catch {
    return null;
  }
}

export async function servePage(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (pathname.startsWith('/assets/')) {
    const found = await asset(pathname.slice('/assets/'.length));
    if (!found) return html(res, 404, 'notfound');
    if (req.headers['if-none-match'] === found.tag) {
      res.writeHead(304, { ETag: found.tag });
      return void res.end();
    }
    const long = found.type.startsWith('font/');
    res.writeHead(200, { 'Content-Type': found.type, ETag: found.tag, 'Cache-Control': long ? 'public, max-age=31536000, immutable' : 'no-cache' });
    return void res.end(found.body);
  }
  const decoded = decodeSegment(pathname);
  const verdict = decoded !== null && storable(decoded) && (await permitted(req, pathname));
  if (verdict === 'signin') {
    res.writeHead(302, { Location: '/signin', 'Cache-Control': 'no-store' });
    return void res.end();
  }
  html(res, verdict ? 200 : 404, verdict ? 'app' : 'notfound');
}
