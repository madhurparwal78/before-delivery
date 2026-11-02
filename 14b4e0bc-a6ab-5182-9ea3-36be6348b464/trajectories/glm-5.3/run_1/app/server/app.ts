import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { Database } from './db';
import { Fanout } from './fanout';
import { EvidenceStore } from './evidence';
import { MailRelay } from './mail';
import { NoticeSender } from './sender';
import { requireSession, type AppServices } from './session';
import { applySchemaAndSeed } from './seed';
import { sendError, ERR } from './errors';
import { sessionRoutes } from './routes/session';
import { searchRoute, assetReadRoute, columnReadRoute, graphRoute, lineageRoute, termsRoute, statusRoute } from './routes/reads';
import { tagRoutes } from './routes/tags';
import { bulkRoutes } from './routes/bulk';
import { certificationRoutes } from './routes/certification';
import { evidenceRoutes } from './routes/evidence';
import { ingestionRoutes } from './routes/ingestion';
import { glossaryRoutes } from './routes/glossary';
import { userRoutes } from './routes/users';
import { auditRoutes, auditWriteGuard } from './routes/audit';
import { eventsRoute } from './routes/events';

export interface AppState {
  db: Database;
  fanout: Fanout;
  evidence: EvidenceStore;
  mail: MailRelay;
  sender: NoticeSender;
  services: AppServices;
  probes: NodeJS.Timeout | null;
}

/** Probes the evidence store and the mail relay every 5 seconds (DP-66). */
function startProbes(state: AppState): void {
  const probe = async (): Promise<void> => {
    const [evidenceUp, mailUp] = await Promise.all([state.evidence.probe(), state.mail.probe()]);
    void evidenceUp;
    void mailUp;
  };
  void probe();
  state.probes = setInterval(() => void probe(), 5000);
}

export async function createApp(): Promise<{ app: express.Express; state: AppState }> {
  const db = new Database(process.env.DATABASE_URL!);
  await applySchemaAndSeed(db);

  const evidence = new EvidenceStore({
    endpoint: process.env.S3_ENDPOINT!,
    region: process.env.S3_REGION!,
    bucket: process.env.S3_BUCKET!,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  });
  const mail = new MailRelay({
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT ?? 1025),
    from: process.env.MAIL_FROM ?? 'Strata Catalog <strata@quarrystone.test>',
  });
  const fanout = new Fanout(db);
  const sender = new NoticeSender(db, mail);
  const services: AppServices = { db, evidence, mail, latestSeq: async () => 0 };
  const state: AppState = { db, fanout, evidence, mail, sender, services, probes: null };

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(cookieParser());

  const requireAuth = requireSession(db);

  const health = (req: Request, res: Response): void => {
    void req;
    res.json({ status: 'ok' });
  };

  // Session and health
  app.post('/api/session', ...sessionRoutes(services).create);
  app.get('/api/session', requireAuth, ...sessionRoutes(services).read);
  app.delete('/api/session', requireAuth, ...sessionRoutes(services).destroy);
  app.get('/api/health', health);

  // Reads
  app.get('/api/status', requireAuth, statusRoute(services));
  app.get('/api/search', requireAuth, searchRoute(services));
  app.get('/api/graph', requireAuth, graphRoute(services));
  app.get('/api/terms', requireAuth, termsRoute(services));
  app.get('/api/assets/:id', requireAuth, assetReadRoute(services));
  app.get('/api/columns/:id', requireAuth, columnReadRoute(services));
  app.get('/api/columns/:id/lineage', requireAuth, lineageRoute(services));

  // Tags and suppressions
  const tags = tagRoutes(services);
  app.post('/api/columns/:id/tags', requireAuth, ...tags.addRoute);
  app.delete('/api/columns/:id/tags/:tag', requireAuth, ...tags.withdrawRoute);
  app.post('/api/columns/:id/suppressions', requireAuth, ...tags.suppressRoute);
  app.delete('/api/columns/:id/suppressions/:tag', requireAuth, ...tags.liftRoute);

  // Bulk tag apply and undo
  const bulk = bulkRoutes(services);
  app.post('/api/assets/:id/tags/bulk', requireAuth, ...bulk.bulkRoute);
  app.post('/api/tag-batches/:batchId/undo', requireAuth, ...bulk.undoRoute);

  // Certification and evidence
  const cert = certificationRoutes(services);
  app.post('/api/assets/:id/verify', requireAuth, ...cert.verifyRoute);
  app.post('/api/assets/:id/deprecate', requireAuth, ...cert.deprecateRoute);
  app.post('/api/assets/:id/reinstate', requireAuth, ...cert.reinstateRoute);
  const evidenceHandler = evidenceRoutes(services);
  app.get('/api/assets/:id/evidence', requireAuth, evidenceHandler.handler);
  app.head('/api/assets/:id/evidence', requireAuth, evidenceHandler.handler);

  // Ingestion
  const ing = ingestionRoutes(services);
  app.post('/api/assets', requireAuth, ...ing.registerRoute);
  app.post('/api/lineage/edges', requireAuth, ...ing.edgeRoute);
  app.delete('/api/lineage/edges/:edgeId', requireAuth, ...ing.edgeDeleteRoute);

  // Glossary
  const glossary = glossaryRoutes(services);
  app.post('/api/terms', requireAuth, ...glossary.createRoute);
  app.patch('/api/terms/:id', requireAuth, ...glossary.updateRoute);
  app.post('/api/assets/:id/terms', requireAuth, ...glossary.linkRoute);
  app.delete('/api/assets/:id/terms/:termId', requireAuth, ...glossary.unlinkRoute);

  // Users
  const users = userRoutes(services);
  app.get('/api/users', requireAuth, ...users.listRoute);
  app.post('/api/users', requireAuth, ...users.createRoute);
  app.patch('/api/users/:id', requireAuth, ...users.patchRoute);

  // Audit: reads for Admins, writes refused for every role
  const audit = auditRoutes(services);
  app.get('/api/audit', requireAuth, ...audit.listRoute);
  app.get('/api/audit/chain', requireAuth, ...audit.chainRoute);
  const auditGuard = [
    requireAuth,
    (req: Request, res: Response): void => {
      void req;
      auditWriteGuard(req, res);
    },
  ];
  app.put('/api/audit', ...auditGuard);
  app.patch('/api/audit', ...auditGuard);
  app.delete('/api/audit', ...auditGuard);
  app.post('/api/audit', ...auditGuard);
  app.put('/api/audit/chain', ...auditGuard);
  app.patch('/api/audit/chain', ...auditGuard);
  app.delete('/api/audit/chain', ...auditGuard);
  app.post('/api/audit/chain', ...auditGuard);
  app.put('/api/audit/:id', ...auditGuard);
  app.patch('/api/audit/:id', ...auditGuard);
  app.delete('/api/audit/:id', ...auditGuard);

  // Activity stream
  app.get('/api/events', requireAuth, eventsRoute(services, fanout));

  // API boundary: nothing else under /api exists
  app.use('/api', (req: Request, res: Response): void => {
    void req;
    res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } });
  });

  // Only the built client assets are served; no source, env, manifest or package files.
  const publicDir = path.resolve(__dirname, '..', '..', 'public');
  const protectedNames = new Set(['.env', 'run.json', 'package.json', 'package-lock.json']);
  app.use((req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    const pathname = decodeURIComponent(req.path);
    const base = path.basename(pathname);
    if (protectedNames.has(base) || pathname.includes('..') || pathname.startsWith('/server') || pathname.startsWith('/dist')) {
      res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } });
      return;
    }
    const filePath = path.join(publicDir, pathname);
    if (!filePath.startsWith(publicDir)) {
      res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } });
      return;
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      // Client routes: /, /signin, /catalog, /glossary, /admin
      if (['/', '/signin', '/catalog', '/glossary', '/admin'].includes(pathname)) {
        res.sendFile(path.join(publicDir, 'index.html'));
        return;
      }
      res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } });
      return;
    }
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.map')) {
      res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } });
      return;
    }
    res.sendFile(filePath);
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    void _next;
    sendError(res, err);
  });

  fanout.start();
  sender.start();
  startProbes(state);
  void evidence.ensureBucket().catch(() => undefined);

  return { app, state };
}

export { ERR };
