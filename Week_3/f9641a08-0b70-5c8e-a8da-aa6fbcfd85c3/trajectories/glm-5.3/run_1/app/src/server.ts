import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { CONFIG } from './config.js';
import { pool, withClient, inTransaction } from './db/pool.js';
import { applySchemaAndSeed } from './db/migrate.js';
import { ApiError } from './domain/errors.js';
import { publicRouter } from './api/public.js';
import { accountRouter } from './api/account.js';
import { cartRouter } from './api/cart.js';
import { checkoutRouter } from './api/checkout.js';
import { orderRouter } from './api/orders.js';
import { caseRouter } from './api/cases.js';
import { staffRouter } from './api/staff.js';
import { liveHandler } from './api/live.js';
import { gradingSetup } from './api/grading.js';
import { readSession, SESSION_COOKIE } from './api/session.js';
import { retryPendingEmails } from './domain/notify.js';
import { releaseLapsedHolds } from './api/checkout.js';
import { pushAll } from './services/indexer.js';
import { ensureIndex } from './services/search.js';
import { upload } from './uploads.js';

const app = express();
app.disable('x-powered-by');

type Handler = (req: Request, res: Response) => void | Promise<void>;
/** Express 4 does not forward rejected async handlers; this wrapper does. */
export function h(fn: Handler): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    void Promise.resolve(fn(req, res)).catch(next);
  };
}

// --- server boundary --------------------------------------------------------

const DENIED_PATHS = /^\/(\.env|\.git|package\.json|package-lock\.json|tsconfig\.json|run\.json|src\/|dist\/|node_modules\/|scripts\/|client\/|.*\.map$|THIRD_PARTY_NOTICES\.md)/;

app.use((req: Request, res: Response, next: NextFunction) => {
  if (DENIED_PATHS.test(req.path)) {
    res.status(404).json({ error: 'not_found', message: "We couldn't find that." });
    return;
  }
  next();
});

// Same-origin writes only.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.header('origin');
    if (origin !== undefined && origin !== '') {
      try {
        const originHost = new URL(origin).host;
        const ownHost = new URL(CONFIG.publicUrl).host;
        if (originHost !== ownHost) {
          res.status(403).json({ error: 'cross_origin', message: 'Requests must come from the Roam House site.' });
          return;
        }
      } catch {
        res.status(403).json({ error: 'cross_origin', message: 'Requests must come from the Roam House site.' });
        return;
      }
    }
  }
  next();
});

// JSON bodies with the published limit and content-type rules.
const JSON_PATHS = /^\/api\//;
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!JSON_PATHS.test(req.path)) {
    next();
    return;
  }
  const expectsBody = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH';
  const hasBody = (req.header('content-length') ?? '0') !== '0' || (req.header('transfer-encoding') ?? '') !== '';
  const contentType = req.header('content-type') ?? '';
  const isUpload = req.path === '/api/warranty/evidence' || (req.path.startsWith('/api/admin/products/') && req.path.endsWith('/images'));

  if (isUpload && contentType !== '' && !contentType.startsWith('multipart/form-data')) {
    res.status(415).json({ error: 'unsupported_media_type', message: 'Send the request as JSON.' });
    return;
  }
  // A body on a JSON endpoint must be JSON; a bodyless write carries no content type.
  if (hasBody && !isUpload) {
    if (expectsBody && !contentType.startsWith('application/json')) {
      res.status(415).json({ error: 'unsupported_media_type', message: 'Send the request as JSON.' });
      return;
    }
    if (!expectsBody && contentType !== '' && !contentType.startsWith('application/json')) {
      res.status(415).json({ error: 'unsupported_media_type', message: 'Send the request as JSON.' });
      return;
    }
  }
  next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
  const expected = req.header('content-length');
  if (expected !== undefined && Number(expected) > CONFIG.jsonBodyLimitBytes && !req.path.includes('/warranty/evidence') && !(req.path.startsWith('/api/admin/products/') && req.path.endsWith('/images'))) {
    res.status(413).json({ error: 'too_large', message: 'This request is too large.' });
    return;
  }
  next();
});

app.use(express.json({ limit: CONFIG.jsonBodyLimitBytes }));
app.use(cookieParser());

// Uploads: bounded, with the file-type decided by content.
app.use('/api/warranty/evidence', upload.single('file'));
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'POST' && req.path.startsWith('/api/admin/products/') && req.path.endsWith('/images')) {
    upload.single('file')(req, res, (err) => next(err));
    return;
  }
  next();
});

// --- session ------------------------------------------------------------------

app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await readSession(req, res);
    (req as unknown as { session: unknown }).session = session;
    next();
  } catch (err) {
    next(err);
  }
});

// --- routes -------------------------------------------------------------------

app.use('/api', publicRouter);
app.use('/api', accountRouter);
app.use('/api', cartRouter);
app.use('/api', checkoutRouter);
app.use('/api', orderRouter);
app.use('/api', caseRouter);
app.use('/api/admin', staffRouter);

app.get('/api/live', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await liveHandler(req, res);
  } catch (err) {
    next(err);
  }
});

if (CONFIG.gradingToken !== null) {
  app.post('/api/grading/setup', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await gradingSetup(req, res);
    } catch (err) {
      next(err);
    }
  });
}

// Audit entries can never be changed.
app.use('/api/admin/audit', (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'GET') {
    next();
    return;
  }
  res.status(405).json({ error: 'method_not_allowed', message: "Audit entries can't be changed." });
});

// Known API paths with an unsupported method answer method_not_allowed.
const KNOWN_METHODS: [RegExp, string[]][] = [
  [/^\/health$/, ['GET']],
  [/^\/config$/, ['GET']],
  [/^\/collections$/, ['GET']],
  [/^\/search$/, ['GET']],
  [/^\/search\/suggest$/, ['GET']],
  [/^\/products\/[^/]+$/, ['GET']],
  [/^\/variants\/[^/]+\/stock$/, ['GET']],
  [/^\/airlines$/, ['GET']],
  [/^\/fit$/, ['GET']],
  [/^\/accounts$/, ['POST']],
  [/^\/session$/, ['POST', 'DELETE']],
  [/^\/me$/, ['GET']],
  [/^\/addresses$/, ['GET', 'POST']],
  [/^\/addresses\/[^/]+$/, ['DELETE']],
  [/^\/wishlist$/, ['GET']],
  [/^\/wishlist\/[^/]+$/, ['PUT', 'DELETE']],
  [/^\/notifications$/, ['GET']],
  [/^\/gift-cards\/[^/]+$/, ['GET']],
  [/^\/cart$/, ['GET']],
  [/^\/cart\/lines$/, ['POST']],
  [/^\/cart\/lines\/[^/]+$/, ['PATCH', 'DELETE']],
  [/^\/cart\/codes$/, ['POST']],
  [/^\/cart\/discount$/, ['DELETE']],
  [/^\/cart\/gift-card$/, ['DELETE']],
  [/^\/checkout$/, ['POST']],
  [/^\/checkout\/[^/]+$/, ['GET', 'PATCH']],
  [/^\/checkout\/[^/]+\/reserve$/, ['POST']],
  [/^\/orders$/, ['GET', 'POST']],
  [/^\/orders\/[^/]+$/, ['GET']],
  [/^\/orders\/[^/]+\/cancel$/, ['POST']],
  [/^\/returns$/, ['POST', 'GET']],
  [/^\/returns\/[^/]+$/, ['GET']],
  [/^\/trials$/, ['POST', 'GET']],
  [/^\/trials\/[^/]+$/, ['GET']],
  [/^\/warranty\/registrations$/, ['POST']],
  [/^\/warranty\/evidence$/, ['POST']],
  [/^\/warranty\/evidence\/[^/]+\/content$/, ['GET']],
  [/^\/warranty\/claims$/, ['POST', 'GET']],
  [/^\/warranty\/claims\/[^/]+$/, ['GET']],
  [/^\/live$/, ['GET']],
  [/^\/admin\/products$/, ['GET']],
  [/^\/admin\/products\/[^/]+$/, ['GET', 'PATCH']],
  [/^\/admin\/products\/[^/]+\/images$/, ['POST']],
  [/^\/admin\/variants\/[^/]+$/, ['PATCH']],
  [/^\/admin\/inventory$/, ['GET']],
  [/^\/admin\/inventory\/[^/]+\/movements$/, ['GET']],
  [/^\/admin\/orders$/, ['GET']],
  [/^\/admin\/orders\/[^/]+$/, ['GET', 'POST']],
  [/^\/admin\/orders\/[^/]+\/shipments$/, ['POST']],
  [/^\/admin\/returns(?:\/[^/]+)?$/, ['GET', 'POST']],
  [/^\/admin\/trials(?:\/[^/]+)?$/, ['GET', 'POST']],
  [/^\/admin\/warranty\/evidence\/[^/]+\/content$/, ['GET']],
  [/^\/admin\/warranty(?:\/[^/]+)?$/, ['GET', 'POST']],
  [/^\/admin\/discount-codes$/, ['GET', 'POST']],
  [/^\/admin\/gift-cards\/[^/]+$/, ['GET']],
  [/^\/admin\/audit\/[^/]+$/, ['PUT', 'PATCH', 'DELETE']],
  [/^\/admin\/audit$/, ['GET']],
  [/^\/admin\/metrics$/, ['GET']],
  [/^\/admin\/reports\/orders\.csv$/, ['GET']],
  [/^\/admin\/reports\/inventory\.csv$/, ['GET']],
];

app.use('/api', (req: Request, res: Response) => {
  const path = req.path;
  const matched = KNOWN_METHODS.find(([pattern]) => pattern.test(path));
  if (matched !== undefined && !matched[1].includes(req.method)) {
    res.status(405).json({ error: 'method_not_allowed', message: "That action isn't allowed here." });
    return;
  }
  res.status(404).json({ error: 'not_found', message: "We couldn't find that." });
});

// --- media --------------------------------------------------------------------

app.get('/media/products/:imageId', async (req: Request, res: Response) => {
  const { imageId } = req.params;
  const row = await pool.query<{ content_type: string; bytes: Buffer | null; storage: string; product_slug: string }>(
    `SELECT content_type, bytes, storage, product_slug FROM product_images WHERE id = $1`, [imageId]);
  if (row.rows.length === 0) {
    res.status(404).json({ error: 'not_found', message: "We couldn't find that." });
    return;
  }
  const image = row.rows[0];
  let content: Buffer | null = null;
  if (image.storage === 'db') {
    content = image.bytes;
  } else {
    const { s3 } = await import('./services/s3.js');
    content = await s3.get(`products/${image.product_slug}/${imageId}`);
  }
  if (content === null) {
    res.status(404).json({ error: 'not_found', message: "We couldn't find that." });
    return;
  }
  res.setHeader('Content-Type', image.content_type);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).send(content);
});

// --- static pages -------------------------------------------------------------

app.use(express.static('public', { index: false, maxAge: '1h' }));

const PAGE_ROUTES = ['/', '/collections/:slug', '/products/:slug', '/compare', '/wishlist', '/care', '/sign-in', '/register', '/bag', '/account', '/checkout/:id', '/orders/:number', '/admin', '/admin/:page', '/admin/:page/:id', '/admin/:page/:id/:sub'];

for (const route of PAGE_ROUTES) {
  app.get(route, (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile('index.html', { root: 'public' });
  });
}

app.use((req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(404).sendFile('index.html', { root: 'public' });
});

// --- error shape ---------------------------------------------------------------

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    const body: Record<string, unknown> = { error: err.code, message: err.message };
    if (err.fields !== null) body.fields = err.fields;
    res.status(err.status).json(body);
    return;
  }
  const anyErr = err as { type?: string; message?: string };
  if (anyErr !== null && typeof anyErr === 'object' && (anyErr.type === 'entity.too.large' || (anyErr as { statusCode?: number }).statusCode === 413)) {
    res.status(413).json({ error: 'too_large', message: 'This request is too large.' });
    return;
  }
  console.error('unexpected error', err);
  res.status(500).json({ error: 'internal_error', message: 'Something went wrong on our side. Try again.' });
});

// --- boot ----------------------------------------------------------------------

async function waitForDatabase(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error('PostgreSQL unreachable after 60 seconds');
}

async function start(): Promise<void> {
  await waitForDatabase();
  await applySchemaAndSeed();
  try {
    await ensureIndex();
    await withClient((client) => pushAll(client));
  } catch {
    // Meilisearch is down; the sweep retries every 30 seconds.
  }
  setInterval(() => {
    void (async () => {
      try {
        await ensureIndex();
        await withClient((client) => pushAll(client));
        await inTransaction(async (client) => {
          const expired = await client.query<{ id: string }>(
            `SELECT id::TEXT AS id FROM holds WHERE status = 'active' AND expires_at <= now()`);
          const ids = expired.rows.map((r) => Number(r.id));
          for (const id of ids) {
            const { releaseHold } = await import('./api/checkout.js');
            await releaseHold(client, id);
          }
          await retryPendingEmails(client);
        });
      } catch {
        // retried on the next sweep
      }
    })();
  }, 30_000);

  app.listen(CONFIG.port, '0.0.0.0', () => {
    console.log(`Roam House Atelier listening on port ${CONFIG.port}`);
  });
}

void start();
