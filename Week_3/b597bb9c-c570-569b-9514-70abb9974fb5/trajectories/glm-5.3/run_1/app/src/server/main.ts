import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { loadConfig, type AppConfig } from './config';
import { connectDatabase, applySchema, type Db } from './db';
import { Storage } from './storage';
import { Counters } from './counters';
import { Queue } from './queue';
import { Mail } from './mail';
import { Hub } from './hub';
import type { AppCtx, SocketEntry } from './ctx';
import { sessionRoutes, currentAllowance, readCookie, respond } from './routes-session';
import { projectRoutes, memberRole } from './routes-projects';
import { captionRoutes } from './routes-captions';
import { mediaRoutes, mediaListRoute, completeUpload } from './routes-media';
import { commentRoutes } from './routes-comments';
import { cutRoutes } from './routes-cuts';
import { exportRoutes, makeExportWorker } from './routes-exports';
import { tokenRoutes, v1Routes } from './routes-tokens';
import { kitRoutes } from './routes-kits';
import { seedWorkspace, seedMedia } from './seed-media';
import { seedProjectsIfEmpty } from './seed-projects';
import { upgradeSecondsProjects } from './upgrade';
import { ApiError } from './api-errors';
import { findSession, type PersonRecord } from './sessions';
import type { Person } from '../shared/types';

const config = loadConfig();

interface Running {
  db: Db;
  hub: Hub;
}


async function main(): Promise<void> {
  // Boot: retry Postgres for up to 60 seconds.
  let db: Db | null = null;
  const deadline = Date.now() + 60_000;
  while (db === null && Date.now() < deadline) {
    try {
      db = await connectDatabase(config.databaseUrl);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (db === null) {
    console.error('Postgres did not answer within 60 seconds');
    process.exit(1);
  }
  await applySchema(db);

  const storage = new Storage(config);
  const counters = new Counters(config.valkeyUrl);
  const mail = new Mail(config);
  const queue = new Queue(config);
  const hub = new Hub(db);

  const seeded = await seedWorkspace(db);
  const ctx: AppCtx = {
    db,
    config,
    storage,
    counters,
    queue,
    mail,
    live: hub,
    workspaceId: seeded?.workspaceId ?? 'ws-seed',
    ownerId: seeded?.ownerId ?? 'noor',
  };

  counters.setWorkspace(ctx.workspaceId);
  try {
    await counters.connect();
  } catch {
    // Valkey unreachable: counters rebuild when it returns.
  }
  // Probes start the services and keep their liveness fresh. An unreachable
  // service never blocks the boot: health and pages still serve.
  await storage.probe();
  await mail.probe();
  try {
    await queue.connect(makeExportWorker(ctx));
  } catch {
    // RabbitMQ unreachable: exports answer 503 until it returns.
  }
  await seedProjectsIfEmpty(db, ctx.workspaceId);
  await upgradeSecondsProjects(db);
  // Seed media objects when storage answers; retry while it does not.
  const seedMediaUntilUp = async (): Promise<void> => {
    if (!storage.isUp()) return;
    try {
      await seedMedia(db, storage, ctx.workspaceId);
    } catch {
      // A media object that fails to store waits for the next probe.
    }
  };
  await seedMediaUntilUp();
  setInterval(() => {
    void seedMediaUntilUp();
    void upgradeSecondsProjects(db);
  }, 5000);

  const { startMailLoop } = await import('./mail-loop');
  startMailLoop(ctx);

  // Service probes on an interval keep outage banners truthful.
  setInterval(() => {
    void storage.probe();
    void mail.probe();
    if (!queue.isUp()) void queue.ensure();
    void hub.sweepReviewExpiry();
  }, 3000);

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  // Body parsing with the published limits; a body exactly at its limit is
  // accepted, and an over-limit body stops reading at the limit.
  app.use((req, res, next) => {
    if (req.path.includes('/chunks/')) {
      express.raw({ type: 'application/octet-stream', limit: 5242880 })(req, res, (err) => {
        if (err !== undefined && err !== null) {
          respond(res, new ApiError('too_large', { limit: 5242880 }));
          return;
        }
        next();
      });
      return;
    }
    if (req.path.endsWith('/captions/import')) {
      express.raw({ type: 'application/x-subrip', limit: 1000000 })(req, res, (err) => {
        if (err !== undefined && err !== null) {
          respond(res, new ApiError('too_large', { limit: 1000000 }));
          return;
        }
        next();
      });
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') {
      next();
      return;
    }
    express.json({ limit: 1000000 })(req, res, (err) => {
      if (err !== undefined && err !== null) {
        if (err.type === 'entity.parse.failed') {
          respond(res, new ApiError('unsupported_media_type', { expected: 'application/json' }));
          return;
        }
        respond(res, new ApiError('too_large', { limit: 1000000 }));
        return;
      }
      next();
    });
  });

  // The same-origin boundary: no CORS headers, wrong Origin refused.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== '') {
      const own = config.publicUrl;
      if (origin !== own) {
        respond(res, new ApiError('forbidden'));
        return;
      }
    }
    const contentType = req.headers['content-type'] ?? '';
    if (req.method === 'POST' || req.method === 'PUT') {
      const mime = contentType.split(';')[0]!.trim().toLowerCase();
      if (req.path.includes('/chunks/')) {
        if (mime !== 'application/octet-stream') {
          respond(res, new ApiError('unsupported_media_type', { expected: 'application/octet-stream' }));
          return;
        }
      } else if (req.path.endsWith('/captions/import')) {
        if (mime !== 'application/x-subrip') {
          respond(res, new ApiError('unsupported_media_type', { expected: 'application/x-subrip' }));
          return;
        }
      } else if (mime !== 'application/json') {
        respond(res, new ApiError('unsupported_media_type', { expected: 'application/json' }));
        return;
      }
    }
    next();
  });

  // The session middleware: resolve the cookie or the read token.
  app.use(async (req, res, next) => {
    const token = readCookie(req);
    let person: PersonRecord | null = null;
    if (token !== null) {
      person = await findSession(db!, token);
    }
    (req as typeof req & { person: PersonRecord | null }).person = person;
    (req as typeof req & { isOwner: boolean }).isOwner = person !== null && person.id === ctx.ownerId;
    res.locals.ctx = ctx;
    next();
  });

  const healthHandler: express.RequestHandler = (_req, res) => {
    res.json({ status: 'ok' });
  };
  app.get('/api/health', healthHandler);

  app.use('/api', buildApiRouter(ctx));

  // The v1 read API answers only to bearer tokens and never to a session.
  app.use('/api/v1', (req, _res, next) => {
    (req as typeof req & { person: PersonRecord | null }).person = null;
    next();
  }, v1Routes(ctx));

  // Static assets and the single-page routes.
  const staticDir = path.resolve(process.cwd(), 'dist/client');
  const indexHtml = fs.existsSync(path.join(staticDir, 'index.html'))
    ? fs.readFileSync(path.join(staticDir, 'index.html'), 'utf-8')
    : '<!DOCTYPE html><html><body>Gatecut</body></html>';

  app.use('/assets', express.static(path.join(staticDir, 'assets'), { fallthrough: false }));
  app.get('/favicon.ico', (_req, res) => res.status(204).end());

  const pageHandler: express.RequestHandler = (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.type('html').send(indexHtml);
  };
  app.use(pageHandler);
  // A known path with a wrong method answers 405 with Allow; an unknown
  // path answers the one 404. The pattern list covers the published routes.
  const API_METHODS: { pattern: RegExp; methods: string[] }[] = [
    { pattern: /^\/api\/health$/, methods: ['GET'] },
    { pattern: /^\/api\/session$/, methods: ['POST', 'GET', 'DELETE'] },
    { pattern: /^\/api\/status$/, methods: ['GET'] },
    { pattern: /^\/api\/allowance$/, methods: ['GET'] },
    { pattern: /^\/api\/profile$/, methods: ['GET', 'PUT'] },
    { pattern: /^\/api\/outbox$/, methods: ['GET'] },
    { pattern: /^\/api\/projects$/, methods: ['GET', 'POST'] },
    { pattern: /^\/api\/projects\/[^/]+$/, methods: ['GET', 'PUT'] },
    { pattern: /^\/api\/projects\/[^/]+\/ops$/, methods: ['GET', 'POST'] },
    { pattern: /^\/api\/projects\/[^/]+\/undo$/, methods: ['POST'] },
    { pattern: /^\/api\/projects\/[^/]+\/redo$/, methods: ['POST'] },
    { pattern: /^\/api\/projects\/[^/]+\/frames\/\d+$/, methods: ['GET'] },
    { pattern: /^\/api\/projects\/[^/]+\/members$/, methods: ['GET', 'POST'] },
    { pattern: /^\/api\/projects\/[^/]+\/members\/[^/]+$/, methods: ['PUT', 'DELETE'] },
    { pattern: /^\/api\/projects\/[^/]+\/rows\/[^/]+\/captions\/import$/, methods: ['POST'] },
    { pattern: /^\/api\/projects\/[^/]+\/rows\/[^/]+\/captions\/export$/, methods: ['GET'] },
    { pattern: /^\/api\/projects\/[^/]+\/cuts$/, methods: ['GET', 'POST'] },
    { pattern: /^\/api\/projects\/[^/]+\/cuts\/[^/]+$/, methods: ['GET'] },
    { pattern: /^\/api\/projects\/[^/]+\/cuts\/[^/]+\/compare\/[^/]+$/, methods: ['GET'] },
    { pattern: /^\/api\/projects\/[^/]+\/cuts\/[^/]+\/approval$/, methods: ['POST'] },
    { pattern: /^\/api\/projects\/[^/]+\/cuts\/[^/]+\/restore$/, methods: ['POST'] },
    { pattern: /^\/api\/projects\/[^/]+\/review-links$/, methods: ['GET', 'POST'] },
    { pattern: /^\/api\/review-links\/[^/]+$/, methods: ['PUT', 'DELETE'] },
    { pattern: /^\/api\/review-links\/[^/]+\/regenerate$/, methods: ['POST'] },
    { pattern: /^\/api\/review\/[^/]+$/, methods: ['GET'] },
    { pattern: /^\/api\/review\/[^/]+\/comments$/, methods: ['POST'] },
    { pattern: /^\/api\/review\/[^/]+\/approve$/, methods: ['POST'] },
    { pattern: /^\/api\/projects\/[^/]+\/comments$/, methods: ['GET', 'POST'] },
    { pattern: /^\/api\/projects\/[^/]+\/comment-draft$/, methods: ['GET', 'PUT'] },
    { pattern: /^\/api\/uploads$/, methods: ['POST', 'GET'] },
    { pattern: /^\/api\/uploads\/[^/]+$/, methods: ['GET'] },
    { pattern: /^\/api\/uploads\/[^/]+\/chunks\/\d+$/, methods: ['PUT'] },
    { pattern: /^\/api\/uploads\/[^/]+\/complete$/, methods: ['POST'] },
    { pattern: /^\/api\/media$/, methods: ['GET'] },
    { pattern: /^\/api\/media\/[^/]+\/peaks$/, methods: ['GET'] },
    { pattern: /^\/api\/media\/[^/]+$/, methods: ['DELETE'] },
    { pattern: /^\/api\/projects\/[^/]+\/exports$/, methods: ['POST', 'GET'] },
    { pattern: /^\/api\/exports\/[^/]+$/, methods: ['GET'] },
    { pattern: /^\/api\/exports\/[^/]+\/cancel$/, methods: ['POST'] },
    { pattern: /^\/api\/exports\/[^/]+\/manifest$/, methods: ['GET'] },
    { pattern: /^\/api\/kits$/, methods: ['GET', 'POST'] },
    { pattern: /^\/api\/kits\/[^/]+$/, methods: ['PUT'] },
    { pattern: /^\/api\/tokens$/, methods: ['POST', 'GET'] },
    { pattern: /^\/api\/tokens\/[^/]+$/, methods: ['DELETE'] },
    { pattern: /^\/api\/v1\/projects$/, methods: ['GET'] },
    { pattern: /^\/api\/v1\/projects\/[^/]+$/, methods: ['GET'] },
    { pattern: /^\/api\/v1\/projects\/[^/]+\/clips$/, methods: ['GET'] },
    { pattern: /^\/api\/v1\/projects\/[^/]+\/cuts$/, methods: ['GET'] },
    { pattern: /^\/api\/v1\/projects\/[^/]+\/exports$/, methods: ['GET'] },
    { pattern: /^\/api\/v1\/projects\/[^/]+\/comments$/, methods: ['GET'] },
  ];

  app.use((req, res) => {
    if (req.path.startsWith('/api')) {
      const match = API_METHODS.find((entry) => entry.pattern.test(req.path));
      if (match !== undefined) {
        res.set('Allow', match.methods.join(', '));
        respond(res, new ApiError('method_not_allowed'));
        return;
      }
      respond(res, new ApiError('not_found'));
      return;
    }
    res.status(404).type('html').send(indexHtml);
  });


  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url ?? '/', config.publicUrl);
      if (url.pathname !== '/api/live') {
        socket.destroy();
        return;
      }
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== '' && origin !== config.publicUrl) {
        socket.destroy();
        return;
      }
      const cookie = readCookie(req as unknown as express.Request);
      let person: PersonRecord | null = null;
      if (cookie !== null) person = await findSession(db!, cookie);
      const reviewToken = url.searchParams.get('review');
      wss.handleUpgrade(req, socket, head, (ws) => {
        void serveSocket(ws, ctx, person, reviewToken);
      });
    })();
  });

  const running: Running = { db, hub };
  void running;

  server.listen(config.publicPort, '0.0.0.0', () => {
    console.log(`Gatecut serving on 0.0.0.0:${config.publicPort}`);
  });
}

async function serveSocket(ws: WebSocket, ctx: AppCtx, person: PersonRecord | null, reviewToken: string | null): Promise<void> {
  let projectId: string | null = null;
  let reviewLinkId: string | null = null;
  let entry: SocketEntry | null = null;

  const send = (message: Record<string, unknown>): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };

  ws.on('message', (data) => {
    void (async () => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      if (message.type === 'subscribe' && typeof message.project_id === 'string' && person !== null) {
        try {
          await memberRole(ctx, person.id, message.project_id);
        } catch {
          ws.close(4403);
          return;
        }
        projectId = message.project_id;
        entry = ctx.live.register({ ws, projectId, reviewLinkId: null, personId: person.id });
        const after = Number(message.after_version ?? 0);
        const ops = await ctx.db.query(
          `SELECT version, person_id, person_name, op, undo_data FROM ops WHERE project_id = $1 AND version > $2 ORDER BY version`,
          [projectId, Number.isFinite(after) ? after : 0],
        );
        for (const row of ops.rows) {
          send({
            type: 'op',
            version: row.version,
            author: { id: row.person_id, name: row.person_name },
            op: row.op,
            changes: { clips: [], captions: [], comments: [], rows: [] },
            removed: [],
          });
        }
        const comments = await ctx.db.query(
          `SELECT * FROM comments WHERE project_id = $1 ORDER BY created_at`,
          [projectId],
        );
        for (const row of comments.rows) {
          const { commentJson } = await import('./routes-comments');
          send({ type: 'comment', comment: await commentJson(ctx, row, projectId) });
        }
        const exportsRows = await ctx.db.query(
          'SELECT * FROM exports WHERE project_id = $1 ORDER BY created_at',
          [projectId],
        );
        const { exportJson } = await import('./routes-exports');
        for (const row of exportsRows.rows) {
          send({ type: 'export', export: await exportJson(row) });
        }
        const allowance = await currentAllowance(ctx);
        send({ type: 'allowance', allowance });
      } else if (message.type === 'subscribe_review' && reviewToken !== null) {
        const link = await ctx.db.query('SELECT * FROM review_links WHERE token = $1', [reviewToken]);
        if ((link.rowCount ?? 0) === 0) {
          ws.close(4410);
          return;
        }
        const l = link.rows[0]!;
        if (l.state !== 'active' || new Date(l.expires_at).getTime() < Date.now()) {
          ws.close(4410);
          return;
        }
        reviewLinkId = l.id;
        projectId = l.project_id;
        entry = ctx.live.register({ ws, projectId, reviewLinkId: l.id, personId: person?.id ?? null });
        const allowance = await currentAllowance(ctx);
        send({ type: 'allowance', allowance });
      } else if (message.type === 'playhead' && typeof message.frame === 'number') {
        // Playheads are relayed, not stored: at most four times a second.
        if (projectId !== null) {
          ctx.live.publishOp(projectId, { type: 'playhead', person: person?.name ?? '', frame: Number(message.frame) });
        }
      }
    })();
  });

  ws.on('close', () => {
    if (entry !== null) ctx.live.unregister(entry);
  });
}

function buildApiRouter(ctx: AppCtx): express.Router {
  const r = express.Router();
  r.use(sessionRoutes(ctx));
  r.use(projectRoutes(ctx));
  r.use(captionRoutes(ctx));
  r.use(mediaListRoute(ctx));
  r.use(mediaRoutes(ctx));
  r.use(commentRoutes(ctx));
  r.use(cutRoutes(ctx));
  r.use(exportRoutes(ctx));
  r.use(kitRoutes(ctx));
  r.use(tokenRoutes(ctx));
  return r;
}

void (config satisfies AppConfig);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
