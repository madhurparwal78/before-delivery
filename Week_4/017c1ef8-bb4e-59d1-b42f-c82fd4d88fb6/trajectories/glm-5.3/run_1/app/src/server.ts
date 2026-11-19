import express, { Request, Response, NextFunction } from 'express';
import { config } from './config.js';
import { initDb, query } from './db.js';
import { applySchema } from './schema.js';
import { seedDemoData } from './demo-seed.js';
import { businessMs, now } from './clock.js';
import {
  appExpress, sameOriginGuard, jsonBody, cookieSession, requireSession,
  notFoundHandler, wrap,
} from './http.js';
import { sseHeaders, makeSseSender, addClient, removeClient } from './live.js';
import { authRouter } from './routes/auth.js';
import { profilesRouter } from './routes/profiles.js';
import { connectionsApiRouter } from './routes/network.js';
import { postsRouter } from './routes/posts.js';
import { feedRouter } from './routes/feed.js';
import { messagingRouter } from './routes/messaging.js';
import { meRouter } from './routes/me.js';
import { endorsementsRouter } from './routes/endorsements.js';
import { jobsRouter } from './routes/jobs.js';
import { searchRouter, notificationsRouter } from './routes/search.js';
import { gradingRouter } from './routes/grading.js';
import { invitationsRouter } from './routes/invitations.js';
import { checkStorage, getObject } from './s3.js';
import { errors, sendError } from './errors.js';

const waitForDatabase = async (): Promise<void> => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await query('SELECT 1');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  process.exit(1);
};

const serve = async (): Promise<void> => {
  initDb(config.databaseUrl);
  await waitForDatabase();
  await applySchema();
  await seedDemoData();

  const app = appExpress();
  app.disable('x-powered-by');
  app.use(sameOriginGuard);
  app.use(jsonBody());
  app.use(cookieSession);

  app.get('/api/health', wrap(async (_req, res) => {
    const ok = await checkStorage();
    res.json({ status: ok ? 'ok' : 'unavailable' });
  }));

  app.get('/api/config', (_req, res) => {
    res.json({
      post_max_chars: config.postMaxChars,
      see_more_chars: config.seeMoreChars,
      typing_timeout_ms: config.typingTimeoutMs,
      max_skills: config.maxSkills,
      photo_max_bytes: config.photoMaxBytes,
      resume_max_bytes: config.resumeMaxBytes,
      feed_page_size: config.feedPageSize,
      time_zone: config.timeZone,
      now: now().toISOString(),
    });
  });

  app.get('/api/live', requireSession, (req: Request, res: Response) => {
    const memberId = req.auth!.memberId;
    sseHeaders(res);
    const sender = makeSseSender(res);
    const client = addClient(memberId, sender, () => res.end());
    sender('ready', { now: now().toISOString() });
    const keepAlive = setInterval(() => {
      try { res.write(':hb\n\n'); } catch { clearInterval(keepAlive); }
    }, 15000);
    req.on('close', () => { clearInterval(keepAlive); removeClient(client); });
  });

  app.use('/api', authRouter());
  app.use('/api', profilesRouter());
  app.use('/api', connectionsApiRouter());
  app.use('/api', invitationsRouter());
  app.use('/api', postsRouter());
  app.use('/api', feedRouter());
  app.use('/api', messagingRouter());
  app.use('/api', meRouter());
  app.use('/api', endorsementsRouter());
  app.use('/api', jobsRouter());
  app.use('/api', searchRouter());
  app.use('/api', notificationsRouter());
  app.use('/api', gradingRouter());

  // Media served by the app itself; the browser never talks to MinIO.
  app.get('/media/photos/:photoId', wrap(async (req, res) => {
    const result = await query<{ content_type: string }>(
      `SELECT content_type FROM uploads WHERE id = $1 AND kind = 'photo'`, [req.params.photoId]);
    if (result.rows.length === 0) throw errors.notFound();
    const data = await getObject(`photos/${req.params.photoId}.${result.rows[0].content_type === 'image/png' ? 'png' : 'jpg'}`).catch(() => null);
    if (!data) throw errors.storageUnavailable();
    res.setHeader('Content-Type', result.rows[0].content_type);
    res.send(data);
  }));

  app.use('/api', notFoundHandler);

  // Static client: never serve source, config or lockfiles.
  const clientDir = new URL('./client/', import.meta.url);
  app.use(express.static(clientDir.pathname, {
    fallthrough: true,
    setHeaders: (res) => { res.setHeader('Cache-Control', 'no-store'); },
  }));

  // Unknown pages serve the app shell; known source/config paths stay 404.
  const neverServe = ['/.git', '/src/', '/client/', '/package.json', '/package-lock.json', '/run.json',
    '/tsconfig.json', '/build.mjs', '/dist/', '/node_modules/', '/THIRD_PARTY_NOTICES.md', '/.env'];
  app.get('*', (req, res) => {
    if (neverServe.some((prefix) => req.path === prefix || req.path.startsWith(prefix))) {
      res.status(404).send('Not found');
      return;
    }
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.sendFile(`${clientDir.pathname}index.html`, (err) => {
      if (err) res.status(404).send('Not found');
    });
  });

  const errorHandlerFn = (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    sendError(res, err);
  };
  app.use(errorHandlerFn);

  // Time-based states rechecked every second, so open pages switch within 2 seconds.
  setInterval(() => { void businessMs(); }, 1000);

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`plainwork serving on ${config.port}`);
  });
};

serve().catch((e) => {
  console.error(e);
  process.exit(1);
});
