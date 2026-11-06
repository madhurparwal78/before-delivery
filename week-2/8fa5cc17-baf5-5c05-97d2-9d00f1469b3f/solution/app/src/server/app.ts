// The request pipeline: share surface, API (with the error precedence), built assets and page shells.
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiError, HttpError, notFound, statusBody } from './errors.ts';
import { acceptBody, errorReply, header, match, send, type Reply, type Request, type Route } from './http.ts';
import { idempotencyKey, withIdempotency } from './idempotency.ts';
import { accountRoutes } from './routes/account.ts';
import { attachmentRoutes } from './routes/attachments.ts';
import { blockRoutes } from './routes/blocks.ts';
import { collectionRoutes } from './routes/collections.ts';
import { dailyRoutes } from './routes/daily.ts';
import { objectRoutes } from './routes/objects.ts';
import { queryRoutes } from './routes/queries.ts';
import { authenticate, optionalSession, requireCsrf } from './sessions.ts';
import { SHARE_HEADERS, shareApi } from './shareSurface.ts';
import { TOKENS_CSS } from './tokensCss.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public'); // dist/public: the built client
const FONTS = path.join(HERE, '..', 'public', 'fonts');

let ready = false;
export const markReady = (): void => {
  ready = true;
};

const HEALTH_PATH = '/api/health';

const routes: Route[] = [...accountRoutes, ...objectRoutes, ...blockRoutes, ...dailyRoutes, ...attachmentRoutes, ...queryRoutes, ...collectionRoutes];

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const WORKSPACE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; "
  + "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const WORKSPACE_PATH = /^\/(today|timeline|queries|graph|settings|o\/[^/]+|types\/[^/]+|collections\/[^/]+|collections\/[^/]+\/board|queries\/[^/]+)$/;
const ASSETS = new Map([['main.js', 'text/javascript'], ['main.css', 'text/css'], ['share.js', 'text/javascript'], ['share.css', 'text/css']]);
const FONT_FILE = /^[a-z0-9-]+\.woff2$/;

// Every bundled face is preloaded so text never swaps fonts (and shifts) after the first paint.
const PRELOADED_FONTS = [
  'source-serif-4-latin-400-normal', 'source-serif-4-latin-600-normal', 'source-serif-4-latin-400-italic',
  'fraunces-latin-400-normal', 'fraunces-latin-600-normal', 'fraunces-latin-400-italic',
  'ibm-plex-mono-latin-400-normal', 'ibm-plex-mono-latin-500-normal',
];

function shell(entry: 'main' | 'share', theme: string): string {
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quire</title>
${PRELOADED_FONTS.map((f) => `<link rel="preload" href="/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`).join('\n')}
<link rel="stylesheet" href="/assets/tokens.css">
<link rel="stylesheet" href="/assets/${entry}.css">
<script type="module" src="/assets/${entry}.js"></script>
</head>
<body><div id="root"></div></body>
</html>`;
}

async function apiReply(raw: IncomingMessage, res: ServerResponse, url: URL): Promise<Reply> {
  const method = raw.method ?? 'GET';
  if (url.pathname === HEALTH_PATH && (method === 'GET' || method === 'HEAD')) {
    return ready ? { status: 200, body: { status: 'ok' } } : errorReply(statusBody(503, 'starting'));
  }
  const found = match(routes, method, url.pathname);
  if (found === null || found === 'method') throw notFound();
  if (!ready) return errorReply(statusBody(503, 'starting'));
  const { route: r, params, unknownResource } = found;
  const { rawBody, body } = await acceptBody(raw, r.body);
  const req: Request = {
    method, path: url.pathname, query: url.searchParams, headers: raw.headers, params, rawBody, body, raw, res,
    clientAddress: raw.socket.remoteAddress ?? '', session: { id: '', csrfToken: '', label: '' },
  };
  if (!r.open) {
    req.session = await authenticate(req);
    if (MUTATING.has(method)) requireCsrf(req, req.session);
  }
  const key = r.idempotent ? idempotencyKey(req) : null;
  const run = async (): Promise<Reply> => {
    if (unknownResource) throw notFound();
    return r.handler(req);
  };
  return key ? withIdempotency(req, key, run) : run();
}

async function serveFile(file: string, type: string): Promise<Reply> {
  try {
    return { status: 200, bytes: await readFile(file), headers: { 'Content-Type': type, 'Cache-Control': 'no-cache' } };
  } catch {
    throw notFound();
  }
}

export async function handle(raw: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(raw.url ?? '/', 'http://quire.local');
  const method = raw.method ?? 'GET';
  const p = url.pathname;
  try {
    if (p === '/s' || p.startsWith('/s/')) {
      const reply = await shareApi(method, p);
      if (reply === 'page') return send(res, { status: 200, bytes: Buffer.from(shell('share', 'paper')), headers: { ...SHARE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' } });
      const answer: Reply = reply ?? errorReply(notFound());
      return send(res, { ...answer, headers: { ...answer.headers, ...SHARE_HEADERS } });
    }
    if (p === '/api' || p.startsWith('/api/')) {
      const reply = await apiReply(raw, res, url);
      if (reply.status !== 0) send(res, reply);
      return;
    }
    if (method !== 'GET' && method !== 'HEAD') throw apiError(405, 'method_not_allowed');
    if (p === '/assets/tokens.css') return send(res, { status: 200, bytes: Buffer.from(TOKENS_CSS), headers: { 'Content-Type': 'text/css', 'Cache-Control': 'no-cache' } });
    if (p.startsWith('/assets/') && ASSETS.has(p.slice(8))) return send(res, await serveFile(path.join(PUBLIC, p.slice(8)), ASSETS.get(p.slice(8)) as string));
    if (p.startsWith('/fonts/') && FONT_FILE.test(p.slice(7))) return send(res, await serveFile(path.join(FONTS, p.slice(7)), 'font/woff2'));
    const session = ready ? await optionalSession(header(raw, 'cookie')) : null;
    const page = (status: number): Reply => ({
      status, bytes: Buffer.from(shell('main', session?.theme ?? 'paper')),
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': WORKSPACE_CSP, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
    if (p === '/') return send(res, { status: 302, headers: { Location: session ? '/today' : '/sign-in' } });
    if (p === '/sign-in') {
      if (session) return send(res, { status: 302, headers: { Location: '/today' } });
      return send(res, page(200));
    }
    if (WORKSPACE_PATH.test(p)) {
      if (!session) return send(res, { status: 302, headers: { Location: `/sign-in?return=${encodeURIComponent(p + url.search)}` } });
      return send(res, page(200));
    }
    return send(res, page(404));
  } catch (error) {
    if (error instanceof HttpError) return send(res, errorReply(error));
    console.error('request failed', method, p, error instanceof Error ? error.message : 'error');
    if (!res.headersSent) send(res, errorReply(apiError(500, 'server_error')));
    else res.end();
  }
}
