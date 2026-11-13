import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { loadProject, projectAccess } from './access';
import { readCookie, userForToken } from './auth';
import { config } from './config';
import { applySchema, db, waitForDatabase } from './db';
import { handleApi, sendJson } from './http';
import { addSubscriber, emit, markLeave, removeSubscriber, viewersOf } from './live';
import { tx } from './live';
import { ensureBucket } from './storage';
import { startBackgroundTimers } from './tasks';
import { seedDemoInstance } from './demoseed';
import './routes_auth';
import './routes_groups';
import './routes_repo';
import './routes_mr';
import './routes_ci';
import './routes_env';
import './routes_plan';
import './routes_misc';
import './routes_grading';

const publicDir = join(__dirname, 'public');

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

const pagePrefixes = ['/', '/sign-in', '/sign-up', '/projects', '/groups', '/search'];

function serveFile(path: string, res: import('node:http').ServerResponse): boolean {
  if (!existsSync(path)) return false;
  const stats = statSync(path);
  if (!stats.isFile()) return false;
  res.writeHead(200, {
    'content-type': contentTypes[extname(path)] ?? 'application/octet-stream',
    'content-length': stats.size,
    'cache-control': extname(path) === '.html' ? 'no-store' : 'public, max-age=3600',
  });
  createReadStream(path).pipe(res);
  return true;
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, url);
      if (!handled) sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
      return;
    }
    const safe = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    if (safe !== '/' && serveFile(join(publicDir, safe), res)) return;
    const token = readCookie(req.headers.cookie, 'spur_session');
    const user = token === null ? null : await userForToken(token);
    const isAuthPage = url.pathname === '/sign-in' || url.pathname === '/sign-up';
    if (user === null && !isAuthPage) {
      res.writeHead(302, { location: '/sign-in' });
      res.end();
      return;
    }
    if (pagePrefixes.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) {
      serveFile(join(publicDir, 'index.html'), res);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found.');
  })().catch(() => {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'server_error', message: 'Something went wrong.' }));
  });
});

const sockets = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/api/live') {
      socket.destroy();
      return;
    }
    const token = readCookie(req.headers.cookie, 'spur_session');
    const user = token === null ? null : await userForToken(token);
    const projectId = Number(url.searchParams.get('project') ?? '0');
    const project = user === null ? null : await loadProject(db, projectId);
    if (user === null || project === null) {
      socket.destroy();
      return;
    }
    const access = await projectAccess(db, project, user.id);
    if (access.level === 0) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, (socketConnection) => {
      const since = url.searchParams.get('since');
      void (async () => {
        if (since !== null && since !== '') {
          const sinceSeq = Number(since);
          const rows = await db.query<{ seq: string; type: string; data: unknown }>(
            'select seq, type, data from live_messages where project_id = $1 and seq > $2 order by seq',
            [project.id, sinceSeq],
          );
          const newest = await db.one<{ seq: string }>('select seq from projects where id = $1', [project.id]);
          const gap = Number(newest?.seq ?? 0) - sinceSeq;
          if (gap > 1000) {
            socketConnection.send(JSON.stringify({ type: 'resync' }));
          } else {
            for (const row of rows) {
              socketConnection.send(
                JSON.stringify({ seq: Number(row.seq), type: row.type, data: row.data }),
              );
            }
          }
        }
        const subscriber = addSubscriber(socketConnection, project.id, user.username);
        await tx(async (t) => {
          await emit(t, project.id, 'presence', { viewing: viewersOf(project.id) });
        });
        socketConnection.on('close', () => {
          removeSubscriber(subscriber);
          markLeave(project.id, user.username);
        });
      })();
    });
  })().catch(() => socket.destroy());
});

async function start(): Promise<void> {
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`spurline listening on ${config.port}\n`);
  });
  await waitForDatabase();
  await applySchema();
  await ensureBucket();
  await seedDemoInstance();
  startBackgroundTimers();
}

void start();
