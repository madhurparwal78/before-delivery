import http from 'node:http';
import { URL } from 'node:url';
import { APP_PUBLIC_PORT, MAX_BODY_BYTES, PUBLIC_DIR, SRC_DIR } from './config.js';
import { initWhenReachable, ready } from './bootstrap.js';
import { query, isUnreachable } from './db.js';
import { routes } from './api.js';
import {
  ApiError, sendError, sendJson, readBody, parseJsonBody, contentTypeIsJson,
  errPayloadTooLarge, errUnsupportedMediaType, errMethodNotAllowed, errNotFound,
  errServiceUnavailable, errInternal,
} from './http.js';
import { handleStream } from './stream.js';
import { startScheduler } from './scheduler.js';
import { servePage, serveNotFound } from './pages.js';
import { serveStatic } from './static.js';

const server = http.createServer(async (req, res) => {
  try {
    await dispatch(req, res);
  } catch (err) {
    if (!res.headersSent) {
      try { sendError(res, toApiError(err)); } catch { /* nothing more to do */ }
    } else {
      try { res.end(); } catch { /* nothing more to do */ }
    }
  }
});

function toApiError(err) {
  if (err instanceof ApiError) return err;
  if (isUnreachable(err)) return errServiceUnavailable();
  console.error('internal error:', err && err.message, err && err.stack);
  return errInternal();
}

async function dispatch(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (path === '/api/stream') {
    if (req.method !== 'GET') {
      return sendError(res, errMethodNotAllowed('GET'));
    }
    return handleStream(req, res, url);
  }

  if (path.startsWith('/api/') || path === '/api') {
    return dispatchApi(req, res, url);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain' });
    return res.end('Method not allowed');
  }

  // Never served: source, maps, manifest, env, lockfiles.
  const neverServed = /\.(map|env)$/i.test(path) || path === '/run.json' || path === '/package-lock.json' || path === '/package.json' || path === '/manifest.json';
  if (neverServed) {
    return serveNotFound(res);
  }

  if (serveStatic(req, res, url)) return;

  if (servePage(req, res, url)) return;

  return serveNotFound(res);
}

async function dispatchApi(req, res, url) {
  const path = url.pathname;
  const method = req.method;

  // Find matching routes for the path, any method.
  const matches = [];
  for (const r of routes) {
    const m = matchPath(r.pattern, path);
    if (m) matches.push({ route: r, params: m });
  }
  if (matches.length === 0) {
    return sendError(res, errNotFound());
  }
  const entry = matches.find((x) => x.route.method === method);
  if (!entry) {
    const allow = matches.map((x) => x.route.method).join(', ');
    return sendError(res, errMethodNotAllowed(allow));
  }

  let body = {};
  let raw = Buffer.alloc(0);
  const hasBody = await requestHasBody(req);
  if (hasBody) {
    try {
      raw = await readBody(req, MAX_BODY_BYTES);
    } catch (e) {
      if (e instanceof ApiError) return sendError(res, e);
      return sendError(res, errInternal());
    }
    if (raw.length > 0) {
      if (!contentTypeIsJson(req)) {
        return sendError(res, errUnsupportedMediaType());
      }
      try {
        body = parseJsonBody(raw);
      } catch (e) {
        if (e instanceof ApiError) return sendError(res, e);
        return sendError(res, errInternal());
      }
    }
  }

  const ctx = {
    req,
    res,
    query: url.searchParams,
    params: entry.params,
    body,
    onLogout: () => {},
  };

  try {
    await entry.route.handler(ctx);
  } catch (err) {
    const e = toApiError(err);
    sendError(res, e);
  }
}

function requestHasBody(req) {
  const len = Number(req.headers['content-length'] || 0);
  const chunked = String(req.headers['transfer-encoding'] || '').includes('chunked');
  return chunked || len > 0;
}

function matchPath(pattern, path) {
  const pParts = pattern.split('/').filter(Boolean);
  const uParts = path.split('/').filter(Boolean);
  if (pParts.length !== uParts.length) return null;
  const params = {};
  for (let i = 0; i < pParts.length; i++) {
    const p = pParts[i];
    const u = uParts[i];
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(u);
    } else if (p !== u) {
      return null;
    }
  }
  return params;
}

// Keep trying the database from boot: the app must seed within ten seconds of
// the database first answering, without a restart.
async function retryInit() {
  for (;;) {
    const ok = await initWhenReachable();
    if (ok) {
      startScheduler();
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

server.listen(APP_PUBLIC_PORT, '0.0.0.0', () => {
  console.log(`tallwind listening on 0.0.0.0:${APP_PUBLIC_PORT}`);
});

retryInit();

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
