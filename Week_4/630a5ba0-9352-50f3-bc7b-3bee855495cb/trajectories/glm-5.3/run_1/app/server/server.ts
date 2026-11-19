import express, { type Express, type Request, type RequestHandler } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import fs from 'node:fs';
import { Database } from './db.js';
import { loadConfig } from './config.js';
import { applySchema } from './schema.js';
import { runSeed } from './seed.js';
import { KillBillClient } from './killbill.js';
import { Mailer } from './mail.js';
import { OutboxWorker } from './outbox.js';
import { hashToken } from './ids.js';
import { loadMemberByToken, type MemberRow } from './repo.js';
import { errorResponder, h, sendJson } from './api-core.js';
import { health, authHandlers, taskHandlers, sessionHandlers, routineHandlers, feedHandlers, readSessionCookie } from './api-routes.js';
import { importHandlers, shutdownHandlers } from './api-imports.js';
import { workspaceHandlers, invitationHandlers, billingHandlers, opsHandlers } from './api-workspace.js';
import { refreshWorkspaceStates } from './sweeps.js';
import { MAX_JSON_BYTES, MAX_IMPORT_BYTES } from '../src-shared/constants.js';

const JSON_LIMIT = MAX_JSON_BYTES;
const IMPORT_LIMIT = MAX_IMPORT_BYTES;

function buildApp(deps: {
  db: Database;
  killbill: KillBillClient;
  mailer: Mailer;
  outbox: OutboxWorker;
  port: number;
}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // --- Server boundary: origin check, content types, size limits (in precedence order) ---
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Method check for the feed: only GET and HEAD are accepted there.
    const isFeed = req.path.startsWith('/feed/');
    if (isFeed && req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method_not_allowed', message: 'That method is not allowed here.' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.header('Origin');
      const own = `${req.protocol}://${req.header('Host') ?? ''}`;
      const forwardedProto = req.header('X-Forwarded-Proto');
      const forwardedHost = req.header('X-Forwarded-Host');
      const ownForwarded = `${forwardedProto ?? req.protocol}://${forwardedHost ?? req.header('Host') ?? ''}`;
      if (origin !== undefined && origin !== '' && origin !== own && origin !== ownForwarded) {
        sendJson(res, 403, { error: 'cross_origin', message: 'Writes are only accepted from this app\u2019s own origin.' });
        return;
      }
    }
    next();
  });

  // Body handling with per-endpoint limits and content types.
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      next();
      return;
    }
    const length = Number(req.header('Content-Length') ?? '0');
    const isBillingCallback = req.path === '/api/billing/callbacks';
    const isImport = req.path === '/api/imports/tasks' || req.path === '/api/imports/calendar';
    const limit = isImport ? IMPORT_LIMIT : JSON_LIMIT;
    const wantedType = isImport ? (req.path === '/api/imports/tasks' ? 'text/csv' : 'text/calendar') : 'application/json; charset=utf-8';
    if (length > limit) {
      sendJson(res, 413, { error: 'payload_too_large', message: 'That request is too large.' });
      return;
    }
    const type = req.header('Content-Type') ?? '';
    const contentTypePresent = req.header('Content-Length') !== undefined && Number(req.header('Content-Length')) > 0;
    if (!isBillingCallback) {
      if (contentTypePresent) {
        const base = type.split(';')[0]?.trim().toLowerCase() ?? '';
        const wantedBase = wantedType.split(';')[0]?.trim().toLowerCase() ?? '';
        if (base !== wantedBase && !(wantedBase === 'application/json' && (base === 'application/json' || base === 'text/json'))) {
          sendJson(res, 415, { error: 'unsupported_media_type', message: `Send a body of type ${wantedType}.` });
          return;
        }
      }
    } else if (contentTypePresent) {
      const base = type.split(';')[0]?.trim().toLowerCase() ?? '';
      if (base !== 'application/json') {
        sendJson(res, 415, { error: 'unsupported_media_type', message: 'Send a JSON body.' });
        return;
      }
    }
    let data: Buffer[] = [];
    let size = 0;
    let finished = false;
    const finish = (status: number, body: unknown): void => {
      if (finished) return;
      finished = true;
      res.status(status).json(body);
    };
    req.on('data', (chunk: Buffer) => {
      if (finished) return;
      size += chunk.length;
      if (size > limit) {
        finish(413, { error: 'payload_too_large', message: 'That request is too large.' });
        return;
      }
      data.push(chunk);
    });
    req.on('end', () => {
      if (finished) return;
      finished = true;
      const raw = Buffer.concat(data);
      (req as Request & { rawBody?: Buffer }).rawBody = raw;
      if (raw.length === 0) {
        req.body = {};
        next();
        return;
      }
      if (isBillingCallback || !isImport) {
        try {
          req.body = JSON.parse(raw.toString('utf8'));
        } catch {
          finish(400, { error: 'bad_request', message: 'Send a JSON body.' });
          return;
        }
      } else {
        req.body = raw.toString('utf8');
      }
      next();
    });
    req.on('error', () => {
      if (!finished) finish(400, { error: 'bad_request', message: 'Something went wrong on our side. Nothing was changed.' });
    });
  });

  app.use((req, _res, next) => {
    // Sign in state, loaded once per request.
    const token = readSessionCookie(req);
    if (token === null) {
      next();
      return;
    }
    void loadMemberByToken(deps.db, hashToken(token))
      .then((member) => {
        req.member = member ?? undefined;
        next();
      })
      .catch(() => next());
  });

  const api = express.Router();

  api.get('/api/health', health);

  const auth = authHandlers({ db: deps.db, config: loadConfigFor(deps), killbill: deps.killbill, mailer: deps.mailer, outbox: deps.outbox });
  api.post('/api/workspaces', h(auth.workspaces));
  api.post('/api/auth/sign-in', h(auth.signIn));
  api.post('/api/auth/sign-out', h(auth.signOut));
  api.get('/api/me', h(auth.me));
  api.patch('/api/me', h(auth.patchMe));

  const tasks = taskHandlers({ db: deps.db, config: loadConfigFor(deps), killbill: deps.killbill, mailer: deps.mailer, outbox: deps.outbox });
  api.get('/api/board', h(tasks.board));
  api.post('/api/tasks', h(tasks.createTask));
  api.patch('/api/tasks/:id', h(tasks.patchTask));
  api.get('/api/tasks/suggest', h(tasks.suggest));

  const imports = importHandlers({ db: deps.db, config: loadConfigFor(deps), killbill: deps.killbill, mailer: deps.mailer, outbox: deps.outbox });
  api.post('/api/imports/tasks', h(imports.tasks));
  api.post('/api/imports/calendar', h(imports.calendar));

  const sessions = sessionHandlers({ db: deps.db, config: loadConfigFor(deps), killbill: deps.killbill, mailer: deps.mailer, outbox: deps.outbox });
  api.get('/api/calendar', h(sessions.calendar));
  api.post('/api/sessions', h(sessions.create));
  api.patch('/api/sessions/:id', h(sessions.patch));
  api.delete('/api/sessions/:id', h(sessions.remove));

  const routines = routineHandlers({ db: deps.db, config: loadConfigFor(deps), killbill: deps.killbill, mailer: deps.mailer, outbox: deps.outbox });
  api.get('/api/routines', h(routines.list));
  api.post('/api/routines', h(routines.create));
  api.delete('/api/routines/:id', h(routines.remove));

  const feed = feedHandlers({ db: deps.db, config: loadConfigFor(deps), killbill: deps.killbill, mailer: deps.mailer, outbox: deps.outbox });
  api.get('/api/feed', h(feed.getFeedUrl));
  api.post('/api/feed/rotate', h(feed.rotate));

  const shutdown = shutdownHandlers({ db: deps.db, config: loadConfigFor(deps), killbill: deps.killbill, mailer: deps.mailer, outbox: deps.outbox });
  api.get('/api/shutdown/preview', h(shutdown.preview));
  api.post('/api/shutdown', h(shutdown.run));

  const workspace = workspaceHandlers({ db: deps.db, config: loadConfigFor(deps), killbill: deps.killbill, mailer: deps.mailer, outbox: deps.outbox });
  api.get('/api/workspace/members', h(workspace.members));
  api.post('/api/workspace/invitations', h(workspace.invite));
  api.delete('/api/workspace/members/:id', h(workspace.removeMember));
  api.get('/api/workspace/review', h(workspace.review));

  const invitations = invitationHandlers({ db: deps.db, config: loadConfigFor(deps), killbill: deps.killbill, mailer: deps.mailer, outbox: deps.outbox });
  api.get('/api/invitations/:token', h(invitations.show));
  api.post('/api/invitations/:token/accept', h(invitations.accept));

  const billing = billingHandlers({ db: deps.db, config: loadConfigFor(deps), killbill: deps.killbill, mailer: deps.mailer, outbox: deps.outbox });
  api.post('/api/billing/callbacks', h(billing.callbacks));

  const ops = opsHandlers({ db: deps.db, config: loadConfigFor(deps), killbill: deps.killbill, mailer: deps.mailer, outbox: deps.outbox });
  api.get('/api/ops/workspaces', h(ops.workspaces));

  app.use(api);

  app.use('/feed', (req, res, next) => {
    void feed.serve(req, res).catch(next);
  });

  // Static assets: only the built bundle and bundled fonts/icons.
  const publicDir = path.resolve(__dirname, '..', 'public');
  const serveStatic: RequestHandler = (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method_not_allowed', message: 'That method is not allowed here.' });
      return;
    }
    const rel = decodeURIComponent(req.path.replace(/^\/+/, ''));
    const target = path.resolve(publicDir, rel);
    if (rel !== '' && !target.startsWith(publicDir + path.sep)) {
      sendJson(res, 404, { error: 'not_found', message: "That page doesn't exist." });
      return;
    }
    // Never serve anything that looks like source, config or environment files.
    const forbidden = [
      /^package(-lock)?\.json$/, /^tsconfig.*\.json$/, /^run\.json$/, /^vite\.config\..*$/,
      /\.map$/, /\.ts$/, /\.tsx$/, /\.env/, /^node_modules\//, /^server\//, /^src\//, /^src-shared\//,
      /^public-src\//, /^dist\/server\//,
    ];
    if (forbidden.some((re) => re.test(rel))) {
      sendJson(res, 404, { error: 'not_found', message: "That page doesn't exist." });
      return;
    }
    fs.stat(target, (statErr, stat) => {
      if (statErr !== null || !stat.isFile()) {
        next();
        return;
      }
      res.sendFile(target);
    });
  };
  app.use(serveStatic);

  // The single-page routes.
  const pagePaths = ['/', '/signin', '/trial', '/settings', '/workspace', '/operations', /^\/join\/[A-Za-z0-9_-]+$/];
  const serveIndex: RequestHandler = (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method_not_allowed', message: 'That method is not allowed here.' });
      return;
    }
    const matched = pagePaths.some((p) => (typeof p === 'string' ? req.path === p : p.test(req.path)));
    if (!matched) {
      sendJson(res, 404, { error: 'not_found', message: "That page doesn't exist." });
      return;
    }
    const index = path.join(publicDir, 'index.html');
    fs.readFile(index, (err, contents) => {
      if (err !== null) {
        next(err);
        return;
      }
      res.type('html').send(contents.toString('utf8'));
    });
  };
  app.use(serveIndex);

  app.use(errorResponder);

  return app;
}

let cachedConfig: ReturnType<typeof loadConfig> | null = null;
function loadConfigFor(deps: { db: Database }): ReturnType<typeof loadConfig> {
  void deps;
  if (cachedConfig === null) cachedConfig = loadConfig();
  return cachedConfig;
}

export { buildApp };
