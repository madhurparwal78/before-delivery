'use strict';

// The one server: pages and the JSON API share one origin.

const http = require('http');
const fs = require('fs');
const path = require('path');
const api = require('./api');
const errors = require('./lib/errors');
const ready = require('./lib/ready');
const scheduler = require('./lib/scheduler');

const PORT = Number(process.env.APP_PUBLIC_PORT) || 4173;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const BODY_CAP_BYTES = 32768;

const PAGE_ROUTES = new Set([
  '/',
  '/business-banking',
  '/business-payments',
  '/credit',
  '/treasury',
  '/invoicing',
  '/spend-management',
  '/payroll',
  '/books',
  '/venture-debt',
  '/working-capital-loans',
  '/pricing',
  '/contact',
  '/demo',
  '/login',
  '/signup',
  '/app',
  '/payments',
  '/payments/new',
  '/payments/recipients',
  '/payments/recipients/new',
  '/approvals',
  '/invoices',
  '/loans',
  '/cards',
  '/treasury-account',
  '/bill-pay',
]);

const STATIC_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.vtt': 'text/vtt; charset=utf-8',
  '.woff2': 'font/woff2',
};

const shellPath = path.join(PUBLIC_DIR, 'index.html');
let shellCache = null;

function shell() {
  if (!shellCache) shellCache = fs.readFileSync(shellPath);
  return shellCache;
}

function isPageRoute(pathname) {
  if (PAGE_ROUTES.has(pathname)) return true;
  return /^\/app\/accounts\/[^/]+$/.test(pathname);
}

const ABANDON_BYTES = 4 * 1024 * 1024;

// Every request body to /api is limited to 32,768 raw bytes received.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let settled = false;
    const settle = (action) => {
      if (settled) return;
      settled = true;
      action();
    };
    req.on('data', (chunk) => {
      length += chunk.length;
      if (length <= BODY_CAP_BYTES) chunks.push(chunk);
      else if (length > ABANDON_BYTES) {
        settle(() => reject(errors.payloadTooLarge()));
        req.destroy();
      }
    });
    req.on('end', () => {
      settle(() =>
        length > BODY_CAP_BYTES
          ? reject(errors.payloadTooLarge())
          : resolve(Buffer.concat(chunks))
      );
    });
    req.on('aborted', () => settle(() => reject(errors.payloadTooLarge())));
    req.on('error', () => settle(() => resolve(Buffer.alloc(0))));
  });
}

function sendApi(res, answer) {
  if (res.writableEnded || res.headersSent) return;
  const headers = Object.assign({ 'Cache-Control': 'no-store' }, answer.headers || {});
  if (answer.status === 204) {
    res.writeHead(204, headers);
    res.end();
    return;
  }
  const payload = answer.raw !== undefined ? answer.raw : JSON.stringify(answer.body);
  if (!headers['Content-Type']) headers['Content-Type'] = 'application/json; charset=utf-8';
  const buffer = Buffer.from(payload, 'utf8');
  headers['Content-Length'] = buffer.length;
  res.writeHead(answer.status, headers);
  res.end(buffer);
}

function sendApiError(res, error) {
  const translated =
    error instanceof errors.ApiError
      ? error
      : errors.isConnectionFailure(error)
      ? errors.serviceUnavailable()
      : errors.internal();
  sendApi(res, {
    status: translated.status,
    body: translated.body,
    headers: translated.headers || undefined,
  });
}

function contentTypeIsJson(req) {
  const raw = req.headers['content-type'];
  if (typeof raw !== 'string') return false;
  return raw.split(';')[0].trim().toLowerCase() === 'application/json';
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

async function handleApi(req, res, url) {
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    sendApiError(res, error);
    return;
  }

  const segments = url.pathname
    .slice('/api'.length)
    .split('/')
    .filter((part) => part.length > 0)
    .map(decodeSegment);

  const ctx = {
    req,
    res,
    method: req.method,
    url,
    query: url.searchParams,
    segments,
    bodyIsEmpty: body.length === 0,
    contentTypeIsJson: contentTypeIsJson(req),
    idempotencyKey:
      typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key'].trim() || null
        : null,
    json() {
      if (this.parsedBody !== undefined) return this.parsedBody;
      if (body.length === 0) {
        this.parsedBody = {};
        return this.parsedBody;
      }
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(body);
      } catch (error) {
        throw errors.invalidJson();
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        throw errors.invalidJson();
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw errors.invalidJson();
      }
      this.parsedBody = parsed;
      return parsed;
    },
  };

  try {
    const answer = await api.dispatch(ctx);
    if (answer && answer.handled) return;
    sendApi(res, answer);
  } catch (error) {
    sendApiError(res, error);
  }
}

function sendShell(res, status) {
  const body = shell();
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const extension = path.extname(pathname).toLowerCase();
  if (!STATIC_TYPES[extension]) return false;
  if (pathname.includes('..') || pathname.includes('\\')) return false;
  const filePath = path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return false;
  let data;
  try {
    data = fs.readFileSync(filePath);
  } catch (error) {
    return false;
  }
  res.writeHead(200, {
    'Content-Type': STATIC_TYPES[extension],
    'Content-Length': data.length,
    'Cache-Control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
  return true;
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(() => {
      sendApiError(res, errors.internal());
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendShell(res, 404);
    return;
  }

  // Source maps, manifests, lockfiles and credentials are never served.
  if (url.pathname.endsWith('.map')) {
    sendShell(res, 404);
    return;
  }
  if (serveStatic(req, res, url.pathname)) return;
  sendShell(res, isPageRoute(url.pathname) ? 200 : 404);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;
server.requestTimeout = 0;

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`Tallwind listening on ${PORT}\n`);
});

ready.startRetryLoop();
ready.onFirstHealthy(() => scheduler.tick());
scheduler.start();

process.on('unhandledRejection', () => {});
process.on('uncaughtException', (error) => {
  if (!errors.isConnectionFailure(error)) process.stderr.write(`unexpected: ${error.message}\n`);
});
