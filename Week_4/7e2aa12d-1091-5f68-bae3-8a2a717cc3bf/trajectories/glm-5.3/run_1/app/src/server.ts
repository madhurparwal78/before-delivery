// The one process: pages, API, WebSockets and built assets on one port.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import pg from 'pg';
import { config } from './config.js';
import { Valkey } from './scaffolding/valkey.js';
import { LiveHub } from './scaffolding/hub.js';
import type { LiveMessage } from './scaffolding/live.js';
import * as store from './store/store.js';
import { handleApi, type RouterContext } from './server/api.js';
import { reply, notFound, sessionFrom, HttpError } from './server/http.js';

const PUBLIC_DIR = join(process.cwd(), 'public');

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
const valkey = new Valkey(config.valkeyUrl);
const hub = new LiveHub(valkey, config.presenceSeconds);

const live = () => valkey.answered;

const ctx: RouterContext = {
  pool,
  valkey,
  hub,
  config,
  live,
  publishChange: (layoutId, revision, layout, username, announcement) => {
    // The hub carries the message to this process's pages; Valkey carries it to the others.
    hub.push(layoutId, { layoutId, kind: 'change', revision, username, announcement, layout });
    void valkey.publish(layoutId, { layoutId, kind: 'change', revision, username, announcement });
  },
};

let cachedShell: string | null = null;
async function shell(): Promise<string> {
  if (cachedShell === null) cachedShell = await readFile(join(PUBLIC_DIR, 'index.html'), 'utf8');
  return cachedShell;
}

function send(res: http.ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (error) {
    if (error instanceof HttpError) reply(res, { status: error.status, body: error.body });
    else reply(res, { status: 500, body: { error: 'invalid' } });
  }
});

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path.startsWith('/api/')) {
    const token = sessionFrom(req);
    const username = token ? await store.userOfSession(pool, token) : null;
    try {
      const result = await handleApi({ method, path, query: url.searchParams, req, username, ctx });
      if (result.cookies && result.cookies.length > 0) res.setHeader('set-cookie', result.cookies);
      reply(res, result);
    } catch (error) {
      if (error instanceof HttpError) { reply(res, { status: error.status, body: error.body }); return; }
      reply(res, { status: 500, body: { error: 'invalid' } });
    }
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') throw notFound();

  if (path === '/app.css') return send(res, 200, 'text/css; charset=utf-8', await readFile(join(PUBLIC_DIR, 'app.css'), 'utf8'));
  if (path === '/app.js') return send(res, 200, 'text/javascript; charset=utf-8', await readFile(join(PUBLIC_DIR, 'app.js'), 'utf8'));

  // Same-origin only: the server serves the pages in this brief and nothing else.
  // Source files, the run manifest, package manifests, lockfiles, dependency
  // folders and environment files are never served.
  const pagePaths = ['/', '/signup', '/signin'];
  if (!(pagePaths.includes(path) || /^\/layouts\/[^/]+$/.test(path) || /^\/view\/[^/]+$/.test(path) || /^\/join\/[^/]+$/.test(path))) {
    throw notFound();
  }

  const token = sessionFrom(req);
  const username = token ? await store.userOfSession(pool, token) : null;

  if ((path === '/' || path.startsWith('/layouts/')) && !username) {
    res.writeHead(302, { location: `/signin?next=${encodeURIComponent(path)}` });
    res.end();
    return;
  }

  if (path.startsWith('/join/') && username) {
    const joinToken = path.slice('/join/'.length);
    const layoutId = await store.layoutOfJoinToken(pool, joinToken);
    const record = layoutId ? await store.loadLayout(pool, layoutId) : null;
    if (record) {
      if (record.owner !== username) await store.addCollaborator(pool, layoutId!, username);
      res.writeHead(302, { location: `/layouts/${layoutId}` });
      res.end();
      return;
    }
  }

  return send(res, 200, 'text/html; charset=utf-8', await shell());
}

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (req, socket, head) => {
  const host = req.headers.host ?? '';
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) {
    socket.destroy();
    return;
  }
  const url = new URL(req.url ?? '/', `http://${host}`);
  const path = url.pathname;
  const editorMatch = /^\/api\/layouts\/([^/]+)\/live$/.exec(path);
  const viewMatch = /^\/api\/view\/([^/]+)\/live$/.exec(path);
  let username: string | null = null;
  let layoutId: string | null = null;
  if (editorMatch) {
    const token = sessionFrom(req);
    username = token ? await store.userOfSession(pool, token) : null;
    if (!username) { socket.destroy(); return; }
    const role = await store.roleFor(pool, editorMatch[1]!, username);
    if (role !== 'owner' && role !== 'collaborator') { socket.destroy(); return; }
    layoutId = editorMatch[1]!;
  } else if (viewMatch) {
    layoutId = await store.layoutOfViewToken(pool, viewMatch[1]!);
    if (!layoutId) { socket.destroy(); return; }
  } else {
    socket.destroy();
    return;
  }
  const targetId = layoutId;
  const targetUsername = username;
  wss.handleUpgrade(req, socket, head, (ws) => {
    hub.add({
      layoutId: targetId,
      username: targetUsername,
      sock: ws,
      send: (message: LiveMessage) => { try { ws.send(JSON.stringify(message)); } catch {} },
    });
    void valkey.subscribe(targetId, (message) => {
      try { ws.send(JSON.stringify(message)); } catch {}
    });
    ws.on('close', () => hub.remove(ws));
    ws.on('error', () => {});
  });
});

async function waitForPostgres(): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      await store.applySchema(pool);
      valkey.startRetry();
      console.log('mullion ready');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

server.listen(config.publicPort, '0.0.0.0', () => {
  console.log(`mullion listening on ${config.publicPort}`);
  void waitForPostgres();
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
