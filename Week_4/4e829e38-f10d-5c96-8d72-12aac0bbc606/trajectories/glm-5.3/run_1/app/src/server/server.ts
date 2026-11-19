import express, { Request, Response, NextFunction } from 'express';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { query, db } from './db';
import { applySchema } from './schema';
import { applySeed } from './seed';
import { env, loadSecrets } from './env';
import { createObjectStore, ObjectStore } from './objectstore';
import { createMailer, Mailer } from './mailer';
import { authRouter } from './routes-auth';
import { projectsRouter } from './routes-projects';
import { tasksRouter } from './routes-tasks';
import { rulesRouter } from './routes-rules';
import { approvalsRouter } from './routes-approvals';
import { inboxRouter } from './routes-inbox';
import { goalsRouter } from './routes-goals';
import { workloadRouter } from './routes-workload';
import { formsRouter } from './routes-forms';
import { filesRouter } from './routes-files';
import { eventsRouter } from './routes-events';
import { presenceRouter } from './routes-presence';
import { gradingRouter } from './routes-grading';
import { gradingAuth } from './apiutil';
import { personFromCookie } from './auth';
import { renderPage, PageName } from './pages';

let store: ObjectStore = createObjectStore();
let mailer: Mailer = createMailer();
let schemaReady = false;

async function ready(): Promise<boolean> {
  if (!schemaReady) return false;
  try {
    const r = await query<{ c: string }>(`SELECT 1::text AS c`);
    void r;
    return true;
  } catch {
    return false;
  }
}

async function storeUp(): Promise<boolean> {
  return store.up();
}

export async function start(): Promise<void> {
  loadSecrets();
  const app = express();
  const e = env();

  store = createObjectStore();
  mailer = createMailer();

  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/health')) { next(); return; }
    if (req.path.startsWith('/api/')) {
      if (!schemaReady) {
        res.status(503).json({ error: 'starting' });
        return;
      }
      next();
      return;
    }
    next();
  });

  app.get('/api/health', async (_req, res) => {
    const up = await ready();
    if (!up) {
      res.status(503).json({ status: 'starting' });
      return;
    }
    const storeOk = await Promise.race([
      storeUp(),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2500)),
    ]);
    if (!storeOk) {
      res.status(200).json({ status: 'unavailable' });
      return;
    }
    res.status(200).json({ status: 'ok' });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      moveMs: e.limits.moveMs,
      progressMs: e.limits.progressMs,
      toastMs: e.limits.toastMs,
      holdTimeoutMs: e.limits.holdTimeoutMs,
    });
  });

  if (e.grading) {
    const gr = gradingRouter(mailer);
    const seedHandler = (req: Request, res: Response, next: NextFunction): void => { gr(req, res, next); };
    app.post('/grading/seed', gradingAuth, seedHandler);
    app.post('/grading/clock', gradingAuth, seedHandler);
    app.use('/grading', gradingAuth, gr);
  }

  app.use(authRouter(mailer));
  app.use(projectsRouter());
  app.use(tasksRouter());
  app.use(rulesRouter());
  app.use(approvalsRouter());
  app.use(inboxRouter());
  app.use(goalsRouter());
  app.use(workloadRouter());
  app.use(formsRouter());
  app.use(filesRouter(store));
  app.use(eventsRouter());
  app.use(presenceRouter());

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found' });
  });

  const pub = path.join(__dirname, '..', '..', 'public');
  app.use('/assets', express.static(path.join(pub, 'assets'), { fallthrough: false }));
  app.use('/fonts', express.static(path.join(pub, 'fonts'), { fallthrough: false }));
  app.use('/app.js', express.static(path.join(pub, 'app.js'), { fallthrough: false }));
  app.use('/app.css', express.static(path.join(pub, 'app.css'), { fallthrough: false }));
  app.use('/pages.css', express.static(path.join(pub, 'pages.css'), { fallthrough: false }));

  const pageNames: PageName[] = ['welcome', 'account', 'mywork', 'project', 'rules', 'goals', 'workload', 'inbox', 'form', 'notfound'];
  app.get('/', async (req, res) => {
    const person = schemaReady ? await personFromCookie(req).catch(() => null) : null;
    if (person) {
      res.type('html').send(renderPage('mywork', { personName: person.name }));
    } else {
      res.type('html').send(renderPage('welcome', {}));
    }
  });
  for (const name of pageNames) {
    if (name === 'welcome' || name === 'mywork' || name === 'notfound') continue;
    const route = name === 'project' ? '/projects/:id' : name === 'rules' ? '/projects/:id/rules'
      : name === 'workload' ? '/workload/:teamId' : name === 'form' ? '/f/:slug' : `/${name}`;
    app.get(route, async (req, res) => {
      const person = schemaReady ? await personFromCookie(req).catch(() => null) : null;
      res.type('html').send(renderPage(name, { personName: person?.name ?? '' }));
    });
  }
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.type('html').send(renderPage('welcome', {}));
  });

  const server = http.createServer(app);
  server.listen(e.port, '0.0.0.0', () => {
    console.log(`everyweek serving on ${e.port}`);
  });

  const boot = async (): Promise<void> => {
    try {
      await applySchema();
      await applySeed();
      schemaReady = true;
      console.log('schema ready');
    } catch (err) {
      console.error('waiting for database', err instanceof Error ? err.message : err);
      setTimeout(boot, 1000);
    }
  };
  void boot();
}
