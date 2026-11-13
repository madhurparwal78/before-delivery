import express, { type Request, type Response } from 'express';
import type { AppConfig } from './config.js';
import { loadConfig } from './config.js';
import { connectDatabase, pool, withTransaction } from './db.js';
import { applySchema } from './schema.js';
import { ObjectStorage } from './storage.js';
import { Store } from './store.js';
import { buildApiRouter, type LiveHub } from './api.js';
import { sendError, sessionCookie } from './http.js';
import type { LocalDate } from './dates.js';
import type { UserRow } from './types.js';
import { Seeder, type SeedBody } from './seed.js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

interface LiveClient {
  userId: string;
  role: 'athlete' | 'coach';
  linkedAthleteIds: Set<string>;
  send: (event: string, data: unknown) => void;
}

class LiveHubImpl implements LiveHub {
  private clients = new Set<LiveClient>();

  register(client: LiveClient): void {
    this.clients.add(client);
  }

  unregister(client: LiveClient): void {
    this.clients.delete(client);
  }

  heartbeatIntervalMs: number = 15000;

  broadcast(event: { athlete_id: string; what: string; workout_id?: string }): void {
    for (const client of this.clients) {
      if (client.userId === event.athlete_id) {
        client.send('change', event);
        continue;
      }
      if (client.linkedAthleteIds.has(event.athlete_id)) {
        client.send('change', event);
      }
    }
  }

  notifyUser(userId: string, text: string): void {
    for (const client of this.clients) {
      if (client.userId === userId) client.send('notice', { text });
    }
  }
}

async function main(): Promise<void> {
  const config: AppConfig = loadConfig();
  let todayOverride: LocalDate | null = null;
  const today = (): LocalDate => todayOverride ?? config.appToday;

  const storage = new ObjectStorage(config);
  const liveHub = new LiveHubImpl();
  liveHub.heartbeatIntervalMs = config.liveHeartbeatMs;

  // Wait for the database, retrying every second.
  let dbReady = false;
  while (!dbReady) {
    try {
      await connectDatabase();
      dbReady = true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await applySchema(pool);

  const store = new Store({
    storage,
    today,
    notify: (event, notice) => {
      liveHub.broadcast(event);
      if (notice) liveHub.notifyUser(notice.toUserId, notice.text);
    },
  });

  const seeder = new Seeder(pool, store, {
    today,
    config: {
      activityMaxBytes: config.activityMaxBytes,
      activityMaxSamples: config.activityMaxSamples,
      linkRequestTtlHours: config.linkRequestTtlHours,
    },
    resetToday: (date) => {
      todayOverride = date;
    },
  });
  await seeder.loadDemoSet();

  const app = express();
  app.disable('x-powered-by');

  // --- session middleware
  const attachUser = async (req: Request, res: Response): Promise<UserRow | null> => {
    const cookies = req.headers.cookie ?? '';
    const match = /(?:^|;\s*)tempoline_session=([a-f0-9]+)/.exec(cookies);
    if (!match) return null;
    const token = match[1]!;
    const user = await store.findUserByToken(pool, token);
    if (!user) return null;
    (req as Request & { user: UserRow; sessionToken: string }).user = user;
    (req as Request & { sessionToken: string }).sessionToken = token;
    void res;
    return user;
  };

  app.use(async (req, res, next) => {
    try {
      await attachUser(req, res);
      next();
    } catch (err) {
      sendError(res, err);
    }
  });

  // --- grading routes (before auth; key-protected)
  app.post('/api/grading/seed', express.json({ limit: 20000000, type: 'application/json' }), async (req, res) => {
    try {
      if (!config.gradingKey || req.header('X-Grading-Key') !== config.gradingKey) {
        res.status(404).json({ error: 'not_found', message: 'Not found.' });
        return;
      }
      const result = await seeder.seed(req.body as SeedBody, false);
      res.json({ today: result.today, ids: result.ids, sign_in: result.sign_in });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/grading/reset', async (req, res) => {
    try {
      if (!config.gradingKey || req.header('X-Grading-Key') !== config.gradingKey) {
        res.status(404).json({ error: 'not_found', message: 'Not found.' });
        return;
      }
      await seeder.reset();
      res.json({ status: 'reset' });
    } catch (err) {
      sendError(res, err);
    }
  });

  // --- health
  app.get('/api/health', async (_req, res) => {
    const storageOk = await storage.ensureBucket();
    res.status(200).json({ status: storageOk ? 'ok' : 'unavailable' });
  });

  // --- one-time sign-in
  app.get('/auth/one-time/:token', async (req, res) => {
    try {
      const user = await withTransaction(async (client) => store.consumeOneTimeToken(client, req.params.token ?? ''));
      if (!user) {
        res.status(404).send(notFoundPage());
        return;
      }
      const token = await withTransaction(async (client) => store.createSession(client, user.id));
      res.setHeader('Set-Cookie', sessionCookie(token));
      res.statusCode = 303;
      res.setHeader('Location', '/');
      res.end();
    } catch (err) {
      sendError(res, err);
    }
  });

  // --- live stream
  app.get('/api/live', async (req, res) => {
    const user = (req as Request & { user?: UserRow }).user;
    if (!user) {
      res.status(401).json({ error: 'unauthenticated', message: 'Sign in to continue.' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const linked = user.role === 'coach' ? await store.linkedAthletes(pool, user.id) : [];
    const client: LiveClient = {
      userId: user.id,
      role: user.role,
      linkedAthleteIds: new Set(linked.map((a) => a.id)),
      send: (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      },
    };
    liveHub.register(client);
    const heartbeat = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, config.liveHeartbeatMs);
    req.on('close', () => {
      clearInterval(heartbeat);
      liveHub.unregister(client);
    });
  });

  // --- static UI (mounted before page routes so assets resolve)
  const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui');
  app.use(express.static(uiDir, { index: false }));

  app.use('/api', buildApiRouter({ store, config, today, liveHub }));

  // --- unknown /api paths answer the 404 body
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'Not found.' });
  });

  // --- pages: /, /sign-in, /athletes/:id, ...
  const indexHtml = existsSync(path.join(uiDir, 'index.html'))
    ? readFileSync(path.join(uiDir, 'index.html'), 'utf8')
    : '<!doctype html><title>Tempoline</title>';

  const pagePaths = [
    /^\/$/,
    /^\/sign-in$/,
    /^\/athletes\/[^/]+$/,
    /^\/athletes\/[^/]+\/builder$/,
    /^\/workouts\/[^/]+$/,
    /^\/coach$/,
    /^\/plans$/,
    /^\/inbox$/,
    /^\/coaches$/,
  ];

  app.use(async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    const pathname = req.path.split('?')[0]!;
    if (pathname === '/sign-in') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(indexHtml);
      return;
    }
    if (!pagePaths.some((re) => re.test(pathname))) {
      next();
      return;
    }
    const user = (req as Request & { user?: UserRow }).user;
    if (!user) {
      res.statusCode = 303;
      res.setHeader('Location', '/sign-in');
      res.end();
      return;
    }
    // Page visibility: athletes may only open their own pages; coaches any linked athlete.
    const athleteMatch = /^\/athletes\/([^/]+)/.exec(pathname);
    if (athleteMatch) {
      try {
        await store.canViewAthlete(pool, user.id, athleteMatch[1]!);
      } catch {
        res.status(404).send(notFoundPage());
        return;
      }
    }
    if (pathname === '/coach' && user.role !== 'coach') {
      res.status(404).send(notFoundPage());
      return;
    }
    if ((pathname === '/plans' || pathname === '/inbox') && user.role !== 'coach') {
      res.status(404).send(notFoundPage());
      return;
    }
    if (pathname === '/coaches' && user.role !== 'athlete') {
      res.status(404).send(notFoundPage());
      return;
    }
    if (pathname === '/coach' && user.role === 'coach') {
      // fall through to the SPA
    }
    if (pathname === '/' && user.role === 'coach') {
      res.statusCode = 303;
      res.setHeader('Location', '/coach');
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(indexHtml);
  });

  app.use((req, res) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ error: 'not_found', message: 'Not found.' });
      return;
    }
    const user = (req as Request & { user?: UserRow }).user;
    if (!user) {
      res.statusCode = 303;
      res.setHeader('Location', '/sign-in');
      res.end();
      return;
    }
    res.status(404).send(notFoundPage());
  });

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Tempoline listening on 0.0.0.0:${config.port}`);
  });
}

function notFoundPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found</title><link rel="stylesheet" href="/app.css"></head><body><main id="app"><section class="notfound"><h1>Not found</h1><p>This page isn't available to you.</p><a class="pill" href="/">Back to home</a></section></main><script src="/app.js"></script></body></html>`;
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
