import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from './http/errors.js';
import { Router, runRoute, type Reply } from './http/router.js';
import { sessionRoutes } from './api/session.js';
import { publicRoutes } from './api/publicSite.js';
import { talentRoutes } from './api/talent.js';
import { rosterRoutes } from './api/roster.js';
import { optionRoutes } from './api/options.js';
import { bookingRoutes } from './api/bookings.js';
import { licenceRoutes } from './api/licences.js';
import { ledgerRoutes } from './api/ledger.js';
import { packageRoutes } from './api/packages.js';
import { applicationRoutes } from './api/applications.js';
import { feedRoutes } from './api/feeds.js';
import { adminRoutes } from './api/admin.js';
import { queryOne } from './db.js';

const publicDir = join(fileURLToPath(new URL('../public', import.meta.url)));

const router = new Router();
router.add(sessionRoutes);
router.add(publicRoutes);
router.add(talentRoutes);
router.add(rosterRoutes);
router.add(optionRoutes);
router.add(bookingRoutes);
router.add(licenceRoutes);
router.add(ledgerRoutes);
router.add(packageRoutes);
router.add(applicationRoutes);
router.add(feedRoutes);
router.add(adminRoutes);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const SERVED_ASSETS = new Set(['/app.js', '/styles.css', '/favicon.ico']);

let ready = false;

export function markReady(): void {
  ready = true;
}

function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...(reply.headers ?? {}),
  };
  if (reply.status === 413) {
    headers.Connection = 'close';
    res.once('finish', () => res.socket?.destroy());
  }
  if (reply.json !== undefined) {
    const body = JSON.stringify(reply.json);
    headers['Content-Type'] = 'application/json; charset=utf-8';
    res.writeHead(reply.status, headers);
    res.end(body);
    return;
  }
  if (reply.body !== undefined) {
    headers['Content-Type'] = reply.contentType ?? 'application/octet-stream';
    res.writeHead(reply.status, headers);
    res.end(reply.body);
    return;
  }
  res.writeHead(reply.status, headers);
  res.end();
}

function shellHtml(): string {
  return [
    '<!doctype html>',
    '<html lang="en-CA">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Vesper &amp; Rowe Talent</title>',
    '<link rel="stylesheet" href="/styles.css">',
    '<link rel="preload" href="/fonts/fraunces-variable-latin.woff2" as="font" type="font/woff2" crossorigin>',
    '<link rel="preload" href="/fonts/hanken-grotesk-variable-latin.woff2" as="font" type="font/woff2" crossorigin>',
    '</head>',
    '<body>',
    '<div id="app"></div>',
    '<script src="/app.js" defer></script>',
    '</body>',
    '</html>',
  ].join('\n');
}

const APP_PATH_PREFIXES = [
  '/boards',
  '/talent/',
  '/tray',
  '/cast-request',
  '/p/',
  '/apply',
  '/consent/',
  '/sign-in',
  '/forgot-password',
  '/reset/',
  '/invite/',
  '/workspace',
];

function isAppPath(pathname: string): boolean {
  if (pathname === '/') return true;
  return APP_PATH_PREFIXES.some((prefix) =>
    prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** A gone profile or dead link answers its page with the matching status. */
async function shellStatus(pathname: string, nowMs: number): Promise<number> {
  const talentMatch = /^\/talent\/([^/]+)$/.exec(pathname);
  if (talentMatch) {
    const row = await queryOne<{ state: string }>('SELECT state FROM talent WHERE slug = $1', [
      decodeURIComponent(talentMatch[1]),
    ]);
    if (!row) return 404;
    return row.state === 'active' ? 200 : 410;
  }
  const packageMatch = /^\/p\/([^/]+)$/.exec(pathname);
  if (packageMatch) {
    const link = await queryOne<{ status: string; expires_at: Date; package_id: string }>(
      'SELECT status, expires_at, package_id FROM package_links WHERE token = $1',
      [decodeURIComponent(packageMatch[1])],
    );
    if (!link) return 404;
    if (link.status !== 'active' || nowMs >= link.expires_at.getTime()) return 410;
    const pkg = await queryOne<{ state: string }>('SELECT state FROM packages WHERE id = $1', [
      link.package_id,
    ]);
    return pkg && pkg.state === 'active' ? 200 : 410;
  }
  const consentMatch = /^\/consent\/([^/]+)$/.exec(pathname);
  if (consentMatch) {
    const row = await queryOne<{ consent_used_at: Date | null; consent_expires_at: Date | null }>(
      'SELECT consent_used_at, consent_expires_at FROM applications WHERE consent_token = $1',
      [decodeURIComponent(consentMatch[1])],
    );
    if (!row || !row.consent_expires_at) return 404;
    if (row.consent_used_at || nowMs >= row.consent_expires_at.getTime()) return 410;
    return 200;
  }
  return isAppPath(pathname) ? 200 : 404;
}

async function serveAsset(pathname: string): Promise<Reply | null> {
  const isFont = pathname.startsWith('/fonts/');
  if (!SERVED_ASSETS.has(pathname) && !isFont) return null;
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(publicDir, safe));
    return {
      status: 200,
      body,
      contentType: CONTENT_TYPES[extname(safe)] ?? 'application/octet-stream',
      headers: { 'Cache-Control': isFont ? 'public, max-age=86400' : 'no-cache' },
    };
  } catch {
    return null;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const nowMs = Date.now();
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;

  if (pathname === '/api/health') {
    send(res, ready ? { status: 200, json: { status: 'ok' } } : { status: 503, json: { status: 'starting' } });
    return;
  }

  if (pathname.startsWith('/api/') || pathname.startsWith('/feeds/')) {
    try {
      const { route, params } = router.resolve(req.method ?? 'GET', pathname);
      send(res, await runRoute(route, params, req, url, nowMs));
    } catch (error) {
      if (error instanceof ApiError) {
        send(res, { status: error.status, json: error.body, headers: error.headers });
        return;
      }
      process.stderr.write(`request failed: ${String(error)}\n`);
      send(res, { status: 500, json: { error: 'server_error' } });
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, { status: 405, json: { error: 'method_not_allowed' }, headers: { Allow: 'GET, HEAD' } });
    return;
  }

  const asset = await serveAsset(pathname);
  if (asset) {
    send(res, asset);
    return;
  }

  const status = ready ? await shellStatus(pathname, nowMs) : 200;
  send(res, { status, body: shellHtml(), contentType: 'text/html; charset=utf-8' });
}

export function startServer(port: number): void {
  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      process.stderr.write(`unhandled: ${String(error)}\n`);
      if (!res.headersSent) send(res, { status: 500, json: { error: 'server_error' } });
    });
  });
  server.listen(port, '0.0.0.0');
}
