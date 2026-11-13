// Server entry: wires config, database, storage, mail, the live channel and
// every route.
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import pg from 'pg';
import * as ws from 'ws';
import { loadConfig, type Config } from './config';
import type { Pool } from './app';
import { applySchema } from './schema';
import { Clock } from './clock';
import { makeS3Client } from './s3client';
import { Hub } from './hub';
import { registerRoutes } from './routes';
import { flushOutbox } from './mailer';
import { purgeDueProjects } from './lifecycle';
import type { App } from './app';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
};

async function waitForDb(cfg: Config): Promise<Pool> {
  // Keep retrying the connection until PostgreSQL answers.
  for (;;) {
    try {
      const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 20 });
      await pool.query('SELECT 1');
      return pool;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const pool = await waitForDb(cfg);
  await applySchema(pool);

  const { client: s3, status: s3Status } = makeS3Client(cfg.s3);
  const clock = new Clock(cfg.startAt);
  await clock.init(pool);

  const app: App = {
    cfg,
    pool,
    s3,
    clock,
    limits: {
      particleMax: cfg.particleMax,
      particleSeed: cfg.particleSeed,
      clothSeed: cfg.clothSeed,
      grainSeed: cfg.grainSeed,
    },
    instanceId: `i${Math.random().toString(36).slice(2, 10)}`,
    startedAt: Date.now(),
  };
  void s3Status;

  // Ensure the bucket exists before the first upload, import, publish or
  // seed succeeds; retry in the background until storage answers.
  const ensureBucket = async (): Promise<void> => {
    try {
      const exists = await s3.bucketExists();
      if (!exists) await s3.createBucket();
    } catch {
      setTimeout(ensureBucket, 5000);
    }
  };
  void ensureBucket();

  const hub = new Hub();
  const server = http.createServer((req, res) => {
    void handle(app, hub, req, res);
  });
  const wss = new ws.WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    const client = hub.connect(ws);
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data)) as {
          type: string;
          projectId?: string;
          personId?: string;
          name?: string;
          kind?: string;
        };
        if (msg.type === 'subscribe' && msg.projectId) {
          client.projectId = msg.projectId;
          client.personId = msg.personId ?? null;
          client.name = msg.name ?? null;
          client.kind = msg.kind === 'embed' ? 'embed' : 'editor';
          ws.send(
            JSON.stringify({
              type: 'hello',
              projectId: msg.projectId,
              people: client.kind === 'editor' ? hub.peopleIn(msg.projectId) : [],
            }),
          );
          if (client.kind === 'editor' && client.personId) {
            hub.broadcast(msg.projectId, {
              type: 'presence',
              projectId: msg.projectId,
              people: hub.peopleIn(msg.projectId),
            });
          }
        }
      } catch {
        // ignore malformed frames
      }
    });
  });

  // Outbox retry every 10 seconds; purge trashed projects as time passes.
  const timer = setInterval(() => {
    void flushOutbox(pool, cfg, app.instanceId).catch(() => undefined);
    void purgeDueProjects(app).catch(() => undefined);
  }, 10000);
  timer.unref();

  server.listen(cfg.port, '0.0.0.0', () => {
    console.log(`halation studio listening on ${cfg.port}`);
  });
}

let routesHandler: ((app: App, hub: Hub, req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>) | null = null;

async function handle(
  app: App,
  hub: Hub,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (routesHandler === null) {
    routesHandler = registerRoutes;
  }
  await routesHandler(app, hub, req, res);
}

export function serveStaticFile(res: http.ServerResponse, root: string, file: string): void {
  const full = join(root, file);
  if (!existsSync(full)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const data = readFileSync(full);
  const ext = extname(full).toLowerCase();
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
  res.end(data);
}

void main;
export { main };

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
