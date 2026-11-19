import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createDb } from './db';
import { applySchema, seed } from './seed';
import { Valkey, Gotenberg } from './services';
import { handleApi, type RouteContext } from './api';
import { OutboxPublisher } from './outbox';
import { TickEngine } from './tickEngine';
import { snapshotOf } from './snapshotHelper';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(here, '..', 'web');

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost/gandyboard';
const VALKEY_URL = process.env.VALKEY_URL ?? 'redis://localhost:6379';
const GOTENBERG_URL = process.env.GOTENBERG_URL ?? 'http://localhost:4070';
const PUBLIC_PORT = Number(process.env.APP_PUBLIC_PORT ?? '4173');

/** Wait for Postgres: the app boots with Valkey or Gotenberg down, never without Postgres. */
async function waitForPostgres(databaseUrl: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const db = createDb(databaseUrl);
      await db.query('SELECT 1');
      await db.end();
      return;
    } catch (e) {
      if (attempt > 120) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain',
};

function serveStatic(res: http.ServerResponse, filePath: string): boolean {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] ?? 'application/octet-stream';
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'Cache-Control': 'no-cache' });
  res.end(data);
  return true;
}

/** One app instance: an HTTP server plus its tick engine and outbox publisher. */
async function startInstance(instanceId: string, port: number, registry: InstanceRegistry): Promise<http.Server> {
  const db = createDb(DATABASE_URL);
  await applySchema(db);
  await seed(db);

  const valkey = new Valkey(VALKEY_URL);
  const gotenberg = new Gotenberg(GOTENBERG_URL);
  const ctx: RouteContext = {
    db,
    valkey,
    gotenberg,
    instanceId,
    instances: [],
  };
  // The live instance registry backs /api/ops/instances.
  const syncInstances = () => {
    ctx.instances = registry.all().map((i) => ({ id: i.id, up: i.up, pid: null }));
  };
  syncInstances();
  registry.onChange(syncInstances);

  void valkey.probe();
  void gotenberg.probe();

  const outbox = new OutboxPublisher(db, valkey, instanceId);
  outbox.start();
  const engine = new TickEngine(db, valkey, instanceId, (sessionId, state, status, tick, fastClock, revision, sessionVersion, controlRevision, ratio, holdReason) =>
    snapshotOf({
      id: sessionId,
      name: '',
      status,
      hold_reason: holdReason,
      ratio,
      revision,
      control_revision: controlRevision,
      session_version: sessionVersion,
      tick,
      fast_clock_seconds: fastClock,
      layout_version_id: '',
      layout_version_number: 0,
      timetable_version: 0,
      state,
    }));
  engine.start();

  const server = http.createServer(async (req, res) => {
    try {
      const handled = await handleApi(ctx, req, res);
      if (handled) return;
    } catch (e) {
      console.error('api error', instanceId, e);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: { code: 'internal', message: 'Something went wrong.' } }));
      return;
    }
    // Static frontend.
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname = url.pathname;
    if (pathname === '/') pathname = '/index.html';
    const safe = path.normalize(pathname).replace(/^([./\\])+/, '');
    const filePath = path.join(webRoot, safe);
    if (!filePath.startsWith(webRoot)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    if (serveStatic(res, filePath)) return;
    // SPA fallback to index.html for non-API GET routes.
    if ((req.method ?? 'GET') === 'GET') {
      if (serveStatic(res, path.join(webRoot, 'index.html'))) return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  console.log(`instance ${instanceId} on ${port}`);
  return server;
}

/** The live instance registry shared by the router and the ops endpoints. */
class InstanceRegistry {
  private up = new Map<string, boolean>();
  private stopHandlers = new Map<string, () => Promise<void>>();
  private listeners: (() => void)[] = [];

  all(): { id: string; up: boolean }[] {
    return [...this.up.entries()].map(([id, isUp]) => ({ id, up: isUp }));
  }

  setUp(id: string, isUp: boolean): void {
    this.up.set(id, isUp);
    for (const listener of this.listeners) listener();
  }

  isUp(id: string): boolean {
    return this.up.get(id) ?? false;
  }

  onDown(id: string, stop: () => Promise<void>): void {
    this.stopHandlers.set(id, stop);
  }

  async stop(id: string): Promise<void> {
    this.setUp(id, false);
    await this.stopHandlers.get(id)?.();
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }
}

/** The first free port at or after the start, so several copies never clash. */
function findFreePort(start: number): Promise<number> {
  return new Promise((resolve) => {
    const tryPort = (port: number): void => {
      const probe = net.createServer();
      probe.once('error', () => {
        tryPort(port + 1);
      });
      probe.once('listening', () => {
        probe.close(() => resolve(port));
      });
      probe.listen(port, '127.0.0.1');
    };
    tryPort(start);
  });
}

async function main(): Promise<void> {
  // The router and instances must survive handler errors; SSE writes after a
  // dropped connection are logged and ignored.
  process.on('uncaughtException', (err) => {
    console.error('uncaught', err);
  });
  process.on('unhandledRejection', (err) => {
    console.error('unhandledRejection', err);
  });

  await waitForPostgres(DATABASE_URL);

  // Internal ports cannot collide when several copies run on one host: derive
  // them from the public port plus a per-process offset, and retry on a clash.
  const portA = await findFreePort(PUBLIC_PORT + 71);
  const portB = await findFreePort(PUBLIC_PORT + 72);
  const registry = new InstanceRegistry();

  async function spawn(id: string, port: number): Promise<void> {
    registry.setUp(id, true);
    const server = await startInstance(id, port, registry);
    registry.onDown(id, async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
  }

  await spawn('a', portA);
  await spawn('b', portB);

  const routeHeader = 'x-gandyboard-route';
  let rr = 0;
  const ports = new Map<string, number>([['a', portA], ['b', portB]]);

  const router = http.createServer(async (req, res) => {
    const wanted = req.headers[routeHeader] as string | undefined;

    const unavailable = () => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'instances_restarting', message: 'Gandyboard is restarting. Try again in a moment.' } }));
    };

    let target: string | null = null;
    if (wanted) {
      if (!registry.isUp(wanted)) {
        unavailable();
        return;
      }
      target = wanted;
    } else {
      const live = registry.all().filter((i) => i.up);
      if (live.length === 0) {
        unavailable();
        return;
      }
      const chosen = live[rr % live.length];
      rr += 1;
      target = chosen?.id ?? null;
    }
    if (!target) return;
    const port = ports.get(target) ?? portA;

    const options = {
      hostname: '127.0.0.1',
      port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `localhost:${PUBLIC_PORT}` },
    };

    const proxied = http.request(options, (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(res);
    });
    proxied.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: { code: 'instances_restarting', message: 'Gandyboard is restarting. Try again in a moment.' } }));
    });
    req.pipe(proxied);
  });

  await new Promise<void>((resolve) => router.listen(PUBLIC_PORT, '0.0.0.0', resolve));
  console.log(`router on 0.0.0.0:${PUBLIC_PORT} -> a:${portA}, b:${portB}`);

  // The founder's rescue control: stop an instance, restart after the delay.
  process.on('gandyboard:stop-instance' as never, ((id: string, restartAfterMs: number) => {
    const port = ports.get(id);
    if (port === undefined) return;
    void (async () => {
      await registry.stop(id);
      setTimeout(() => {
        void spawn(id, port);
      }, restartAfterMs);
    })() as never;
  }) as never);
}

void main();
