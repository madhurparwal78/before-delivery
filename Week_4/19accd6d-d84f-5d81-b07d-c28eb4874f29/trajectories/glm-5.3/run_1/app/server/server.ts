import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { loadConfig, clientConfig, type Config } from './config.js';
import { applySchema, pool } from './db.js';
import { ApiError, handle, sendError } from './errors.js';
import { attachUser, requireUser, toProtocolUser } from './auth.js';
import { initServices, loadOutages, storageUp } from './services.js';
import { initMail } from './mail.js';
import { applyIndexSettings } from './search.js';
import { attachLive } from './live.js';
import { authRouter } from './routes/auth.js';
import { recipesRouter } from './routes/recipes.js';
import { filesRouter } from './routes/files.js';
import { snapshotsRouter } from './routes/snapshots.js';
import { importsRouter } from './routes/imports.js';
import { searchRouteRouter } from './routes/search.js';
import { teamsRouter } from './routes/teams.js';
import { invitesRouter } from './routes/invites.js';
import { gradingRouter } from './routes/grading.js';
import { confirmPendingSnapshots } from './background.js';

globalThis.__wringbenchConfig = loadConfig();
const config: Config = globalThis.__wringbenchConfig;

const JSON_LIMIT = 1_000_000;
const SNAPSHOT_LIMIT = 3_000_000;
const SEED_LIMIT = 10_000_000;

async function waitForPostgres(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function main(): Promise<void> {
  await waitForPostgres();
  await applySchema();
  await loadOutages();
  initServices(config);
  initMail(config.smtp.host, config.smtp.port, config.smtp.from);

  // Index settings retry until they land (Services / Meilisearch).
  void (async () => {
    for (;;) {
      try {
        await applyIndexSettings();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();
  void confirmPendingSnapshots();
  setInterval(() => void confirmPendingSnapshots(), 5000).unref();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const own = new URL(config.publicUrl);
      const host = req.headers.host ?? '';
      const same = origin === config.publicUrl || (own.host === host && origin.startsWith(`${own.protocol}//${host}`));
      if (!same) {
        if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT' || req.method === 'PATCH') {
          sendError(res, new ApiError(403, 'forbidden', 'You may not do this.'));
          return;
        }
      }
    }
    // Body limits, before any parsing (DP-05).
    const path = req.path;
    const declared = Number(req.headers['content-length']);
    if (!Number.isNaN(declared)) {
      const limit = limitFor(path);
      if (declared > limit) {
        sendError(res, new ApiError(413, 'payload_too_large', `The request body is larger than ${limit} bytes.`));
        return;
      }
    }
    next();
  });

  app.use(express.json({ limit: JSON_LIMIT, type: 'application/json' }));
  app.use(express.json({ limit: SNAPSHOT_LIMIT, type: () => false, inflate: false }));
  app.use(cookieParser());
  app.use(attachUser);

  app.get('/api/health', async (_req, res) => {
    const ok = await storageUp();
    res.status(200).json(ok ? { status: 'ok' } : { status: 'unavailable' });
  });

  app.get('/api/config', (_req, res) => {
    res.json(clientConfig(config));
  });

  // The snapshot route accepts a larger body than the JSON default (API).
  app.use('/api/snapshots', express.json({ limit: SNAPSHOT_LIMIT }), snapshotsRouter);

  // Routes that need no session (DP-04 precedence).
  app.use('/api/auth', authRouter);
  app.use('/api/invites', invitesRouter);

  // Session-guarded routes: attachUser has already run; requireUser throws 401 when missing.
  app.use('/api/recipes', recipesRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/imports', importsRouter);
  app.use('/api/search', searchRouteRouter);
  app.use('/api/teams', teamsRouter);
  // /api/me mirrors the auth router's session query (API).
  app.get('/api/me', handle(async (req, res) => {
    const user = requireUser(req);
    const teams = await pool.query<{ id: string; name: string; role: string }>(
      'SELECT t.id, t.name, tm.role FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id = $1 ORDER BY t.name',
      [user.id],
    );
    res.json({ user: toProtocolUser(user), teams: teams.rows });
  }));

  if (config.grading) {
    app.use('/api/grading', gradingRouter);
  } else {
    app.use('/api/grading', (_req, res) => {
      sendError(res, new ApiError(404, 'not_found', 'Not found.'));
    });
  }

  // The snapshot route needs a larger body limit than the JSON default.
  app.use(express.json({ limit: SNAPSHOT_LIMIT, type: () => false }));

  app.use('/api', (_req, res) => {
    sendError(res, new ApiError(404, 'not_found', 'Not found.'));
  });

  // Static frontend
  const clientDir = join(import.meta.dirname, 'public/client');
  const indexHtml = join(clientDir, 'index.html');
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    const path = req.path === '/' ? '/index.html' : req.path;
    const file = join(clientDir, path);
    if (!file.startsWith(clientDir) || !existsSync(file) || !statSync(file).isFile()) {
      if (existsSync(indexHtml)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(readFileSync(indexHtml));
        return;
      }
      res.status(503).send('Not built');
      return;
    }
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.ttf': 'font/ttf',
      '.png': 'image/png',
      '.map': 'application/json',
    };
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.end(readFileSync(file));
  });

  // One error shape for every failure (DP-04).
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    if (!(err instanceof ApiError)) console.error(err);
    sendError(res, err);
  });

  const server = createServer(app);
  attachLive(server);
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`wringbench serving on 0.0.0.0:${config.port}`);
  });
}

function limitFor(path: string): number {
  if (path === '/api/snapshots') return SNAPSHOT_LIMIT;
  if (path === '/api/grading/seed') return SEED_LIMIT;
  if (path === '/api/files') return config.fileMaxBytes;
  return JSON_LIMIT;
}

void main();
