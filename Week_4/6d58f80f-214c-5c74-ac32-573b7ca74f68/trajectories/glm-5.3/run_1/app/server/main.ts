import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from './config/runtime.js';
import { pool, withTransaction } from './db/pool.js';
import { applySchema } from './db/schema.js';
import { ensureBucket } from './svc/storage.js';
import { probeStorage, storageStatus } from './svc/storage.js';
import { probeDirectory, directoryStatus, ensureDirectoryFields } from './svc/directory.js';
import { startProbes, startSweep } from './svc/probes.js';
import { routes, type RouteContext } from './api/routes.js';
import { registerConnection, dropConnection } from './api/events.js';
import { ApiError, sendError, sendJson, isOwnOrigin } from './http/respond.js';
import { parseSessionCookie, getSession } from './api/sessions.js';
import { seedIfEmpty } from './api/seed.js';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { sweep } from './api/sweep.js';

const MIME: Record<string, string> = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json',
};

const BUILD_DIR = join(import.meta.dirname, '..', 'build');

function serveStatic(res: http.ServerResponse, path: string): boolean {
  const safe = path.replace(/^\/+/, '').split('?')[0] ?? '';
  if (safe.includes('..')) return false;
  const candidates = safe === '' || safe.startsWith('drive') || safe.startsWith('recent') || safe.startsWith('shared') ||
    safe.startsWith('bin') || safe.startsWith('handovers') || safe.startsWith('settings') || safe.startsWith('sign-in')
    ? ['index.html'] : [safe, join(safe, 'index.html')];
  for (const candidate of candidates) {
    const full = join(BUILD_DIR, candidate);
    if (!full.startsWith(BUILD_DIR)) continue;
    if (!existsSync(full) || !statSync(full).isFile()) continue;
    if (candidate === 'index.html' && safe !== '' && !safe.includes('.')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(readFileSync(full));
      return true;
    }
    if (candidate === 'index.html' && safe.includes('.') && !safe.startsWith('assets') && !safe.startsWith('fonts') && !safe.startsWith('icons')) {
      return false;
    }
    const mime = MIME[extname(full)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(readFileSync(full));
    return true;
  }
  return false;
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const pathname = url.pathname;
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const match = r.pattern.exec(pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => { params[k] = match[i + 1] ?? ''; });
    if (!r.allowNoBody && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
      // handled below in the body pipeline
    }
    const ctx: RouteContext = {
      req, res, url, person: null, body: null, rawBody: Buffer.alloc(0), params,
    };
    await dispatch(req, res, ctx, r);
    return;
  }
  throw new ApiError('not_found');
}

async function dispatch(req: http.IncomingMessage, res: http.ServerResponse, ctx: RouteContext, r: (typeof routes)[number]): Promise<void> {
  try {
    const method = req.method ?? 'GET';
    const isPartRoute = req.method === 'PUT' && /^\/api\/uploads\/[^/]+\/parts\/\d+$/.test(ctx.url.pathname);
    const bodyLimit = isPartRoute ? 5_242_880 : 65_536;

    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const declared = Number(req.headers['content-length'] ?? '0');
      if (declared > bodyLimit) throw new ApiError('too_large');
    }

    const hasBodyFlag = method === 'POST' || method === 'PUT' || method === 'PATCH';
    const contentLength = Number(req.headers['content-length'] ?? '0');
    const hasActualBody = hasBodyFlag && (contentLength > 0 || req.headers['transfer-encoding'] !== undefined);
    if (hasActualBody) {
      const contentType = req.headers['content-type'];
      if (!contentType) throw new ApiError('unsupported_media_type');
      const mime = contentType.split(';')[0]?.trim();
      if (isPartRoute) {
        if (mime !== 'application/octet-stream') throw new ApiError('unsupported_media_type');
      } else if (mime !== 'application/json') {
        throw new ApiError('unsupported_media_type');
      }
    }

    if (method !== 'GET' && method !== 'HEAD' && !isOwnOrigin(req)) {
      throw new ApiError('cross_origin');
    }

    const token = parseSessionCookie(req.headers.cookie);
    if (r.needsSession) {
      const person = token ? await getSession(token) : null;
      if (!person) throw new ApiError('unauthenticated');
      ctx.person = person;
    }

    if (hasBodyFlag) {
      const chunks: Buffer[] = [];
      let total = 0;
      let oversized = false;
      for await (const chunk of req) {
        const buf = chunk as Buffer;
        total += buf.length;
        if (total > bodyLimit) { oversized = true; break; }
        chunks.push(buf);
      }
      if (oversized) throw new ApiError('too_large');
      ctx.rawBody = Buffer.concat(chunks);
      if (hasActualBody && !isPartRoute) {
        try {
          ctx.body = ctx.rawBody.length === 0 ? {} : (JSON.parse(ctx.rawBody.toString('utf8')) as Record<string, unknown>);
        } catch {
          ctx.body = {};
        }
      } else if (!isPartRoute) {
        ctx.body = {};
      }
    }

    await r.handler(ctx);
    if (!res.writableEnded && res.headersSent === false) {
      throw new ApiError('not_found');
    }
  } catch (err) {
    if (err instanceof ApiError) {
      sendError(res, err);
      return;
    }
    if (res.headersSent) return;
    sendError(res, new ApiError('not_found'));
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${config.appPort}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (url.pathname === '/api/health' || url.pathname === '/api/status' || url.pathname === '/api/clock') {
      await handleApi(req, res, url);
      return;
    }
    if (serveStatic(res, url.pathname)) return;
    if (url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (err) {
    if (err instanceof ApiError) {
      sendError(res, err);
    } else {
      sendJson(res, 500, { error: 'not_found' });
    }
  }
});

const wss = new WebSocketServer({ noServer: true });
const wsMap = new Map<WebSocket, ReturnType<typeof registerConnection>>();

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${config.appPort}`);
  if (url.pathname !== '/api/events') {
    socket.destroy();
    return;
  }
  const token = parseSessionCookie(req.headers.cookie);
  const person = token ? await getSession(token) : null;
  if (!person) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const conn = registerConnection(ws, person);
    wsMap.set(ws, conn);
    ws.on('close', () => {
      wsMap.delete(ws);
      dropConnection(conn);
    });
  });
});

async function boot(): Promise<void> {
  let schemaReady = false;
  for (let attempt = 0; !schemaReady && attempt < Infinity; attempt++) {
    try {
      await applySchema(pool);
      schemaReady = true;
    } catch (err) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  try {
    await ensureBucket();
  } catch { /* storage down; probes will retry */ }
  try {
    await ensureDirectoryFields();
  } catch { /* directory down; probes will retry */ }
  try {
    await withTransaction(async (client) => {
      await seedIfEmpty(client);
    });
  } catch (err) {
    console.error('Seed failed', err);
  }
  startProbes();
  startSweep();
  server.listen(config.appPort, '0.0.0.0', () => {
    console.log(`Lintel Drive listening on port ${config.appPort}`);
  });
}

void boot();
