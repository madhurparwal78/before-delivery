import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { config, settings } from './config';
import { createSchema, markDatabaseReady, one, query } from './db';
import { loadClockFromDatabase, serverNow } from './clock';
import { AppError } from './errors';
import { createSession, currentActor, landingFor } from './auth';
import { sessionRouter } from './routes/session';
import { appointmentRouter } from './routes/appointments';
import { wardRouter } from './routes/ward';
import { patientRouter } from './routes/patients';
import { invoiceRouter } from './routes/invoices';
import { stockRouter } from './routes/stock';
import { staffRouter } from './routes/staff';
import { publicRouter } from './routes/public';
import { gradingRouter } from './routes/grading';
import { seedOnFirstStart } from './seed';
import { startTicker } from './ticker';

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const STAFF_PATHS = [
  '/today',
  '/ward',
  '/patients',
  '/consult',
  '/invoices',
  '/stock',
  '/staff',
];

const app = express();
app.set('trust proxy', false);
app.disable('x-powered-by');

const uploadLimit = settings.uploadMaxMb * 1_048_576 + 1_048_576;

app.use((request, response, next) => {
  if (request.path.endsWith('/files') && request.method === 'POST') {
    express.raw({ type: () => true, limit: uploadLimit })(request, response, next);
    return;
  }
  express.json({ limit: 100_000, type: ['application/json', 'text/plain'] })(request, response, next);
});

app.use(sessionRouter);
app.use(gradingRouter);
app.use(publicRouter);
app.use(appointmentRouter);
app.use(wardRouter);
app.use(patientRouter);
app.use(invoiceRouter);
app.use(stockRouter);
app.use(staffRouter);

app.get('/auth/link/:token', async (request, response) => {
  try {
    const row = await one<{ user_id: string }>(
      'select user_id from login_tokens where token = $1 and used_at is null',
      [request.params.token],
    );
    if (!row) {
      response.redirect(302, '/login');
      return;
    }
    await query('update login_tokens set used_at = $2 where token = $1', [
      request.params.token,
      new Date(serverNow()).toISOString(),
    ]);
    await createSession(row.user_id, response);
    response.redirect(302, landingFor(request.query.next));
  } catch {
    response.redirect(302, '/login');
  }
});

app.use('/api', (_request, _response, next) => next(new AppError('not_found')));

app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    setHeaders: (response) => {
      response.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

app.get('*', async (request, response) => {
  const needsSession = STAFF_PATHS.some(
    (prefix) => request.path === prefix || request.path.startsWith(`${prefix}/`),
  );
  if (needsSession) {
    const actor = await currentActor(request).catch(() => null);
    if (!actor) {
      const target = request.originalUrl;
      response.redirect(302, `/login?next=${encodeURIComponent(target)}`);
      return;
    }
  }
  response.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  if (error instanceof AppError) {
    response.status(error.status).json(error.body);
    return;
  }
  const typed = error as { type?: string; status?: number } | null;
  if (typed?.type === 'entity.too.large') {
    const failure = new AppError('payload_too_large');
    response.status(failure.status).json(failure.body);
    return;
  }
  if (typed?.type === 'entity.parse.failed') {
    const failure = new AppError('validation_failed', { field: 'body', label: 'body', shape: 'invalid' });
    response.status(failure.status).json(failure.body);
    return;
  }
  response.status(500).json({ error: 'database_unavailable', message: 'The clinic database is unavailable. Try again shortly.' });
});

async function connectWithRetry(): Promise<void> {
  for (;;) {
    try {
      await createSchema();
      await loadClockFromDatabase();
      await seedOnFirstStart();
      markDatabaseReady(true);
      return;
    } catch {
      markDatabaseReady(false);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

app.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`Roundbook listening on 0.0.0.0:${config.port}\n`);
});

void connectWithRetry().then(() => {
  startTicker();
});
