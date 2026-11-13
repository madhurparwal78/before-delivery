import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, clientSettings } from './config';
import { connectAndMigrate, dbReady, one, query } from './db';
import { ensureBaseSeed } from './seed';
import { loadClock } from './clock';
import { broadcastClock } from './events';
import { handleApi } from './api';
import { ApiError } from './errors';
import {
  Call,
  JSON_LIMIT,
  errorResponse,
  readBody,
  resolveContext,
  sendJson,
  sendText,
} from './http';
import { StorageDown, getObject, putObject } from './storage';
import { startPictureWriter } from './pictures';
import { sweep } from './sweep';
import { bookingObject, canSeeBooking } from './bookings';
import { invoiceHtml } from './invoice';
import { msg } from '../shared/strings';

const PUBLIC_DIR = join(__dirname, '..', 'public');
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

const STATIC_FILES: Record<string, string> = {
  '/app.js': 'text/javascript; charset=utf-8',
  '/app.css': 'text/css; charset=utf-8',
};

const PAGE_PATHS = ['/', '/search', '/find', '/inbox', '/account', '/signin', '/signup', '/destinations', '/for-properties'];

function shell(status: number, cookies: string[]): { status: number; body: string; cookies: string[] } {
  const settings = JSON.stringify(clientSettings());
  const body = `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kipwell Stays</title>
<link rel="stylesheet" href="/app.css">
<script id="kip-settings" type="application/json">${settings}</script>
<script src="/app.js" defer></script>
</head>
<body data-pending="0"><div id="kip-root"></div></body>
</html>
`;
  return { status, body, cookies };
}

async function pageStatus(path: string, req: IncomingMessage): Promise<number> {
  if (PAGE_PATHS.includes(path)) return 200;
  if (/^\/properties\/[A-Za-z0-9-]+$/.test(path)) return 200;
  if (/^\/checkout\/[A-Za-z0-9_-]+$/.test(path)) return 200;
  if (/^\/reviews\/[A-Za-z0-9_-]+$/.test(path)) return 200;
  const booking = /^\/bookings\/(KW-[A-Z2-9]{6})$/.exec(path);
  if (booking) {
    const { ctx } = await resolveContext(req, { createVisitor: false });
    const visible = await canSeeBooking(booking[1], {
      visitorId: ctx.visitorId,
      username: ctx.user?.username ?? null,
      manages: ctx.user?.manages ?? [],
      role: ctx.user?.role ?? null,
    });
    return visible ? 200 : 404;
  }
  const manage = /^\/manage\/([A-Za-z0-9-]+)\/(calendar|reservations|import|statements)$/.exec(path);
  if (manage) {
    const { ctx } = await resolveContext(req, { createVisitor: false });
    if (!ctx.user) return 404;
    return ctx.user.manages.includes(manage[1]) ? 200 : 404;
  }
  if (path === '/moderation') {
    const { ctx } = await resolveContext(req, { createVisitor: false });
    if (!ctx.user) return 404;
    return ctx.user.role === 'operator' ? 200 : 403;
  }
  return 404;
}

async function serveInvoice(req: IncomingMessage, res: ServerResponse, code: string): Promise<void> {
  const { ctx, cookies } = await resolveContext(req, { createVisitor: false });
  const visible = await canSeeBooking(code, {
    visitorId: ctx.visitorId,
    username: ctx.user?.username ?? null,
    manages: ctx.user?.manages ?? [],
    role: ctx.user?.role ?? null,
  });
  if (!visible) {
    sendText(res, 404, `<!doctype html><html lang="en"><body><h1>NOTHING</h1><p>${msg('en', 'page.missing')}</p></body></html>`, 'text/html; charset=utf-8', {}, cookies);
    return;
  }
  const booking = await bookingObject(code);
  if (!booking) {
    sendText(res, 404, `<!doctype html><html lang="en"><body><h1>NOTHING</h1><p>${msg('en', 'page.missing')}</p></body></html>`, 'text/html; charset=utf-8', {}, cookies);
    return;
  }
  const key = `invoices/${code}.html`;
  try {
    const stored = await one<{ ledger_version: number }>('select ledger_version from invoices where code = $1', [code]);
    const version = booking.ledger.length;
    if (!stored || stored.ledger_version !== version) {
      await putObject(key, Buffer.from(invoiceHtml(booking), 'utf8'), 'text/html; charset=utf-8');
      await query(
        `insert into invoices (code, ledger_version) values ($1,$2)
         on conflict (code) do update set ledger_version = excluded.ledger_version`,
        [code, version],
      );
    }
    const object = await getObject(key);
    if (!object) throw new StorageDown('missing invoice');
    sendText(res, 200, object.body, 'text/html; charset=utf-8', {}, cookies);
  } catch (err) {
    if (err instanceof StorageDown) {
      sendText(
        res,
        503,
        `<!doctype html><html lang="en"><body><div role="alert">${msg('en', 'storage.doc')}</div></body></html>`,
        'text/html; charset=utf-8',
        {},
        cookies,
      );
      return;
    }
    throw err;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';
  const path = url.pathname;

  if (WRITE_METHODS.includes(method)) {
    const origin = req.headers.origin;
    if (origin) {
      let sameOrigin = false;
      try {
        const originUrl = new URL(origin);
        sameOrigin = originUrl.host === (req.headers.host ?? '');
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin) {
        sendJson(res, 403, { error: 'cross_origin' });
        return;
      }
    }
  }

  if (method === 'GET' && STATIC_FILES[path]) {
    const file = await readFile(join(PUBLIC_DIR, path.slice(1)));
    sendText(res, 200, file, STATIC_FILES[path], { 'cache-control': 'public, max-age=3600' });
    return;
  }

  const font = /^\/fonts\/([a-z0-9-]+\.woff2)$/.exec(path);
  if (method === 'GET' && font) {
    try {
      const file = await readFile(join(PUBLIC_DIR, 'fonts', font[1]));
      sendText(res, 200, file, 'font/woff2', { 'cache-control': 'public, max-age=31536000, immutable' });
    } catch {
      sendJson(res, 404, { error: 'not_found' });
    }
    return;
  }

  const image = /^\/images\/([A-Za-z0-9-]+)\/([1-3])\.svg$/.exec(path);
  if (method === 'GET' && image) {
    try {
      const object = await getObject(`images/${image[1]}/${image[2]}.svg`);
      if (!object) {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }
      sendText(res, 200, object.body, 'image/svg+xml');
    } catch (err) {
      if (err instanceof StorageDown) sendJson(res, 503, { error: 'storage_unavailable' });
      else throw err;
    }
    return;
  }

  const invoice = /^\/bookings\/(KW-[A-Z2-9]{6})\/invoice$/.exec(path);
  if (method === 'GET' && invoice) {
    await serveInvoice(req, res, invoice[1]);
    return;
  }

  if (path.startsWith('/api/')) {
    await handleApiCall(req, res, url, method);
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  const { cookies } = await resolveContext(req, { createVisitor: true });
  const status = await pageStatus(path, req);
  const page = shell(status, cookies);
  sendText(res, page.status, page.body, 'text/html; charset=utf-8', {}, page.cookies);
}

const RAW_BODY_PATHS = /^\/api\/manage\/[A-Za-z0-9-]+\/imports(\/preview)?$/;

async function handleApiCall(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<void> {
  const raw = RAW_BODY_PATHS.test(url.pathname);
  let body = Buffer.alloc(0);
  let json: Record<string, unknown> = {};
  const hasBody = WRITE_METHODS.includes(method);
  if (hasBody) {
    const type = String(req.headers['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (raw) {
      if (type !== 'text/plain' && type !== 'application/octet-stream') {
        sendJson(res, 415, { error: 'unsupported_media_type' });
        return;
      }
      const read = await readBody(req, config.importMaxBytes);
      if (read === 'too_large') {
        sendJson(res, 413, { error: 'too_large' });
        return;
      }
      body = read;
    } else {
      const empty = (req.headers['content-length'] ?? '0') === '0' && req.headers['transfer-encoding'] === undefined;
      if (type !== 'application/json' && !(type === '' && empty)) {
        sendJson(res, 415, { error: 'unsupported_media_type' });
        return;
      }
      const read = await readBody(req, JSON_LIMIT);
      if (read === 'too_large') {
        sendJson(res, 413, { error: 'too_large' });
        return;
      }
      body = read;
      if (body.length > 0) {
        try {
          const parsed = JSON.parse(body.toString('utf8'));
          json = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
        } catch {
          sendJson(res, 422, { error: 'validation', fields: { body: 'invalid' } });
          return;
        }
      }
    }
  }

  const createVisitor = url.pathname === '/api/time' || url.pathname.startsWith('/api/grading/');
  const { ctx, cookies } = await resolveContext(req, { createVisitor });
  const call: Call = { req, res, url, method, body, json, ctx, setCookies: cookies };
  try {
    await handleApi(call);
  } catch (err) {
    if (err instanceof StorageDown) {
      sendJson(res, 503, { error: 'storage_unavailable' }, {}, cookies);
    } else if (err instanceof ApiError) errorResponse(res, err, cookies);
    else {
      process.stderr.write(`api error ${url.pathname}: ${String(err)}\n`);
      errorResponse(res, err, cookies);
    }
  }
}

const server = createServer((req, res) => {
  void handle(req, res).catch((err) => {
    process.stderr.write(`request error: ${String(err)}\n`);
    if (!res.headersSent) sendJson(res, 500, { error: 'server_error' });
    else res.end();
  });
});

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`kipwell listening on ${config.port}\n`);
});

async function start(): Promise<void> {
  await connectAndMigrate();
  await ensureBaseSeed();
  await loadClock();
  startPictureWriter();
  setInterval(() => {
    if (!dbReady()) return;
    void sweep().catch(() => undefined);
  }, 1000);
  setInterval(() => {
    broadcastClock();
  }, 60000);
}

void start();
