import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response, type NextFunction } from 'express';
import { loadConfig } from './config.js';
import { applySchema, pool } from './db.js';
import { sendError, JSON_BODY_LIMIT } from './http.js';
import { authRouter } from './routes/auth.js';

import { briefsRouter } from './routes/briefs.js';
import { commissionsRouter } from './routes/commissions.js';
import { venuesRouter } from './routes/venues.js';
import { filesRendersRouter } from './routes/files.js';
import { holdsRouter } from './routes/holds.js';
import { paymentsRouter } from './routes/payments.js';
import { fundersRouter } from './routes/funders.js';
import { miscRouter } from './routes/misc.js';
import { callbacksRouter } from './routes/callbacks.js';
import { eventsRouter } from './routes/events.js';
import { Worker } from './worker.js';
import { KeycloakAdmin } from './services/keycloak.js';
import { KillBill } from './services/killbill.js';
import { ObjectStore } from './services/objectstore.js';
import * as svc from './commission-service.js';
import { VENUES } from './domain/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = loadConfig();
const DIST = path.join(__dirname, '..', 'client');

async function seedVenues(): Promise<void> {
  for (const venue of VENUES) {
    await pool.query(
      `INSERT INTO venues (id, name, address, city, time_zone, tax_rate_bp) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address, city = EXCLUDED.city, time_zone = EXCLUDED.time_zone, tax_rate_bp = EXCLUDED.tax_rate_bp`,
      [venue.id, venue.name, venue.address, venue.city, venue.timeZone, venue.taxRateBp],
    );
  }
}

/** Idempotent startup setup: until it succeeds, the app keeps trying on a timer. */
async function setupKeycloak(): Promise<boolean> {
  const kc = new KeycloakAdmin(cfg);
  if (!(await kc.available().catch(() => false))) return false;
  try {
    await kc.ensureRealmRoles();
    await kc.ensureSeededUsers();
    return true;
  } catch (e) {
    console.warn('keycloak setup pending:', e instanceof Error ? e.message : e);
    return false;
  }
}

async function setupKillBill(): Promise<boolean> {
  const kb = new KillBill(cfg);
  if (!(await kb.available().catch(() => false))) return false;
  try {
    await kb.ensureTenant();
    await kb.ensureCatalog();
    return true;
  } catch (e) {
    console.warn('killbill setup pending:', e instanceof Error ? e.message : e);
    return false;
  }
}

async function setupStorage(): Promise<boolean> {
  const store = new ObjectStore(cfg);
  try {
    await store.ensureBucket();
    return true;
  } catch (e) {
    console.warn('storage setup pending:', e instanceof Error ? e.message : e);
    return false;
  }
}

// Service health probes with short-lived caching.
interface ServiceStatus {
  postgres: string;
  keycloak: string;
  killbill: string;
  mailpit: string;
  minio: string;
  gotenberg: string;
  svix: string;
  ntfy: string;
  renderProvider: string;
}

let statusCache: { at: number; value: ServiceStatus } | null = null;

async function probeServices(): Promise<ServiceStatus> {
  if (statusCache && Date.now() - statusCache.at < 5000) return statusCache.value;
  const kc = new KeycloakAdmin(cfg);
  const kb = new KillBill(cfg);
  const store = new ObjectStore(cfg);
  const mailer = new (await import('./services/mailer.js')).Mailer(cfg);
  const pdf = new (await import('./services/pdf.js')).PdfRenderer(cfg);
  const alerts = new (await import('./services/ntfy.js')).CrewAlerts(cfg);
  const svix = new (await import('./services/svix.js')).Svix(cfg);
  const render = new (await import('./services/render.js')).RenderProvider(cfg);
  const [postgres, keycloak, killbill, mailpit, minio, gotenberg, svixUp, ntfyUp, renderUp] = await Promise.all([
    pool.query('SELECT 1').then(() => 'up').catch(() => 'down'),
    kc.available().then((ok) => (ok ? 'up' : 'down')).catch(() => 'down'),
    kb.available().then((ok) => (ok ? 'up' : 'down')).catch(() => 'down'),
    mailer.available().then((ok) => (ok ? 'up' : 'down')).catch(() => 'down'),
    store.available().then((ok) => (ok ? 'up' : 'down')).catch(() => 'down'),
    pdf.available().then((ok) => (ok ? 'up' : 'down')).catch(() => 'down'),
    svix.available().then((ok) => (ok ? 'up' : 'down')).catch(() => 'down'),
    alerts.available().then((ok) => (ok ? 'up' : 'down')).catch(() => 'down'),
    render.available().then((ok) => (ok ? 'up' : 'down')).catch(() => 'down'),
  ]);
  const value: ServiceStatus = { postgres, keycloak, killbill, mailpit, minio, gotenberg, svix: svixUp, ntfy: ntfyUp, renderProvider: renderUp };
  statusCache = { at: Date.now(), value };
  return value;
}

async function main(): Promise<void> {
  await applySchema();
  await seedVenues();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // Body limits are enforced before anything else.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api/')) {
      next();
      return;
    }
    if (req.path === '/api/render-callbacks') {
      next();
      return;
    }
    next();
  });
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const contentType = req.headers['content-type'] ?? '';
      // Multipart bodies are handled by multer in the route itself.
      if (contentType.includes('multipart/form-data')) {
        next();
        return;
      }
      if (!contentType.includes('application/json') || req.method === 'GET' || req.method === 'HEAD') {
        next();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let limit = JSON_BODY_LIMIT;
      if (req.path === '/api/render-callbacks') limit = 16_777_216;
      let aborted = false;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) {
          aborted = true;
          res.status(413).json({ error: { code: 'body_too_large' } });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (aborted) return;
        const raw = Buffer.concat(chunks);
        (req as unknown as { rawBody: Buffer }).rawBody = raw;
        try {
          (req as unknown as { body: unknown }).body = chunks.length === 0 ? {} : JSON.parse(raw.toString('utf8'));
        } catch {
          res.status(400).json({ error: { code: 'bad_json' } });
          return;
        }
        next();
      });
      req.on('error', () => {
        if (!aborted && !res.headersSent) res.status(400).json({ error: { code: 'bad_request' } });
      });
    })();
  });

  const api = express.Router();
  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  api.get('/status', async (_req, res) => {
    const value = await probeServices();
    res.json({ services: value });
  });
  api.get('/me', async (req, res) => {
    const outcome = await (await import('./middleware.js')).authenticate(req as never, cfg.accessTtlSeconds);
    if (!outcome || 'expired' in outcome) {
      res.status(401).json({ error: { code: 'unauthenticated' } });
      return;
    }
    res.json({ id: outcome.user.id, email: outcome.user.email, name: outcome.user.name, roles: [outcome.user.role] });
  });
  api.use(briefsRouter(cfg));
  api.use(commissionsRouter(cfg));
  api.use(filesRendersRouter(cfg));
  api.use(holdsRouter(cfg));
  api.use(paymentsRouter(cfg));
  api.use(fundersRouter(cfg));
  api.use(miscRouter(cfg));
  api.use(callbacksRouter(cfg));
  api.use(eventsRouter(cfg));
  api.use(venuesRouter(cfg));
  api.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found' } });
  });
  app.use('/api', api);
  app.use('/auth', authRouter(cfg));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    sendError(res, err);
  });

  // Serve only the built app and its assets.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(404).send('Not found');
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.status(400).send('Bad request');
      return;
    }
    if (pathname === '/') pathname = '/index.html';
    const forbidden =
      pathname.startsWith('/server/') ||
      pathname.startsWith('/client/') ||
      pathname === '/run.json' ||
      pathname.startsWith('/tsconfig') ||
      pathname.endsWith('.ts') ||
      pathname.startsWith('/.env');
    if (forbidden) {
      res.status(404).send('Not found');
      return;
    }
    const filePath = path.join(DIST, pathname);
    if (!filePath.startsWith(DIST)) {
      res.status(404).send('Not found');
      return;
    }
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        if (pathname.startsWith('/assets/')) {
          res.status(404).send('Not found');
          return;
        }
        // The SPA handles its own routes.
        res.set('content-type', 'text/html');
        fs.readFile(path.join(DIST, 'index.html'), (readErr, data) => {
          if (readErr) {
            res.status(404).send('Not found');
            return;
          }
          res.send(data);
        });
        return;
      }
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.woff2': 'font/woff2',
        '.json': 'application/json',
        '.glb': 'model/gltf-binary',
        '.pdf': 'application/pdf',
      };
      res.set('content-type', types[path.extname(filePath)] ?? 'application/octet-stream');
      res.set('cache-control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.sendFile(filePath);
    });
  });

  const server = http.createServer(app);
  server.listen(cfg.port, '0.0.0.0', () => {
    console.log(`Spindrift Rooms listening on 0.0.0.0:${cfg.port}`);
  });

  // Startup setup, retried until it succeeds.
  let keycloakReady = false;
  let killbillReady = false;
  let storageReady = false;
  const setupTimer = setInterval(() => {
    void (async () => {
      if (!keycloakReady) keycloakReady = await setupKeycloak();
      if (!killbillReady) killbillReady = await setupKillBill();
      if (!storageReady) storageReady = await setupStorage();
      if (keycloakReady && killbillReady && storageReady) clearInterval(setupTimer);
    })();
  }, 10_000);
  void (async () => {
    keycloakReady = await setupKeycloak();
    killbillReady = await setupKillBill();
    storageReady = await setupStorage();
    if (keycloakReady && killbillReady && storageReady) clearInterval(setupTimer);
  })();

  // Job worker and hold sweep.
  const worker = new Worker(cfg);
  const tick = () => {
    if (worker) void worker.tick().finally(() => {
      setTimeout(tick, 200);
    });
  };
  tick();
  setInterval(() => {
    void worker.sweepHolds();
  }, 1000);

  const shutdown = () => {
    clearInterval(setupTimer);
    worker.stop();
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main().catch((e) => {
  console.error('startup failed', e);
  process.exit(1);
});
